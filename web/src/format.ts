import type { Design, Science, Source } from "./types";

/** "Kuhnen, C. M. & Knutson, B. (2005). …" → "Kuhnen & Knutson, 2005". */
export function shortCite(full: string | undefined, key: string): string {
  if (!full) return key;
  const match = full.match(/^(.*?)\((\d{4})\)/);
  if (!match) return key;
  const [, authors, year] = match;
  const surnames = [
    ...authors.matchAll(/((?:(?:De|Di|Da|Del|Du|Le|La|Van|Von) )?[A-ZÀ-Ý][\p{L}'’\-]+(?: [a-z]+ [A-Z][\p{L}'’\-]+)?),\s(?:[A-Z]\.\s?-?)+/gu),
  ].map((m) => m[1]);
  if (!surnames.length) return `${authors.split(",")[0]}, ${year}`;
  if (/et al\./.test(authors) || surnames.length > 2) return `${surnames[0]} et al., ${year}`;
  return `${surnames.join(" & ")}, ${year}`;
}

export const DESIGN_LABEL: Record<Design, string> = {
  within_subject: "Task fMRI, within people",
  individual_differences: "Individual differences",
  lesion: "Lesion study",
  stimulation: "Brain stimulation (causal)",
  meta_analysis: "Meta-analysis",
  theory: "Theoretical proposal",
};

export const SOURCE_LABEL: Record<Source, string> = { neuroquery: "NeuroQuery", neurosynth: "Neurosynth" };

export const SOURCE_LINE: Record<Source | "both", string> = {
  neuroquery: "Meta-analytic map · NeuroQuery (Dockès et al., 2020), 13,459 full-text articles",
  neurosynth: "Meta-analytic map · Neurosynth association test (Yarkoni et al., 2011), 14,371 studies",
  both: "Where both sources agree · minimum of the NeuroQuery and Neurosynth maps (conjunction)",
};

/** Short dimension names for the profile glyph's axes. */
export const SHORT: Record<string, string> = {
  risk_tolerance: "Risk",
  exploration: "Explore",
  time_horizon: "Horizon",
  analytical_style: "Analytic",
  experimentation: "Novelty",
  social_orientation: "Social",
  uncertainty_tolerance: "Ambiguity",
  cognitive_flexibility: "Flexible",
};

export const HEMI_LABEL = { lh: "Left hemisphere", rh: "Right hemisphere" } as const;

export const LEVELS = ["absent", "minor", "present", "central"] as const;

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const signed = (x: number, digits = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`;

export const usd = (x: number | null | undefined) => (x == null ? "–" : x < 0.01 ? "< $0.01" : `$${x.toFixed(2)}`);

/** An estimate in words: "about $0.12", or "under a cent". */
export const roughly = (x: number) => (x < 0.01 ? "under a cent" : `about ${usd(x)}`);

/** "rh.insula" → "Insula, right". */
export function structureName(science: Science, key: string): string {
  const [hemi, id] = key.includes(".") ? key.split(".") : [null, key];
  const name = science.regions.find((r) => r.id === id)?.name ?? id;
  return hemi ? `${name}, ${hemi === "lh" ? "left" : "right"}` : name;
}
