import React from "react";

/**
 * Pipeline-style markdown renderer. Each pass walks the current array of
 * (string | ReactNode) parts and replaces any matches in the *string*
 * parts with the rendered React node. Because we never feed user input
 * into innerHTML, this is XSS-safe by construction — React escapes text
 * children automatically.
 *
 * Order matters: code blocks first (their content shouldn't be parsed
 * for any other rules), then inline code, then bold, italic, mentions,
 * URLs.
 */
type Part = string | React.ReactNode;

function splitOnPattern(
  parts: Part[],
  re: RegExp,
  render: (match: RegExpExecArray, key: string) => React.ReactNode,
): Part[] {
  const out: Part[] = [];
  parts.forEach((p, i) => {
    if (typeof p !== "string") {
      out.push(p);
      return;
    }
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let n = 0;
    while ((m = rx.exec(p)) !== null) {
      if (m.index > lastIdx) out.push(p.slice(lastIdx, m.index));
      out.push(render(m, `${i}-${n++}`));
      lastIdx = m.index + m[0].length;
      // Guard against zero-width matches looping forever.
      if (m[0].length === 0) rx.lastIndex++;
    }
    if (lastIdx < p.length) out.push(p.slice(lastIdx));
  });
  return out;
}

export function MessageContent({
  content,
  knownNames,
  myName,
}: {
  content: string;
  knownNames: Set<string>;
  myName: string | null;
}) {
  const myLower = myName?.toLowerCase() ?? null;
  let parts: Part[] = [content];

  // Fenced code blocks. Optionally accept a language hint on the same line
  // as the opening fence: ```rust\n...\n```. The hint becomes a small label
  // above the block; we don't actually highlight by language yet, but the
  // tag is preserved instead of leaking into the rendered code.
  parts = splitOnPattern(
    parts,
    /```([A-Za-z0-9_+-]*)\n?([\s\S]+?)```/,
    (m, key) => {
      const lang = m[1] || "";
      const body = m[2].replace(/^\n/, "").replace(/\n$/, "");
      return (
        <div key={key} className="md-codeblock-wrap">
          {lang && <div className="md-codeblock-lang">{lang}</div>}
          <pre className="md-codeblock">
            <code>{body}</code>
          </pre>
        </div>
      );
    },
  );

  // Inline code
  parts = splitOnPattern(parts, /`([^`\n]+)`/, (m, key) => (
    <code key={key} className="md-code">
      {m[1]}
    </code>
  ));

  // Bold (must run before italic since ** would otherwise match * twice)
  parts = splitOnPattern(parts, /\*\*([^*\n]+)\*\*/, (m, key) => (
    <strong key={key}>{m[1]}</strong>
  ));

  // Italic — single asterisk with no spaces flanking.
  parts = splitOnPattern(parts, /\*([^*\s][^*\n]*[^*\s]|[^*\s])\*/, (m, key) => (
    <em key={key}>{m[1]}</em>
  ));

  // Bare URLs → external links
  parts = splitOnPattern(parts, /https?:\/\/[^\s<]+/, (m, key) => (
    <a key={key} href={m[0]} target="_blank" rel="noreferrer">
      {m[0]}
    </a>
  ));

  // Mentions — last so they don't collide with URL/markdown chars
  parts = splitOnPattern(parts, /@([\w.\-]+)/, (m, key) => {
    const name = m[1].toLowerCase();
    if (!knownNames.has(name)) return m[0];
    const isSelf = myLower !== null && name === myLower;
    return (
      <span key={key} className={`mention ${isSelf ? "mention-self" : ""}`}>
        {m[0]}
      </span>
    );
  });

  return <>{parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : p))}</>;
}
