import { useEffect, useMemo, useState } from "react";
import { PUBLIC, api } from "../api";
import { SHORT } from "../format";
import { itemOrder, leaningOf, leanings } from "../pattern";
import type { PersonalPattern, Science } from "../types";
import { Glyph } from "./Glyph";
import { Kbd, MOD, Mark } from "./Mark";

interface Props {
  science: Science;
  pattern: PersonalPattern | null;
  onPattern: (pattern: PersonalPattern | null) => void;
}

const values = (p: PersonalPattern) => Object.fromEntries(Object.entries(p.dimensions).map(([k, v]) => [k, v.value]));
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const SCALE = Array.from({ length: 11 }, (_, i) => i);

/** Your pattern: the six questions of the Global Preferences Survey, then what your answers go with. */
export function PatternCheck({ science, pattern, onPattern }: Props) {
  const [mode, setMode] = useState<"check" | "result">(pattern ? "result" : "check");
  const [answers, setAnswers] = useState<Record<string, number>>(pattern?.answers ?? {});
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => itemOrder(science), [science]);
  const done = items.filter((i) => i.id in answers).length;
  const complete = done === items.length;
  const mechanisms = new Map(science.mechanisms.map((m) => [m.id, m.name]));

  useEffect(() => {
    if (pattern && mode === "check" && !Object.keys(answers).length) setAnswers(pattern.answers);
  }, [pattern, mode, answers]);

  const answer = (index: number, value: number, advance = true) => {
    const next = { ...answers, [items[index].id]: Math.max(0, Math.min(10, value)) };
    setAnswers(next);
    if (!advance) return;
    const after = items.findIndex((it, i) => i > index && !(it.id in next));
    const before = items.findIndex((it) => !(it.id in next));
    setActive(after >= 0 ? after : before >= 0 ? before : index);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onPattern(await api.savePattern(answers));
      setMode("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Keyboard first: 0–9 answer the current question, ← → move the answer, ↑ ↓ the question, ⌘↵ saves.
  useEffect(() => {
    if (mode !== "check") return;
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".pattern-check") || target.closest("input, textarea, [contenteditable]") || e.altKey) return;
      const id = items[active]?.id;
      if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        answer(active, Number(e.key));
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        answer(active, (answers[id] ?? 5) + (e.key === "ArrowRight" ? 1 : -1), false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && complete) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (mode === "result" && pattern) {
    const current = values(pattern);
    const found = leanings(science, current);
    return (
      <div className="card pattern-result">
        <div className="pattern-result-grid">
          <div>
            <div className="pattern-glyph">
              <Glyph scores={science.dimensions.map((d) => current[d.id])} size={170} rings={5} labels={science.dimensions.map((d) => SHORT[d.id] ?? d.name)} />
            </div>
            <ul className="pattern-bars">
              {science.dimensions.map((d) => {
                const v = current[d.id];
                const lean = found.find((l) => l.dimension === d.id);
                return (
                  <li key={d.id} className={lean ? lean.strength : ""} title={d.definition}>
                    <span className="pb-name">{d.name}</span>
                    <span className="pb-lean">
                      {v} · {lean ? lean.poleName : "middle"}
                    </span>
                    <span className="pb-track" aria-label={`${d.low_pole} to ${d.high_pole}`}>
                      <span className="pb-span" style={{ left: `${Math.min(v, 5) * 10}%`, width: `${Math.abs(v - 5) * 10}%` }} />
                      <span className="pb-dot" style={{ left: `${v * 10}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="pattern-watch">
            <h3>What your answers go with</h3>
            {found.length === 0 ? (
              <p className="note">All your answers are near the middle of the scale. The dialogue spends its questions where this decision needs them.</p>
            ) : (
              <ul>
                {found.map((l) => {
                  const lean = leaningOf(science, l.dimension, l.pole)!;
                  return (
                    <li key={l.dimension} className={l.strength}>
                      <div className="pw-head">
                        <strong>{l.poleName}</strong>
                        <span className="rc-tag">{l.strength === "clear" ? "Clear leaning" : "Some leaning"}</span>
                      </div>
                      <p className="pw-watch">{lean.watch}</p>
                      {lean.mechanisms.length > 0 && (
                        <p className="pw-ask">
                          <span>Bias it was validated against</span> {lean.mechanisms.map((m) => mechanisms.get(m) ?? m).join(", ")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="pattern-provenance">
              Your answers of {date(pattern.updated_at)} to the six questions of the Global Preferences Survey (Falk et al., 2018), asked of 80,000
              people in 76 countries and validated against choices with real money (Falk et al., 2023). They describe your attitudes in general,
              not a particular decision. New dialogues use them; dialogues already started keep the answers they began with. Saved{" "}
              {PUBLIC ? "in this browser" : "on this computer"} only.
            </p>
            {error && <p className="error">{error}</p>}
            <div className="pattern-actions">
              <button
                className="button dark"
                onClick={() => {
                  setAnswers(pattern.answers);
                  setActive(0);
                  setMode("check");
                }}
              >
                Change my answers
              </button>
              <button
                className="button quiet danger"
                onClick={async () => {
                  if (!confirm("Delete your answers? New dialogues will no longer use them.")) return;
                  await api.deletePattern();
                  onPattern(null);
                  setAnswers({});
                  setMode("check");
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rc-window pattern-check" tabIndex={-1}>
      <div className="rc-search pc-head">
        <span className="pc-title">Six questions about how you decide</span>
        <span className="pc-progress" aria-live="polite">
          <span className="pc-bar">
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </span>
          {done}/{items.length}
        </span>
      </div>
      <ol className="pc-list">
        {items.map((item, i) => (
          <li key={item.id} className={`pc-item ${i === active ? "on" : ""} ${item.id in answers ? "answered" : ""}`} onClick={() => setActive(i)}>
            <span className="pc-text">{item.text}</span>
            <span className="pc-answers" role="radiogroup" aria-label={item.text}>
              {SCALE.map((v) => (
                <button
                  key={v}
                  role="radio"
                  aria-checked={answers[item.id] === v}
                  aria-label={v === 0 ? `0, ${item.low}` : v === 10 ? `10, ${item.high}` : String(v)}
                  className={answers[item.id] === v ? "on" : ""}
                  onClick={(e) => {
                    e.stopPropagation();
                    answer(i, v);
                  }}
                >
                  {v}
                </button>
              ))}
            </span>
            <span className="pc-ends" aria-hidden>
              <span>{item.low}</span>
              <span>{item.high}</span>
            </span>
          </li>
        ))}
      </ol>
      {error && <p className="error pc-error">{error}</p>}
      <div className="rc-actionbar">
        <div className="rc-actionbar-left">
          <Mark size={18} />
          <span>Global Preferences Survey · one minute · stays {PUBLIC ? "in this browser" : "on this computer"}</span>
        </div>
        <div className="rc-actionbar-right">
          <span className="rc-hint">
            Answer <Kbd>0</Kbd>–<Kbd>9</Kbd> <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </span>
          <span className="rc-divider" />
          {pattern && (
            <>
              <button className="rc-action" onClick={() => setMode("result")}>
                Cancel
              </button>
              <span className="rc-divider" />
            </>
          )}
          <button className="rc-action primary" disabled={!complete || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "See my pattern"}
            <Kbd>{MOD}</Kbd>
            <Kbd>↵</Kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
