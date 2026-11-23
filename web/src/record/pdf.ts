import type { Column, Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { displayName } from "../components/Face";
import { usd } from "../format";
import type { Conclusion, Decision, Exchange, Notes, Science } from "../types";

/**
 * The whole decision as a PDF to keep: what you decided and why, a page to come back to at the
 * review, the full dialogue, the biases at play and what the other minds said. Built in the
 * browser, so on reticulate.space nothing leaves this computer to make it.
 */

type PdfMake = typeof import("pdfmake/build/pdfmake");

// ---- the press: pdfmake, its Roboto, and Instrument Serif for the headings, loaded once on demand

let press: Promise<PdfMake> | null = null;

async function base64(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function load(): Promise<PdfMake> {
  press ??= (async () => {
    const [make, fonts, serif, serifItalic] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/vfs_fonts"),
      base64("/fonts/InstrumentSerif-Regular.ttf"),
      base64("/fonts/InstrumentSerif-Italic.ttf"),
    ]);
    // Both are CommonJS bundles: the module is the default export.
    const pdfMake = ((make as { default?: PdfMake }).default ?? make) as PdfMake;
    const vfs = ((fonts as { default?: Record<string, string> }).default ?? fonts) as Record<string, string>;
    pdfMake.addVirtualFileSystem({ ...vfs, "InstrumentSerif-Regular.ttf": serif, "InstrumentSerif-Italic.ttf": serifItalic });
    pdfMake.addFonts({
      Roboto: { normal: "Roboto-Regular.ttf", bold: "Roboto-Medium.ttf", italics: "Roboto-Italic.ttf", bolditalics: "Roboto-MediumItalic.ttf" },
      Serif: {
        normal: "InstrumentSerif-Regular.ttf",
        bold: "InstrumentSerif-Regular.ttf",
        italics: "InstrumentSerif-Italic.ttf",
        bolditalics: "InstrumentSerif-Italic.ttf",
      },
    });
    return pdfMake;
  })().catch((e) => {
    press = null;
    throw e;
  });
  return press;
}

/** The record, built and ready to save. */
export async function makeRecord(science: Science, decision: Decision) {
  const pdfMake = await load();
  return pdfMake.createPdf(recordDocument(science, decision));
}

/** Build the record and hand it to the browser as a download. */
export async function downloadRecord(science: Science, decision: Decision) {
  await (await makeRecord(science, decision)).download(fileName(decision));
}

export function fileName(decision: Decision) {
  const slug = decision.problem.question
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");
  return `reticulate-${decision.created_at.slice(0, 10)}-${slug || decision.id.slice(0, 8)}.pdf`;
}

// ---- the page ---------------------------------------------------------------------------------

const INK = "#15171b";
const INK_2 = "#3f444b";
const MUTED = "#868b93";
const RULE = "#dfe1e4";
const FILL = "#f4f5f6";
const ACCENT = "#2f6fe0";
const WIDTH = 595.28 - 2 * 62; // A4 less the side margins

const LEVEL = { strong: "Strong", partial: "Partial", weak: "Weak" } as const;
const FILLED = { strong: 3, partial: 2, weak: 1 } as const;
const ASSUMPTION = { open: "Open", holds: "Holds", shaky: "Shaky", dropped: "Dropped" } as const;

/** "In six months" as it reads inside a sentence: "in six months". */
const when = (review: string) => {
  const s = review.replace(/^review\s+/i, "").replace(/\.$/, "").trim();
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
};
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** "claude-opus-5-5" → "Claude Opus 5.5". */
const modelName = (id: string) => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : id;
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const rule = (margin: [number, number, number, number] = [0, 0, 0, 0]): Content => ({
  canvas: [{ type: "line", x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 0.6, lineColor: RULE }],
  margin,
});

const eyebrow = (text: string, margin: [number, number, number, number] = [0, 0, 0, 6]): Content => ({
  text: text.toUpperCase(),
  fontSize: 7,
  bold: true,
  characterSpacing: 1.3,
  color: MUTED,
  margin,
});

/** A section: a hairline, its number and name, the heading in the serif. */
function section(number: number, name: string, title: string, options: { pageBreak?: boolean } = {}): Content {
  return {
    stack: [rule([0, 0, 0, 10]), eyebrow(`${String(number).padStart(2, "0")} · ${name}`), { text: title, style: "h2" }],
    margin: [0, options.pageBreak ? 0 : 30, 0, 12],
    pageBreak: options.pageBreak ? "before" : undefined,
    unbreakable: true,
  };
}

const subhead = (text: string): Content => ({ text, style: "subhead" });

const list = (items: string[]): Content => ({ ul: items, style: "list", markerColor: MUTED });

function checkbox(done: boolean): Column {
  const box = [{ type: "rect" as const, x: 0, y: 2.5, w: 7.5, h: 7.5, lineWidth: 0.7, lineColor: INK_2, r: 1 }];
  const tick = [
    { type: "line" as const, x1: 1.6, y1: 6.4, x2: 3.3, y2: 8.2, lineWidth: 1, lineColor: ACCENT },
    { type: "line" as const, x1: 3.3, y1: 8.2, x2: 6.3, y2: 4.2, lineWidth: 1, lineColor: ACCENT },
  ];
  return { canvas: done ? [...box, ...tick] : box, width: 16 };
}

/** Lines to write on, for the review. */
const writingLines = (count: number): Content => ({
  canvas: Array.from({ length: count }, (_, i) => ({
    type: "line" as const,
    x1: 0,
    y1: 22 * (i + 1),
    x2: WIDTH,
    y2: 22 * (i + 1),
    lineWidth: 0.5,
    lineColor: RULE,
  })),
  margin: [0, 0, 0, 14],
});

/** Three small squares, filled to the level: how well a stage of the decision was covered. */
function levelMark(level: keyof typeof FILLED): Column {
  return {
    width: 26,
    canvas: [0, 1, 2].map((i) => ({
      type: "rect" as const,
      x: i * 8,
      y: 2.5,
      w: 5.5,
      h: 5.5,
      r: 1,
      color: i < FILLED[level] ? (level === "weak" ? "#c4512f" : INK_2) : RULE,
    })),
  };
}

/** Text with a hairline down its left side: an answer in the dialogue. */
const aside = (content: Content): Content => ({
  table: { widths: ["*"], body: [[content]] },
  layout: {
    hLineWidth: () => 0,
    vLineWidth: (i: number) => (i === 0 ? 1 : 0),
    vLineColor: () => RULE,
    paddingLeft: () => 11,
    paddingRight: () => 0,
    paddingTop: () => 1,
    paddingBottom: () => 1,
  },
});

/** A shaded box: the first step. */
const panel = (stack: Content[]): Content => ({
  table: { widths: ["*"], body: [[{ stack, fillColor: FILL }]] },
  layout: {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: () => 16,
    paddingRight: () => 16,
    paddingTop: () => 14,
    paddingBottom: () => 14,
  },
  margin: [0, 14, 0, 4],
});

// ---- the record -------------------------------------------------------------------------------

export function recordDocument(science: Science, decision: Decision): TDocumentDefinitions {
  const { problem, dialogue } = decision;
  const conclusion = dialogue?.conclusion ?? null;
  const exchanges = dialogue?.exchanges ?? [];
  const notes = [...exchanges].reverse().find((e) => e.turn.notes)?.turn.notes ?? null;
  const model = dialogue?.meta.model ?? decision.meta.model;
  let n = 0;
  const next = () => ++n;

  const content: Content[] = [
    {
      columns: [
        { text: "RETICULATE", bold: true, fontSize: 7.5, characterSpacing: 2.2, color: INK },
        { text: `Decision record · ${day(decision.created_at)}`, alignment: "right", fontSize: 7.5, color: MUTED },
      ],
      margin: [0, 0, 0, 34],
    },
    eyebrow("The question you are deciding"),
    { text: sentence(problem.question), style: "title", fontSize: problem.question.length > 110 ? 21 : problem.question.length > 60 ? 25 : 30 },
  ];
  if (problem.context.trim()) content.push({ text: problem.context, style: "lead" });
  if (problem.options.length) {
    content.push(subhead("The options you started with"), { ol: problem.options.map(sentence), style: "list", markerColor: MUTED });
  }

  if (conclusion) content.push(...concluded(science, decision, conclusion, next()));
  else if (exchanges.length) {
    content.push(section(next(), "Where you stand", "The dialogue is still open"), {
      text: `${exchanges.length} ${exchanges.length === 1 ? "question" : "questions"} so far. ${notes?.leaning ? `Your leaning at the last question: ${notes.leaning}` : "No leaning yet."}`,
      style: "body",
    });
  }

  if (conclusion) content.push(...review(science, decision, conclusion, next()));
  if (exchanges.length) content.push(...transcript(exchanges, next()));
  if (notes) content.push(...worked(notes, next()));
  if (decision.watch_outs.length) content.push(...biases(science, decision, next()));
  if (decision.panel) content.push(...minds(decision, next()));

  const used = decision.usage;
  content.push(rule([0, 34, 0, 10]), {
    text: [
      "Made with Reticulate · reticulate.space · ",
      model ? modelName(model) : "Rated by you",
      used.calls ? ` · ${used.calls} Claude call${used.calls === 1 ? "" : "s"} · ${usd(used.cost_usd)}` : "",
      ` · science ${decision.meta.science_version}`,
    ].join(""),
    style: "fine",
  });
  content.push({
    text: "The questions, the reading of your answers and the other minds come from Claude, an AI model. The biases are documented in published research; how they apply here is Claude's reading. None of it is a prediction or advice from a person.",
    style: "fine",
    margin: [0, 4, 0, 0],
  });

  return {
    pageSize: "A4",
    pageMargins: [62, 66, 62, 62],
    info: { title: problem.question, creator: "Reticulate", producer: "Reticulate", subject: "Decision record" },
    header: (page) =>
      page === 1
        ? null
        : {
            columns: [
              { text: "Reticulate · Decision record", color: MUTED },
              { text: sentence(problem.question.length > 70 ? `${problem.question.slice(0, 68).trim()}…` : problem.question), alignment: "right", color: MUTED },
            ],
            fontSize: 7,
            margin: [62, 30, 62, 0],
          },
    footer: (page, pages) => ({
      text: `${page} / ${pages}`,
      alignment: "right",
      fontSize: 7,
      color: MUTED,
      margin: [62, 24, 62, 0],
    }),
    content,
    defaultStyle: { font: "Roboto", fontSize: 9.5, lineHeight: 1.38, color: INK_2 },
    styles: {
      title: { font: "Serif", color: INK, lineHeight: 1.05, margin: [0, 0, 0, 14] },
      lead: { fontSize: 10.5, color: INK_2, margin: [0, 0, 0, 6] },
      h2: { font: "Serif", fontSize: 21, color: INK, lineHeight: 1.1 },
      subhead: { fontSize: 8.5, bold: true, color: INK, margin: [0, 14, 0, 5] },
      body: { margin: [0, 0, 0, 6] },
      list: { margin: [0, 0, 0, 4] },
      statement: { font: "Serif", fontSize: 16.5, color: INK, lineHeight: 1.22, margin: [0, 0, 0, 8] },
      question: { font: "Serif", fontSize: 13, color: INK, lineHeight: 1.2, margin: [0, 0, 0, 5] },
      fine: { fontSize: 7.5, color: MUTED, lineHeight: 1.35 },
      note: { fontSize: 8.5, color: MUTED, italics: true, margin: [0, 4, 0, 0] },
    },
  };
}

function concluded(science: Science, decision: Decision, c: Conclusion, number: number): Content[] {
  const settled = new Set(decision.settled);
  const out: Content[] = [section(number, c.decided ? "Your decision" : "Where you stand", c.decided ? "What you decided" : "Where you landed"), { text: c.statement, style: "statement" }];
  if (!c.decided) out.push({ text: "You had not settled on an option yet. The open questions below are what stood between you and the decision.", style: "note" });
  if (c.reasons.length) out.push(subhead("Why"), list(c.reasons));
  if (c.tradeoffs.length) out.push(subhead("What you give up"), list(c.tradeoffs));

  if (c.first_step) {
    const box: Content[] = [eyebrow("First step", [0, 0, 0, 5]), { text: c.first_step, fontSize: 11, color: INK, lineHeight: 1.3 }];
    if (c.if_then) box.push({ text: c.if_then, italics: true, margin: [0, 6, 0, 0] });
    if (c.review) box.push({ text: `Review the decision ${when(c.review)}.`, fontSize: 8.5, color: MUTED, margin: [0, 8, 0, 0] });
    out.push(panel(box));
  }

  if (c.open_questions.length) {
    out.push(subhead("Before you act"));
    for (const q of c.open_questions) out.push({ columns: [checkbox(settled.has(q)), { text: q, width: "*" }], margin: [0, 0, 0, 4] });
    out.push({ text: `${c.open_questions.filter((q) => settled.has(q)).length} of ${c.open_questions.length} settled when this record was made.`, style: "note" });
  }

  if ((c.pattern_notes ?? []).length) {
    out.push(subhead("Your pattern in this decision"));
    for (const p of c.pattern_notes) {
      const dim = science.dimensions.find((d) => d.id === p.dimension);
      const value = decision.dialogue?.pattern?.[p.dimension];
      const pole = dim && value !== undefined ? (value < 5 ? dim.low_pole : dim.high_pole) : (dim?.name ?? p.dimension);
      out.push({ text: [{ text: `${pole}. `, bold: true, color: INK }, p.note], margin: [0, 0, 0, 4] });
    }
    out.push({ text: "Claude's reading of the dialogue, set against the pattern you rated yourself.", style: "note" });
  }
  return out;
}

/** A page of its own for the day you come back to the decision. */
function review(science: Science, decision: Decision, c: Conclusion, number: number): Content[] {
  const stages = new Map(science.socratic.stages.map((s) => [s.id, s.name]));
  const out: Content[] = [section(number, "For your review", "Coming back to it", { pageBreak: true })];
  out.push({
    text: [
      c.decided ? "Decided on " : "Dialogue concluded on ",
      { text: day(decision.dialogue?.concluded_at ?? decision.updated_at), color: INK },
      ...(c.review ? [". Come back to it ", { text: when(c.review), color: INK }] : []),
      ". Read your reasons before you look at how things turned out, so the outcome does not rewrite them.",
    ],
    style: "body",
  });

  if (c.revisit_if.length) out.push(subhead("Look at it again sooner if"), list(c.revisit_if));

  if (c.quality.length) {
    out.push(subhead("How well the decision was made"), {
      table: {
        widths: [92, 66, "*"],
        body: c.quality.map((q) => [
          { text: stages.get(q.stage) ?? q.stage, color: INK, bold: true, fontSize: 8.5 },
          { columns: [levelMark(q.level), { text: LEVEL[q.level], fontSize: 8, width: "*" }] },
          { text: q.note, fontSize: 8.5 },
        ]),
      },
      layout: {
        hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => RULE,
        paddingLeft: (i: number) => (i === 0 ? 0 : 6),
        paddingRight: () => 6,
        paddingTop: () => 6,
        paddingBottom: () => 6,
      },
    });
    out.push({
      text: "The six elements of decision quality; a decision is only as good as its weakest one (Spetzler, Winter & Meyer, 2016). This is Claude's reading of the dialogue, not a measurement.",
      style: "note",
    });
  }

  out.push(subhead("At the review"), { text: "Answer these before you reopen the dialogue.", style: "note", margin: [0, -2, 0, 8] });
  for (const q of [
    "What has happened since you decided?",
    "Which of the open questions have you settled, and how?",
    "Knowing what you know now, would you decide the same way? Why?",
    "What will you do differently in the next decision like this one?",
  ]) {
    out.push({ stack: [{ text: q, color: INK, margin: [0, 4, 0, 0] }, writingLines(3)], unbreakable: true });
  }
  return out;
}

function transcript(exchanges: Exchange[], number: number): Content[] {
  const answered = exchanges.filter((e) => e.answer !== null || e.skipped).length;
  const first = exchanges[0].asked_at;
  const last = exchanges[exchanges.length - 1].answered_at ?? exchanges[exchanges.length - 1].asked_at;
  const out: Content[] = [
    section(number, "The dialogue", "Every question, every answer", { pageBreak: true }),
    {
      text: `${answered} ${answered === 1 ? "question" : "questions"} answered · ${day(first)}, ${time(first)}–${time(last)}`,
      style: "fine",
      margin: [0, -4, 0, 12],
    },
  ];
  exchanges.forEach((e, i) => {
    const answer: Content = e.skipped
      ? { text: "Skipped", italics: true, color: MUTED }
      : e.answer === null
        ? { text: "Not answered yet", italics: true, color: MUTED }
        : { text: e.answer, color: INK_2 };
    const stack: Content[] = [{ text: `Q${i + 1}`, fontSize: 7, bold: true, characterSpacing: 1, color: MUTED, margin: [0, 0, 0, 3] }];
    if (e.turn.reflection.trim()) stack.push({ text: e.turn.reflection, italics: true, color: MUTED, fontSize: 9, margin: [0, 0, 0, 4] });
    stack.push({ text: e.turn.question, style: "question" }, aside(answer));
    const long = (e.answer?.length ?? 0) + e.turn.question.length + e.turn.reflection.length > 1400;
    out.push({ stack, margin: [0, 0, 0, 16], unbreakable: !long });
  });
  return out;
}

/** The working notes the dialogue kept: what you want, what you know, what you assume. */
function worked(notes: Notes, number: number): Content[] {
  const out: Content[] = [];
  if (notes.goals.length) out.push(subhead("What you want"), list(notes.goals));
  if (notes.facts.length) out.push(subhead("What you know"), list(notes.facts));
  if (notes.unknowns.length) out.push(subhead("What you do not know yet"), list(notes.unknowns));
  if (notes.assumptions.length) {
    out.push(subhead("What you assume"));
    for (const a of notes.assumptions) {
      out.push({
        text: [{ text: `${ASSUMPTION[a.status]}  `, bold: true, fontSize: 7.5, color: a.status === "shaky" ? "#c4512f" : a.status === "holds" ? INK : MUTED }, a.status === "dropped" ? { text: a.text, decoration: "lineThrough" } : a.text],
        margin: [0, 0, 0, 4],
      });
    }
  }
  if (!out.length) return [];
  return [section(number, "Your notes", "What you worked out"), ...out];
}

function biases(science: Science, decision: Decision, number: number): Content[] {
  const mechanisms = new Map(science.mechanisms.map((m) => [m.id, m]));
  const out: Content[] = [
    section(number, "Biases at play", "What may pull on this decision"),
    { text: "Documented decision biases that match this decision, each with a check. How each could apply here is Claude's reading.", style: "note", margin: [0, -4, 0, 10] },
  ];
  for (const w of decision.watch_outs) {
    const m = mechanisms.get(w.mechanism_id);
    out.push({
      stack: [
        { text: m?.name ?? w.mechanism_id.replace(/_/g, " "), bold: true, color: INK, fontSize: 10 },
        { text: w.here, margin: [0, 2, 0, 3] },
        { text: [{ text: "Check  ", bold: true, fontSize: 7.5, color: ACCENT }, w.check] },
      ],
      margin: [0, 0, 0, 12],
      unbreakable: true,
    });
  }
  return out;
}

function minds(decision: Decision, number: number): Content[] {
  const panel = decision.panel!;
  const out: Content[] = [
    section(number, "Other minds", "What the minds at the table said"),
    { text: "Simulated from the attitudes of each mind, not real people, and not a prediction.", style: "note", margin: [0, -4, 0, 10] },
  ];
  for (const profile of panel.profiles) {
    const view = panel.perspectives[profile.id]?.[0];
    if (!view) continue;
    const stack: Content[] = [
      { text: [{ text: displayName(profile), bold: true, color: INK, fontSize: 10 }, profile.person?.name ? { text: `  ${profile.name}`, color: MUTED, fontSize: 8.5 } : ""] },
      { text: view.recommendation, color: INK, margin: [0, 2, 0, 2] },
      { text: view.summary },
    ];
    if (view.would_change_mind.length) stack.push({ text: [{ text: "Would change its mind if  ", bold: true, fontSize: 7.5, color: MUTED }, view.would_change_mind.slice(0, 2).join("; ")], margin: [0, 3, 0, 0] });
    out.push({ stack, margin: [0, 0, 0, 12], unbreakable: true });
  }
  const s = panel.synthesis;
  if (s) {
    if (s.overview) out.push(subhead("Taken together"), { text: s.overview, style: "body" });
    if (s.shared_ground.length) out.push(subhead("Where they agree"), list(s.shared_ground));
    if (s.blind_spots.length) out.push(subhead("What none of them weighed"), list(s.blind_spots));
  }
  return out;
}
