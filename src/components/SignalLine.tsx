"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  /** Null while idle, then "right" or "wrong" to spike the trace. */
  pulse?: "right" | "wrong" | null;
  /** Changing this redraws the resting waveform. */
  seed?: number;
  height?: number;
};

const WIDTH = 1200;

function trace(seed: number, amplitude: number, spike: number): string {
  const points: string[] = [];
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * WIDTH;
    const wobble =
      Math.sin(t * 9.1 + seed) * 0.55 +
      Math.sin(t * 21.7 + seed * 1.7) * 0.28 +
      Math.sin(t * 43.3 + seed * 0.4) * 0.14;
    const envelope = spike ? Math.exp(-((t - 0.5) ** 2) / 0.012) * spike : 0;
    const y = 0.5 + wobble * amplitude * 0.5 + envelope;
    points.push(`${x.toFixed(1)},${(y * 100).toFixed(2)}`);
  }
  return `M ${points.join(" L ")}`;
}

/**
 * A single running trace across the top of the round. It is the only ambient
 * motion in the game, and it answers you: a spike when you are right, a
 * collapse when you are not.
 */
export default function SignalLine({ pulse = null, seed = 1, height = 46 }: Props) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setPhase((p) => p + 0.35), 120);
    return () => window.clearInterval(id);
  }, []);

  const d = useMemo(() => {
    if (pulse === "right") return trace(seed + phase, 0.32, -42);
    if (pulse === "wrong") return trace(seed + phase, 0.08, 0);
    return trace(seed + phase, 0.3, 0);
  }, [pulse, seed, phase]);

  return (
    <div className="signal-wrap" style={{ height }} aria-hidden="true">
      <svg viewBox={`0 0 ${WIDTH} 100`} preserveAspectRatio="none" className="h-full w-full">
        <path d={d} className="signal-line" data-pulse={pulse ?? undefined} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="signal-sweep" />
    </div>
  );
}
