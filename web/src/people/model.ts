// The 3D people: realistic humans from the Microsoft Rocketbox avatar library (MIT), built
// into web/public/people by tools/people/build.py. Each person is the library's FBX model,
// loaded and posed here, with physically based materials made from its WebP textures.

import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { PersonStyle } from "../types";
import type { PersonAsset } from "./catalogue";
import { PLAIN } from "./style";

export { loadCatalogue, portraitUrl, type PersonAsset } from "./catalogue";

// A relaxed standing pose instead of the library's A-pose: upper arms down beside the
// body, elbows slightly bent. Angles were measured on the skeleton (Biped rig, local axes).
const POSE: [bone: string, axis: [number, number, number], degrees: number][] = [
  ["Bip01_L_UpperArm", [0, 1, 0], 40],
  ["Bip01_R_UpperArm", [0, 1, 0], -40],
  ["Bip01_L_Forearm", [0, 0, 1], -12],
  ["Bip01_R_Forearm", [0, 0, 1], -12],
];

const textures = new THREE.TextureLoader();
const textureCache = new Map<string, Promise<THREE.Texture>>();

function texture(url: string, color: boolean): Promise<THREE.Texture> {
  let cached = textureCache.get(url);
  if (!cached) {
    cached = textures.loadAsync(url).then((t) => {
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      return t;
    });
    textureCache.set(url, cached);
  }
  return cached;
}

/** The part of a person a material belongs to: "m007_head" -> "head". */
function partOf(materialName: string, parts: string[]): string | null {
  const name = materialName.toLowerCase();
  return [...parts].sort((a, b) => b.length - a.length).find((p) => name.includes(p)) ?? null;
}

// ---- the look, changed: recolouring in the shader ---------------------------------------------
//
// Skin, hair and clothes are painted into each person's textures. A style changes them in the
// shader, so a change shows at once and the textures stay shared. Skin is found by its colour
// (close in chromaticity to the face's own skin) and scaled to the chosen tone; hair (the alpha
// cards) and clothes (everything on the body that is not skin) keep their light and shade and take
// the chosen colour. Top and bottom are told apart by the bones each vertex follows.

type Uniforms = Record<string, THREE.IUniform>;

const makeUniforms = (): Uniforms => ({
  rtSkinRef: { value: new THREE.Vector3(0.5, 0.3, 0.22) },
  rtSkinGain: { value: new THREE.Vector3(1, 1, 1) },
  rtBodySkinRef: { value: new THREE.Vector3(0.5, 0.3, 0.22) },
  rtBodySkinGain: { value: new THREE.Vector3(1, 1, 1) },
  rtSkinOn: { value: 0 },
  rtHair: { value: new THREE.Vector3() },
  rtHairRef: { value: 0.1 },
  rtHairTone: { value: new THREE.Vector3(0.05, 0.03, 0.02) }, // the hair cards' mean colour
  rtHasHair: { value: 0 },
  rtHairOn: { value: 0 },
  rtTop: { value: new THREE.Vector3() },
  rtTopRef: { value: 0.3 },
  rtTopOn: { value: 0 },
  rtBottom: { value: new THREE.Vector3() },
  rtBottomRef: { value: 0.3 },
  rtBottomOn: { value: 0 },
});

const DECLARE = /* glsl */ `
uniform vec3 rtSkinRef; uniform vec3 rtSkinGain; uniform vec3 rtBodySkinRef; uniform vec3 rtBodySkinGain; uniform float rtSkinOn;
uniform vec3 rtHair; uniform float rtHairRef; uniform vec3 rtHairTone; uniform float rtHasHair; uniform float rtHairOn;
uniform vec3 rtTop; uniform float rtTopRef; uniform float rtTopOn;
uniform vec3 rtBottom; uniform float rtBottomRef; uniform float rtBottomOn;
varying vec4 vRtRegion;
float rtLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// A colour at a given light: the target's hue, highlights rolled off, and pulled towards grey
// rather than clipped where a channel would pass 1, so white stays white and nothing turns neon.
vec3 rtAt(vec3 target, float light) {
  float t = max(rtLum(target), 1e-3);
  float l = light <= 0.8 ? light : 0.8 + 0.2 * (1.0 - exp(-(light - 0.8) / 0.2));
  vec3 c = target * (l / t);
  float m = max(max(c.r, c.g), c.b);
  return m > 1.0 ? mix(vec3(l), c, (1.0 - l) / max(m - l, 1e-3)) : c;
}
// How close a texel is to a colour: in chromaticity within hue, in light within a factor of e^light.
float rtNear(vec3 c, vec3 ref, float hue, float light) {
  float l = rtLum(c);
  float rl = max(rtLum(ref), 1e-4);
  float h = 1.0 - smoothstep(hue, hue * 2.0, distance(c / max(l, 1e-4), ref / rl));
  float k = 1.0 - smoothstep(light, light * 1.6, abs(log(max(l, 1e-4) / rl)));
  return h * k;
}

// How much a texel is skin: near the person's own skin in chromaticity and in light (brown cloth has
// skin's hue but rarely its lightness). On pieces of the body that are mostly bare skin (legs in
// shorts, arms) the tolerance widens, since knees and elbows are redder; on the face it is widest,
// so that lips follow the skin.
float rtSkin(vec3 c, vec3 ref, float wide) {
  return rtNear(c, ref, 0.18 + 0.3 * wide, 0.8 + 0.6 * wide) * smoothstep(0.004, 0.02, rtLum(c));
}`;

const RECOLOUR = /* glsl */ `
{
  vec3 c = diffuseColor.rgb;
  float l = rtLum(c);
#if defined(RT_SKIN) || defined(RT_CLOTH)
  float shoe = smoothstep(0.4, 0.6, vRtRegion.y);
#ifdef RT_CLOTH
  vec3 skinRef = rtBodySkinRef;
  vec3 skinGain = rtBodySkinGain;
  float wide = smoothstep(0.4, 0.8, vRtRegion.z);
#else
  vec3 skinRef = rtSkinRef;
  vec3 skinGain = rtSkinGain;
  float wide = 1.6;
#endif
  float eye = smoothstep(0.5, 0.8, vRtRegion.w);
  float bare = 0.0;
#ifdef RT_CLOTH
  bare = smoothstep(0.2, 0.35, vRtRegion.z);
#endif
  wide = max(wide, bare * smoothstep(0.4, 0.6, vRtRegion.y)); // all of a bare foot, ankle too
  float skin = rtSkin(c, skinRef, wide) * (1.0 - shoe * (1.0 - bare)) * (1.0 - eye);
#ifdef RT_SKIN
  // The face texture is skin throughout, apart from the eyes and hair painted on the scalp and
  // brows: all of it takes the tone, so no patches stay behind and lips darken with the skin.
  float painted = rtNear(c, rtHairTone, 0.25, 1.0) * rtHasHair * (1.0 - eye);
  skin = (1.0 - eye) * (1.0 - painted);
#endif
  vec3 outc = c;
#ifdef RT_CLOTH
  float lower = smoothstep(0.4, 0.6, vRtRegion.x);
  vec3 target = mix(rtTop, rtBottom, lower);
  float ref = mix(rtTopRef, rtBottomRef, lower);
  float on = mix(rtTopOn, rtBottomOn, lower) * (1.0 - shoe) * (1.0 - skin);
  outc = mix(outc, rtAt(target, l * rtLum(target) / max(ref, 1e-3)), on);
#endif
  vec3 toned = c * skinGain;
  // Lightening dark skin would magnify every mark in the texture: contrast is softened as it brightens.
  float from = max(rtLum(skinRef), 1e-4);
  float to = max(rtLum(skinRef * skinGain), 1e-4);
  float soft = 1.0 / (1.0 + 0.6 * max(log(to / from), 0.0));
  float light = to * pow(max(l, 1e-5) / from, soft);
  outc = mix(outc, rtAt(toned / max(rtLum(toned), 1e-3), light), skin * rtSkinOn);
#ifdef RT_SKIN
  outc = mix(outc, rtAt(rtHair, l * rtLum(rtHair) / max(rtHairRef, 1e-3)), painted * rtHairOn);
#endif
  diffuseColor.rgb = outc;
#endif
#ifdef RT_HAIR
  diffuseColor.rgb = mix(c, rtAt(rtHair, l * rtLum(rtHair) / max(rtHairRef, 1e-3)), rtHairOn);
#endif
}`;

function recolourable(m: THREE.Material, kind: "skin" | "cloth" | "hair", uniforms: Uniforms) {
  m.defines = { ...(m.defines ?? {}), ...(kind === "skin" ? { RT_SKIN: "" } : kind === "cloth" ? { RT_CLOTH: "" } : { RT_HAIR: "" }) };
  m.customProgramCacheKey = () => `rt-${kind}`;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 rtRegion;\nvarying vec4 vRtRegion;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRtRegion = rtRegion;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${DECLARE}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${RECOLOUR}`);
  };
  return m;
}

async function material(asset: PersonAsset, part: string | null, uniforms: Uniforms): Promise<THREE.Material> {
  const maps = part ? asset.parts[part] ?? [] : [];
  const base = `/people/${asset.look}/${part}`;
  const [map, normalMap, roughnessMap] = await Promise.all([
    maps.includes("color") ? texture(`${base}.webp`, true) : null,
    maps.includes("normal") ? texture(`${base}_n.webp`, false) : null,
    maps.includes("rough") ? texture(`${base}_r.webp`, false) : null,
  ]);
  const shared = { map, normalMap, roughnessMap, roughness: roughnessMap ? 1 : 0.8, metalness: 0 };
  if (part === "head") {
    // Skin: a soft sheen stands in for the scatter under the surface.
    const skin = new THREE.MeshPhysicalMaterial({ ...shared, sheen: 0.35, sheenRoughness: 0.75, sheenColor: new THREE.Color("#ffd9c7"), specularIntensity: 0.55 });
    return recolourable(skin, "skin", uniforms);
  }
  if (part?.includes("glasses")) {
    // Frames and tinted lenses: real transparency, drawn after the face.
    return new THREE.MeshStandardMaterial({ ...shared, roughness: 0.25, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  }
  if (maps.includes("alpha")) {
    // Hair, lashes and brows are cards with an alpha mask. Matte and with little specular,
    // so that the rim light does not streak across the cards.
    const hair = new THREE.MeshPhysicalMaterial({
      ...shared,
      roughnessMap: null,
      roughness: 0.85,
      specularIntensity: 0.25,
      alphaTest: 0.45,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
    });
    return recolourable(hair, "hair", uniforms);
  }
  const body = new THREE.MeshStandardMaterial({ ...shared, side: part === "body" ? THREE.FrontSide : THREE.DoubleSide });
  return part === "body" ? recolourable(body, "cloth", uniforms) : body;
}

export interface Person {
  root: THREE.Group; // in metres, standing on y = 0, facing +z
  bones: Record<string, THREE.Bone>;
  rest: Record<string, THREE.Quaternion>; // the relaxed pose, before any idle motion
  height: number;
  eyes: number; // eye height
  base: { height: number; eyes: number }; // as built, before a style
  look: { asset: PersonAsset; model: THREE.Group; meshes: THREE.Mesh[]; uniforms: Uniforms; refs: Refs | null };
}

/** Load and pose one person. Each call returns its own copy, ready for a scene. */
export async function loadPerson(asset: PersonAsset): Promise<Person> {
  const buffer = await fetch(`/people/${asset.look}/model.fbx`).then((r) => {
    if (!r.ok) throw new Error(`no model for ${asset.look}`);
    return r.arrayBuffer();
  });
  // The FBX names TGA textures; the WebP versions are applied below, so its own texture
  // loads are answered with empty placeholders.
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, { load: () => new THREE.Texture(), setPath: () => undefined } as unknown as THREE.Loader);
  const warn = console.warn;
  console.warn = () => undefined;
  let model: THREE.Group;
  try {
    model = new FBXLoader(manager).parse(buffer, "");
  } finally {
    console.warn = warn;
  }

  const parts = Object.keys(asset.parts);
  const uniforms = makeUniforms();
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    // Filled in only once a style is applied (see measure); plain people stay quick to load.
    mesh.geometry.setAttribute("rtRegion", new THREE.BufferAttribute(new Float32Array(mesh.geometry.getAttribute("position").count * 4), 4));
    const old = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const fresh = await Promise.all(old.map((m) => material(asset, partOf(m.name, parts), uniforms)));
    old.forEach((m) => m.dispose());
    mesh.material = Array.isArray(mesh.material) ? fresh : fresh[0];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned bounds follow the bind pose, not the posed body
  }

  const bones: Record<string, THREE.Bone> = {};
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
  });
  for (const [name, axis, degrees] of POSE) {
    bones[name]?.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), THREE.MathUtils.degToRad(degrees)));
  }
  const rest = Object.fromEntries(Object.entries(bones).map(([k, b]) => [k, b.quaternion.clone()]));

  model.scale.setScalar(0.01); // centimetres -> metres
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const eye = bones["Bip01_LEye"] ? new THREE.Vector3().setFromMatrixPosition(bones["Bip01_LEye"].matrixWorld).y : box.max.y * 0.93;
  return {
    root,
    bones,
    rest,
    height: box.max.y,
    eyes: eye,
    base: { height: box.max.y, eyes: eye },
    look: { asset, model, meshes, uniforms, refs: null },
  };
}

// ---- the regions of the body and the colours a style starts from ------------------------------

const LOWER = /Thigh|Calf/;
const HIPS = /Pelvis/; // shared by trousers and the hem of a jacket: counts a third
const FEET = /Foot|Toe/;
const HANDS = /Hand|Finger/;
const EYES = /[LR]Eye$/; // the eyeballs only: lids and brows are skin

/** Per vertex: how much it belongs to the lower body (trousers, skirt) and to the feet (shoes).
 * The hands are kept aside too: they are bare on everyone, so they show the body's own skin. */
const handsOf = new WeakMap<THREE.BufferGeometry, Uint8Array>();
const piecesOf = new WeakMap<THREE.BufferGeometry, Int32Array>();
function regions(mesh: THREE.Mesh) {
  const skinned = mesh as THREE.SkinnedMesh;
  const geometry = mesh.geometry;
  const index = geometry.getAttribute("skinIndex");
  const weight = geometry.getAttribute("skinWeight");
  const count = geometry.getAttribute("position").count;
  const attribute = geometry.getAttribute("rtRegion") as THREE.BufferAttribute;
  const region = attribute.array as Float32Array;
  const hands = new Uint8Array(count);
  if (skinned.isSkinnedMesh && index && weight) {
    const names = skinned.skeleton.bones.map((b) => b.name);
    for (let v = 0; v < count; v++) {
      let lower = 0;
      let feet = 0;
      let hand = 0;
      let eye = 0;
      for (let k = 0; k < 4; k++) {
        const w = weight.getComponent(v, k);
        if (!w) continue;
        const name = names[index.getComponent(v, k)] ?? "";
        if (FEET.test(name)) feet += w;
        else if (LOWER.test(name)) lower += w;
        else if (HIPS.test(name)) lower += w / 3;
        else if (HANDS.test(name)) hand += w;
        else if (EYES.test(name)) eye += w;
      }
      region[v * 4] = lower + feet;
      region[v * 4 + 1] = feet;
      region[v * 4 + 3] = eye;
      hands[v] = hand > 0.9 ? 1 : 0;
    }
    byPiece(geometry, region);
  }
  attribute.needsUpdate = true;
  handsOf.set(geometry, hands);
}

/**
 * Garments are cut into pieces in the texture (UV islands). A piece goes wholly to the top or the
 * bottom, by where most of it is, so a jacket's hem keeps the jacket's colour instead of a line
 * across the hips. Pieces that are split evenly keep the per-vertex weights.
 */
function byPiece(geometry: THREE.BufferGeometry, region: Float32Array) {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!uv) return;
  const count = position.count;
  // Vertices at the same place with the same texture coordinate are one (FBX geometry repeats them).
  const keyOf = new Map<string, number>();
  const id = new Int32Array(count);
  for (let v = 0; v < count; v++) {
    const key = `${position.getX(v).toFixed(2)},${position.getY(v).toFixed(2)},${position.getZ(v).toFixed(2)},${uv.getX(v).toFixed(4)},${uv.getY(v).toFixed(4)}`;
    let k = keyOf.get(key);
    if (k === undefined) keyOf.set(key, (k = keyOf.size));
    id[v] = k;
  }
  const parent = Int32Array.from({ length: keyOf.size }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const index = geometry.index;
  const corners = index ? index.count : count;
  for (let i = 0; i + 2 < corners; i += 3) {
    const [a, b, c] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
    join(id[a], id[b]);
    join(id[b], id[c]);
  }
  const sums = new Map<number, [number, number, number]>();
  for (let v = 0; v < count; v++) {
    const piece = find(id[v]);
    const sum = sums.get(piece) ?? [0, 0, 0];
    sum[0] += region[v * 4];
    sum[1] += region[v * 4 + 1];
    sum[2]++;
    sums.set(piece, sum);
  }
  const pieces = new Int32Array(count);
  for (let v = 0; v < count; v++) {
    pieces[v] = find(id[v]);
    const [lower, feet, n] = sums.get(pieces[v])!;
    const meanLower = lower / n;
    const meanFeet = feet / n;
    if (meanLower < 0.4 || meanLower > 0.6) region[v * 4] = meanLower > 0.5 ? 1 : 0;
    if (meanFeet < 0.3 || meanFeet > 0.7) region[v * 4 + 1] = meanFeet > 0.5 ? 1 : 0;
  }
  piecesOf.set(geometry, pieces);
}

interface Refs {
  skin: THREE.Vector3 | null; // the person's own skin on the face, linear RGB
  bodySkin: THREE.Vector3 | null; // and on the body
  hair: number | null; // mean luminance of the hair
  hairTone: THREE.Vector3 | null; // and its mean colour
  top: number; // mean luminance of the clothes above and below the waist
  bottom: number;
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** A texture's pixels in linear RGB, small. */
function pixels(texture: THREE.Texture | null | undefined, size = 128): { rgb: Float32Array; alpha: Uint8ClampedArray; size: number } | null {
  const image = texture?.image as CanvasImageSource | undefined;
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(image, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size).data;
  const rgb = new Float32Array(size * size * 3);
  const alpha = new Uint8ClampedArray(size * size);
  for (let i = 0; i < size * size; i++) {
    rgb[i * 3] = linear(data[i * 4] / 255);
    rgb[i * 3 + 1] = linear(data[i * 4 + 1] / 255);
    rgb[i * 3 + 2] = linear(data[i * 4 + 2] / 255);
    alpha[i] = data[i * 4 + 3];
  }
  return { rgb, alpha, size };
}

const chromaDistance = (r: number, g: number, b: number, ref: THREE.Vector3) => {
  const l = Math.max(lum(r, g, b), 1e-3);
  const rl = Math.max(lum(ref.x, ref.y, ref.z), 1e-3);
  return Math.hypot(r / l - ref.x / rl, g / l - ref.y / rl, b / l - ref.z / rl);
};
/** Skin-coloured as the shader sees it on clothes: close in hue and in light. */
const nearSkin = (r: number, g: number, b: number, ref: THREE.Vector3) =>
  chromaDistance(r, g, b, ref) < 0.3 && Math.abs(Math.log(Math.max(lum(r, g, b), 1e-4) / Math.max(lum(ref.x, ref.y, ref.z), 1e-3))) < 1.05;

const mapOf = (person: Person, kind: "head" | "body" | "hair"): THREE.Texture | null => {
  for (const mesh of person.look.meshes) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const defines = m.defines ?? {};
      const hit = kind === "hair" ? "RT_HAIR" in defines : kind === "head" ? "RT_SKIN" in defines : "RT_CLOTH" in defines;
      if (hit) return (m as THREE.MeshStandardMaterial).map;
    }
  }
  return null;
};

/** The mean colour of a texture's pixels that pass `keep`, or null if too few do. */
function meanOf(tex: ReturnType<typeof pixels>, keep: (r: number, g: number, b: number) => boolean): THREE.Vector3 | null {
  if (!tex) return null;
  const sum = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < tex.alpha.length; i++) {
    const [r, g, b] = [tex.rgb[i * 3], tex.rgb[i * 3 + 1], tex.rgb[i * 3 + 2]];
    if (tex.alpha[i] > 128 && keep(r, g, b)) {
      sum.add(new THREE.Vector3(r, g, b));
      n++;
    }
  }
  return n > 40 ? sum.divideScalar(n) : null;
}

// Skin is warm: red above green above blue, clearly (grey hair or white teeth are not skin).
const skinLike = (r: number, g: number, b: number) => r > g * 1.15 && g > b && (r - b) / r > 0.35 && lum(r, g, b) > 0.015 && lum(r, g, b) < 0.7;

/** The colours the person was built with, measured once from their textures. */
function measure(person: Person): Refs {
  for (const mesh of person.look.meshes) regions(mesh);
  // Skin: the face's skin-like pixels, refined twice towards their own centre; then the body's
  // pixels near that colour, since arms and legs are often a little lighter or paler than the face.
  const head = pixels(mapOf(person, "head"));
  let skin = meanOf(head, skinLike);
  for (let k = 0; k < 2 && skin; k++) {
    const centre: THREE.Vector3 = skin;
    skin = meanOf(head, (r, g, b) => skinLike(r, g, b) && chromaDistance(r, g, b, centre) < 0.25) ?? centre;
  }
  const bodyMap = mapOf(person, "body");
  const body = pixels(bodyMap);

  /** The body texture under each vertex of the body's own material. */
  const underBody = (visit: (r: number, g: number, b: number, v: number, geometry: THREE.BufferGeometry) => void) => {
    if (!body) return;
    for (const mesh of person.look.meshes) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const geometry = mesh.geometry;
      const uv = geometry.getAttribute("uv");
      if (!uv) continue;
      const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.index?.count ?? uv.count, materialIndex: 0 }];
      for (const group of groups) {
        if (!("RT_CLOTH" in (materials[group.materialIndex ?? 0]?.defines ?? {}))) continue;
        for (let i = group.start; i < group.start + group.count; i++) {
          const v = geometry.index ? geometry.index.getX(i) : i;
          const u = uv.getX(v) - Math.floor(uv.getX(v));
          const w = uv.getY(v) - Math.floor(uv.getY(v));
          const px = Math.min(body.size - 1, Math.floor(u * body.size));
          const py = Math.min(body.size - 1, Math.floor((bodyMap?.flipY === false ? w : 1 - w) * body.size));
          const at = (py * body.size + px) * 3;
          visit(body.rgb[at], body.rgb[at + 1], body.rgb[at + 2], v, geometry);
        }
      }
    }
  };

  // The body's skin: what the texture shows under the hands.
  let bodySkin: THREE.Vector3 | null = null;
  {
    const sum = new THREE.Vector3();
    let n = 0;
    underBody((r, g, b, v, geometry) => {
      if (!handsOf.get(geometry)?.[v] || !skinLike(r, g, b)) return;
      sum.add(new THREE.Vector3(r, g, b));
      n++;
    });
    bodySkin = n >= 12 ? sum.divideScalar(n) : skin;
  }

  // Hair: the mean light of the hair cards.
  const hairTone = meanOf(pixels(mapOf(person, "hair")), () => true);
  const hair = hairTone && lum(hairTone.x, hairTone.y, hairTone.z);

  // How much of each piece of the body is bare skin.
  if (bodySkin) {
    const tally = new Map<THREE.BufferGeometry, Map<number, [number, number]>>();
    underBody((r, g, b, v, geometry) => {
      const piece = piecesOf.get(geometry)?.[v];
      if (piece === undefined) return;
      const counts = tally.get(geometry) ?? new Map<number, [number, number]>();
      tally.set(geometry, counts);
      const c = counts.get(piece) ?? [0, 0];
      if (nearSkin(r, g, b, bodySkin!)) c[0]++;
      c[1]++;
      counts.set(piece, c);
    });
    for (const [geometry, counts] of tally) {
      const region = geometry.getAttribute("rtRegion") as THREE.BufferAttribute;
      const pieces = piecesOf.get(geometry)!;
      for (let v = 0; v < region.count; v++) {
        const c = counts.get(pieces[v]);
        region.setZ(v, c ? c[0] / c[1] : 0);
      }
      region.needsUpdate = true;
    }
  }

  // Clothes: the body texture under the vertices of each region, without the skin and the shoes.
  const sums = { top: [0, 0], bottom: [0, 0] };
  underBody((r, g, b, v, geometry) => {
    const region = geometry.getAttribute("rtRegion");
    if (region.getY(v) > 0.5 || (bodySkin && nearSkin(r, g, b, bodySkin))) return;
    const bucket = region.getX(v) > 0.5 ? sums.bottom : sums.top;
    bucket[0] += lum(r, g, b);
    bucket[1]++;
  });
  const mean = ([sum, n]: number[], fallback: number) => (n > 30 ? sum / n : fallback);
  const top = mean(sums.top, 0.3);
  return { skin, bodySkin, hair, hairTone, top, bottom: mean(sums.bottom, top) };
}

const linearHex = (hex: string) => {
  const c = new THREE.Color(hex); // three converts sRGB hex to linear working colour
  return new THREE.Vector3(c.r, c.g, c.b);
};

/** Change a loaded person's look; a plain style shows them as built. Cheap enough to call on every input. */
export function applyStyle(person: Person, style: PersonStyle | null | undefined) {
  const s = style ?? PLAIN;
  const u = person.look.uniforms;
  const needsRefs = !!(s.skin || s.hair || s.top || s.bottom);
  if (needsRefs && !person.look.refs) person.look.refs = measure(person);
  const refs = person.look.refs;

  const gain = (target: THREE.Vector3, ref: THREE.Vector3) =>
    new THREE.Vector3(
      THREE.MathUtils.clamp(target.x / Math.max(ref.x, 1e-3), 0.04, 6),
      THREE.MathUtils.clamp(target.y / Math.max(ref.y, 1e-3), 0.04, 6),
      THREE.MathUtils.clamp(target.z / Math.max(ref.z, 1e-3), 0.04, 6),
    );
  // The skin references also keep skin out of the clothes' colour, so they are set whenever known.
  if (refs?.skin) u.rtSkinRef.value.copy(refs.skin);
  if (refs?.bodySkin) u.rtBodySkinRef.value.copy(refs.bodySkin);
  if (s.skin && refs?.skin && refs.bodySkin) {
    const target = linearHex(s.skin);
    u.rtSkinGain.value.copy(gain(target, refs.skin));
    u.rtBodySkinGain.value.copy(gain(target, refs.bodySkin));
    u.rtSkinOn.value = 1;
  } else u.rtSkinOn.value = 0;
  // Hair painted on the scalp is told from skin only where the two differ clearly (not on someone
  // with blond hair and fair skin); otherwise only the hair cards change.
  if (refs?.hairTone) u.rtHairTone.value.copy(refs.hairTone);
  if (refs?.hairTone && refs.skin) {
    const h = refs.hairTone;
    const k = refs.skin;
    const apart = chromaDistance(h.x, h.y, h.z, k) + Math.abs(Math.log(Math.max(lum(h.x, h.y, h.z), 1e-4) / Math.max(lum(k.x, k.y, k.z), 1e-4)));
    u.rtHasHair.value = THREE.MathUtils.smoothstep(apart, 0.7, 1.1);
  } else u.rtHasHair.value = 0;
  if (s.hair && refs?.hair && refs.hairTone) {
    u.rtHair.value.copy(linearHex(s.hair));
    u.rtHairRef.value = refs.hair;
    u.rtHairOn.value = 1;
  } else u.rtHairOn.value = 0;
  if (s.top && refs) {
    u.rtTop.value.copy(linearHex(s.top));
    u.rtTopRef.value = refs.top;
    u.rtTopOn.value = 1;
  } else u.rtTopOn.value = 0;
  if (s.bottom && refs) {
    u.rtBottom.value.copy(linearHex(s.bottom));
    u.rtBottomRef.value = refs.bottom;
    u.rtBottomOn.value = 1;
  } else u.rtBottomOn.value = 0;

  // Height scales the whole person; build widens or narrows the body and leaves the head as it is.
  const { model } = person.look;
  person.root.scale.setScalar(s.height);
  model.scale.set(0.01 * s.build, 0.01, 0.01 * s.build);
  const head = person.bones["Bip01_Head"];
  if (head) head.scale.set(1, 1 / s.build, 1 / s.build);
  person.height = person.base.height * s.height;
  person.eyes = person.base.eyes * s.height;
}

export function disposePerson(person: Person) {
  person.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
  });
}
