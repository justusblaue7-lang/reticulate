import { useState } from "react";
import { ref } from "../../api";
import { usd } from "../../format";
import type { Avatar, Decision, Progress, Science } from "../../types";
import { DoseResponse } from "../DoseResponse";
import { Face } from "../Face";
import { clock, engagedDimensions, estimate, observedPerCall, poles, tendencyNames } from "./model";

const LEVELS = [2, 5, 8];

interface Props {
  science: Science;
  decision: Decision;
  configured: boolean;
  running: { progress: Progress | null; since: number } | null;
  busy: boolean;
  onRun: (profile: string | Avatar, key: string, values: number[], replicates: number) => void;
  onConnect: () => void;
}

/** Would a different temperament flip the answer? One avatar, one tendency, three levels. */
export function Tipping({ science, decision, configured, running, busy, onRun, onConnect }: Props) {
  const members = decision.panel?.profiles ?? [];
  const engaged = engagedDimensions(decision).map((d) => d.dimension_id);
  const keys = [...engaged, ...science.dimensions.map((d) => d.id).filter((id) => !engaged.includes(id)), ...science.personality.traits.map((t) => t.id)];
  const [memberId, setMemberId] = useState(members[0]?.id);
  const [key, setKey] = useState(engaged[0] ?? keys[0]);
  const [replicates, setReplicates] = useState(2);
  const names = tendencyNames(science);
  const member = members.find((m) => m.id === memberId) ?? members[0];
  const cost = estimate(LEVELS.length * replicates, observedPerCall(decision));
  const [low, high] = poles(science, key);

  if (!decision.panel) {
    return <p className="empty">Ask the panel first. Then you can test which tendency would have to change for an avatar's answer to flip.</p>;
  }

  return (
    <>
      <div className="tipping-setup">
        <div className="tip-field">
          <span className="eyebrow">Whose answer</span>
          <div className="tip-members">
            {members.map((m) => (
              <button key={m.id} className={`pick small ${m.id === member?.id ? "on" : ""}`} onClick={() => setMemberId(m.id)}>
                <Face avatar={m} size={34} />
                <span>
                  <strong>{m.name}</strong>
                  <small>{decision.panel!.space.recommendations[m.id]?.option}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="tip-field">
          <span className="eyebrow">Which tendency to vary</span>
          <div className="tip-keys">
            {keys.map((k) => (
              <button key={k} className={`key ${k === key ? "on" : ""}`} onClick={() => setKey(k)}>
                {names.get(k)}
                {engaged.includes(k) && <span className="dot-mark" title="Engaged by this decision" />}
              </button>
            ))}
          </div>
          <p className="note">
            {names.get(key)} runs from {low.toLowerCase()} (0) to {high.toLowerCase()} (10); this avatar is at{" "}
            {member ? (member.dimensions[key] ?? member.personality?.traits[key])?.value ?? 5 : 5}. Reticulate re-runs it with{" "}
            {names.get(key)?.toLowerCase()} set to {LEVELS.slice(0, -1).join(", ")} and {LEVELS[LEVELS.length - 1]}, everything else held fixed.{" "}
            <span className="dot-mark inline" /> marks the tendencies this decision engages.
          </p>
        </div>
        {running ? (
          <div className="panel-progress compact" role="status">
            <div className="progress-head">
              <span className="spinner" />
              <strong>Testing the tipping point</strong>
              <span className="mono muted">
                {running.progress ? `${running.progress.done} of ${running.progress.total} calls` : "starting"} · {clock((Date.now() - running.since) / 1000)}
              </span>
            </div>
            <div className="progress-bar">
              <span style={{ width: running.progress?.total ? `${Math.max(2, (running.progress.done / running.progress.total) * 100)}%` : "2%" }} />
            </div>
          </div>
        ) : (
          <div className="go-row">
            <label className="runs">
              <span>Runs per level</span>
              <span className="segmented">
                {[1, 2, 3].map((n) => (
                  <button key={n} className={replicates === n ? "on" : ""} onClick={() => setReplicates(n)}>
                    {n}
                  </button>
                ))}
              </span>
            </label>
            <span className="estimate">
              {cost.calls} calls · about {usd(cost.usd)} · about {cost.minutes} min
            </span>
            {configured ? (
              <button className="button primary" disabled={busy || !member} onClick={() => onRun(ref(member!), key, LEVELS, replicates)}>
                Test this tipping point
              </button>
            ) : (
              <button className="button primary" onClick={onConnect}>
                Connect Claude
              </button>
            )}
          </div>
        )}
      </div>

      {[...decision.tipping].reverse().map((t) => {
        const label = names.get(t.dimension) ?? t.dimension;
        const [lo, hi] = poles(science, t.dimension);
        const tallies = t.values.map((v) => t.recommendations[`${v}`] ?? t.recommendations[String(v)]);
        const flips = tallies.map((tl, i) => i > 0 && tl?.option !== tallies[i - 1]?.option);
        const first = flips.indexOf(true);
        const sentence =
          first > 0
            ? `The answer flips between ${t.values[first - 1]} and ${t.values[first]}: toward ${(t.values[first] > t.values[first - 1] ? hi : lo).toLowerCase()}, ${t.profile.name} chooses “${tallies[first]?.option}”.`
            : `The answer holds: from ${t.values[0]} to ${t.values[t.values.length - 1]}, ${t.profile.name} chooses “${tallies[0]?.option}”.`;
        return (
          <section key={t.id} className="tip-result">
            <header>
              <Face avatar={t.profile} size={40} />
              <div>
                <h3>
                  {t.profile.name} · {label}
                </h3>
                <p className={first > 0 ? "flip-line" : "hold-line"}>{sentence}</p>
              </div>
            </header>
            <div className="flip-strip">
              {t.values.map((v, i) => (
                <div key={v} className={flips[i] ? "flip" : ""}>
                  <span className="eyebrow">
                    {label} {v}
                    {i === 0 ? ` · ${lo.toLowerCase()}` : i === t.values.length - 1 ? ` · ${hi.toLowerCase()}` : ""}
                  </span>
                  <strong>{tallies[i]?.option}</strong>
                  <span className="mono muted">
                    {tallies[i]?.counts[tallies[i].option]}/{t.meta.replicates} runs
                  </span>
                </div>
              ))}
            </div>
            <details>
              <summary>How the factor weights moved</summary>
              <p className="note">
                Slope per scale point ± standard error over {t.meta.replicates} run{t.meta.replicates === 1 ? "" : "s"} per level, everything else
                held fixed. This design can attribute the change to {label.toLowerCase()} alone.
              </p>
              <DoseResponse result={t} label={label} limit={4} />
            </details>
          </section>
        );
      })}
    </>
  );
}
