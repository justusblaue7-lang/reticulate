import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usd } from "../../format";
import type { Problem, Rating, Science } from "../../types";
import { ANALYSIS_USD, EXAMPLES, TURN_USD, clock } from "./model";
import { SelfCheck } from "./SelfCheck";

interface Props {
  science: Science;
  configured: boolean;
  problem: Problem;
  onProblem: (problem: Problem) => void;
  busy: { label: string; since: number } | null;
  onStart: () => void;
  onSelfRate: (anatomy: Rating[]) => void;
  onConnect: () => void;
}

const MAX_OPTIONS = 6;

function useElapsed(since: number | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? (now - since) / 1000 : 0;
}

/** The decision bar: the question, its options and details, and the way in. */
export function Composer({ science, configured, problem, onProblem, busy, onStart, onSelfRate, onConnect }: Props) {
  const [option, setOption] = useState("");
  const [details, setDetails] = useState(!!problem.context);
  const [selfCheck, setSelfCheck] = useState(false);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const question = useRef<HTMLTextAreaElement>(null);
  const elapsed = useElapsed(busy?.since);
  const ready = problem.question.trim().length >= 10;
  const rated = Object.values(levels).filter((l) => l > 0).length;

  useLayoutEffect(() => {
    const el = question.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [problem.question]);

  useEffect(() => {
    if (problem.context) setDetails(true);
  }, [problem.context]);

  const addOption = () => {
    const text = option.trim();
    if (!text || problem.options.length >= MAX_OPTIONS || problem.options.includes(text)) return;
    onProblem({ ...problem, options: [...problem.options, text] });
    setOption("");
  };

  const submit = () => {
    if (!ready || busy) return;
    if (!configured) onConnect();
    else onStart();
  };

  return (
    <div className={`composer ${busy ? "busy" : ""}`}>
      <div className="bar">
        <textarea
          ref={question}
          className="bar-question"
          rows={2}
          value={problem.question}
          placeholder="Should I …"
          aria-label="Your decision"
          disabled={!!busy}
          onChange={(e) => onProblem({ ...problem, question: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />

        <div className="bar-row">
          <span className="bar-label">Options</span>
          <div className="chips">
            {problem.options.map((o, i) => (
              <span key={o} className="chip">
                <span className="chip-letter">{String.fromCharCode(65 + i)}</span>
                {o}
                <button aria-label={`Remove ${o}`} disabled={!!busy} onClick={() => onProblem({ ...problem, options: problem.options.filter((x) => x !== o) })}>
                  ×
                </button>
              </span>
            ))}
            {problem.options.length < MAX_OPTIONS && (
              <input
                className="chip-input"
                value={option}
                disabled={!!busy}
                placeholder={problem.options.length ? "Add another" : "Optional: name the options, press Enter after each"}
                onChange={(e) => setOption(e.target.value)}
                onBlur={addOption}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOption();
                  } else if (e.key === "Backspace" && !option && problem.options.length) {
                    onProblem({ ...problem, options: problem.options.slice(0, -1) });
                  }
                }}
              />
            )}
          </div>
        </div>

        {details ? (
          <div className="bar-row top">
            <span className="bar-label">Details</span>
            <textarea
              className="bar-details"
              rows={3}
              value={problem.context}
              disabled={!!busy}
              placeholder="Numbers, deadlines, constraints, who else is affected, what matters most to you"
              onChange={(e) => onProblem({ ...problem, context: e.target.value })}
            />
          </div>
        ) : (
          <div className="bar-row">
            <button className="add-details" onClick={() => setDetails(true)} disabled={!!busy}>
              + Add details: numbers, deadlines, who else is affected
            </button>
          </div>
        )}

        <div className="bar-foot">
          {busy ? (
            <div className="thinking" role="status">
              <span className="spinner" />
              <div>
                <strong>{busy.label}</strong> <span className="mono muted">{clock(elapsed)}</span>
                <p>Reticulate is preparing the first question.</p>
              </div>
            </div>
          ) : (
            <>
              <span className="bar-cost">
                {configured
                  ? `About ${usd(TURN_USD)} a question, plus ${usd(ANALYSIS_USD)} for the bias analysis · ⌘↵`
                  : "The dialogue uses Claude with your own API key"}
              </span>
              <button className="text-button" disabled={!ready} onClick={() => setSelfCheck(!selfCheck)}>
                {selfCheck ? "Close the questions" : "Rate it yourself, without AI"}
              </button>
              <button className="button primary large" disabled={!ready} onClick={submit}>
                {configured ? "Start the dialogue" : "Connect Claude to start"}
              </button>
            </>
          )}
        </div>
      </div>

      {selfCheck && !busy && (
        <div className="selfcheck-panel">
          <header>
            <h3>Rate it yourself</h3>
            <p>
              Answer for your decision as you see it. Reticulate shows the biases and brain research that match your answers; no AI is
              involved. You can start the dialogue later.
            </p>
          </header>
          <SelfCheck science={science} levels={levels} onChange={(id, l) => setLevels({ ...levels, [id]: l })} />
          <div className="selfcheck-foot">
            <span className="muted">{rated ? `${rated} of ${science.features.length} answered with more than “No”` : "Answer at least one question with more than “No”."}</span>
            <button
              className="button primary"
              disabled={!ready || rated === 0}
              onClick={() => onSelfRate(science.features.map((f) => ({ feature_id: f.id, level: levels[f.id] ?? 0, reason: "", source: "user" })))}
            >
              Show what's at play
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Examples({ onPick }: { onPick: (problem: Problem) => void }) {
  return (
    <div className="examples">
      <span>Try an example:</span>
      {EXAMPLES.map((e) => (
        <button key={e.label} onClick={() => onPick(e.problem)}>
          {e.label}
        </button>
      ))}
    </div>
  );
}
