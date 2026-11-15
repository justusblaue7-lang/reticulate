// The person's leanings, by the same rule as the engine (reticulate/pattern.py): a score at
// least 1.25 from the midpoint is "some" leaning, at least 2.5 a "clear" one.
import type { Science } from "./types";

export interface Leaning {
  dimension: string;
  pole: "low" | "high";
  strength: "clear" | "some";
  value: number;
  name: string; // the dimension
  poleName: string; // e.g. "Cautious"
}

export function leanings(science: Science, values: Record<string, number> | null | undefined): Leaning[] {
  if (!values) return [];
  const out: Leaning[] = [];
  for (const d of science.dimensions) {
    const v = values[d.id];
    if (v === undefined) continue;
    const off = v - 5;
    if (Math.abs(off) < 1.25) continue;
    const pole = off > 0 ? "high" : "low";
    out.push({
      dimension: d.id,
      pole,
      strength: Math.abs(off) >= 2.5 ? "clear" : "some",
      value: v,
      name: d.name,
      poleName: pole === "high" ? d.high_pole : d.low_pole,
    });
  }
  return out.sort((a, b) => Math.abs(b.value - 5) - Math.abs(a.value - 5));
}

export const leaningOf = (science: Science, dimension: string, pole: "low" | "high") =>
  science.pattern.leanings.find((l) => l.dimension === dimension)?.[pole];

/** The statements in a fixed order that keeps each pair apart: one per dimension, then the other. */
export function itemOrder(science: Science) {
  const first = science.dimensions.map((d, i) => science.pattern.items.find((x) => x.dimension === d.id && x.pole === (i % 2 ? "low" : "high"))!);
  const second = science.dimensions.map((d, i) => science.pattern.items.find((x) => x.dimension === d.id && x.pole === (i % 2 ? "high" : "low"))!);
  return [...first, ...second.slice(4), ...second.slice(0, 4)];
}
