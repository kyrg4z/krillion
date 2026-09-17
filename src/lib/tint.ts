import type { CSSProperties } from "react";

/**
 * Custom properties resolve where they are declared, so a nested `--cat` alone
 * cannot re-derive `--accent`. Every tinted subtree sets all three together.
 */
export function tint(hue: number): CSSProperties {
  return {
    "--cat": String(hue),
    "--accent": `hsl(${hue} 90% 68%)`,
    "--accent-soft": `hsl(${hue} 80% 68% / 0.16)`,
  } as CSSProperties;
}
