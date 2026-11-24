// How a person's look is changed from the built 3D person: skin tone, hair colour, the colours of
// what they wear, height and build. Plain data and palettes, without three.js, so the builder can
// show the choices before any 3D has loaded. model.ts applies a style to a loaded person.

import type { PersonStyle } from "../types";

export const PLAIN: PersonStyle = { skin: null, hair: null, top: null, bottom: null, height: 1, build: 1 };

export const HEIGHT = { min: 0.92, max: 1.08 } as const;
export const BUILD = { min: 0.9, max: 1.15 } as const;

/** Whether a style changes anything at all. */
export const styled = (s: PersonStyle | null | undefined): s is PersonStyle =>
  !!s && (!!s.skin || !!s.hair || !!s.top || !!s.bottom || Math.abs(s.height - 1) > 0.004 || Math.abs(s.build - 1) > 0.004);

export interface Swatch {
  hex: string;
  name: string;
}

/**
 * Ten skin tones, light to deep. They are albedo, the colour of skin before light falls on it, set
 * along the range of the people's own textures and a little beyond it at the deep end; under the
 * stage's light they show lighter, so the swatches are drawn a little brighter (see styles.css).
 */
export const SKIN: Swatch[] = [
  { hex: "#c49274", name: "Skin tone 1 of 10, lightest" },
  { hex: "#b48467", name: "Skin tone 2 of 10" },
  { hex: "#a5775b", name: "Skin tone 3 of 10" },
  { hex: "#966a4f", name: "Skin tone 4 of 10" },
  { hex: "#865d44", name: "Skin tone 5 of 10" },
  { hex: "#765039", name: "Skin tone 6 of 10" },
  { hex: "#66442f", name: "Skin tone 7 of 10" },
  { hex: "#563826", name: "Skin tone 8 of 10" },
  { hex: "#462d1e", name: "Skin tone 9 of 10" },
  { hex: "#362317", name: "Skin tone 10 of 10, deepest" },
];

export const HAIR: Swatch[] = [
  { hex: "#1b1714", name: "Black" },
  { hex: "#3b2a20", name: "Dark brown" },
  { hex: "#6a4a33", name: "Brown" },
  { hex: "#7d3a22", name: "Auburn" },
  { hex: "#a8552c", name: "Copper" },
  { hex: "#a07c50", name: "Dark blond" },
  { hex: "#c9a66b", name: "Blond" },
  { hex: "#e0cfa5", name: "Platinum" },
  { hex: "#8e8b86", name: "Grey" },
  { hex: "#dcd9d4", name: "White" },
];

export const CLOTHES: Swatch[] = [
  { hex: "#1c1d20", name: "Black" },
  { hex: "#3d4148", name: "Charcoal" },
  { hex: "#8a8f96", name: "Grey" },
  { hex: "#ecebe6", name: "White" },
  { hex: "#cbb89a", name: "Sand" },
  { hex: "#5e4330", name: "Brown" },
  { hex: "#1f2d4d", name: "Navy" },
  { hex: "#3c64a8", name: "Blue" },
  { hex: "#2f6f6c", name: "Teal" },
  { hex: "#3f5e3a", name: "Green" },
  { hex: "#6b6a3a", name: "Olive" },
  { hex: "#c08a2e", name: "Ochre" },
  { hex: "#b0342f", name: "Red" },
  { hex: "#6e2433", name: "Burgundy" },
];
