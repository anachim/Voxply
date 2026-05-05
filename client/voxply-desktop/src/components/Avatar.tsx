export function Avatar({
  src,
  name,
  size = 24,
}: {
  src?: string | null;
  name: string | null | undefined;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="avatar-img"
        style={{ width: size, height: size }}
      />
    );
  }
  const initials = (name || "?").trim().slice(0, 2).toUpperCase();
  return (
    <span
      className="avatar-fallback"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initials}
    </span>
  );
}
