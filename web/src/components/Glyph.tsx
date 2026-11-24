// The avatar of a cognitive profile: a reticulum whose outline is the six attitude
// scores (clockwise from the top, in the order of the science layer). The dashed ring
// marks the midpoint (5); parts of the outline beyond it are above-midpoint leanings.

interface Props {
  scores: number[]; // 0–10, one per dimension
  size?: number;
  rings?: number;
  labels?: string[]; // optional axis labels for the large version
}

type Point = [number, number];

function closedCurve(points: Point[]): string {
  // Catmull–Rom through the points, as cubic Béziers.
  const n = points.length;
  let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d + "Z";
}

export function Glyph({ scores, size = 44, rings = 4, labels }: Props) {
  // Labels need room at the sides (long words) more than above and below.
  const padX = labels ? size * 0.42 : 0;
  const padY = labels ? size * 0.13 : 0;
  const width = size + padX * 2;
  const height = size + padY * 2;
  const cx = width / 2;
  const cy = height / 2;
  const r0 = size * 0.14;
  const r1 = size * 0.47;
  const n = scores.length;
  const angle = (i: number, twist = 0) => -Math.PI / 2 + (i * 2 * Math.PI) / n + twist;
  const radius = (score: number, k = 1) => r0 + (r1 - r0) * (score / 10) * k;
  const point = (i: number, r: number, twist = 0): Point => [cx + r * Math.cos(angle(i, twist)), cy + r * Math.sin(angle(i, twist))];
  const outline = scores.map((s, i) => point(i, radius(s)));
  const fine = size < 80 ? 0.6 : 0.7;

  return (
    <svg className="glyph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Profile glyph">
      <circle cx={cx} cy={cy} r={r0} fill="none" stroke="var(--line-2)" strokeWidth={fine} />
      <circle cx={cx} cy={cy} r={radius(5)} fill="none" stroke="var(--line-2)" strokeWidth={fine} strokeDasharray="1.5 2.5" />
      {Array.from({ length: rings }, (_, k) => {
        const f = (k + 1) / (rings + 1);
        const twist = (k + 1) * 0.035;
        return (
          <path
            key={k}
            d={closedCurve(scores.map((s, i) => point(i, r0 + (radius(s) - r0) * f, twist)))}
            fill="none"
            stroke="var(--cream-3)"
            strokeWidth={fine * 0.8}
            opacity={0.55}
          />
        );
      })}
      {outline.map(([x, y], i) => {
        const [x0, y0] = point(i, r0);
        return <line key={i} x1={x0} y1={y0} x2={x} y2={y} stroke="var(--cream-3)" strokeWidth={fine * 0.8} />;
      })}
      <path d={closedCurve(outline)} fill="none" stroke="var(--cream)" strokeWidth={size < 80 ? 1 : 1.3} />
      {outline.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={size < 80 ? 1.4 : 2.2} fill="var(--cream)" />
      ))}
      {labels?.map((label, i) => {
        const cos = Math.cos(angle(i));
        const [x, y] = point(i, r1 + (Math.abs(cos) > 0.3 ? 5 : 11));
        const anchor = cos < -0.3 ? "end" : cos > 0.3 ? "start" : "middle";
        return (
          <text key={label} x={x} y={y} className="glyph-label" textAnchor={anchor} dominantBaseline="middle">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
