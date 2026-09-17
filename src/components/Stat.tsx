export default function Stat({
  value,
  label,
  tone = "ink",
}: {
  value: string;
  label: string;
  tone?: "ink" | "accent" | "true" | "false";
}) {
  const colour =
    tone === "accent" ? "text-[var(--accent)]" : tone === "true" ? "text-true" : tone === "false" ? "text-false" : "text-ink";
  return (
    <div>
      <div className={`font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight tabular-nums ${colour}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[0.8125rem] text-faint">{label}</div>
    </div>
  );
}
