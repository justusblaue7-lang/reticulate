import { forwardRef, type ReactNode } from "react";
import { credit, type ArtSlug } from "../art";
import type { Atlas } from "../atlas/load";
import type { BrainRenderer } from "../brain/renderer";
import { Art } from "../components/Art";
import { Composer, type ComposerHandle } from "../components/decision/Composer";
import { Kbd, MOD } from "../components/Mark";
import { PatternCheck } from "../components/PatternCheck";
import type { Avatar, DecisionSummary, PersonalPattern, Problem, Rating, Science } from "../types";
import { Passage } from "./Passage";
import { Patterns } from "./Patterns";

interface Props {
  atlas: Atlas;
  science: Science;
  renderer: BrainRenderer;
  avatars: Avatar[];
  onAvatars: (avatars: Avatar[]) => void;
  pattern: PersonalPattern | null;
  onPattern: (pattern: PersonalPattern | null) => void;
  configured: boolean;
  draft: Problem;
  onDraft: (p: Problem) => void;
  busy: { label: string; since: number } | null;
  archive: DecisionSummary[];
  onOpen: (id: string) => void;
  onStart: () => void;
  onSelfRate: (anatomy: Rating[]) => void;
  onConnect: () => void;
  onFocus: () => void;
  onSection: (id: string) => void;
}

/**
 * A work set into the page: it bleeds off one edge and dissolves into the page on the others,
 * and the words stand on the dark side. No frame, no border.
 */
function Band({ slug, side = "right", className = "", children }: { slug: ArtSlug; side?: "left" | "right"; className?: string; children: ReactNode }) {
  return (
    <div className={`band ${side} ${className}`}>
      <Art slug={slug} className="band-art" reveal sizes="(max-width: 980px) 100vw, 70vw" />
      <div className="container band-text">{children}</div>
      <p className="band-credit container">{credit(slug)}</p>
    </div>
  );
}

export const Home = forwardRef<ComposerHandle, Props>(function Home(props, composer) {
  const { science } = props;
  const tested = science.mechanisms.filter((m) => m.countermove.basis === "tested");
  const shown = [...tested, ...science.mechanisms.filter((m) => m.countermove.basis !== "tested")].slice(0, 4);

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <h1 className="hero-title">Think it through.</h1>
        <p className="hero-sub">A Socratic dialogue for critical decisions, made by you, not a system based on the most probable choice.</p>
        <div className="hero-window">
          <Composer
            ref={composer}
            science={science}
            configured={props.configured}
            problem={props.draft}
            onProblem={props.onDraft}
            busy={props.busy}
            recent={props.archive}
            pattern={props.pattern}
            onPatternSetup={() => props.onSection("you")}
            onOpen={props.onOpen}
            onStart={props.onStart}
            onSelfRate={props.onSelfRate}
            onConnect={props.onConnect}
          />
        </div>
      </section>

      <section className="block container" id="how">
        <header className="block-head rise">
          <h2>Not advice. Better questions.</h2>
          <p>Reticulate does not choose for you. It accompanies you in making hard decisions by yourself.</p>
        </header>
        <div className="bento three rise">
          <article className="card bento-item">
            <div className="bento-visual">
              <div className="mini-search">
                <span>Should I take the offer?</span>
                <span className="keys">
                  <Kbd>{MOD}</Kbd>
                  <Kbd>↵</Kbd>
                </span>
              </div>
            </div>
            <h3>Ask.</h3>
            <p>One sentence is enough. Options and details are optional.</p>
          </article>
          <article className="card bento-item">
            <div className="bento-visual">
              <div className="mini-turn">
                <p className="mini-reflect">You said security matters most, yet you lean toward the bolder offer.</p>
                <p className="mini-q">What makes this case different for you?</p>
                <span className="mini-tag">For your leaning · Cautious</span>
              </div>
            </div>
            <h3>Question.</h3>
            <p>One question at a time, aimed at what your way of deciding tends to leave out.</p>
          </article>
          <article className="card bento-item">
            <div className="bento-visual">
              <ul className="mini-check">
                <li className="done">What matters most</li>
                <li className="done">What you give up</li>
                <li>
                  <b>If</b> it's Monday, <b>then</b> I call them
                </li>
              </ul>
            </div>
            <h3>Decide.</h3>
            <p>Your choice in your own words, the trade-off, and an if–then first step.</p>
          </article>
        </div>
      </section>

      <Passage science={science} />

      <section className="block container biases" id="biases">
        <div className="split">
          <header className="block-head left rise">
            <h2>Know what pulls on you.</h2>
            <p>
              {science.mechanisms.length} documented biases, each with a countermove, {tested.length} of them tested in intervention studies.
              When one fits your decision, or your pattern makes it likelier, the dialogue asks its countermove as a question. It never
              diagnoses you.
            </p>
          </header>
          <div className="biases-stage">
            <Art slug="battle" className="backdrop" decorative sizes="(max-width: 980px) 100vw, 60vw" />
            <div className="rc-window static rise">
              <div className="rc-search">
                <span className="placeholder">Biases and countermoves</span>
              </div>
              <div className="rc-list">
                {shown.map((m, i) => (
                  <div key={m.id} className={`rc-item tall ${i === 0 ? "on" : ""}`}>
                    <span className="rc-icon bias" />
                    <span className="rc-stack">
                      <span className="rc-title">{m.name}</span>
                      <span className="rc-sub">{m.countermove.text}</span>
                    </span>
                    <span className={`rc-tag ${m.countermove.basis === "tested" ? "good" : ""}`}>{m.countermove.basis === "tested" ? "Tested" : "Derived"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="you" id="you">
        <Band slug="statue-night" side="left" className="you-band">
          <span className="block-kicker">Your pattern</span>
          <h2 className="maxim">Know thyself.</h2>
          <p className="byline">The Delphic inscription Socrates made his task · Plato, Phaedrus 229e</p>
          <p className="band-lede">
            Everyone leans somewhere: toward caution or risk, the familiar or the new, the gut or the spreadsheet. Rate sixteen statements, and
            the dialogue aims its questions at what your leanings tend to leave out. It never tells you who you are; it asks.
          </p>
        </Band>
        <div className="container you-check rise">
          <PatternCheck science={science} pattern={props.pattern} onPattern={props.onPattern} />
        </div>
      </section>

      <section className="block container" id="patterns">
        <header className="block-head rise">
          <h2>Minds that decide differently.</h2>
          <p>
            Simulated decision-makers, each set by {science.dimensions.length} tendencies from decision research. Ask them about your decision;
            what they weigh differently comes back to you as a question.
          </p>
        </header>
        <Patterns atlas={props.atlas} science={science} renderer={props.renderer} avatars={props.avatars} onAvatars={props.onAvatars} />
      </section>

      <section className="closing" aria-label="Socrates">
        <Band slug="death-of-socrates" className="quote-band">
          <blockquote>
            <p className="maxim">“The unexamined life is not worth living.”</p>
            <footer className="byline">Socrates, at his trial · Plato, Apology 38a</footer>
          </blockquote>
        </Band>
      </section>

      <section className="final">
        <div className="container final-inner">
          <h2>Decide on purpose.</h2>
          <p>Start with one sentence.</p>
          <button className="button primary large" onClick={props.onFocus}>
            Start a decision
          </button>
        </div>
      </section>

      <section className="colophon container" aria-label="Art credits">
        <details>
          <summary>The art in Reticulate</summary>
          <ul>
            {(
              [
                "socrates-athens",
                "facade",
                "thinker",
                "trevi",
                "philosopher",
                "bronze",
                "ceiling",
                "battle",
                "statue-night",
                "death-of-socrates",
                "marble-head",
              ] as const
            ).map((slug) => (
              <li key={slug}>
                <Art slug={slug} decorative sizes="64px" />
                <span>{credit(slug)}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </main>
  );
});
