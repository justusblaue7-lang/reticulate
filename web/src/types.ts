// Mirrors the engine's pydantic models (engine/reticulate). Keep in sync.

export type Provenance = "measured" | "inferred" | "meta-analytic" | "authored";
export type Source = "neuroquery" | "neurosynth";
export type Design = "within_subject" | "individual_differences" | "lesion" | "stimulation" | "meta_analysis" | "theory";

export interface Anchors {
  low: string;
  high: string;
}

export interface Dimension {
  id: string;
  name: string;
  low_pole: string;
  high_pole: string;
  definition: string;
  constructs: string[];
  instruments: { id: string; name: string; kind: string; ref: string | null }[];
  notes: string;
  refs: string[];
  construct_map: { query: string; neurosynth: string[]; quality: "good" | "moderate" | "low"; note: string };
  reasoning: Anchors;
}

export interface Trait {
  id: string;
  name: string;
  low_pole: string;
  high_pole: string;
  definition: string;
  anchors: Anchors;
}

export interface Network {
  id: string;
  index: number;
  name: string;
  functions: string[];
  notes: string;
  refs: string[];
}

export interface Region {
  id: string;
  name: string;
  alias: string;
  group: string;
  kind: "cortex" | "medialwall" | "deep";
  functions: string[];
  refs: string[];
}

export interface RegionLink {
  region: string;
  dimension: string;
  design: Design;
  finding: string;
  refs: string[];
}

export interface Stimulus {
  id: string;
  category: string;
  name: string;
  paradigm: string;
  query: string;
  neurosynth: string[];
  note: string;
  refs: string[];
}

export interface DecisionFeature {
  id: string;
  name: string;
  question: string; // rated by Claude
  ask: string; // the same question put to the user
  neuroquery: string;
  neurosynth: string[];
  dimensions: string[];
  mechanisms: string[];
  note: string;
}

export interface Countermove {
  text: string;
  basis: "tested" | "derived"; // tested: an intervention study shows that it reduces the effect
  finding: string;
  refs: string[];
}

export interface Mechanism {
  id: string;
  name: string;
  summary: string;
  evidence: { design: Design; finding: string; refs: string[] }[];
  dimensions: string[];
  refs: string[];
  countermove: Countermove;
}

export interface SocraticStage {
  id: string;
  name: string;
  aim: string;
  note: string;
  refs: string[];
}

export interface SocraticMove {
  id: string;
  name: string;
  question: string;
  basis: "tested" | "derived";
  finding: string;
  refs: string[];
}

export interface Science {
  version: string;
  socratic: { method: { summary: string; refs: string[] }; stages: SocraticStage[]; moves: SocraticMove[] };
  dimensions: Dimension[];
  personality: {
    traits: Trait[];
    values: { id: string; name: string; definition: string }[];
    refs: string[];
    value_refs: string[];
  };
  networks: Network[];
  region_groups: { id: string; name: string }[];
  regions: Region[];
  links: RegionLink[];
  stimulus_categories: { id: string; name: string }[];
  stimuli: Stimulus[];
  features: DecisionFeature[];
  mechanisms: Mechanism[];
  references: Record<string, string>;
}

export interface Score {
  value: number;
  provenance: Provenance;
  uncertainty: number | null;
  source: string | null;
}

/** Who an avatar is shown as: a fictional name and a 3D person. Never part of a prompt. */
export interface Person {
  name: string;
  look: string; // id of a 3D person in web/public/people
}

export interface Avatar {
  id: string;
  name: string;
  kind: "persona" | "archetype" | "figure_inspired" | "personal" | "custom";
  origin: "library" | "user";
  summary: string;
  nuance: string;
  priorities: string[];
  voice: string;
  dimensions: Record<string, Score>;
  personality: { traits: Record<string, Score>; values: string[] } | null;
  context: { goals: string[]; constraints: string[]; notes: string } | null;
  person: Person | null;
  phenotype?: unknown; // the drawn cameo of builds before 0.5; kept, no longer used
}

export interface Status {
  version: string;
  science_version: string;
  claude: { configured: boolean; model: string; effort: string; dialogue_effort: string; key_hint: string | null };
  literature: boolean;
  data_dir: string;
}

export interface Problem {
  question: string;
  context: string;
  options: string[];
}

export interface Factor {
  id: string;
  name: string;
  description: string;
}

export interface Perspective {
  recommendation: string;
  conditions: string[];
  summary: string;
  reasoning: string;
  assessments: { factor_id: string; weight: number; favours: string; rationale: string }[];
  added_factors: Factor[];
  key_questions: string[];
  would_change_mind: string[];
  confidence: number;
  dimension_drivers: { dimension_id: string; effect: string }[];
}

export interface DecisionFrame {
  decision: string;
  options: string[];
  facts: string[];
  unknowns: string[];
  factors: Factor[];
}

export interface Tally {
  option: string;
  counts: Record<string, number>;
}

export interface Usage {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number | null;
}

export interface RunMeta {
  app_version: string;
  science_version: string;
  prompt_version: string;
  engine: string;
  model: string | null;
  effort: string | null;
  replicates: number;
  neural_context: boolean;
  usage: Usage | null;
}

export interface SimulationResult {
  id: string;
  kind: "simulation";
  created_at: string;
  meta: RunMeta;
  problem: Problem;
  frame: DecisionFrame;
  profiles: Avatar[];
  perspectives: Record<string, Perspective[]>;
  space: {
    profile_ids: string[];
    factors: {
      factor_id: string;
      name: string;
      weights: Record<string, { mean: number; min: number; max: number; n: number }>;
      favours: Record<string, string>;
      spread: number;
      contested: boolean;
    }[];
    recommendations: Record<string, Tally>;
    agreement: number;
    notes: string[];
  };
  synthesis: {
    overview: string;
    divergences: { factor_id: string; explanation: string }[];
    shared_ground: string[];
    blind_spots: string[];
  } | null;
  notice: string;
}

export interface SensitivityResult {
  id: string;
  kind: "sensitivity";
  created_at: string;
  meta: RunMeta;
  problem: Problem;
  frame: DecisionFrame;
  profile: Avatar;
  dimension: string; // a dimension or trait id
  values: number[];
  perspectives: Record<string, Perspective[]>;
  curves: {
    factor_id: string;
    name: string;
    points: { value: number; mean: number; min: number; max: number; n: number }[];
    slope: number;
    slope_se: number | null;
  }[];
  recommendations: Record<string, Tally>;
  notice: string;
}

export interface Rating {
  feature_id: string;
  level: number; // 0 absent … 3 central
  reason: string;
  source: "model" | "user";
}

export interface SignatureSource {
  maps: number;
  display_max: number;
  coverage: number;
  top_regions: { key: string; z: number }[];
  networks: Record<string, number>;
  constructs: Record<string, number>;
  decoding: { term: string; r: number }[];
}

export interface NeuralSignature {
  weights: Record<string, number>;
  neuroquery: SignatureSource | null;
  neurosynth: SignatureSource | null;
  agreement: { r: number; dice: number | null; maps: number } | null;
  dimensions: { dimension_id: string; weight: number; features: string[]; overlap: Partial<Record<Source, number>> }[];
  mechanisms: { mechanism_id: string; level: number; features: string[] }[];
  findings: number[];
  unmapped: string[];
  available: boolean;
}

export interface WatchOut {
  mechanism_id: string;
  here: string; // how the mechanism could pull on this decision (Claude)
  check: string; // its countermove for this decision (Claude)
}

// --- the Socratic dialogue ---------------------------------------------------------------

export interface Notes {
  decision: string;
  goals: string[];
  options: string[];
  facts: string[];
  unknowns: string[];
  assumptions: { text: string; status: "open" | "holds" | "shaky" | "dropped" }[];
  leaning: string;
  confidence: number; // 0–10, or -1 when not known
}

export interface SocraticTurn {
  reflection: string;
  question: string;
  move: string;
  stage: string;
  mechanism_id: string; // or "none"
  why: string;
  scale: boolean;
  notes: Notes;
  ready: boolean;
}

export interface Exchange {
  turn: SocraticTurn;
  asked_at: string;
  answer: string | null;
  skipped: boolean;
  answered_at: string | null;
  context: string | null;
  usage: Usage;
}

export interface Conclusion {
  decided: boolean;
  choice: string;
  statement: string;
  reasons: string[];
  tradeoffs: string[];
  revisit_if: string[];
  open_questions: string[];
  first_step: string;
  if_then: string;
  review: string;
  quality: { stage: string; level: "strong" | "partial" | "weak"; note: string }[];
}

export interface Dialogue {
  exchanges: Exchange[];
  pending: string[];
  conclusion: Conclusion | null;
  concluded_at: string | null;
  conclusion_usage: Usage | null;
  meta: { prompt_version: string; model: string | null; effort: string | null };
}

export interface Decision {
  id: string;
  kind: "decision";
  created_at: string;
  updated_at: string;
  problem: Problem;
  dialogue: Dialogue | null;
  analysis: "none" | "pending" | "done" | "failed";
  analysis_error: string | null;
  settled: string[];
  frame: DecisionFrame | null;
  anatomy: Rating[];
  watch_outs: WatchOut[];
  signature: NeuralSignature;
  neural_context: boolean;
  panel: SimulationResult | null;
  tipping: SensitivityResult[];
  usage: Usage;
  meta: { app_version: string; science_version: string; prompt_version: string; model: string | null; effort: string | null };
  notice: string;
}

export interface DecisionSummary {
  id: string;
  kind: "decision";
  created_at: string;
  updated_at: string;
  question: string;
  title: string;
  status: "decided" | "in dialogue" | "analysed" | "rated";
  decided: string | null;
  questions: number;
  verdict: string | null; // "3/4 · Option"
  label: string;
  steps: string[];
  cost_usd: number | null;
  file: string;
}

/** A panel or tipping run in flight. */
export interface Progress {
  kind: "panel" | "tipping";
  total: number;
  done: number;
  labels: Record<string, number>; // avatar id (or level) -> replicates finished
  started_at: string;
}

/** A free-text or vocabulary map from POST /api/maps. */
export interface SourceMap {
  display_max: number;
  coverage: number;
  top_regions: { key: string; z: number }[];
  networks: Record<string, number>;
  constructs: Record<string, number>;
  decoding: { term: string; r: number }[];
  values: string; // base64 int8 vertex values
  query_terms?: string[];
  map_terms?: { term: string; weight: number }[];
  terms?: string[];
  studies?: number;
  fdr_z?: number | null;
}

export interface TextMap {
  query: string;
  neuroquery: SourceMap;
  neurosynth: SourceMap | null;
  agreement: { r: number; dice: number | null } | null;
}
