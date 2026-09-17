export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-[family-name:var(--font-display)] font-semibold tracking-[-0.045em] ${className}`}>
      Carrier
    </span>
  );
}
