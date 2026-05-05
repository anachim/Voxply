import type { Reaction } from "../types";

export function MessageReactions({
  reactions,
  onToggle,
}: {
  reactions: Reaction[];
  onToggle: (emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="message-reactions">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          className={`reaction-chip ${r.me ? "mine" : ""}`}
          onClick={() => onToggle(r.emoji)}
          title={r.me ? "Remove your reaction" : "Add your reaction"}
        >
          <span className="reaction-emoji">{r.emoji}</span>
          <span className="reaction-count">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
