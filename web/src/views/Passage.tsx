import { useEffect, useRef, useState } from "react";
import { STAGE_ART, credit, type ArtSlug } from "../art";
import { Art } from "../components/Art";
import type { Science } from "../types";

// The questions are Reticulate's, one per element of decision quality; only the opening line
// is Socrates' (a paraphrase), and it is attributed as such.
const QUESTION: Record<string, string> = {
  frame: "What exactly are you deciding?",
  goals: "What would make it turn out well — for you?",
  options: "What else could you do?",
  evidence: "How do you know?",
  tradeoffs: "What are you willing to give up?",
  commitment: "What will you do first?",
};

const NUMERAL = ["I", "II", "III", "IV", "V", "VI"];

interface Chapter {
  key: string;
  art: ArtSlug;
  numeral?: string;
  label: string;
  saying: string;
  gloss: string;
  source?: string;
}

/**
 * A walk through the Socratic method. The works stand on one stage that stays while the
 * questions pass over it; each dissolves into the next, and into the page at every edge.
 */
export function Passage({ science }: { science: Science }) {
  const chapters: Chapter[] = [
    {
      key: "aporia",
      art: "socrates-athens",
      label: "Where Socrates began",
      saying: "I know that I don’t know.",
      gloss: "A good decision starts with an honest account of what you do not know yet. So Reticulate starts with questions, not answers.",
      source: "After Plato, Apology 21d",
    },
    ...science.socratic.stages.map((s, i) => ({
      key: s.id,
      art: STAGE_ART[s.id] ?? "facade",
      numeral: NUMERAL[i],
      label: s.name,
      saying: QUESTION[s.id] ?? s.aim,
      gloss: s.aim,
    })),
  ];
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    steps.current.forEach((el) => el && seen.observe(el));
    return () => seen.disconnect();
  }, []);

  return (
    <section className="passage" id="method" aria-label="The Socratic method">
      <div className="passage-stage" aria-hidden="true">
        {chapters.map((c, i) => (
          <Art key={c.key} slug={c.art} className={`band-art ${i === active ? "on" : ""}`} decorative eager={i < 2} sizes="(max-width: 980px) 100vw, 64vw" />
        ))}
        <div className="container passage-meta">
          <ol className="passage-rail">
            {chapters.map((c, i) => (
              <li key={c.key} className={i === active ? "on" : i < active ? "past" : ""} />
            ))}
          </ol>
          <p className="band-credit">{credit(chapters[active].art)}</p>
        </div>
      </div>
      <ol className="container passage-steps">
        {chapters.map((c, i) => (
          <li key={c.key} ref={(el) => (steps.current[i] = el)} data-i={i} className={`${i === active ? "on" : ""} ${i === 0 ? "first" : ""}`}>
            <span className="passage-label">
              {c.numeral && <span className="numeral">{c.numeral}</span>}
              {c.label}
            </span>
            <p className="saying">{c.saying}</p>
            <p className="gloss">{c.gloss}</p>
            {c.source && <p className="byline">{c.source}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
