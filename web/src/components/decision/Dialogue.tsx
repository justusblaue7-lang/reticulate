import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { roughly, usd } from "../../format";
import type { Decision, Exchange, Science } from "../../types";
import { leaningOf } from "../../pattern";
import { Cites } from "../Cites";
import { clock, TURN_USD } from "./model";

export type DialogueBusy = { kind: "reply" | "conclude"; since: number; answer: string | null } | null;

interface Props {
  science: Science;
  decision: Decision;
  busy: DialogueBusy;
  error: string | null;
  configured: boolean;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
  onConclude: (answer: string | null) => void;
  onRevise: (index: number, answer: string) => void;
  onRetry: () => void;
  onConnect: () => void;
}

function useElapsed(since: number | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? (now - since) / 1000 : 0;
}

/** Where the dialogue stands among the six elements of decision quality. */
export function StageRail({ science, decision }: { science: Science; decision: Decision }) {
  const dialogue = decision.dialogue;
  const stages = science.socratic.stages;
  const last = dialogue?.exchanges.at(-1)?.turn.stage;
  const current = dialogue?.conclusion ? stages.length : Math.max(0, stages.findIndex((s) => s.id === last));
  const visited = new Set(dialogue?.exchanges.map((e) => e.turn.stage));
  return (
    <ol className="stage-rail" aria-label="Decision quality">
      {stages.map((s, i) => (
        <li key={s.id} className={i < current || (visited.has(s.id) && i !== current) ? "done" : i === current ? "now" : ""} title={s.aim}>
          <span className="dot" aria-hidden />
          {s.name}
        </li>
      ))}
    </ol>
  );
}

/** Why the guide asked this: the Socratic move, its basis, and the bias it counters. */
type Values = Record<string, number> | null;

/** The person's leaning a question counterweighs: the pole they lean to, and what it leaves out. */
function aimedAt(science: Science, pattern: Values, dimension: string) {
  const dim = science.dimensions.find((d) => d.id === dimension);
  if (!dim || !pattern || pattern[dimension] === undefined) return null;
  const pole = pattern[dimension] < 5 ? "low" : "high";
  return { dim, pole: pole === "low" ? dim.low_pole : dim.high_pole, lean: leaningOf(science, dimension, pole) };
}

function Why({ science, exchange, pattern }: { science: Science; exchange: Exchange; pattern: Values }) {
  const turn = exchange.turn;
  const aimed = turn.pattern && turn.pattern !== "none" ? aimedAt(science, pattern, turn.pattern) : null;
  const move = science.socratic.moves.find((m) => m.id === turn.move);
  const mechanism = science.mechanisms.find((m) => m.id === turn.mechanism_id);
  return (
    <div className="why-panel">
      <p>{turn.why}</p>
      {move && (
        <p className="why-move">
          <span className="kicker">The move · {move.name}</span>
          {move.basis === "tested" ? move.finding : "A classic Socratic question; it follows from the method rather than from an intervention study."}{" "}
          <span className={`basis ${move.basis}`}>{move.basis === "tested" ? "Tested" : "Derived"}</span>
          <Cites refs={move.refs} science={science} />
        </p>
      )}
      {aimed && (
        <p className="why-move why-pattern">
          <span className="kicker">For your pattern · {aimed.pole}</span>
          You described yourself as leaning {aimed.pole.toLowerCase()} ({aimed.dim.name.toLowerCase()}). {aimed.lean?.watch} This question brings
          in the other side; it does not say your leaning is wrong. <span className="basis derived">Derived</span>
        </p>
      )}
      {mechanism && (
        <p className="why-move">
          <span className="kicker">Against · {mechanism.name}</span>
          {mechanism.summary} The countermove: {mechanism.countermove.text}{" "}
          <span className={`basis ${mechanism.countermove.basis}`}>{mechanism.countermove.basis === "tested" ? "Tested" : "Derived"}</span>
          <Cites refs={mechanism.countermove.refs.length ? mechanism.countermove.refs : mechanism.refs} science={science} />
        </p>
      )}
    </div>
  );
}

function Turn({ science, exchange, index, latest, pattern }: { science: Science; exchange: Exchange; index: number; latest: boolean; pattern: Values }) {
  const [open, setOpen] = useState(false);
  const turn = exchange.turn;
  const aimed = turn.pattern && turn.pattern !== "none" ? aimedAt(science, pattern, turn.pattern) : null;
  const stage = science.socratic.stages.find((s) => s.id === turn.stage);
  const mechanism = science.mechanisms.find((m) => m.id === turn.mechanism_id);
  return (
    <li className={`turn ${latest ? "latest" : ""}`}>
      {turn.reflection && <p className="reflection">{turn.reflection}</p>}
      <p className="question">
        <span className="qnum" aria-hidden>
          {index + 1}
        </span>
        {turn.question}
      </p>
      <div className="turn-meta">
        <span>{stage?.name ?? turn.stage}</span>
        {aimed && <span className="for-pattern" title={aimed.lean?.watch}>for your leaning · {aimed.pole.toLowerCase()}</span>}
        {mechanism && <span className="against">against {mechanism.name.toLowerCase()}</span>}
        <button className="why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Why this question?"}
        </button>
      </div>
      {open && <Why science={science} exchange={exchange} pattern={pattern} />}
    </li>
  );
}

function Answer({ exchange, onChange, disabled }: { exchange: Exchange; onChange: () => void; disabled: boolean }) {
  return (
    <li className={`answer ${exchange.skipped ? "skipped" : ""}`}>
      {exchange.context?.startsWith("<panel>") && <span className="sent-with">The panel's reasons went along with this answer.</span>}
      <p>{exchange.skipped ? "Skipped" : exchange.answer}</p>
      <button className="change" onClick={onChange} disabled={disabled} title="Answer this question again; the questions after it are dropped">
        Change
      </button>
    </li>
  );
}

/** The thread of questions and answers, and the box to answer the open question. */
export function DialogueThread({ science, decision, busy, error, configured, onAnswer, onSkip, onConclude, onRevise, onRetry, onConnect }: Props) {
  const dialogue = decision.dialogue!;
  const exchanges = dialogue.exchanges;
  const open = exchanges.at(-1)?.answer == null && !exchanges.at(-1)?.skipped ? exchanges.at(-1) : undefined;
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(busy?.since);
  const concluded = !!dialogue.conclusion;
  const ready = open?.turn.ready ?? false;
  const spent = exchanges.reduce((sum, e) => sum + (e.usage.cost_usd ?? 0), 0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  // Keep the newest question in view as the dialogue grows.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: exchanges.length > 1 ? "smooth" : "auto", block: "nearest" });
    if (open && !busy) box.current?.focus({ preventScroll: true });
  }, [exchanges.length, busy?.kind, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    const answer = text.trim();
    if (!answer || busy) return;
    onAnswer(answer);
    setText("");
  };

  const change = (index: number) => {
    const previous = exchanges[index];
    const later = exchanges.length - 1 - index;
    if (later > 0 && !confirm(`Answer question ${index + 1} again? The ${later} question${later === 1 ? "" : "s"} after it will be dropped.`)) return;
    setText(previous.answer ?? "");
    onRevise(index, previous.answer ?? "");
  };

  return (
    <div className="dialogue">
      <ol className="thread">
        {exchanges.map((exchange, i) => (
          <Fragment key={i}>
            <Turn science={science} exchange={exchange} index={i} latest={!concluded && i === exchanges.length - 1} pattern={decision.dialogue?.pattern ?? null} />
            {(exchange.answer != null || exchange.skipped) && <Answer exchange={exchange} onChange={() => change(i)} disabled={!!busy} />}
          </Fragment>
        ))}
        {busy?.answer && (
          <li className="answer sending">
            <p>{busy.answer}</p>
          </li>
        )}
        {busy && (
          <li className="turn thinking" role="status">
            <span className="spinner" />
            <span>
              {busy.kind === "conclude" ? "Putting your decision into words" : exchanges.length ? "Thinking about your answer" : "Reading your decision"}{" "}
              <span className="mono muted">{clock(elapsed)}</span>
            </span>
          </li>
        )}
      </ol>

      {!busy && error && (
        <div className="dialogue-error" role="alert">
          <p>{error}</p>
          {configured ? (
            <button className="button" onClick={onRetry}>
              Try again
            </button>
          ) : (
            <button className="button primary" onClick={onConnect}>
              Connect Claude
            </button>
          )}
        </div>
      )}

      {!concluded && open && (
        <div className={`answer-box ${busy ? "busy" : ""}`}>
          {open.turn.scale && (
            <div className="answer-scale" role="group" aria-label="0 to 10">
              {Array.from({ length: 11 }, (_, n) => (
                <button
                  key={n}
                  disabled={!!busy}
                  className={text.startsWith(`${n}/10`) ? "on" : ""}
                  onClick={() => {
                    setText(`${n}/10${text.replace(/^\d+\/10/, "")}`);
                    box.current?.focus();
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={box}
            rows={2}
            value={text}
            disabled={!!busy}
            placeholder={busy ? "" : "Your answer"}
            aria-label="Your answer"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="answer-foot">
            <span className="mono muted">
              {configured ? `↵ to answer · ${roughly(TURN_USD)} a question${spent ? ` · ${usd(spent)} so far` : ""}` : "The dialogue uses Claude with your API key"}
            </span>
            <button className="text-button" disabled={!!busy} onClick={onSkip}>
              Skip
            </button>
            <button className={`button ${ready ? "primary" : ""}`} disabled={!!busy} onClick={() => onConclude(text.trim() || null)} title="Put your decision into words now">
              I'm ready to decide
            </button>
            <button className="button primary" disabled={!!busy || !text.trim()} onClick={send}>
              Answer
            </button>
          </div>
          {ready && <p className="ready-hint">You have covered the ground. Answer this, or put your decision into words now.</p>}
        </div>
      )}

      {!concluded && !open && !busy && !error && exchanges.length > 0 && (
        <div className="answer-box">
          <button className="button primary" onClick={onRetry}>
            Ask the next question
          </button>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
