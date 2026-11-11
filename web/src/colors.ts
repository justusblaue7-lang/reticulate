// Colour. The interface is cream on deep blue; any other colour carries data.

export type RGB = [number, number, number];

export const hexToRGB = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v + (b[i] - v) * t) as RGB;
export const css = ([r, g, b]: RGB) => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linear = (rgb: RGB): RGB => rgb.map(toLinear) as RGB;

// Anatomical tones (not data): the brain as a porcelain specimen, deep structures a shade warmer.
export const SPECIMEN = hexToRGB("#e6ddca");
export const MEDIAL_WALL = hexToRGB("#a79e8b");
export const BOUNDARY = hexToRGB("#1b2a4d"); // region borders in the interface's deep blue
export const DEEP_TONES: Record<string, RGB> = {
  thalamus: hexToRGB("#ddd0ba"),
  caudate: hexToRGB("#d5c6ad"),
  putamen: hexToRGB("#d1c1a8"),
  pallidum: hexToRGB("#e3d9c6"),
  accumbens: hexToRGB("#cdbb9f"),
  hippocampus: hexToRGB("#dacbb3"),
  amygdala: hexToRGB("#d0bea3"),
  ventraldc: hexToRGB("#d6c9b4"),
  cerebellum: hexToRGB("#dbd1bf"),
  brainstem: hexToRGB("#d3c8b5"),
  corpuscallosum: hexToRGB("#f1ebdf"),
};

// Meta-analytic overlay: one warm hue, light to dark, on the porcelain cortex. OKLab lightness
// falls monotonically (ΔL ≈ 0.1 per stop) and the threshold stop has 2.25:1 contrast against
// the specimen.
export const OVERLAY_STOPS = ["#e0774d", "#c64a30", "#9e2d28", "#731d25", "#48121c"];

export function overlayCSS(t: number): string {
  const stops = OVERLAY_STOPS.map(hexToRGB);
  const p = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  return css(mix(stops[i], stops[i + 1], p - i));
}

// Factor weights (0–10) on the deep-blue page: from the page colour up to cream.
const WEIGHT_STEPS = ["#162750", "#233a6b", "#36538a", "#5571a5", "#8194bd", "#b4bdd4", "#e9e3d5"].map(hexToRGB);

function weightRGB(weight: number): RGB {
  const p = (Math.max(0, Math.min(10, weight)) / 10) * (WEIGHT_STEPS.length - 1);
  const i = Math.min(WEIGHT_STEPS.length - 2, Math.floor(p));
  return mix(WEIGHT_STEPS[i], WEIGHT_STEPS[i + 1], p - i);
}

export const weightCSS = (w: number) => css(weightRGB(w));

export function weightInk(w: number): string {
  const [r, g, b] = linear(weightRGB(w));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.2 ? "#0b1530" : "#f3ecdc";
}

export { mix };
