import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { conjunction, decodeValues, loadMap, rankStructures, type Atlas, type MapEntry } from "../atlas/load";
import type { BaseLayer, BrainRenderer, Hit } from "../brain/renderer";
import { LeaderLine } from "../components/LeaderLine";
import { MapBrowser } from "../components/MapBrowser";
import { Specimen, type OverlaySpec } from "../components/Specimen";
import { Cites, StructureCard } from "../components/StructureCard";
import { RankedStructures, StructureIndex } from "../components/StructureIndex";
import { SOURCE_LABEL, SOURCE_LINE, pct, signed } from "../format";
import type { Science, Source, Status, TextMap } from "../types";

type Choice = Source | "both";
const LABEL_ID = "structure-label";

interface Props {
  atlas: Atlas;
  science: Science;
  status: Status | null;
  renderer: BrainRenderer;
}

export function SourceSwitch({
  value,
  onChange,
  available,
  both = true,
}: {
  value: Choice;
  onChange: (c: Choice) => void;
  available: Record<Source, boolean>;
  both?: boolean;
}) {
  return (
    <div className="source-switch no-print">
      <div className="segmented" role="group" aria-label="Source">
        {(both ? (["neuroquery", "neurosynth", "both"] as const) : (["neuroquery", "neurosynth"] as const)).map((c) => {
          const ok = c === "both" ? available.neuroquery && available.neurosynth : available[c];
          return (
            <button
              key={c}
              className={value === c ? "on" : ""}
              disabled={!ok}
              title={ok ? SOURCE_LINE[c] : `${c === "both" ? "Needs both sources" : `${SOURCE_LABEL[c as Source]} has no term for this`}`}
              onClick={() => onChange(c)}
            >
              {c === "both" ? "Agreement" : SOURCE_LABEL[c]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AtlasView({ atlas, science, status, renderer }: Props) {
  const [tab, setTab] = useState<"structures" | "maps">("structures");
  const [hover, setHover] = useState<Hit | null>(null);
  const [selection, setSelection] = useState<Hit | null>(null);
  const [layer, setLayer] = useState<BaseLayer>("regions");
  const [threshold, setThreshold] = useState(3.1);
  const [mapId, setMapId] = useState<string | null>(null); // curated id, or "text"
  const [text, setText] = useState<TextMap | null>(null);
  const [choice, setChoice] = useState<Choice>("neuroquery");
  const [values, setValues] = useState<Partial<Record<Source, Float32Array>>>({});
  const [fire, setFire] = useState(0);

  const entry: MapEntry | null = mapId && mapId !== "text" ? atlas.catalogue.maps.find((m) => m.id === mapId) ?? null : null;
  const available: Record<Source, boolean> = entry
    ? { neuroquery: !!entry.sources.neuroquery, neurosynth: !!entry.sources.neurosynth }
    : { neuroquery: !!text, neurosynth: !!text?.neurosynth };
  const source: Choice = choice === "both" ? (available.neuroquery && available.neurosynth ? "both" : "neuroquery") : available[choice] ? choice : available.neuroquery ? "neuroquery" : "neurosynth";

  useEffect(() => {
    if (!entry) return;
    let current = true;
    const sources = (["neuroquery", "neurosynth"] as const).filter((s) => entry.sources[s]);
    Promise.all(sources.map((s) => loadMap(atlas, entry, s))).then((loaded) => {
      if (!current) return;
      setValues(Object.fromEntries(sources.map((s, i) => [s, loaded[i]])));
      setFire((f) => f + 1);
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas, mapId]);

  const overlayValues = useMemo(() => {
    if (!mapId) return null;
    const nq = values.neuroquery;
    const ns = values.neurosynth;
    if (source === "both") return nq && ns ? conjunction(nq, ns) : null;
    return values[source] ?? null;
  }, [mapId, values, source]);

  const name = entry ? entry.name : text ? `“${text.query}”` : "";
  const kind = entry ? { stimulus: "Stimulus", construct: "Construct", feature: "Decision feature" }[entry.kind] : "Search";
  const sourceMax = (s: Source) => (entry ? entry.sources[s]?.display_max : s === "neuroquery" ? text?.neuroquery.display_max : text?.neurosynth?.display_max) ?? 6;
  const overlay: OverlaySpec | null =
    overlayValues && mapId
      ? {
          id: `${mapId}.${source}.${text?.query ?? ""}`,
          values: overlayValues,
          max: source === "both" ? Math.min(sourceMax("neuroquery"), sourceMax("neurosynth")) : sourceMax(source),
          title: `${kind} · ${name}`,
          source: SOURCE_LINE[source],
          unit: source === "both" ? "minimum z of both sources" : `${SOURCE_LABEL[source]} z`,
          fire,
        }
      : null;

  const pick = useCallback(
    (code: number) => {
      renderer.focus(code);
      setSelection({ code, anchor: renderer.anchorFor(code) });
    },
    [renderer],
  );

  const onText = async (query: string) => {
    const result = await api.textMap(query);
    setText(result);
    setValues({
      neuroquery: decodeValues(atlas, result.neuroquery.values),
      ...(result.neurosynth ? { neurosynth: decodeValues(atlas, result.neurosynth.values) } : {}),
    });
    setMapId("text");
    setSelection(null);
    setFire((f) => f + 1);
  };

  const shown = selection ?? hover;
  const ranking = overlay ? rankStructures(atlas, overlay.values) : null;

  return (
    <main className="view">
      <div className="atlas">
        <aside>
          <div className="tabs">
            <button className={tab === "structures" ? "on" : ""} onClick={() => setTab("structures")}>
              Structures
            </button>
            <button className={tab === "maps" ? "on" : ""} onClick={() => setTab("maps")}>
              Literature maps
            </button>
          </div>
          {tab === "structures" ? (
            <StructureIndex atlas={atlas} science={science} selected={selection?.code ?? -1} onPick={pick} />
          ) : (
            <MapBrowser
              science={science}
              maps={atlas.catalogue.maps}
              selected={mapId}
              textQuery={text?.query ?? null}
              literature={!!status?.literature}
              onSelect={(id) => {
                setMapId(id === mapId ? null : id);
                setText(null);
                setSelection(null);
              }}
              onText={onText}
            />
          )}
        </aside>

        <section className="centre">
          <Specimen
            renderer={renderer}
            atlas={atlas}
            networks={science.networks}
            layer={overlay ? "plain" : layer}
            onLayer={setLayer}
            overlay={overlay}
            threshold={threshold}
            onThreshold={setThreshold}
            hover={hover?.code ?? -1}
            selected={selection?.code ?? -1}
            onHover={setHover}
            onSelect={(hit) => setSelection(hit && selection?.code === hit.code ? null : hit)}
            figure="Fig. 1"
            legendExtra={mapId ? <SourceSwitch value={source} onChange={setChoice} available={available} /> : null}
          />
        </section>

        <aside>
          {shown ? (
            <StructureCard
              atlas={atlas}
              science={science}
              code={shown.code}
              labelId={LABEL_ID}
              pinned={!!selection}
              map={overlay ? { title: overlay.title, values: overlay.values } : null}
            />
          ) : mapId && (entry || text) ? (
            <MapDossier science={science} entry={entry} text={text} source={source} ranking={ranking} onPick={pick} atlas={atlas} />
          ) : (
            <div className="intro">
              <p className="subtitle">Every structure of the brain, and what the literature says about it.</p>
              <p className="note">
                Point at the specimen to identify a structure; click to pin it. The full-resolution fsaverage template (163,842
                vertices per hemisphere) is divided into the 68 cortical regions of the Desikan–Killiany atlas and 22 deep
                structures. <em>Inflated</em> reaches cortex hidden in sulci, <em>Deep</em> the nuclei beneath it.
              </p>
              <p className="note">
                <em>Literature maps</em> show where published studies of a topic report activation, from two independent
                sources: NeuroQuery ({atlas.catalogue.sources.neuroquery.documents.toLocaleString()} full-text articles) and
                Neurosynth ({atlas.catalogue.sources.neurosynth.studies.toLocaleString()} studies). Across{" "}
                {atlas.catalogue.agreement.terms.toLocaleString()} terms both know, their maps correlate with a median r of{" "}
                {atlas.catalogue.agreement.median_r?.toFixed(2)}.
              </p>
            </div>
          )}
        </aside>
      </div>
      <LeaderLine renderer={renderer} anchor={shown?.anchor ?? null} target={LABEL_ID} />
    </main>
  );
}

function MapDossier({
  science,
  entry,
  text,
  source,
  ranking,
  onPick,
  atlas,
}: {
  science: Science;
  entry: MapEntry | null;
  text: TextMap | null;
  source: Choice;
  ranking: { key: string; z: number }[] | null;
  onPick: (code: number) => void;
  atlas: Atlas;
}) {
  const stimulus = entry?.kind === "stimulus" ? science.stimuli.find((s) => s.id === entry.ref) : null;
  const feature = entry?.kind === "feature" ? science.features.find((f) => f.id === entry.ref) : null;
  const dimension = entry?.kind === "construct" ? science.dimensions.find((d) => d.id === entry.ref) : null;
  const nq = entry?.sources.neuroquery ?? text?.neuroquery ?? null;
  const ns = entry?.sources.neurosynth ?? text?.neurosynth ?? null;
  const agreement = entry?.agreement ?? text?.agreement ?? null;
  const constructs = (source === "neurosynth" ? ns?.constructs : nq?.constructs) ?? null;
  const decoding = text ? (source === "neurosynth" ? text.neurosynth?.decoding : text.neuroquery.decoding) : null;

  return (
    <article className="dossier">
      <div className="label">{entry ? { stimulus: "Stimulus", construct: "Construct map", feature: "Decision feature" }[entry.kind] : "Search"}</div>
      <h2>{entry?.name ?? `“${text?.query}”`}</h2>
      {stimulus && <p className="note">{stimulus.paradigm}</p>}
      {feature && <p className="note">{feature.question}</p>}
      {dimension && <p className="note">{dimension.construct_map.note}</p>}
      {(stimulus?.note || feature?.note) && <p className="notice" style={{ marginTop: 10 }}>{stimulus?.note || feature?.note}</p>}

      <div className="agreement">
        <div>
          <div className="label">NeuroQuery</div>
          <div className="figure">{nq ? pct(nq.coverage) : "–"}</div>
          <div className="note">cortex above 3.1</div>
        </div>
        <div>
          <div className="label">Neurosynth</div>
          <div className="figure">{ns ? pct(ns.coverage) : "–"}</div>
          <div className="note">{ns ? `${ns.studies} studies` : "no term"}</div>
        </div>
        <div>
          <div className="label">Agreement</div>
          <div className="figure">{agreement ? signed(agreement.r) : "–"}</div>
          <div className="note">{agreement ? `r · Dice ${agreement.dice ?? "–"}` : "one source only"}</div>
        </div>
      </div>

      <dl className="facts-list">
        {nq && (
          <>
            <dt>NeuroQuery</dt>
            <dd>
              <span className="mono">{entry?.sources.neuroquery?.query ?? text?.query}</span>
              {nq.query_terms && <span className="muted"> · recognised: {nq.query_terms.join(", ") || "–"}</span>}
            </dd>
          </>
        )}
        <dt>Neurosynth</dt>
        <dd>
          {ns ? (
            <>
              <span className="mono">{ns.terms?.join(" OR ")}</span>
              <span className="muted"> · {ns.studies} studies{ns.fdr_z ? ` · FDR q < .01 from z ${ns.fdr_z.toFixed(1)}` : ""}</span>
            </>
          ) : (
            <span className="muted">Its abstract vocabulary has no term for this; NeuroQuery only.</span>
          )}
        </dd>
      </dl>

      {decoding && decoding.length > 0 && (
        <section>
          <h3 className="label">Resembles the maps of</h3>
          <p className="decoded">
            {decoding.slice(0, 8).map((d) => (
              <span key={d.term}>
                {d.term}
                <span className="mono">{d.r.toFixed(2)}</span>
              </span>
            ))}
          </p>
        </section>
      )}

      {ranking && (
        <section>
          <RankedStructures atlas={atlas} science={science} ranking={ranking} onPick={onPick} title={`Strongest structures · ${source === "both" ? "both sources" : SOURCE_LABEL[source]}`} />
        </section>
      )}

      {constructs && (
        <section>
          <h3 className="label">Overlap with the profile constructs</h3>
          <table className="construct-table">
            <tbody>
              {science.dimensions
                .filter((d) => d.id in constructs)
                .map((d) => (
                  <tr key={d.id} className={constructs[d.id] >= 0.5 ? "strong" : ""}>
                    <th scope="row">{d.name}</th>
                    <td className="bar-cell">
                      <span className="hbar" style={{ width: `${Math.max(0, constructs[d.id]) * 100}%` }} />
                    </td>
                    <td className="mono num">{signed(constructs[d.id])}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 6 }}>Spatial correlation over the grid (descriptive; smooth maps correlate easily).</p>
        </section>
      )}
      {stimulus && (
        <section>
          <Cites refs={stimulus.refs} science={science} />
        </section>
      )}
    </article>
  );
}
