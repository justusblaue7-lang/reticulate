// Loads the atlas assets produced by `reticulate build-atlas` (web/public/atlas).

import type { Source } from "../types";

export type DType = "float32" | "uint32" | "uint8" | "int8";

export interface BufferEntry {
  dtype: DType;
  offset: number;
  length: number;
}

export interface AtlasStructure {
  key: string; // e.g. "lh.insula", "brainstem"
  id: string; // region id in regions.yaml
  hemi: "lh" | "rh" | null;
  kind: "cortex" | "medialwall" | "deep";
}

export interface GeometryManifest {
  version: string;
  space: string;
  sources: Record<string, string>;
  regions: AtlasStructure[]; // index = region code used in the buffers
  networks: { index: number; id: string; color: string }[];
  hemispheres: Record<"lh" | "rh", { vertices: number; faces: number; buffers: Record<string, string> }>;
  deep: { key: string; region: number; vertices: number; faces: number; map_offset: number; buffers: Record<string, string> }[];
  envelope: Record<"lh" | "rh", { position: string; index: string }>;
  buffers: Record<string, BufferEntry>;
}

export interface StructureStats extends AtlasStructure {
  vertices: number;
  area_cm2?: number;
  volume_cm3?: number;
  centroid: [number, number, number];
  anchor: number;
  view: string;
  networks?: Record<string, number>;
  constructs: Partial<Record<Source, Record<string, number>>>;
}

export interface SourceEntry {
  file: string;
  display_max: number;
  coverage: number;
  top_regions: { key: string; z: number }[];
  constructs: Record<string, number> | null;
  query?: string;
  query_terms?: string[];
  map_terms?: { term: string; weight: number }[];
  terms?: string[];
  studies?: number;
  fdr_z?: number | null;
}

export interface MapEntry {
  id: string; // "stimulus.risky_gamble", "construct.risk_tolerance", "feature.possible_loss"
  kind: "construct" | "stimulus" | "feature";
  ref: string;
  name: string;
  sources: Partial<Record<Source, SourceEntry>>;
  agreement?: { r: number; dice: number | null };
}

export interface MapCatalogue {
  version: string;
  generated: string;
  threshold: number;
  quant_scale: number;
  layout: { lh: number; rh: number; deep: number };
  grid: string;
  sources: Record<Source, Record<string, string | number>>;
  agreement: { terms: number; median_r: number | null; quartiles: [number, number] | null; min_studies: number };
  maps: MapEntry[];
}

export interface Atlas {
  geometry: GeometryManifest;
  stats: StructureStats[]; // index = region code
  catalogue: MapCatalogue;
  array(name: string): Float32Array | Uint32Array | Uint8Array | Int8Array;
}

const BASE = "/atlas";

async function json<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}/${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function loadAtlas(): Promise<Atlas> {
  const [geometry, regions, catalogue, bin] = await Promise.all([
    json<GeometryManifest>("geometry.json"),
    json<{ regions: StructureStats[] }>("regions.json"),
    json<MapCatalogue>("maps.json"),
    fetch(`${BASE}/geometry.bin`).then((r) => {
      if (!r.ok) throw new Error(`geometry.bin: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const byKey = new Map(regions.regions.map((r) => [r.key, r]));
  return {
    geometry,
    stats: geometry.regions.map((r) => byKey.get(r.key)!),
    catalogue,
    array(name) {
      const e = geometry.buffers[name];
      if (!e) throw new Error(`missing buffer ${name}`);
      switch (e.dtype) {
        case "float32":
          return new Float32Array(bin, e.offset, e.length);
        case "uint32":
          return new Uint32Array(bin, e.offset, e.length);
        case "uint8":
          return new Uint8Array(bin, e.offset, e.length);
        case "int8":
          return new Int8Array(bin, e.offset, e.length);
      }
    },
  };
}

const mapCache = new Map<string, Promise<Float32Array>>();

function dequantise(raw: Int8Array, scale: number): Float32Array {
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / scale;
  return out;
}

/** Vertex values of a curated map in one source: [lh vertices | rh vertices | deep vertices]. */
export function loadMap(atlas: Atlas, entry: MapEntry, source: Source): Promise<Float32Array> {
  const file = entry.sources[source]?.file;
  if (!file) return Promise.reject(new Error(`${entry.id} has no ${source} map`));
  let pending = mapCache.get(file);
  if (!pending) {
    pending = fetch(`${BASE}/${file}`)
      .then((r) => r.arrayBuffer())
      .then((b) => dequantise(new Int8Array(b), atlas.catalogue.quant_scale));
    mapCache.set(file, pending);
  }
  return pending;
}

export function decodeValues(atlas: Atlas, base64: string): Float32Array {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return dequantise(new Int8Array(bytes.buffer), atlas.catalogue.quant_scale);
}

/** Minimum-statistic conjunction: where both sources reach a value (Nichols et al., 2005). */
export function conjunction(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.min(a[i], b[i]);
  return out;
}

/** Weighted mean of vertex maps (a descriptive composite, not itself a z-map). */
export function weightedMean(maps: { values: Float32Array; weight: number }[]): Float32Array | null {
  const used = maps.filter((m) => m.weight > 0);
  if (!used.length) return null;
  const total = used.reduce((s, m) => s + m.weight, 0);
  const out = new Float32Array(used[0].values.length);
  for (const m of used) {
    const w = m.weight / total;
    for (let i = 0; i < out.length; i++) out[i] += w * m.values[i];
  }
  return out;
}

/** Mean of a vertex map over one structure (cortex: its vertices; deep: its mesh vertices). */
export function structureMean(atlas: Atlas, values: Float32Array, code: number): number {
  const s = atlas.geometry.regions[code];
  const { lh, rh } = atlas.catalogue.layout;
  if (s.kind === "deep") {
    const mesh = atlas.geometry.deep.find((d) => d.region === code)!;
    let sum = 0;
    for (let i = 0; i < mesh.vertices; i++) sum += values[lh + rh + mesh.map_offset + i];
    return sum / mesh.vertices;
  }
  const codes = atlas.array(atlas.geometry.hemispheres[s.hemi!].buffers.region) as Uint8Array;
  const offset = s.hemi === "lh" ? 0 : lh;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < codes.length; i++) {
    if (codes[i] === code) {
      sum += values[offset + i];
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Mean of a vertex map for every structure, strongest first (one pass over the vertices). */
export function rankStructures(atlas: Atlas, values: Float32Array, top = 10): { key: string; z: number }[] {
  const n = atlas.geometry.regions.length;
  const sum = new Float64Array(n);
  const count = new Float64Array(n);
  const { lh, rh } = atlas.catalogue.layout;
  for (const [hemi, offset] of [["lh", 0], ["rh", lh]] as const) {
    const codes = atlas.array(atlas.geometry.hemispheres[hemi].buffers.region) as Uint8Array;
    for (let i = 0; i < codes.length; i++) {
      sum[codes[i]] += values[offset + i];
      count[codes[i]]++;
    }
  }
  for (const mesh of atlas.geometry.deep) {
    for (let i = 0; i < mesh.vertices; i++) sum[mesh.region] += values[lh + rh + mesh.map_offset + i];
    count[mesh.region] += mesh.vertices;
  }
  return atlas.geometry.regions
    .map((s, code) => ({ key: s.key, kind: s.kind, z: count[code] ? sum[code] / count[code] : 0 }))
    .filter((r) => r.kind !== "medialwall")
    .sort((a, b) => b.z - a.z)
    .slice(0, top)
    .map(({ key, z }) => ({ key, z: Math.round(z * 100) / 100 }));
}

export function percentile99(values: Float32Array, above: number): number {
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += 5) if (values[i] > above) sample.push(values[i]);
  if (!sample.length) return above + 1;
  sample.sort((a, b) => a - b);
  return Math.min(25, sample[Math.floor(sample.length * 0.99)]);
}

// ---- full-vocabulary decoding ------------------------------------------------------------

export type Category = "concept" | "task" | "disorder" | "anatomy" | "other";

interface VocabularyFile {
  structures: string[];
  scale: number;
  categories: [Category, string][];
  cognitive_atlas: { retrieved: string; entries: number };
  agreement: MapCatalogue["agreement"];
  neuroquery: { offset: number; terms: string[]; documents: number[]; category: number[]; atlas: (string | null)[]; link: number[]; agreement: (number | null)[] };
  neurosynth: { offset: number; terms: string[]; studies: number[]; category: number[]; atlas: (string | null)[]; link: number[]; fdr_z: (number | null)[] };
}

export interface Vocabulary extends VocabularyFile {
  decoding: Int16Array;
}

let vocabulary: Promise<Vocabulary> | null = null;

export function loadVocabulary(): Promise<Vocabulary> {
  vocabulary ??= Promise.all([
    json<VocabularyFile>("vocabulary.json"),
    fetch(`${BASE}/decoding.bin`).then((r) => r.arrayBuffer()),
  ]).then(([file, bin]) => ({ ...file, decoding: new Int16Array(bin) }));
  return vocabulary;
}

export interface DecodedTerm {
  term: string;
  z: number; // mean z of the term's map in the structure
  evidence: number; // documents (NeuroQuery) or studies (Neurosynth)
  category: Category;
  other: number | null; // the same term's value in the other source, when it has one
}

export const MIN_EVIDENCE = 50;

/** Terms whose maps are strongest in a structure, from the whole vocabulary of one source. */
export function decodeStructure(
  vocab: Vocabulary,
  source: Source,
  key: string,
  scope: "functional" | "all",
  n = 8,
): DecodedTerm[] {
  const s = vocab.structures.indexOf(key);
  if (s < 0) return [];
  const width = vocab.structures.length;
  const table = vocab[source];
  const other = source === "neuroquery" ? vocab.neurosynth : vocab.neuroquery;
  const evidence = source === "neuroquery" ? vocab.neuroquery.documents : vocab.neurosynth.studies;
  const rows: DecodedTerm[] = [];
  for (let t = 0; t < table.terms.length; t++) {
    const category = vocab.categories[table.category[t]][0];
    if (scope === "functional" && (!(category === "concept" || category === "task") || evidence[t] < MIN_EVIDENCE)) continue;
    const link = table.link[t];
    rows.push({
      term: table.terms[t],
      z: vocab.decoding[table.offset + t * width + s] / vocab.scale,
      evidence: evidence[t],
      category,
      other: link >= 0 ? vocab.decoding[other.offset + link * width + s] / vocab.scale : null,
    });
  }
  rows.sort((a, b) => b.z - a.z);
  return rows.slice(0, n);
}

/** Terms of both sources for a search box, best matches first. */
export function searchTerms(vocab: Vocabulary, query: string, n = 12): { term: string; nq: boolean; ns: boolean; evidence: number }[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const found = new Map<string, { term: string; nq: boolean; ns: boolean; evidence: number }>();
  vocab.neuroquery.terms.forEach((term, i) => {
    if (term.includes(q)) found.set(term, { term, nq: true, ns: vocab.neuroquery.link[i] >= 0, evidence: vocab.neuroquery.documents[i] });
  });
  vocab.neurosynth.terms.forEach((term, i) => {
    if (!term.includes(q)) return;
    const hit = found.get(term);
    if (hit) hit.ns = true;
    else found.set(term, { term, nq: vocab.neurosynth.link[i] >= 0, ns: true, evidence: vocab.neurosynth.studies[i] });
  });
  return [...found.values()]
    .sort((a, b) => Number(b.term.startsWith(q)) - Number(a.term.startsWith(q)) || b.evidence - a.evidence)
    .slice(0, n);
}
