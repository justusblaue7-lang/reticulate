// Geometry of a cameo portrait: a bust in right-facing profile, built from anatomical
// landmarks that the phenotype moves. Pure functions; Cameo.tsx renders the result.
//
// Proportions follow the Loomis construction in a 200 × 240 frame: a cranial sphere
// (centre 95,88, radius 48) with the brow line through its centre, facial thirds of 34
// units (hairline 54, brow 88, nose base 122, chin 156), the ear between the brow and nose
// lines just behind the sphere's centre, and the jaw angle below the ear.

import type { Phenotype } from "../types";

export type P = [number, number];
interface Node {
  p: P;
  corner?: boolean;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const scale = (a: P, k: number): P => [a[0] * k, a[1] * k];
const f2 = (n: number) => n.toFixed(2);

/** Catmull–Rom spline through nodes, with sharp corners where marked. */
export function spline(nodes: Node[], closed = false, tension = 1): string {
  const n = nodes.length;
  const at = (i: number) => nodes[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${f2(nodes[0].p[0])},${f2(nodes[0].p[1])}`;
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = at(i);
    const b = at(i + 1);
    const ta = a.corner ? ([0, 0] as P) : scale(sub(at(i + 1).p, at(i - 1).p), tension / 6);
    const tb = b.corner ? ([0, 0] as P) : scale(sub(at(i + 2).p, a.p), tension / 6);
    const c1 = add(a.p, ta);
    const c2 = sub(b.p, tb);
    d += `C${f2(c1[0])},${f2(c1[1])} ${f2(c2[0])},${f2(c2[1])} ${f2(b.p[0])},${f2(b.p[1])}`;
  }
  return closed ? d + "Z" : d;
}

const nodes = (list: P[], corners: number[] = []): Node[] => list.map((p, i) => ({ p, corner: corners.includes(i) }));
const curve = (list: P[], corners: number[] = []) => spline(nodes(list, corners));
const shape = (list: P[], corners: number[] = []) => spline(nodes(list, corners), true);

/** Offset a polyline outward by thickness(t), t in 0..1 along it; outward = left of a
 *  path traced front → crown → nape (counter-clockwise on screen). */
function offset(line: P[], thickness: (t: number, i: number) => number): P[] {
  return line.map((p, i) => {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    return add(p, scale([-dy / len, dx / len], thickness(i / (line.length - 1), i)));
  });
}

/** A point at fraction t of a polyline's length. */
function along(line: P[], t: number): P {
  const lengths = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
  let target = Math.max(0, Math.min(1, t)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]) {
      const k = lengths[i] ? target / lengths[i] : 0;
      return [lerp(line[i][0], line[i + 1][0], k), lerp(line[i][1], line[i + 1][1], k)];
    }
    target -= lengths[i];
  }
  return line[line.length - 1];
}

/** Resample a polyline to n evenly spaced points. */
function resample(line: P[], n: number): P[] {
  return Array.from({ length: n }, (_, i) => along(line, i / (n - 1)));
}

/** Deterministic pseudo-random numbers, so a phenotype always draws the same portrait. */
function random(seed: number) {
  let s = Math.abs(Math.round(seed)) % 2147483647 || 7;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export interface Shade {
  d: string;
  opacity: number;
  blur: number; // softness in frame units
  tone: "dark" | "light";
}

export interface Portrait {
  head: string; // head and neck silhouette
  shades: Shade[]; // soft modelling of the face and neck
  ear: string;
  earLines: string[];
  eye: { lid: string; crease: string; lower: string; iris: P; irisR: number; lash: string };
  brow: string;
  browWidth: number;
  nostril: string;
  lips: string;
  mouth: string;
  lines: { d: string; opacity: number }[]; // age lines
  hairBack: string | null;
  hairBackStroke: number; // > 0: hairBack is drawn as ropes of this width
  hairBackFront: boolean; // falls over the neck and shoulders (true) or sits behind the head (bun)
  backStrands: string[];
  hair: string | null;
  strands: string[];
  curls: P[]; // texture marks
  lobes: { c: P; r: number }[]; // round masses that give curly and coily hair its outline
  beard: string | null;
  beardStrands: string[];
  stubble: P[];
  moustache: string | null;
  scarf: string | null;
  folds: string[];
  bust: string;
  bustLines: string[];
  collar: string | null; // drawn over the neck
  collarLines: string[];
  glasses: { lens: string; arm: string; round: boolean } | null;
}

export function portrait(ph: Phenotype): Portrait {
  const f = ph.face;
  const a = Math.max(0, Math.min(1, (ph.age - 18) / 72));
  const l = ph.lips;
  const b = ph.build;
  const rand = random(ph.age * 97 + ph.skin * 13 + f * 1000 + l * 77 + b * 31 + ph.hair.length * 7);

  // ---- face profile -------------------------------------------------------------------
  const glabella: P = [140.5 + 2.6 * f, 87];
  const nasion: P = [138 + 1.1 * f, 93.5];
  const droop = 2.2 * a;
  const nose = {
    straight: { mid: [146.2, 104] as P, tip: [155.2, 115.5] as P, colu: [149.8, 121.2] as P },
    aquiline: { mid: [149, 101.5] as P, tip: [155, 117] as P, colu: [149.3, 122] as P },
    concave: { mid: [143.6, 106.5] as P, tip: [153.8, 113.6] as P, colu: [149.4, 119.8] as P },
    broad: { mid: [146.5, 104.4] as P, tip: [156.2, 116] as P, colu: [150.8, 121.8] as P },
  }[ph.nose];
  const tip = add(nose.tip, [0.8 * a, droop]);
  const colu = add(nose.colu, [0.4 * a, droop * 0.7]);
  const subnasale: P = [141.2, 123.2 + 0.6 * a];
  const fullness = 1.9 * l - 1.2 * a;
  const upperLip: P = [143.4 + fullness, 129 + 0.4 * a];
  const stomion: P = [140, 133.6 + 0.6 * a];
  const lowerLip: P = [142.8 + fullness * 1.15, 137.6 + 1.2 * l + 0.5 * a];
  const sulcus: P = [137.6 + 0.6 * f, 143.4 + 0.6 * a];
  const pogonion: P = [139.8 + 2.8 * f - 1.2 * a, 151 + 1.2 * f];
  const menton: P = [132.6 + 1.4 * f, 158.6 + 1.4 * f + 1.2 * a];
  const submental: P = [123.5 + 1.5 * b, 161.5 + 2.2 * a + 1.5 * b];
  const throat: P = [118 + 2 * a + 3 * b, 166 + 3 * a];
  const neckFront: P = [114.8 + 3 * b, 181];
  const notch: P = [113.5 + 4 * b, 198];
  const nape: P = [60.5 - 2 * b, 131];
  const neckBack: P[] = [
    [63.5 - 3 * b, 147],
    [60 - 4 * b, 163],
    [50 - 5 * b, 178],
  ];

  const face: Node[] = [
    { p: [100, 40] },
    { p: [118, 43.2] },
    { p: [130.2, 52.6] },
    { p: [137, 66] },
    { p: [139.6 + 0.8 * f, 78] },
    { p: glabella },
    { p: nasion },
    { p: nose.mid },
    { p: tip },
    { p: colu },
    { p: subnasale, corner: true },
    { p: upperLip },
    { p: stomion, corner: true },
    { p: lowerLip },
    { p: sulcus },
    { p: pogonion },
    { p: menton },
    { p: submental },
    { p: throat },
    { p: neckFront },
    { p: notch, corner: true },
  ];
  const back: Node[] = [
    { p: [neckBack[2][0] + 3, neckBack[2][1] + 7], corner: true },
    ...nodes([...neckBack].reverse()),
    { p: nape },
    { p: [51.5, 119] },
    { p: [46.6, 103] },
    { p: [46.2, 86] },
    { p: [51, 66] },
    { p: [63, 50.5] },
    { p: [80, 41.4] },
  ];
  const head = spline([...face, ...back], true);

  // ---- modelling ----------------------------------------------------------------------
  const shades: Shade[] = [
    // under the jaw, cast on the neck
    { d: shape([[90, 138], [104, 152], [menton[0] - 2, menton[1] + 1], [submental[0] - 2, submental[1] + 5], [102, 168], [86, 158]]), opacity: 0.38, blur: 3.2, tone: "dark" },
    // eye socket and the side of the nose
    { d: shape([[118, 88.5], [131, 89], [136.5, 95], [133, 102], [121, 101]]), opacity: 0.22, blur: 2.6, tone: "dark" },
    // cheek hollow, deeper with age and a fine face
    { d: shape([[110, 116], [124, 112], [132, 126], [126, 140], [112, 136]]), opacity: 0.12 + 0.12 * a + 0.06 * (1 - f), blur: 4, tone: "dark" },
    // the sternocleidomastoid running from behind the ear to the notch
    { d: shape([[84, 128], [92, 132], [notch[0] - 6, notch[1] - 4], [notch[0] - 12, notch[1] - 2], [80, 140]]), opacity: 0.2, blur: 2.4, tone: "dark" },
    // back of the neck, turning away from the light
    { d: shape([[nape[0] + 2, nape[1]], [72, 150], [70, 192], [neckBack[2][0] + 1, 196], [neckBack[1][0] + 1, 170]]), opacity: 0.22, blur: 3.6, tone: "dark" },
    // lights: forehead, cheekbone, nose bridge, chin
    { d: shape([[120, 52], [133, 58], [136, 74], [126, 80], [116, 66]]), opacity: 0.22, blur: 4, tone: "light" },
    { d: shape([[112, 103], [125, 104], [128, 111], [116, 113]]), opacity: 0.2, blur: 3, tone: "light" },
    { d: shape([[nasion[0] - 1, nasion[1] + 2], [nose.mid[0] - 0.5, nose.mid[1]], [tip[0] - 3, tip[1] - 1.5], [nose.mid[0] - 3.5, nose.mid[1] + 1]]), opacity: 0.22, blur: 1.6, tone: "light" },
    { d: shape([[pogonion[0] - 6, pogonion[1] - 4], [pogonion[0] - 1.5, pogonion[1] - 1], [pogonion[0] - 4, pogonion[1] + 3]]), opacity: 0.18, blur: 1.8, tone: "light" },
  ];

  const earScale = 1 + 0.12 * a;
  const ec: P = [86.5, 106];
  const e = (x: number, y: number): P => [ec[0] + x * earScale, ec[1] + y * earScale];
  const ear = shape([e(5.5, -16), e(-3, -17.5), e(-9.5, -10.5), e(-10.2, 1), e(-7.2, 11), e(-2, 17), e(4, 15.5), e(6, 7), e(5.6, -4)]);
  const earLines = [
    curve([e(2.5, -12.5), e(-5, -11.5), e(-6.8, -1), e(-4, 8), e(1.6, 10.5)]),
    curve([e(-1.6, -4.5), e(2.6, -0.5), e(1, 5.5)]),
  ];

  const eyeY = 96;
  const eyeFront = 129.6 + 0.5 * f;
  const lid = curve([[119.2, eyeY + 0.9], [123.2, eyeY - 2.2], [eyeFront, eyeY - 1.1], [eyeFront + 1.2, eyeY + 0.4]]);
  const crease = curve([[119.5, eyeY - 2.3], [124, eyeY - 4.6 + a], [eyeFront - 0.5, eyeY - 3.6]]);
  const lower = curve([[120.5, eyeY + 1.6], [124.6, eyeY + 2.9], [eyeFront - 0.4, eyeY + 1.6]]);
  const lash = curve([[eyeFront + 1.2, eyeY + 0.4], [eyeFront + 2.3, eyeY - 0.4]]);
  const browY = 85.5 - 0.6 * f;
  const brow = curve([[116, browY + 2.4], [123.5, browY - 1.2 - 0.8 * f], [132, browY - 0.8], [137, browY + 0.9]]);
  const alar = ph.nose === "broad" ? 7.2 : 5.6;
  const nostril = curve([[subnasale[0] + 5, subnasale[1] - 0.6], [subnasale[0] + 0.6, subnasale[1] - alar], [subnasale[0] - 3.8, subnasale[1] - alar + 1.8], [subnasale[0] - 2.4, subnasale[1] - 0.4]]);
  const lips = shape(
    [
      [subnasale[0] + 0.6, subnasale[1] + 3.2],
      [upperLip[0] - 0.4, upperLip[1] - 1.4],
      upperLip,
      stomion,
      lowerLip,
      [lowerLip[0] - 2.2, lowerLip[1] + 2.4],
      [stomion[0] - 4.2, stomion[1] + 1.4],
      [stomion[0] - 4.6, stomion[1] - 0.6],
    ],
    [3],
  );
  const mouth = curve([stomion, [stomion[0] - 2.6, stomion[1] + 0.25], [stomion[0] - 4.6, stomion[1] + 0.1]]);

  const lines: Portrait["lines"] = [];
  const age = (d: string, from: number) => {
    if (a > from) lines.push({ d, opacity: Math.min(1, (a - from) / 0.3) });
  };
  age(curve([[118.4, 94.4], [115.2, 93]]) + curve([[118.4, 97], [114.8, 97.4]]) + curve([[118.8, 99.4], [115.8, 101.6]]), 0.3);
  age(curve([[subnasale[0] - 3.4, subnasale[1] - 3.6], [subnasale[0] - 6.8, subnasale[1] + 3.4], [stomion[0] - 6, stomion[1] + 3.6]]), 0.2);
  age(curve([[128.5, 61], [133.4, 60.6]]) + curve([[127.2, 67.5], [134.2, 66.8]]), 0.48);
  age(curve([[119.5, eyeY + 4.6], [124.5, eyeY + 6.2], [128.6, eyeY + 4.8]]), 0.4);
  age(curve([[throat[0] - 5, throat[1] + 7], [throat[0] - 0.5, throat[1] + 2.5]]) + curve([[104, 184], [112, 182.5]]), 0.55);
  age(curve([[menton[0] - 7, menton[1] - 0.5], [menton[0] - 14, menton[1] - 4]]), 0.6);

  // ---- hair ---------------------------------------------------------------------------
  const recede = ["short", "swept", "buzz"].includes(ph.hair) && ph.age > 50 ? Math.min(1, (ph.age - 50) / 35) : 0;
  const hairline: P = [lerp(130.2, 121, recede), lerp(52.6, 45, recede)];
  const skull = resample(
    [hairline, [118, 43.2], [100, 40], [80, 41.4], [63, 50.5], [51, 66], [46.2, 86], [46.6, 103], [51.5, 119], [nape[0] + 1, nape[1] - 1]],
    28,
  );
  // Boundary between hair and skin: front hairline, the recess at the temple, a short
  // sideburn in front of the ear, over the ear and down behind it to the nape.
  const inner: P[] = [
    hairline,
    [lerp(127, 119, recede), lerp(58, 52, recede)],
    [lerp(121, 115, recede), lerp(61.5, 58, recede)],
    [115.5, 67],
    [112, 76],
    [109, 86],
    [106.2, 94.5],
    [104.6, 101.5],
    [101.6, 99.6],
    [99.4, 92.5],
    [93.5, 88.6],
    [86, 88.2],
    [79.2, 91.6],
    [75.6, 100],
    [73, 112],
    [69.5, 124],
    [nape[0] + 1, nape[1] - 1],
  ];

  let hairBack: string | null = null;
  let hairBackStroke = 0;
  let hairBackFront = true;
  const backStrands: string[] = [];
  let hair: string | null = null;
  const strands: string[] = [];
  const curls: P[] = [];
  const lobes: { c: P; r: number }[] = [];
  let scarf: string | null = null;
  const folds: string[] = [];

  /** Round masses along a line (the outline of curly and coily hair). */
  const lobesAlong = (line: P[], count: number, radius: [number, number], inset = 0) => {
    for (let k = 0; k <= count; k++) {
      const t = k / count;
      const p = along(line, t);
      const q = along(line, Math.min(1, t + 0.01));
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const r = radius[0] + rand() * (radius[1] - radius[0]);
      lobes.push({ c: add(p, scale([dy / len, -dx / len], inset + r * 0.35)), r });
    }
  };

  /** A closed path along `outer` whose edge bulges outward between samples (curls, coils). */
  const scalloped = (outer: P[], step: number, amplitude: number): Node[] => {
    const pts = resample(outer, Math.max(4, Math.round(outer.length * 2.2 / step * 3)));
    const out: Node[] = [];
    pts.forEach((p, i) => {
      out.push({ p, corner: true });
      const q = pts[i + 1];
      if (!q) return;
      const mid: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      out.push({ p: add(mid, scale([-dy / len, dx / len], amplitude * (0.6 + rand() * 0.8))) });
    });
    return out;
  };

  const cap = (thickness: (t: number) => number, roughness: number, frontLift = 0, bump = 0) => {
    const outer = offset(skull, (t) => thickness(t) + (rand() - 0.5) * roughness);
    outer[0] = add(outer[0], [frontLift * 0.35, -frontLift * 0.4]);
    outer[1] = add(outer[1], [frontLift * 0.5, -frontLift]);
    outer[2] = add(outer[2], [frontLift * 0.3, -frontLift * 0.7]);
    const edge = bump > 0 ? scalloped(outer, 6.5, bump) : nodes(outer, [0]);
    hair = spline([...edge, ...nodes([...inner].reverse().slice(1, -1))], true);
    // Strands flowing from the hairline over the crown toward the nape.
    for (let k = 0; k < 11; k++) {
      const depth = 0.2 + (k % 4) * 0.2;
      const start = 0.01 + k * 0.03;
      const line = Array.from({ length: 8 }, (_, j) => {
        const t = Math.min(0.97, start + j * (0.08 + rand() * 0.025));
        const s = along(skull, t);
        const o = along(outer, t);
        return [lerp(s[0], o[0], depth) + (rand() - 0.5) * 0.8, lerp(s[1], o[1], depth)] as P;
      });
      strands.push(curve(line));
    }
    // A few strands breaking over the front hairline.
    for (let k = 0; k < 4; k++) {
      const s = along(inner.slice(0, 5), 0.1 + k * 0.2);
      strands.push(curve([add(s, [-3, -3]), add(s, [1.2, 0.5 + rand()]), add(s, [2.5 + rand() * 1.5, 2.5 + rand() * 2])]));
    }
    return outer;
  };

  /** Ropes falling from the back of the head (locs, braids). */
  const ropes = (outer: P[], count: number, from: number, to: number, length: [number, number]) => {
    const out: string[] = [];
    for (let k = 0; k < count; k++) {
      const start = along(outer.slice(Math.round(outer.length * from), Math.round(outer.length * to)), (k + 0.5) / count);
      const len = length[0] + rand() * (length[1] - length[0]);
      const sway = (rand() - 0.5) * 7;
      out.push(curve([start, [start[0] - 3 + sway, start[1] + len * 0.35], [start[0] - 5 + sway * 1.4, start[1] + len * 0.7], [start[0] - 6 + sway * 1.2 - k * 0.4, start[1] + len]]));
    }
    return out;
  };

  switch (ph.hair) {
    case "bald":
      break;
    case "buzz": {
      const outer = cap(() => 1.7, 0.2);
      strands.length = 0;
      for (let k = 0; k < 520; k++) {
        const t = rand() * 0.97;
        const s = along(skull, t);
        const o = along(outer, t);
        const depth = rand();
        curls.push([lerp(s[0], o[0], depth) + (rand() - 0.5) * 2.4, lerp(s[1], o[1], depth) + (rand() - 0.5) * 2.4]);
      }
      break;
    }
    case "short":
      cap((t) => 3.2 + 5.2 * Math.sin(Math.PI * Math.min(1, t * 1.45)) - 1.8 * t, 0.7, 2.5);
      break;
    case "swept":
      cap((t) => 4.5 + 9 * Math.max(0, 1 - t * 1.6) + 2.2 * Math.sin(Math.PI * t), 0.8, 7);
      break;
    case "wavy": {
      const outer = cap((t) => 7 + 1.6 * Math.sin(t * 10), 0.9, 3);
      hairBack = shape([outer[13], [38, 104], [35, 132], [39, 156], [50, 168], [64, 166], [74, 150], [76, 124]]);
      for (let k = 0; k < 7; k++) {
        const s = along([[40, 108], [37, 136], [44, 160]], (k + 0.5) / 7);
        backStrands.push(curve([s, [s[0] + 4 + Math.sin(k) * 2, s[1] + 8], [s[0] + 6, s[1] + 16]]));
      }
      break;
    }
    case "curly": {
      const outer = cap((t) => 8 + 2.5 * Math.sin(Math.PI * t), 0.6, 3);
      const fall: P[] = [outer[13], [40, 110], [37.5, 134], [42, 156], [55, 166], [69, 161], [75, 140], [75.5, 120]];
      hairBack = shape(fall);
      lobesAlong(outer.slice(0, 15), 15, [2.8, 5.4]);
      lobesAlong(fall.slice(1, 7), 9, [3.2, 5.6]);
      lobesAlong(offset(outer.slice(1, 14), () => -4.5), 9, [2.6, 4.2]);
      for (let k = 0; k < 140; k++) {
        const t = rand();
        const s = along(skull, t);
        const o = along(outer, t);
        curls.push([lerp(s[0], o[0], 0.2 + rand() * 0.9), lerp(s[1], o[1], 0.2 + rand() * 0.9)]);
      }
      for (let k = 0; k < 50; k++) {
        const p = along(fall.slice(1, 7), rand());
        curls.push([p[0] + 3 + rand() * 12, p[1] - 4 + rand() * 8]);
      }
      break;
    }
    case "long": {
      const outer = cap((t) => 6 + 2.4 * Math.sin(Math.PI * t), 0.6, 2.5);
      hairBack = shape([outer[11], [40, 100], [35.5, 132], [34, 168], [30.5, 206], [34, 240], [72, 240], [79, 216], [80, 184], [79.5, 150], [77.5, 120]]);
      for (let k = 0; k < 10; k++) {
        const x = 38 + k * 4;
        const sway = (rand() - 0.5) * 4;
        backStrands.push(curve([[x + 1.5, 108 + k * 2.2], [x - 1 + sway, 150], [x - 2 + sway * 1.5, 190], [x + 1 + sway, 236]]));
      }
      break;
    }
    case "coily": {
      const outer = offset(skull, (t) => 12 + 9 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
      outer[0] = add(outer[0], [1.5, -3]);
      outer[1] = add(outer[1], [1.5, -2]);
      hair = spline([...nodes(outer, [0]), ...nodes([...inner].reverse().slice(1, -1))], true);
      lobesAlong(outer, 30, [3, 4.4], -1);
      for (let k = 0; k < 420; k++) {
        const t = rand();
        const s = along(skull, t);
        const o = along(outer, t);
        const depth = Math.pow(rand(), 0.8);
        curls.push([lerp(s[0], o[0], depth) + (rand() - 0.5) * 2, lerp(s[1], o[1], depth) + (rand() - 0.5) * 2]);
      }
      break;
    }
    case "locs": {
      const outer = cap((t) => 6.5 + 2 * Math.sin(Math.PI * t), 0.9, 2);
      hairBack = ropes(outer, 12, 0.3, 0.92, [62, 96]).join(" ");
      hairBackStroke = 3.8;
      break;
    }
    case "braids": {
      const outer = cap(() => 4.4, 0.25, 1);
      strands.length = 0;
      for (let k = 1; k <= 6; k++) strands.push(curve(offset(skull, () => k * 0.7).slice(0, 24)));
      hairBack = ropes(outer, 14, 0.35, 0.95, [80, 110]).join(" ");
      hairBackStroke = 2.8;
      break;
    }
    case "bun": {
      cap((t) => 3 + 1.8 * Math.sin(Math.PI * t), 0.4, 1);
      const c: P = [55, 53.5];
      hairBackFront = false;
      hairBack = shape([[c[0] + 11, c[1] - 7], [c[0] + 1, c[1] - 14.5], [c[0] - 10.5, c[1] - 9], [c[0] - 13, c[1] + 3], [c[0] - 5, c[1] + 12.5], [c[0] + 8, c[1] + 9.5]]);
      strands.push(curve([[c[0] + 6, c[1] - 7], [c[0] - 4, c[1] - 8], [c[0] - 8, c[1] + 2], [c[0], c[1] + 7]]));
      strands.push(curve([[c[0] + 2, c[1] - 11], [c[0] - 9, c[1] - 4], [c[0] - 6, c[1] + 8]]));
      break;
    }
    case "headscarf": {
      // Fitted over the skull, framing the face and wrapping under the chin, then draped
      // over the shoulders and chest.
      const outer = offset(skull, (t) => 4.5 + 1.8 * Math.sin(Math.PI * t));
      scarf = shape([
        [135.2, 63.5],
        [131.8, 50],
        ...outer.slice(2, 22),
        [37, 126],
        [30, 160],
        [22, 200],
        [16, 240],
        [140, 240],
        [137, 224],
        [130, 208],
        [123, 194],
        [118.5, 181],
        [116.5, 170],
        [121, 165],
        [116, 160.5],
        [109.5, 152],
        [104, 138],
        [102.5, 118],
        [106, 100],
        [113.5, 85],
        [122, 73.5],
        [130, 67],
      ]);
      folds.push(curve([[134.5, 66], [124.5, 74], [115.5, 87], [108.4, 101], [105.4, 119], [106.8, 138], [112, 152], [119.5, 162]]));
      folds.push(curve([[127, 204], [104, 212], [80, 224], [58, 240]]));
      folds.push(curve([[119.5, 184], [96, 192], [70, 208], [44, 232]]));
      folds.push(curve([[100, 112], [90, 134], [80, 160], [62, 190], [46, 218]]));
      folds.push(curve([[128, 56], [110, 48], [88, 46], [66, 56]]));
      break;
    }
  }

  // ---- facial hair --------------------------------------------------------------------
  let beard: string | null = null;
  const beardStrands: string[] = [];
  const stubble: P[] = [];
  let moustache: string | null = null;
  const gonion: P = [87.5 - 1.5 * f, 143 + 3 * f + 2 * a];
  const beardEdge = (t: number): P[] => [
    [104.6, 101],
    [110.5, 114],
    [119.5, 121.5],
    [128.5, 124.5],
    [subnasale[0] - 3.5, stomion[1] + 2.6],
    [sulcus[0] + 0.6 + t * 0.2, sulcus[1] + 0.8],
    [pogonion[0] + t, pogonion[1] + t * 0.3],
    [menton[0] + t * 0.3, menton[1] + t],
    [submental[0], submental[1] + t * 0.9],
    [throat[0] - 3, throat[1] + t * 0.6],
    [gonion[0] + 8, gonion[1] + 7],
    [gonion[0] - 1, gonion[1] - 5],
    [95.5, 116],
  ];
  if (ph.facial_hair === "beard" || ph.facial_hair === "full_beard") {
    const full = ph.facial_hair === "full_beard";
    const edge = beardEdge(full ? 6.5 : 2.4);
    beard = shape(edge, [4]);
    const count = full ? 14 : 9;
    for (let k = 0; k < count; k++) {
      const p = along(edge.slice(1, 9), (k + 0.5) / count);
      beardStrands.push(curve([[p[0] - 4.5, p[1] - 3.5], [p[0] - 1.5, p[1] + 0.5], [p[0] + 0.3, p[1] + (full ? 4.8 : 2.6)]]));
    }
  }
  if (ph.facial_hair === "stubble") {
    const edge = beardEdge(0);
    for (let k = 0; k < 420; k++) {
      const p = along(edge.slice(0, 10), rand());
      stubble.push([p[0] - rand() * 10, p[1] + (rand() - 0.5) * 4]);
    }
  }
  if (ph.facial_hair !== "none" && ph.facial_hair !== "stubble") {
    moustache = shape(
      [
        [subnasale[0] - 0.6, subnasale[1] + 0.9],
        [upperLip[0] - 0.6, upperLip[1] - 2.2],
        [upperLip[0] - 1.2, upperLip[1] - 0.9],
        [stomion[0] - 4.6, stomion[1] - 0.4],
        [subnasale[0] - 6, subnasale[1] + 2.2],
      ],
      [0, 2],
    );
  }

  // ---- bust and attire ----------------------------------------------------------------
  const s = 5 * b; // shoulders broaden with build
  const bust = shape(
    [
      notch,
      [130 + s, 204],
      [150 + s, 213],
      [163 + s, 227],
      [165 + s, 240],
      [16 - s, 240],
      [15 - s, 220],
      [22 - s, 203],
      [36 - s, 190],
      [neckBack[2][0] - 1, neckBack[2][1] + 1],
    ],
    [0, 4, 5],
  );
  const bustLines: string[] = [];
  const collarLines: string[] = [];
  let collar: string | null = null;
  const n = notch;
  switch (ph.attire) {
    case "crew":
    case "knit": {
      // A ribbed neckband that wraps the base of the neck.
      const back: P = [neckBack[2][0] + 2, neckBack[2][1] + 1];
      collar = shape(
        [[n[0] + 1.6, n[1] - 4.5], [86, n[1] - 4.5], back, [back[0] - 4, back[1] + 6], [86, n[1] + 2], [n[0] + 2.6, n[1] + 2.5]],
        [0, 2, 3, 5],
      );
      collarLines.push(curve([[n[0] + 1.9, n[1] - 1], [86, n[1] - 1.2], [back[0] - 2, back[1] + 3]]));
      if (ph.attire === "knit") {
        for (let k = 0; k < 13; k++) {
          const x = 30 + k * 10;
          bustLines.push(curve([[x, n[1] + 12 + Math.abs(k - 7) * 0.8], [x + 0.6, 226], [x + 1, 240]]));
        }
      } else {
        bustLines.push(curve([[56, 206], [70, 226], [76, 240]]));
      }
      break;
    }
    case "turtleneck": {
      const top = 170;
      collar = shape(
        [
          [neckFront[0] + 2.4, top + 2],
          [neckFront[0] + 2.6, n[1] - 8],
          [n[0] + 3.5, n[1] + 4],
          [n[0] - 30, n[1] + 9],
          [neckBack[2][0] - 2, neckBack[2][1] + 6],
          [neckBack[1][0] - 2.5, neckBack[1][1] + 4],
          [neckBack[0][0] - 2, top],
          [90, top - 3],
        ],
        [0, 6],
      );
      for (const [y, sag] of [[178, 4.5], [187, 3]] as const)
        collarLines.push(curve([[neckFront[0] + 1.8, y], [100, y + sag], [80, y + sag * 0.9], [neckBack[1][0] - 1, y + 1]]));
      break;
    }
    case "collar":
    case "blazer": {
      const back = neckBack[2];
      collar = shape(
        [
          [n[0] + 0.5, n[1] - 15],
          [n[0] + 9.5, n[1] + 4],
          [n[0] - 3, n[1] + 9.5],
          [n[0] - 28, n[1] + 4.5],
          [back[0] + 3, back[1] + 6],
          [back[0] + 7, back[1] - 7],
          [92, n[1] - 9],
        ],
        [0, 1, 2],
      );
      if (ph.attire === "blazer") {
        bustLines.push(curve([[n[0] + 9, n[1] + 5], [n[0] + 22, n[1] + 20], [n[0] + 29, 240]]));
        bustLines.push(curve([[n[0] - 3, n[1] + 10], [n[0] + 7, n[1] + 24], [n[0] + 13, 240]]));
        bustLines.push(curve([[42, 206], [50, 224], [54, 240]]));
      } else {
        bustLines.push(curve([[n[0] + 4, n[1] + 10], [n[0] + 11, n[1] + 24], [n[0] + 15, 240]]));
      }
      break;
    }
  }

  // ---- glasses ------------------------------------------------------------------------
  let glasses: Portrait["glasses"] = null;
  if (ph.glasses !== "none") {
    const round = ph.glasses === "round";
    const cx = eyeFront + 3.6;
    const lens = round
      ? shape([[cx, eyeY - 6.4], [cx + 2.1, eyeY - 1], [cx + 1.2, eyeY + 5.6], [cx - 1.4, eyeY + 5.4], [cx - 2.2, eyeY - 1.2]])
      : shape([[cx - 2.4, eyeY - 4.6], [cx + 1.8, eyeY - 5], [cx + 1.6, eyeY + 4.4], [cx - 2, eyeY + 4.6]], [0, 1, 2, 3]);
    const arm = curve([[cx - 2, eyeY - 2.4], [112, eyeY - 4.2], [97, eyeY - 2.6], [91, eyeY + 0.6]]);
    glasses = { lens, arm, round };
  }

  return {
    head,
    shades,
    ear,
    earLines,
    eye: { lid, crease, lower, iris: [eyeFront - 2.4, eyeY + 0.1], irisR: 1.5, lash },
    brow,
    browWidth: 1.5 + 1.1 * f,
    nostril,
    lips,
    mouth,
    lines,
    hairBack,
    hairBackStroke,
    hairBackFront,
    backStrands,
    hair,
    strands,
    curls,
    lobes,
    beard,
    beardStrands,
    stubble,
    moustache,
    scarf,
    folds,
    bust,
    bustLines,
    collar,
    collarLines,
    glasses,
  };
}
