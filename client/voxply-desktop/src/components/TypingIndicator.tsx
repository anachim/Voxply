export function TypingIndicator({ typers }: { typers: { name: string }[] }) {
  if (typers.length === 0) return null;
  let label: string;
  if (typers.length === 1) label = `${typers[0].name} is typing…`;
  else if (typers.length === 2)
    label = `${typers[0].name} and ${typers[1].name} are typing…`;
  else if (typers.length === 3)
    label = `${typers[0].name}, ${typers[1].name}, and ${typers[2].name} are typing…`;
  else label = "Several people are typing…";
  return <div className="typing-indicator">{label}</div>;
}
