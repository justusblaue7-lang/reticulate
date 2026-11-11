// Shared vocabulary and arithmetic of the decision mode.
import type { Avatar, Decision, Problem, Science, SimulationResult } from "../../types";

/** Example decisions for the decision bar; each fills the bar, nothing is sent. */
export const EXAMPLES: { label: string; problem: Problem }[] = [
  {
    label: "A job offer at a start-up",
    problem: {
      question: "Should I accept a job offer at a Munich start-up or stay in my secure job at a large company?",
      context:
        "The start-up offers 20% more salary plus equity and has 18 months of funding. I am 36, have a mortgage, and my partner works locally. My current employer has offered nothing new in two years.",
      options: ["Accept the start-up offer", "Stay in my current job"],
    },
  },
  {
    label: "Investing in a local venture",
    problem: {
      question: "I have €70,000 invested in ETFs. Should I invest €40,000 for a 33% share of a new pickleball facility in Lübbecke?",
      context: "",
      options: [],
    },
  },
  {
    label: "Opening a second location",
    problem: {
      question: "Should we open a second café location next year?",
      context:
        "Our first café has been profitable for three years. The new site needs €120,000 and a ten-year lease. My co-founder is hesitant and wants to pay down debt first.",
      options: [],
    },
  },
  {
    label: "A master's degree at 38",
    problem: {
      question: "Should I go back to university for a part-time master's degree at 38?",
      context: "I have two children and a full-time job. My employer will not pay for it, but a promotion would likely require it within five years.",
      options: [],
    },
  },
];

/** Anatomy levels as the user answers them, and as Claude rates them. */
export const ANSWERS = ["No", "A little", "Yes", "Central"] as const;
export const LEVEL_NAME = ["absent", "minor", "present", "central"] as const;

/** How strongly a mechanism is engaged, from the highest level among its features. */
export const PULL = ["", "Possible", "Likely", "Strong pull"] as const;

/** List-price estimates per call on Claude Opus 5.5 (rough; the record shows the real cost). */
export const ANALYSIS_USD = 0.08;
export const CALL_USD = 0.1;
/** One question of the dialogue: the cached conversation plus a short structured answer. */
export const TURN_USD = 0.04;
const SECONDS_PER_CALL = 45;
const CONCURRENCY = 6;

export function estimate(calls: number, perCall = CALL_USD) {
  const minutes = Math.max(1, Math.round((Math.ceil(calls / CONCURRENCY) * SECONDS_PER_CALL) / 60));
  return { usd: calls * perCall, minutes, calls };
}

/** The cost per call this decision has actually had so far, if any. */
export function observedPerCall(decision: Decision): number | undefined {
  const { calls, cost_usd } = decision.usage;
  return calls > 0 && cost_usd ? cost_usd / calls : undefined;
}

export const panelCalls = (decision: Decision, members: number, replicates: number) =>
  members * replicates + (decision.frame ? 0 : 1) + (members > 1 ? 1 : 0);

export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Dimensions this decision engages, most engaged first. */
export function engagedDimensions(decision: Decision) {
  return decision.signature.dimensions.filter((d) => d.weight > 0);
}

/**
 * A panel that disagrees where it matters: greedy farthest-point selection over the avatars'
 * leanings (distance from 5), weighted by how strongly the decision engages each dimension.
 */
export function suggestPanel(avatars: Avatar[], decision: Decision, science: Science, size = 5): string[] {
  const weight = new Map(engagedDimensions(decision).map((d) => [d.dimension_id, d.weight]));
  const ids = science.dimensions.map((d) => d.id);
  const vector = (a: Avatar) => ids.map((id) => ((a.dimensions[id]?.value ?? 5) - 5) * Math.sqrt((weight.get(id) ?? 0) + 0.1));
  const vectors = new Map(avatars.map((a) => [a.id, vector(a)]));
  const distance = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]));
  const norm = (v: number[]) => Math.hypot(...v);
  const pool = [...avatars].sort((a, b) => norm(vectors.get(b.id)!) - norm(vectors.get(a.id)!) || a.id.localeCompare(b.id));
  const chosen: Avatar[] = pool.slice(0, 1);
  while (chosen.length < Math.min(size, pool.length)) {
    let best: Avatar | null = null;
    let bestScore = -1;
    for (const a of pool) {
      if (chosen.includes(a)) continue;
      const score = Math.min(...chosen.map((c) => distance(vectors.get(a.id)!, vectors.get(c.id)!)));
      if (score > bestScore) [best, bestScore] = [a, score];
    }
    chosen.push(best!);
  }
  return chosen.map((a) => a.id);
}

/** The panel's verdict: options ranked by how many members chose them. */
export function verdict(panel: SimulationResult) {
  const ids = panel.space.profile_ids;
  const supporters = (option: string) => ids.filter((id) => panel.space.recommendations[id]?.option === option);
  const options = [...new Set([...panel.frame.options, ...ids.map((id) => panel.space.recommendations[id]?.option).filter(Boolean)])];
  const ranked = options
    .map((option) => ({ option, ids: supporters(option) }))
    .sort((a, b) => b.ids.length - a.ids.length || options.indexOf(a.option) - options.indexOf(b.option));
  const total = ids.length;
  const lead = ranked[0];
  const tie = ranked.length > 1 && ranked[1].ids.length === lead.ids.length;
  const statement =
    tie
      ? `The panel is split between “${lead.option}” and “${ranked[1].option}”.`
      : lead.ids.length === total
        ? `All ${total} choose “${lead.option}”.`
        : `${lead.ids.length} of ${total} choose “${lead.option}”.`;
  const alignment = tie ? "split" : lead.ids.length === total ? "unanimous" : lead.ids.length / total >= 0.75 ? "largely aligned" : "divided";
  return { ranked, total, lead, tie, statement, alignment };
}

export const unique = (items: string[]) => [...new Map(items.map((s) => [s.trim().toLowerCase(), s.trim()])).values()];

/** Names of dimensions and Big Five traits by id. */
export function tendencyNames(science: Science) {
  return new Map([...science.dimensions.map((d) => [d.id, d.name] as const), ...science.personality.traits.map((t) => [t.id, t.name] as const)]);
}

/** Poles of a dimension or trait, for labelling levels. */
export function poles(science: Science, key: string): [string, string] {
  const item = science.dimensions.find((d) => d.id === key) ?? science.personality.traits.find((t) => t.id === key);
  return item ? [item.low_pole, item.high_pole] : ["low", "high"];
}
