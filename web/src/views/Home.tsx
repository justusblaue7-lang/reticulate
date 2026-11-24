import { forwardRef, type ReactNode } from "react";
import { credit, type ArtSlug } from "../art";
import { Art } from "../components/Art";
import { Composer, type ComposerHandle } from "../components/decision/Composer";
import { Kbd, MOD } from "../components/Mark";
import { PatternCheck } from "../components/PatternCheck";
import { DESIGN_LABEL } from "../format";
import type { Avatar, DecisionSummary, Mechanism, PersonalPattern, Problem, Rating, Science } from "../types";
import { Passage } from "./Passage";
import { Patterns } from "./Patterns";

interface Props {
  science: Science;
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
  onAtlas: () => void;
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
  const featured = ["loss_aversion", "present_bias", "status_quo_bias", "confirmation_bias"];
  const shown = featured.map((id) => science.mechanisms.find((m) => m.id === id)).filter((m): m is Mechanism => !!m);

  return (
    <main className="home" id="content">
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
                <span className="mini-tag">Your answers · Cautious</span>
              </div>
            </div>
            <h3>Question.</h3>
            <p>One question at a time, through the parts of a decision aid: options, outcomes and their chances, what matters to you.</p>
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

      <Passage />

      <section className="block container biases" id="biases">
        <div className="split">
          <header className="block-head left rise">
            <h2>Know what pulls on you.</h2>
            <p>
              {science.mechanisms.length} biases, each confirmed by a meta-analysis, a replication across many labs or large field data. Where
              trials have proven a remedy, the dialogue uses it; where none has been proven, it only asks. It never diagnoses you.
            </p>
          </header>
          <div className="biases-stage">
            <Art slug="battle" className="backdrop" decorative sizes="(max-width: 980px) 100vw, 60vw" />
            <div className="rc-window static rise">
              <div className="rc-search">
                <span className="placeholder">Documented biases</span>
              </div>
              <div className="rc-list">
                {shown.map((m, i) => (
                  <div key={m.id} className={`rc-item tall ${i === 0 ? "on" : ""}`}>
                    <span className="rc-icon bias" />
                    <span className="rc-stack">
                      <span className="rc-title">{m.name}</span>
                      <span className="rc-sub">{m.summary}</span>
                    </span>
                    <span className="rc-tag good">{DESIGN_LABEL[m.evidence[0].design]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="you" id="you">
        <Band slug="death-of-socrates" side="left" className="you-band">
          <span className="block-kicker">Your pattern</span>
          <h2 className="maxim">“To examine myself and others.”</h2>
          <p className="byline">Socrates on his task · Plato, Apology 28e</p>
          <p className="band-lede">From the Global Preferences Survey (Falk et al., 2018).</p>
        </Band>
        <div className="container you-check rise">
          <PatternCheck science={science} pattern={props.pattern} onPattern={props.onPattern} />
        </div>
      </section>

      <section className="block container" id="patterns">
        <header className="block-head rise">
          <h2>Minds that decide differently.</h2>
          <p>
            Sixteen people from everyday life, each with their answers to the same six questions, a personality, values,
            goals and constraints. They sit beside your dialogue: pick who should weigh in, and what they weigh differently comes back to you as a
            question.
          </p>
        </header>
        <Patterns science={science} avatars={props.avatars} onAvatars={props.onAvatars} onAtlas={props.onAtlas} />
      </section>

      <section className="closing" aria-label="Socrates">
        <Band slug="thinker" className="quote-band">
          <blockquote>
            <p className="maxim">“I am the kind of man who listens to nothing within me but the argument that on reflection seems best to me.”</p>
            <footer className="byline">Socrates, deciding whether to flee his prison · Plato, Crito 46b</footer>
          </blockquote>
          <button className="button primary large closing-cta" onClick={props.onFocus}>
            Start a decision
          </button>
        </Band>
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
