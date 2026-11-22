import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { leanings } from "../../pattern";
import type { DecisionSummary, PersonalPattern, Problem, Rating, Science } from "../../types";
import { Kbd, MOD, Mark } from "../Mark";
import { EXAMPLES, clock } from "./model";
import { SelfCheck } from "./SelfCheck";

interface Props {
  science: Science;
  configured: boolean;
  problem: Problem;
  onProblem: (problem: Problem) => void;
  busy: { label: string; since: number } | null;
  recent: DecisionSummary[];
  pattern: PersonalPattern | null;
  onPatternSetup: () => void;
  onOpen: (id: string) => void;
  onStart: () => void;
  onSelfRate: (anatomy: Rating[]) => void;
  onConnect: () => void;
}

export interface ComposerHandle {
  focus: () => void;
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

export const statusLine = (d: DecisionSummary) =>
  d.decided ? `Decided: ${d.decided}` : d.status === "in dialogue" ? `In dialogue · ${d.questions} question${d.questions === 1 ? "" : "s"}` : d.verdict ?? d.status;

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** The command window: type the decision, add options or details, start. */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { science, configured, problem, onProblem, busy, recent, pattern, onPatternSetup, onOpen, onStart, onSelfRate, onConnect },
  handle,
) {
  const [option, setOption] = useState("");
  const [details, setDetails] = useState(!!problem.context);
  const [selfCheck, setSelfCheck] = useState(false);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const question = useRef<HTMLTextAreaElement>(null);
  const elapsed = useElapsed(busy?.since);
  const typed = problem.question.trim().length > 0;
  const ready = problem.question.trim().length >= 10;
  const rated = Object.values(levels).filter((l) => l > 0).length;

  useImperativeHandle(handle, () => ({ focus: () => question.current?.focus() }), []);

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
    <div className={`rc-window composer ${busy ? "busy" : ""}`}>
      <div className="rc-search">
        <textarea
          ref={question}
          rows={1}
          value={problem.question}
          placeholder="What are you deciding?"
          aria-label="Your decision"
          disabled={!!busy}
          onChange={(e) => onProblem({ ...problem, question: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {typed && !busy && (
          <button className="rc-clear" aria-label="Clear" onClick={() => { onProblem({ question: "", context: "", options: [] }); setDetails(false); setSelfCheck(false); question.current?.focus(); }}>
            ×
          </button>
        )}
      </div>

      {typed ? (
        <div className="rc-fields">
          <div className="rc-field">
            <span className="rc-label">Options</span>
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
                  placeholder={problem.options.length ? "Add another" : "Optional · press Enter after each"}
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
          <div className="rc-field top">
            <span className="rc-label">Details</span>
            {details ? (
              <textarea
                className="rc-details"
                rows={3}
                value={problem.context}
                disabled={!!busy}
                placeholder="Numbers, deadlines, constraints, who else is affected"
                onChange={(e) => onProblem({ ...problem, context: e.target.value })}
              />
            ) : (
              <button className="rc-add" onClick={() => setDetails(true)} disabled={!!busy}>
                Optional · add numbers, deadlines, who else is affected
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rc-list" role="list">
          {recent.length > 0 && (
            <>
              <div className="rc-section">Recent decisions</div>
              {recent.slice(0, 3).map((d) => (
                <button key={d.id} className="rc-item" role="listitem" onClick={() => onOpen(d.id)}>
                  <span className={`rc-icon status ${d.decided ? "decided" : d.status === "in dialogue" ? "open" : ""}`} />
                  <span className="rc-title">{d.title}</span>
                  <span className="rc-meta">{statusLine(d)}</span>
                  <span className="rc-tag">{shortDate(d.updated_at)}</span>
                </button>
              ))}
            </>
          )}
          <div className="rc-section">Examples</div>
          {EXAMPLES.slice(0, recent.length ? 2 : 4).map((e) => (
            <button key={e.label} className="rc-item" role="listitem" onClick={() => { onProblem(e.problem); question.current?.focus(); }}>
              <span className="rc-icon example">?</span>
              <span className="rc-title">{e.label}</span>
              <span className="rc-meta">{e.problem.question}</span>
            </button>
          ))}
        </div>
      )}

      {selfCheck && !busy && typed && (
        <div className="selfcheck-panel">
          <header>
            <h3>Rate it yourself</h3>
            <p>Answer for your decision as you see it. You get the documented biases that match, with no AI involved.</p>
          </header>
          <SelfCheck science={science} levels={levels} onChange={(id, l) => setLevels({ ...levels, [id]: l })} />
          <div className="selfcheck-foot">
            <span className="muted">{rated ? `${rated} of ${science.features.length} answered` : "Answer at least one question with more than “No”."}</span>
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

      <div className="rc-actionbar">
        <div className="rc-actionbar-left">
          {busy ? (
            <span className="rc-busy" role="status">
              <span className="spinner tiny" /> {busy.label} <span className="mono">{clock(elapsed)}</span>
            </span>
          ) : (
            <>
              <Mark size={18} />
              {typed && !ready ? (
                <span>A little more: one full sentence</span>
              ) : !configured ? (
                <span>Uses Claude with your own API key</span>
              ) : pattern ? (
                <span className="tuned">
                  <span className="dot on" />
                  Tuned to your pattern
                  {(() => {
                    const n = leanings(science, Object.fromEntries(Object.entries(pattern.dimensions).map(([k, v]) => [k, v.value]))).length;
                    return n ? ` · ${n} leaning${n === 1 ? "" : "s"}` : "";
                  })()}
                </span>
              ) : (
                <button className="rc-link" onClick={onPatternSetup}>
                  Add your pattern for a dialogue tuned to you →
                </button>
              )}
            </>
          )}
        </div>
        {!busy && (
          <div className="rc-actionbar-right">
            <button className="rc-action" disabled={!ready} onClick={() => setSelfCheck(!selfCheck)}>
              {selfCheck ? "Close self-check" : "Rate it myself"}
            </button>
            <span className="rc-divider" />
            <button className="rc-action primary" disabled={!ready} onClick={submit}>
              {configured ? "Start dialogue" : "Connect Claude"}
              <Kbd>{MOD}</Kbd>
              <Kbd>↵</Kbd>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
