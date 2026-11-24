// Pictures of a changed person (face and portrait), rendered once when an avatar is saved, so that
// every list and chip shows them as changed without loading any 3D. three.js loads only here.

import type { PersonStyle } from "../types";

export interface Stills {
  face: string;
  portrait: string;
}

/** Whether this browser can encode WebP (Safari cannot; it gets smaller PNGs). */
const webp = () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  return canvas.toDataURL("image/webp").startsWith("data:image/webp");
};

export async function renderStills(look: string, style: PersonStyle): Promise<Stills | null> {
  const [{ PersonStage }, { loadCatalogue }] = await Promise.all([import("./stage"), import("./catalogue")]);
  const asset = (await loadCatalogue()).find((p) => p.look === look);
  if (!asset) return null;
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;width:480px;height:600px;pointer-events:none";
  document.body.appendChild(holder);
  const stage = new PersonStage(holder, { interactive: false, idle: false });
  try {
    await stage.show(asset, style);
    const [type, scale] = webp() ? ["image/webp", 1] : ["image/png", 0.6];
    const px = (n: number) => Math.round(n * scale);
    // The same framing as the built stills (tools/people/bake.py via Bake.tsx).
    return {
      face: stage.snapshot(px(320), px(320), 1, 0.38, type, 0.86),
      portrait: stage.snapshot(px(480), px(600), 0.62, 0.3, type, 0.86),
    };
  } catch {
    return null;
  } finally {
    stage.dispose();
    holder.remove();
  }
}
