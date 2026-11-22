import { useEffect, useState } from "react";
import { loadAtlas, loadMap, type Atlas, type MapEntry } from "../atlas/load";
import { BrainRenderer } from "../brain/renderer";
import { SourceSwitch } from "../components/SourceSwitch";
import { Specimen, type OverlaySpec } from "../components/Specimen";
import { SOURCE_LABEL } from "../format";
import type { Science, Source } from "../types";

// The atlas loads only when someone opens it, and is built once per visit.
let loading: Promise<{ atlas: Atlas; renderer: BrainRenderer }> | null = null;
function open() {
  loading ??= loadAtlas().then((atlas) => {
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    document.body.appendChild(holder);
    return { atlas, renderer: new BrainRenderer(holder, atlas) };
  });
  return loading;
}

/**
 * The brain atlas: published meta-analytic maps of the eight tendencies and of decision
 * features. A reference to the research literature, kept apart from the dialogue: nothing in a
 * decision is read from it.
 */
export default function AtlasView({ science, onClose }: { science: Science; onClose: () => void }) {
  const [loaded, setLoaded] = useState<{ atlas: Atlas; renderer: BrainRenderer } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string>(`construct.${science.dimensions[0].id}`);
  const [source, setSource] = useState<Source>("neuroquery");
  const [threshold, setThreshold] = useState(3.1);
  const [overlay, setOverlay] = useState<OverlaySpec | null>(null);

  useEffect(() => {
    open()
      .then(setLoaded)
      .catch((e) => setError(`The atlas could not be loaded (${e instanceof Error ? e.message : e}).`));
  }, []);

  const entries = loaded?.atlas.catalogue.maps ?? [];
  const constructs = entries.filter((m) => m.kind === "construct");
  const features = entries.filter((m) => m.kind === "feature");
  const entry = entries.find((m) => m.id === entryId);
  const available = { neuroquery: !!entry?.sources.neuroquery, neurosynth: !!entry?.sources.neurosynth };
  const shown: Source = entry?.sources[source] ? source : available.neuroquery ? "neuroquery" : "neurosynth";

  useEffect(() => {
    if (!loaded || !entry?.sources[shown]) return;
    let current = true;
    loadMap(loaded.atlas, entry, shown).then((values) => {
      if (!current) return;
      const part = entry.sources[shown]!;
      setOverlay({
        id: `${entry.id}.${shown}`,
        values,
        max: part.display_max,
        title: entry.name,
        source: `${SOURCE_LABEL[shown]} meta-analytic map of “${part.query ?? part.terms?.join(", ") ?? entry.name}”`,
        unit: "z",
        fire: 0,
      });
    });
    return () => {
      current = false;
    };
  }, [loaded, entry, shown]);

  const dimension = science.dimensions.find((d) => `construct.${d.id}` === entryId);
  const feature = science.features.find((f) => `feature.${f.id}` === entryId);

  const chip = (m: MapEntry) => (
    <button key={m.id} className={`chip ${m.id === entryId ? "on" : ""}`} onClick={() => setEntryId(m.id)}>
      {m.kind === "construct" ? (science.dimensions.find((d) => `construct.${d.id}` === m.id)?.name ?? m.name) : (science.features.find((f) => `feature.${f.id}` === m.id)?.name ?? m.name)}
    </button>
  );

  return (
    <main className="container atlas-page">
      <header className="atlas-head">
        <button className="text-button" onClick={onClose}>
          ← Back to Reticulate
        </button>
        <h1>Brain atlas</h1>
        <p>
          Where published brain-imaging studies report activity for each of the eight tendencies and for features of decisions, pooled across
          thousands of studies and people. It shows the research literature on the average brain. It is not a reading of you, it does not explain
          a choice, and nothing in your dialogue is drawn from it.
        </p>
      </header>

      {error ? (
        <p className="banner error">{error}</p>
      ) : !loaded ? (
        <p className="waiting" role="status">
          <span className="spinner" /> Loading the atlas…
        </p>
      ) : (
        <div className="atlas-grid">
          <aside className="atlas-pick">
            <h3 className="eyebrow">Tendencies</h3>
            <div className="chips">{constructs.map(chip)}</div>
            {features.length > 0 && (
              <>
                <h3 className="eyebrow">Features of a decision</h3>
                <div className="chips">{features.map(chip)}</div>
              </>
            )}
            {dimension && (
              <p className="note">
                <strong>{dimension.name}.</strong> {dimension.construct_map.note}{" "}
                <span className={`rc-tag ${dimension.construct_map.quality === "good" ? "good" : ""}`}>Map quality: {dimension.construct_map.quality}</span>
              </p>
            )}
            {feature && (
              <p className="note">
                <strong>{feature.name}.</strong> {feature.note}
              </p>
            )}
          </aside>
          <div className="atlas-brain">
            <Specimen
              renderer={loaded.renderer}
              atlas={loaded.atlas}
              networks={science.networks}
              layer="plain"
              overlay={overlay}
              threshold={threshold}
              onThreshold={setThreshold}
              legendExtra={<SourceSwitch value={shown} onChange={(c) => c !== "both" && setSource(c)} available={available} both={false} />}
            />
          </div>
        </div>
      )}
    </main>
  );
}
