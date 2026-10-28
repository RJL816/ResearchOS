import type { MetricPoint } from "@/lib/api";
import { fmtNumber } from "@/lib/format";

/** Lightweight inline SVG line chart — no chart library needed at this scale. */
export function MetricChart({ points, domain, color }: { points: MetricPoint[]; domain?: { min: number; max: number; start: number; end: number }; color?: string }) {
  if (points.length < 2) {
    return <div className="text-muted-foreground text-xs">数据点不足（{points.length}）</div>;
  }
  const width = 520;
  const height = 96;
  const pad = 5;
  const values = points.map((p) => p.value);
  let min = domain?.min ?? Math.min(...values);
  let max = domain?.max ?? Math.max(...values);
  if (max - min < 1e-9) {
    min -= 0.5;
    max += 0.5;
  }
  const start = domain?.start ?? points[0].step;
  const end = domain?.end ?? points[points.length - 1].step;
  const x = (i: number) => pad + ((points[i].step - start) / (end - start || 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - min) / (max - min)) * (height - 2 * pad);
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <div className="text-muted-foreground" style={color ? { color } : undefined}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" preserveAspectRatio="none">
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="3" fill="currentColor" />
      </svg>
      <div className="mt-1 flex justify-between text-xs">
        <span>范围 {fmtNumber(min)}–{fmtNumber(max)}</span>
        <span>step {points[0].step}: {fmtNumber(points[0].value)}</span>
        <span>
          最新 step {last.step}: <span className="text-foreground font-medium">{fmtNumber(last.value)}</span>
        </span>
      </div>
    </div>
  );
}
