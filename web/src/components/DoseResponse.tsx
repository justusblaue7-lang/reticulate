import { signed } from "../format";
import type { SensitivityResult } from "../types";

const W = 214;
const H = 132;
const M = { top: 10, right: 10, bottom: 22, left: 24 };
const x = (v: number) => M.left + (v / 10) * (W - M.left - M.right);
const y = (w: number) => H - M.bottom - (w / 10) * (H - M.top - M.bottom);

/** One small multiple per factor: weight against the varied dimension or trait, with the OLS fit. */
export function DoseResponse({ result, label, limit = 8 }: { result: SensitivityResult; label: string; limit?: number }) {
  return (
    <div className="dose-grid">
      {result.curves.slice(0, limit).map((c) => {
        const n = c.points.reduce((s, p) => s + p.n, 0);
        const mx = c.points.reduce((s, p) => s + p.value * p.n, 0) / n;
        const my = c.points.reduce((s, p) => s + p.mean * p.n, 0) / n;
        const line = (v: number) => Math.max(0, Math.min(10, my + c.slope * (v - mx)));
        const lo = Math.min(...result.values);
        const hi = Math.max(...result.values);
        return (
          <figure key={c.factor_id} className="dose-panel">
            <figcaption>
              <span>{c.name}</span>
              <span className="mono">
                {signed(c.slope)}
                {c.slope_se !== null && ` ± ${c.slope_se.toFixed(2)}`}
              </span>
            </figcaption>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${c.name} by ${label}`}>
              {[0, 5, 10].map((w) => (
                <g key={w}>
                  <line x1={M.left} x2={W - M.right} y1={y(w)} y2={y(w)} className="grid" />
                  <text x={M.left - 6} y={y(w)} className="tick" textAnchor="end" dominantBaseline="middle">
                    {w}
                  </text>
                </g>
              ))}
              {result.values.map((v) => (
                <text key={v} x={x(v)} y={H - 6} className="tick" textAnchor="middle">
                  {v}
                </text>
              ))}
              <line x1={x(lo)} x2={x(hi)} y1={y(line(lo))} y2={y(line(hi))} className="fit" />
              {c.points.map((p) => (
                <g key={p.value}>
                  <line x1={x(p.value)} x2={x(p.value)} y1={y(p.min)} y2={y(p.max)} className="whisker" />
                  <circle cx={x(p.value)} cy={y(p.mean)} r={3.4} className="point">
                    <title>
                      {label} {p.value}: mean weight {p.mean.toFixed(1)} (range {p.min}–{p.max}, n = {p.n})
                    </title>
                  </circle>
                </g>
              ))}
            </svg>
          </figure>
        );
      })}
    </div>
  );
}
