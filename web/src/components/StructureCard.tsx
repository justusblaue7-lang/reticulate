import { useEffect, useState } from "react";
import { decodeStructure, loadVocabulary, MIN_EVIDENCE, structureMean, type Atlas, type DecodedTerm, type Vocabulary } from "../atlas/load";
import { DESIGN_LABEL, HEMI_LABEL, SOURCE_LABEL, shortCite } from "../format";
import type { Science, Source } from "../types";

interface Props {
  atlas: Atlas;
  science: Science;
  code: number;
  labelId: string;
  map: { title: string; values: Float32Array } | null;
  pinned: boolean;
}

export function Cites({ refs, science }: { refs: string[]; science: Science }) {
  return (
    <span className="cites">
      {refs.map((r, i) => (
        <span key={r} title={science.references[r]}>
          {i > 0 && "; "}
          {shortCite(science.references[r], r)}
        </span>
      ))}
    </span>
  );
}

function Decoding({ vocab, structureKey }: { vocab: Vocabulary; structureKey: string }) {
  const [source, setSource] = useState<Source>("neuroquery");
  const [scope, setScope] = useState<"functional" | "all">("functional");
  const terms: DecodedTerm[] = decodeStructure(vocab, source, structureKey, scope, 9);
  const other: Source = source === "neuroquery" ? "neurosynth" : "neuroquery";
  const count = vocab[source].terms.length;
  return (
    <section>
      <h3 className="label">What the literature reports here</h3>
      <div className="source-switch" style={{ marginBottom: 10 }}>
        <div className="segmented">
          {(["neuroquery", "neurosynth"] as const).map((s) => (
            <button key={s} className={source === s ? "on" : ""} onClick={() => setSource(s)}>
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="segmented">
          <button className={scope === "functional" ? "on" : ""} onClick={() => setScope("functional")} title={`Cognitive Atlas concepts and tasks with at least ${MIN_EVIDENCE} studies`}>
            Functions
          </button>
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")} title={`All ${count.toLocaleString()} terms`}>
            All terms
          </button>
        </div>
      </div>
      <div className="terms">
        <span className="head">Term</span>
        <span className="head num">z</span>
        <span className="head num">{SOURCE_LABEL[other].slice(0, 6)}.</span>
        {terms.map((t) => (
          <Row key={t.term} t={t} />
        ))}
      </div>
      <p className="note" style={{ marginTop: 8 }}>
        Mean z of each term's map in this structure, across all {count.toLocaleString()} terms of {SOURCE_LABEL[source]}
        {scope === "functional" ? `, showing Cognitive Atlas concepts and tasks with ≥ ${MIN_EVIDENCE} studies` : ""}. The right
        column gives the same term in {SOURCE_LABEL[other]}. Reading function from activation is reverse inference.
      </p>
    </section>
  );
}

function Row({ t }: { t: DecodedTerm }) {
  return (
    <>
      <span>
        {t.term}
        {t.category !== "concept" && t.category !== "task" && <span className="tag">{t.category}</span>}
      </span>
      <span className="mono num">{t.z.toFixed(1)}</span>
      <span className="mono num muted">{t.other === null ? "–" : t.other.toFixed(1)}</span>
    </>
  );
}

export function StructureCard({ atlas, science, code, labelId, map, pinned }: Props) {
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  useEffect(() => void loadVocabulary().then(setVocab), []);

  const structure = atlas.geometry.regions[code];
  const stats = atlas.stats[code];
  const region = science.regions.find((r) => r.id === structure.id);
  if (!region) return null;
  const group = science.region_groups.find((g) => g.id === region.group)?.name;
  const links = science.links.filter((l) => l.region === region.id);
  const dims = new Map(science.dimensions.map((d) => [d.id, d]));
  const networkNames = new Map(science.networks.map((n) => [n.index, n.name]));
  const networkColours = new Map(atlas.geometry.networks.map((n) => [n.index, n.color]));
  const mapValue = map ? structureMean(atlas, map.values, code) : null;
  const nq = stats.constructs.neuroquery ?? {};
  const ns = stats.constructs.neurosynth ?? {};
  const constructMax = Math.max(8, ...Object.values(nq), ...Object.values(ns));

  return (
    <article className="structure">
      <div className="label">
        {structure.hemi ? HEMI_LABEL[structure.hemi] : "Midline"} · {group}
        {pinned && " · pinned"}
      </div>
      <h2 id={labelId}>{region.name}</h2>
      {region.alias && <p className="alias">{region.alias}</p>}

      {mapValue !== null && (
        <p className="map-value">
          <span className="label">{map!.title}</span>
          <span className="mono">mean {mapValue.toFixed(1)}</span>
        </p>
      )}

      <section>
        <h3 className="label">Known functions</h3>
        <ul className="functions">
          {region.functions.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <Cites refs={region.refs} science={science} />
      </section>

      {structure.kind === "cortex" && stats.networks && (
        <section>
          <h3 className="label">Network membership</h3>
          <div className="network-bar" aria-hidden>
            {Object.entries(stats.networks).map(([k, share]) => (
              <span key={k} style={{ width: `${share * 100}%`, background: networkColours.get(Number(k)) }} />
            ))}
          </div>
          <ul className="network-shares">
            {Object.entries(stats.networks)
              .filter(([, share]) => share >= 0.05)
              .sort((a, b) => b[1] - a[1])
              .map(([k, share]) => (
                <li key={k}>
                  <span className="swatch" style={{ background: networkColours.get(Number(k)) }} />
                  {networkNames.get(Number(k))} <span className="mono">{Math.round(share * 100)}%</span>
                </li>
              ))}
          </ul>
          <Cites refs={["yeo2011"]} science={science} />
        </section>
      )}

      {structure.kind !== "medialwall" && vocab && <Decoding vocab={vocab} structureKey={structure.key} />}

      {structure.kind !== "medialwall" && (
        <section>
          <h3 className="label">Connections to the profile dimensions</h3>
          <table className="construct-table">
            <thead>
              <tr>
                <th />
                <th className="bar-cell" />
                <th className="num">NQ</th>
                <th className="num">NS</th>
              </tr>
            </thead>
            <tbody>
              {science.dimensions.map((d) => {
                const z = nq[d.id] ?? 0;
                return (
                  <tr key={d.id} className={z >= 3.1 ? "strong" : ""}>
                    <th scope="row">
                      {d.name}
                      {d.construct_map.quality === "low" && (
                        <sup title={d.construct_map.note} className="quality">
                          †
                        </sup>
                      )}
                    </th>
                    <td className="bar-cell">
                      <span className="hbar" style={{ width: `${(Math.max(0, z) / constructMax) * 100}%` }} />
                    </td>
                    <td className="mono num">{z.toFixed(1)}</td>
                    <td className="mono num muted">{d.id in ns ? ns[d.id].toFixed(1) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 8 }}>
            Mean z of each dimension's construct map here, in NeuroQuery (bar) and Neurosynth (– where its vocabulary has no
            fitting term). How strongly the literature on a construct reports activity here, not a difference between people.
            {science.dimensions.some((d) => d.construct_map.quality === "low") && " † thin literature; a rough proxy."}
          </p>

          <h3 className="label" style={{ marginTop: 22 }}>
            Published findings
          </h3>
          {links.length ? (
            <ul className="findings">
              {links.map((l, i) => (
                <li key={i}>
                  <div className="finding-head">
                    <span className="finding-dim">{dims.get(l.dimension)?.name}</span>
                    <span className="design">{DESIGN_LABEL[l.design]}</span>
                  </div>
                  <p>{l.finding}</p>
                  <Cites refs={l.refs} science={science} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No curated finding links this structure directly to a profile dimension.</p>
          )}
        </section>
      )}

      <footer className="facts mono">
        {stats.area_cm2 !== undefined && <span>{stats.area_cm2.toFixed(1)} cm² pial area</span>}
        {stats.volume_cm3 !== undefined && <span>{stats.volume_cm3.toFixed(2)} cm³</span>}
        <span>centroid {stats.centroid.map((c) => c.toFixed(0)).join(", ")} (MNI305)</span>
      </footer>
    </article>
  );
}
