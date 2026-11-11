import { useEffect, useMemo, useState } from "react";
import { conjunction, loadMap, weightedMean, type Atlas } from "../../atlas/load";
import type { BrainRenderer } from "../../brain/renderer";
import { DESIGN_LABEL, SOURCE_LABEL, SOURCE_LINE, pct, structureName } from "../../format";
import type { Decision, Science, Source } from "../../types";
import { SourceSwitch } from "../../views/AtlasView";
import { Specimen } from "../Specimen";
import { Cites } from "../StructureCard";

type Choice = Source | "both";
type Look = "lh-lateral" | "rh-lateral" | "deep";

/** Composite maps of the rated features, computed from the same curated maps as the engine. */
function useComposite(atlas: Atlas, weights: Record<string, number>) {
  const [maps, setMaps] = useState<Record<string, Partial<Record<Source, Float32Array>>>>({});
  const key = JSON.stringify(weights);
  useEffect(() => {
    let current = true;
    const jobs: Promise<[string, Source, Float32Array]>[] = [];
    for (const feature of Object.keys(weights)) {
      const entry = atlas.catalogue.maps.find((m) => m.id === `feature.${feature}`);
      if (!entry) continue;
      for (const s of ["neuroquery", "neurosynth"] as const) {
        if (entry.sources[s]) jobs.push(loadMap(atlas, entry, s).then((v) => [feature, s, v]));
      }
    }
    Promise.all(jobs).then((loaded) => {
      if (!current) return;
      const out: Record<string, Partial<Record<Source, Float32Array>>> = {};
      for (const [feature, s, v] of loaded) (out[feature] ??= {})[s] = v;
      setMaps(out);
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas, key]);
  return useMemo(() => {
    const of = (s: Source, only?: string[]) =>
      weightedMean(
        Object.entries(weights)
          .filter(([f]) => maps[f]?.[s] && (!only || only.includes(f)))
          .map(([f, w]) => ({ values: maps[f][s]!, weight: w })),
      );
    const shared = Object.keys(weights).filter((f) => maps[f]?.neuroquery && maps[f]?.neurosynth);
    const a = of("neuroquery", shared);
    const b = of("neurosynth", shared);
    return { neuroquery: of("neuroquery"), neurosynth: of("neurosynth"), both: a && b ? conjunction(a, b) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, key]);
}

const strength = (r: number) => (r >= 0.6 ? "strongly" : r >= 0.3 ? "moderately" : "only weakly");

interface Props {
  atlas: Atlas;
  science: Science;
  renderer: BrainRenderer;
  decision: Decision;
}

/** Where published studies of decisions with these features report activity. */
export function Brain({ atlas, science, renderer, decision }: Props) {
  const sig = decision.signature;
  const [choice, setChoice] = useState<Choice>("neuroquery");
  const [threshold, setThreshold] = useState(3.1);
  const composite = useComposite(atlas, sig.weights);
  const regions = new Map(science.regions.map((r) => [r.id, r]));
  const features = new Map(science.features.map((f) => [f.id, f]));

  // The strongest structures, both hemispheres of a structure merged into one line.
  const top = useMemo(() => {
    const seen = new Map<string, { id: string; sides: string[]; z: number }>();
    for (const r of sig.neuroquery?.top_regions ?? []) {
      const [hemi, id] = r.key.includes(".") ? r.key.split(".") : ["", r.key];
      const item = seen.get(id) ?? { id, sides: [], z: r.z };
      if (hemi) item.sides.push(hemi === "lh" ? "left" : "right");
      seen.set(id, item);
    }
    return [...seen.values()].slice(0, 4);
  }, [sig.neuroquery]);
  const deepFirst = top.slice(0, 3).filter((t) => regions.get(t.id)?.kind === "deep").length >= 2;
  const [look, setLook] = useState<Look>(deepFirst ? "deep" : "lh-lateral");

  useEffect(() => {
    renderer.setDeep(look === "deep");
    if (look !== "deep") renderer.setView(look);
    else renderer.setView("lh-lateral");
  }, [renderer, look]);

  if (!sig.available) return <p className="empty">The literature sources are not installed. Run reticulate build-atlas.</p>;
  if (!Object.keys(sig.weights).length) {
    return <p className="empty">None of the features rated present has a brain map in the literature. The watch-outs above still apply.</p>;
  }

  const available = { neuroquery: !!sig.neuroquery, neurosynth: !!sig.neurosynth };
  const source: Choice = choice === "both" ? (sig.agreement ? "both" : "neuroquery") : available[choice] ? choice : "neuroquery";
  const part = source === "both" ? sig.neuroquery : sig[source];
  const values = composite[source];
  const overlay =
    values && part
      ? {
          id: `signature.${decision.id}.${source}.${JSON.stringify(sig.weights)}`,
          values,
          max: Math.max(4, Math.min(sig.neuroquery?.display_max ?? 8, source === "neurosynth" ? sig.neurosynth?.display_max ?? 8 : 99)),
          title: "Decisions like yours",
          source: SOURCE_LINE[source],
          unit: source === "both" ? "z in both sources" : "z",
          fire: 0,
        }
      : null;
  const networks = part ? Object.entries(part.networks).sort((a, b) => b[1] - a[1]) : [];
  const networkName = new Map(science.networks.map((n) => [n.id, n.name]));
  const mapped = Object.keys(sig.weights).map((f) => features.get(f)?.name.toLowerCase());

  return (
    <div className="brain">
      <figure className="brain-figure">
        <div className="segmented brain-look" role="group" aria-label="View">
          {(
            [
              ["lh-lateral", "Left"],
              ["rh-lateral", "Right"],
              ["deep", "Deep structures"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} className={look === v ? "on" : ""} onClick={() => setLook(v)}>
              {label}
            </button>
          ))}
        </div>
        <Specimen renderer={renderer} atlas={atlas} networks={science.networks} layer="plain" overlay={overlay} threshold={threshold} onThreshold={setThreshold} bare compact />
        <figcaption>Drag to turn the brain. Colour shows where studies report activity, from z {threshold.toFixed(1)}.</figcaption>
      </figure>

      <div className="brain-text">
        <p className="brain-lede">
          Published brain-imaging studies of {mapped.slice(0, -1).join(", ")}
          {mapped.length > 1 ? " and " : ""}
          {mapped[mapped.length - 1]} report activity mostly here:
        </p>
        <ul className="engaged">
          {top.map((t) => {
            const r = regions.get(t.id);
            return (
              <li key={t.id}>
                <span className="engaged-name">
                  {r?.name ?? t.id}
                  {t.sides.length === 1 && <span className="muted">, {t.sides[0]}</span>}
                </span>
                <span className="engaged-role">{r?.functions[0]}</span>
              </li>
            );
          })}
        </ul>
        {sig.agreement && (
          <p className="agree">
            Two independent research databases agree {strength(sig.agreement.r)} on this pattern{" "}
            <span className="mono">(r = {sig.agreement.r.toFixed(2)})</span>: NeuroQuery, built from 13,459 articles, and Neurosynth,
            from 14,371 studies.
          </p>
        )}
        <p className="caveat">
          This is what research reports for people on average, not a scan of your brain. Activity in a region does not prove which
          process is at work.
        </p>

        <details className="tech">
          <summary>Technical details</summary>
          <div className="tech-body">
            <div className="tech-row">
              <span className="label">Source</span>
              <SourceSwitch value={source} onChange={setChoice} available={available} />
            </div>
            <label className="tech-row">
              <span className="label">Shown from z</span>
              <input type="range" min={1.96} max={6} step={0.1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
              <span className="mono">{threshold.toFixed(1)}</span>
            </label>
            <p className="note">
              The map is the level-weighted mean of the meta-analytic maps of the rated features ({SOURCE_LINE[source]}).
              {sig.agreement ? ` Agreement: r over the ${sig.agreement.maps} features both sources map.` : ""}
            </p>
            {part && (
              <>
                <h4 className="label">Strongest structures · {source === "both" ? "NeuroQuery" : SOURCE_LABEL[source as Source]}</h4>
                <p className="decoded">
                  {part.top_regions.slice(0, 8).map((r) => (
                    <span key={r.key}>
                      {structureName(science, r.key)} <span className="mono">{r.z.toFixed(1)}</span>
                    </span>
                  ))}
                </p>
                {networks.length > 0 && (
                  <>
                    <h4 className="label">Networks of the engaged cortex</h4>
                    <p className="note">{networks.slice(0, 4).map(([id, share]) => `${networkName.get(id)} ${pct(share)}`).join(" · ")}</p>
                  </>
                )}
                {part.decoding.length > 0 && (
                  <>
                    <h4 className="label">Maps of other terms that resemble this one</h4>
                    <p className="decoded">
                      {part.decoding.slice(0, 6).map((d) => (
                        <span key={d.term}>
                          {d.term} <span className="mono">{d.r.toFixed(2)}</span>
                        </span>
                      ))}
                    </p>
                  </>
                )}
              </>
            )}
            {sig.unmapped.length > 0 && (
              <p className="note">No brain map exists for {sig.unmapped.map((f) => features.get(f)?.name.toLowerCase()).join(", ")}; they enter through their mechanisms only.</p>
            )}
            {sig.findings.length > 0 && (
              <>
                <h4 className="label">Published findings on the tendencies this decision engages</h4>
                <ul className="findings">
                  {sig.findings.slice(0, 5).map((i) => {
                    const l = science.links[i];
                    return (
                      <li key={i}>
                        <span className="design">
                          {regions.get(l.region)?.name} · {DESIGN_LABEL[l.design]}
                        </span>
                        <p>{l.finding}</p>
                        <Cites refs={l.refs} science={science} />
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <a className="text-button" href="#atlas">
              Explore every map in the brain atlas
            </a>
          </div>
        </details>
      </div>
    </div>
  );
}
