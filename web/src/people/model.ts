// The 3D people: realistic humans from the Microsoft Rocketbox avatar library (MIT), built
// into web/public/people by tools/people/build.py. Each person is the library's FBX model,
// loaded and posed here, with physically based materials made from its WebP textures.

import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

export interface PersonAsset {
  look: string;
  source: string;
  parts: Record<string, string[]>; // part (head, body, opacity …) -> maps: color, normal, rough
}

let catalogue: Promise<PersonAsset[]> | null = null;

/** Every 3D person the app has, in the order of tools/people/cast.yaml. */
export function loadCatalogue(): Promise<PersonAsset[]> {
  catalogue ??= fetch("/people/index.json")
    .then((r) => (r.ok ? r.json() : { people: [] }))
    .then((data: { people: PersonAsset[] }) => data.people)
    .catch(() => []);
  return catalogue;
}

export const portraitUrl = (look: string, kind: "face" | "portrait" = "face") => `/people/${look}/${kind}.webp`;

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

async function material(asset: PersonAsset, part: string | null): Promise<THREE.Material> {
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
    return new THREE.MeshPhysicalMaterial({ ...shared, sheen: 0.35, sheenRoughness: 0.75, sheenColor: new THREE.Color("#ffd9c7"), specularIntensity: 0.55 });
  }
  if (part?.includes("glasses")) {
    // Frames and tinted lenses: real transparency, drawn after the face.
    return new THREE.MeshStandardMaterial({ ...shared, roughness: 0.25, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  }
  if (maps.includes("alpha")) {
    // Hair, lashes and brows are cards with an alpha mask. Matte and with little specular,
    // so that the rim light does not streak across the cards.
    return new THREE.MeshPhysicalMaterial({
      ...shared,
      roughnessMap: null,
      roughness: 0.85,
      specularIntensity: 0.25,
      alphaTest: 0.45,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshStandardMaterial({ ...shared, side: part === "body" ? THREE.FrontSide : THREE.DoubleSide });
}

export interface Person {
  root: THREE.Group; // in metres, standing on y = 0, facing +z
  bones: Record<string, THREE.Bone>;
  rest: Record<string, THREE.Quaternion>; // the relaxed pose, before any idle motion
  height: number;
  eyes: number; // eye height
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
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const old = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const fresh = await Promise.all(old.map((m) => material(asset, partOf(m.name, parts))));
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
  return { root, bones, rest, height: box.max.y, eyes: eye };
}

export function disposePerson(person: Person) {
  person.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
  });
}
