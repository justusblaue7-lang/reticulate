import { useMemo, useState } from "react";
import { weightCSS, weightInk } from "../../colors";
import { usd } from "../../format";
import type { Avatar, Decision, Progress, Science } from "../../types";
import { Face } from "../Face";
import { clock, engagedDimensions, estimate, observedPerCall, panelCalls, suggestPanel, tendencyNames, verdict } from "./model";

interface SetupProps {
  science: Science;
  decision: Decision;
  avatars: Avatar[];
  configured: boolean;
  onConvene: (avatars: Avatar[], replicates: number, neural: boolean) => void;
  onConnect: () => void;
  again?: boolean;
}

/** Choose who sits on the panel; a suggestion that disagrees where this decision matters. */
export function PanelSetup({ science, decision, avatars, configured, onConvene, onConnect, again }: SetupProps) {
  const suggested = useMemo(() => suggestPanel(avatars, decision, science), [avatars, decision, science]);
  const [ids, setIds] = useState<string[]>(decision.panel?.profiles.map((p) => p.id) ?? suggested);
  const [picking, setPicking] = useState(false);
  const [replicates, setReplicates] = useState(decision.panel?.meta.replicates ?? 3);
  const [neural, setNeural] = useState(true);
  const chosen = ids.map((id) => avatars.find((a) => a.id === id)).filter((a): a is Avatar => !!a);
  const cost = estimate(panelCalls(decision, chosen.length, replicates), observedPerCall(decision));
  const dims = new Map(science.dimensions.map((d) => [d.id, d.name.toLowerCase()]));
  const engaged = engagedDimensions(decision).slice(0, 2).map((d) => dims.get(d.dimension_id));
  const isSuggested = ids.length === suggested.length && ids.every((id) => suggested.includes(id));
  const own = avatars.filter((a) => a.origin === "user");
  const library = avatars.filter((a) => a.origin === "library");
  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < 8 ? [...ids, id] : ids);

  return (
    <div className="panel-setup">
      <div className="panel-who">
        <p className="panel-why">
          {isSuggested && engaged.length
            ? `Suggested: the ${chosen.length} avatars who differ most on ${engaged.join(" and ")}, the tendencies this decision engages most.`
            : `${chosen.length} avatar${chosen.length === 1 ? "" : "s"} on the panel.`}
        </p>
        <div className="panel-faces">
          {chosen.map((a) => (
            <figure key={a.id} className="member" title={a.summary}>
              <Face avatar={a} size={64} />
              <figcaption>{a.name}</figcaption>
            </figure>
          ))}
          <button className="member add" onClick={() => setPicking(!picking)}>
            <span>{picking ? "Done" : "Change"}</span>
          </button>
        </div>
        {picking && (
          <div className="picker">
            {[
              ["Your avatars", own],
              ["Library", library],
            ].map(([label, list]) =>
              (list as Avatar[]).length ? (
                <div key={label as string}>
                  <h4 className="eyebrow">{label as string}</h4>
                  <div className="picker-grid">
                    {(list as Avatar[]).map((a) => (
                      <button key={a.id} className={`pick ${ids.includes(a.id) ? "on" : ""}`} onClick={() => toggle(a.id)} title={a.summary}>
                        <Face avatar={a} size={44} />
                        <span>
                          <strong>{a.name}</strong>
                          <small>{a.summary}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
            <p className="note">
              Up to eight. {!isSuggested && <button className="text-button" onClick={() => setIds(suggested)}>Use the suggestion</button>}{" "}
              <a className="text-button" href="#avatars">
                Create your own avatar
              </a>
            </p>
          </div>
        )}
      </div>

      <div className="panel-go">
        <label className="runs">
          <span>Runs per avatar</span>
          <span className="segmented">
            {[1, 2, 3, 5].map((n) => (
              <button key={n} className={replicates === n ? "on" : ""} onClick={() => setReplicates(n)}>
                {n}
              </button>
            ))}
          </span>
          <small>Several runs show how stable each answer is.</small>
        </label>
        <label className="check" title="The panel sees which features the decision has and which mechanisms research documents for them, and judges how strongly each applies to the avatar.">
          <input type="checkbox" checked={neural} onChange={(e) => setNeural(e.target.checked)} />
          Brief the panel on the research behind the watch-outs
        </label>
        <div className="go-row">
          <span className="estimate">
            {cost.calls} Claude calls · about {usd(cost.usd)} · about {cost.minutes} min
          </span>
          {configured ? (
            <button className="button primary large" disabled={!chosen.length} onClick={() => onConvene(chosen, replicates, neural)}>
              {again ? "Ask this panel" : "Ask the panel"}
            </button>
          ) : (
            <button className="button primary large" onClick={onConnect}>
              Connect Claude to ask the panel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The panel at work: one face per member, filling as its runs come back. */
export function PanelProgress({ progress, members, replicates, since }: { progress: Progress | null; members: Avatar[]; replicates: number; since: number }) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const elapsed = (Date.now() - since) / 1000;
  return (
    <div className="panel-progress" role="status">
      <div className="progress-head">
        <span className="spinner" />
        <strong>The panel is reasoning</strong>
        <span className="mono muted">
          {total ? `${done} of ${total} calls` : "starting"} · {clock(elapsed)}
        </span>
      </div>
      <div className="progress-bar">
        <span style={{ width: total ? `${Math.max(2, (done / total) * 100)}%` : "2%" }} />
      </div>
      <div className="panel-faces">
        {members.map((a) => {
          const finished = progress?.labels[a.id] ?? 0;
          return (
            <figure key={a.id} className={`member ${finished >= replicates ? "answered" : "waiting"}`}>
              <Face avatar={a} size={64} />
              <figcaption>
                {a.name}
                <small>{finished >= replicates ? "answered" : `thinking · ${finished}/${replicates}`}</small>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <p className="note">
        Each avatar reasons through your decision on its own{replicates > 1 ? `, ${replicates} times` : ""}; then Claude compares the answers.
        You can keep reading while it runs.
      </p>
    </div>
  );
}

/** The panel's answer: verdict, voices, disagreements and the weights behind them. */
export function PanelResult({ science, decision }: { science: Science; decision: Decision }) {
  const panel = decision.panel!;
  const [run, setRun] = useState(0);
  const n = panel.meta.replicates;
  const profiles = new Map(panel.profiles.map((p) => [p.id, p]));
  const v = verdict(panel);
  const names = tendencyNames(science);
  const factorName = new Map(panel.space.factors.map((f) => [f.factor_id, f.name]));

  return (
    <div className="panel-result">
      <div className="verdict-block">
        <p className="verdict-line">{v.statement}</p>
        <ul className="support">
          {v.ranked.map((r) => (
            <li key={r.option} className={r === v.lead && !v.tie ? "lead" : ""}>
              <span className="option">{r.option}</span>
              <span className="track">
                <span style={{ width: `${(r.ids.length / v.total) * 100}%` }} />
              </span>
              <span className="who">
                {r.ids.map((id) => (
                  <Face key={id} avatar={profiles.get(id)!} size={28} />
                ))}
              </span>
              <span className="mono tally">
                {r.ids.length}/{v.total}
              </span>
            </li>
          ))}
        </ul>
        {panel.synthesis && <p className="synthesis-overview">{panel.synthesis.overview}</p>}
      </div>

      <div className="voices-head">
        <h3 className="subhead">In their words</h3>
        {n > 1 && (
          <span className="run-switch">
            Run
            <span className="segmented">
              {Array.from({ length: n }, (_, i) => (
                <button key={i} className={run === i ? "on" : ""} onClick={() => setRun(i)}>
                  {i + 1}
                </button>
              ))}
            </span>
          </span>
        )}
      </div>
      <div className="voices">
        {panel.profiles.map((p) => {
          const view = panel.perspectives[p.id][run] ?? panel.perspectives[p.id][0];
          const tally = panel.space.recommendations[p.id];
          const stable = tally ? tally.counts[tally.option] : 1;
          return (
            <article key={p.id} className="voice">
              <header>
                <Face avatar={p} size={56} />
                <div>
                  <h4>{p.name}</h4>
                  <span className="choice">{view.recommendation}</span>
                </div>
              </header>
              <p className="quote">“{view.summary}”</p>
              <div className="voice-meta">
                <span title="Confidence the avatar reports">
                  Confidence <span className="meter"><span style={{ width: `${view.confidence * 10}%` }} /></span> {view.confidence}/10
                </span>
                {n > 1 && <span title="How many runs chose this option">{stable}/{n} runs agree</span>}
              </div>
              {view.conditions.length > 0 && (
                <p className="conditions">
                  <span className="kicker">On condition that</span>
                  {view.conditions.join("; ")}
                </p>
              )}
              <details>
                <summary>Full reasoning</summary>
                <p>{view.reasoning}</p>
                {view.dimension_drivers.length > 0 && (
                  <p className="drivers">
                    <span className="kicker">Shaped by</span>
                    {view.dimension_drivers.map((d) => `${names.get(d.dimension_id) ?? d.dimension_id}: ${d.effect}`).join(" · ")}
                  </p>
                )}
              </details>
            </article>
          );
        })}
      </div>

      {panel.synthesis && (
        <div className="why-differ">
          {panel.synthesis.divergences.length > 0 && (
            <section>
              <h3 className="subhead">Why they disagree</h3>
              <ul>
                {panel.synthesis.divergences.map((d) => (
                  <li key={d.factor_id}>
                    <strong>{factorName.get(d.factor_id) ?? d.factor_id}.</strong> {d.explanation}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            {panel.synthesis.shared_ground.length > 0 && (
              <>
                <h3 className="subhead">Where they agree</h3>
                <ul>
                  {panel.synthesis.shared_ground.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {panel.synthesis.blind_spots.length > 0 && (
              <>
                <h3 className="subhead">What nobody weighed enough</h3>
                <ul>
                  {panel.synthesis.blind_spots.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}

      <details className="weights">
        <summary>How each avatar weighed the factors</summary>
        <div className="matrix-wrap">
          <table className="matrix">
            <caption className="note">
              Weight from 0 (ignored) to 10 (decisive){n > 1 ? `, mean of ${n} runs` : ""}. Most contested factors first; hover a cell for the
              reason.
            </caption>
            <thead>
              <tr>
                <th />
                {panel.space.profile_ids.map((id) => (
                  <th key={id} className="col">
                    <Face avatar={profiles.get(id)!} size={30} />
                    <span>{profiles.get(id)!.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {panel.space.factors.map((f) => (
                <tr key={f.factor_id}>
                  <th scope="row">
                    {f.name}
                    {f.contested && <span className="tag">contested</span>}
                  </th>
                  {panel.space.profile_ids.map((id) => {
                    const w = f.weights[id];
                    if (!w) return <td key={id} className="cell">–</td>;
                    const rationale = panel.perspectives[id][0]?.assessments.find((a) => a.factor_id === f.factor_id);
                    return (
                      <td
                        key={id}
                        className="cell"
                        style={{ background: weightCSS(w.mean), color: weightInk(w.mean) }}
                        title={`${profiles.get(id)!.name}: favours ${f.favours[id]}. ${rationale?.rationale ?? ""}`}
                      >
                        {n > 1 ? w.mean.toFixed(1) : w.mean}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
