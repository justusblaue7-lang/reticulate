// The catalogue of 3D people and their portraits, without three.js: the portraits are plain
// images, so the interface can show them before (or without) loading any 3D.

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
