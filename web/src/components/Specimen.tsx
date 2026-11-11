import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Atlas } from "../atlas/load";
import { VIEW_LABELS, type BaseLayer, type BrainRenderer, type Hit, type Surface, type View } from "../brain/renderer";
import { overlayCSS } from "../colors";
import type { Network } from "../types";

export interface OverlaySpec {
  id: string;
  values: Float32Array;
  max: number;
  title: string; // e.g. "Stimulus · A risky gamble"
  source: string; // provenance line
  unit?: string; // what the colour encodes, e.g. "NeuroQuery z"
  fire: number; // change to replay the reveal
}

interface Props {
  renderer: BrainRenderer;
  atlas: Atlas;
  networks: Network[];
  layer: BaseLayer;
  onLayer?: (layer: BaseLayer) => void;
  overlay: OverlaySpec | null;
  threshold: number;
  onThreshold: (z: number) => void;
  hover?: number;
  selected?: number;
  onHover?: (hit: Hit | null) => void;
  onSelect?: (hit: Hit | null) => void;
  figure?: string; // e.g. "Fig. 1"
  legendExtra?: ReactNode; // a source switch, for example
  compact?: boolean; // fewer controls for small embeds
  bare?: boolean; // only the brain and its colour scale, for narrow previews
}

const VIEWS: [View, string][] = [
  ["lh-lateral", "L lat"],
  ["lh-medial", "L med"],
  ["rh-lateral", "R lat"],
  ["rh-medial", "R med"],
  ["dorsal", "Dors"],
  ["ventral", "Vent"],
  ["anterior", "Ant"],
  ["posterior", "Post"],
];

const SCALE_STEPS = [5, 10, 20, 50];

/** One view onto the shared brain renderer: it moves the canvas here while mounted. */
export function Specimen(props: Props) {
  const { renderer } = props;
  const host = useRef<HTMLDivElement>(null);
  const scaleBar = useRef<HTMLDivElement>(null);
  const scaleLabel = useRef<HTMLSpanElement>(null);
  const compass = useRef<SVGSVGElement>(null);
  const [state, setState] = useState<{ surface: Surface; view: View; deep: boolean }>({
    surface: renderer.surface,
    view: renderer.view,
    deep: renderer.deepMode,
  });
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    renderer.attach(host.current!);
    renderer.onHover((hit) => callbacks.current.onHover?.(hit));
    renderer.onClick((hit) => callbacks.current.onSelect?.(hit));
    const stop = renderer.onFrame(() => {
      // Scale bar: the largest round length that fits in ~130 px.
      const ppm = renderer.pixelsPerMm();
      const mm = [...SCALE_STEPS].reverse().find((s) => s * ppm <= 130) ?? SCALE_STEPS[0];
      if (scaleBar.current) scaleBar.current.style.width = `${mm * ppm}px`;
      if (scaleLabel.current) scaleLabel.current.textContent = `${mm} mm`;
      // Orientation: anatomical axes as seen from the camera.
      const svg = compass.current;
      if (svg) {
        for (const [key, [x, y]] of Object.entries(renderer.screenAxes())) {
          const line = svg.querySelector<SVGLineElement>(`[data-axis="${key}"]`);
          const label = svg.querySelector<SVGTextElement>(`[data-label="${key}"]`);
          const visible = Math.hypot(x, y) > 0.18;
          line?.setAttribute("x2", String(28 + x * 17));
          line?.setAttribute("y2", String(28 + y * 17));
          line?.setAttribute("opacity", visible ? "1" : "0");
          label?.setAttribute("x", String(28 + x * 24));
          label?.setAttribute("y", String(28 + y * 24));
          label?.setAttribute("opacity", visible ? "1" : "0");
        }
      }
      setState((s) =>
        s.surface === renderer.surface && s.view === renderer.view && s.deep === renderer.deepMode
          ? s
          : { surface: renderer.surface, view: renderer.view, deep: renderer.deepMode },
      );
    });
    return () => {
      stop();
      renderer.onHover(() => undefined);
      renderer.onClick(() => undefined);
    };
  }, [renderer]);

  useEffect(() => renderer.setBaseLayer(props.layer), [renderer, props.layer]);
  useEffect(() => renderer.setHover(props.hover ?? -1), [renderer, props.hover]);
  useEffect(() => renderer.setSelected(props.selected ?? -1), [renderer, props.selected]);
  useEffect(() => renderer.setThreshold(props.threshold), [renderer, props.threshold]);
  useEffect(() => {
    renderer.setOverlay(props.overlay?.values ?? null, props.overlay?.max, !!props.overlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, props.overlay?.id, props.overlay?.fire, props.overlay?.values]);

  const overlay = props.overlay;
  const exportFigure = () => {
    const link = document.createElement("a");
    link.href = renderer.exportPNG(3);
    link.download = `reticulate-${overlay?.id ?? props.layer}-${state.view}.png`;
    link.click();
  };

  const layerLine = overlay
    ? overlay.source
    : props.layer === "networks"
      ? "Seven cortical networks (Yeo et al., 2011)"
      : props.layer === "regions"
        ? "Desikan–Killiany parcellation (Desikan et al., 2006)"
        : "fsaverage template surface";

  return (
    <div className={`specimen ${props.compact || props.bare ? "compact" : ""} ${props.bare ? "bare" : ""}`}>
      <div className="specimen-canvas" ref={host} />

      <div className="caption" hidden={props.bare}>
        <div className="label">
          {props.figure ? `${props.figure} · ` : ""}
          {state.deep ? "Deep structures" : VIEW_LABELS[state.view]} · {state.surface}
        </div>
        {overlay && <div className="caption-title">{overlay.title}</div>}
        <div className="caption-source">{layerLine}</div>
      </div>

      <div className="controls" hidden={props.bare}>
        <div className="segmented" role="group" aria-label="Surface">
          {(["pial", "inflated"] as const).map((s) => (
            <button key={s} className={state.surface === s && !state.deep ? "on" : ""} onClick={() => renderer.setSurface(s)}>
              {s === "pial" ? "Pial" : "Inflated"}
            </button>
          ))}
          <button className={state.deep ? "on" : ""} onClick={() => renderer.setDeep(!state.deep)} title="Subcortical nuclei, cerebellum, brainstem">
            Deep
          </button>
        </div>
        <div className="segmented" role="group" aria-label="View">
          {(props.compact ? VIEWS.filter(([v]) => v.endsWith("lateral") || v === "lh-medial" || v === "ventral") : VIEWS).map(([v, label]) => (
            <button key={v} className={state.view === v ? "on" : ""} onClick={() => renderer.setView(v)} title={VIEW_LABELS[v]}>
              {label}
            </button>
          ))}
        </div>
        {props.onLayer && !overlay && (
          <div className="segmented" role="group" aria-label="Layer">
            {(["plain", "regions", "networks"] as const).map((l) => (
              <button key={l} className={props.layer === l ? "on" : ""} onClick={() => props.onLayer!(l)}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="scale" hidden={props.bare}>
        <svg ref={compass} width="56" height="56" viewBox="0 0 56 56" aria-hidden>
          <circle cx="28" cy="28" r="1.8" fill="var(--cream)" />
          {(["R", "A", "S"] as const).map((k) => (
            <g key={k}>
              <line data-axis={k} x1="28" y1="28" x2="28" y2="28" stroke="var(--cream-2)" strokeWidth="1" />
              <text data-label={k} x="28" y="28" className="compass-label" textAnchor="middle" dominantBaseline="middle">
                {k}
              </text>
            </g>
          ))}
        </svg>
        <div>
          <div className="scale-bar" ref={scaleBar} />
          <span className="label" ref={scaleLabel} />
        </div>
      </div>

      <div className="legend">
        {!props.bare && props.legendExtra}
        {overlay ? (
          <div className="colorbar">
            <div className="label">
              {overlay.unit ?? "z"} · shown from {props.threshold.toFixed(1)}
            </div>
            <div className="colorbar-ramp" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(overlayCSS).join(",")})` }} />
            <div className="colorbar-ticks mono">
              <span>{props.threshold.toFixed(1)}</span>
              <span>{((props.threshold + overlay.max) / 2).toFixed(1)}</span>
              <span>≥ {overlay.max.toFixed(1)}</span>
            </div>
            <label className="threshold no-print" hidden={props.compact}>
              <span className="label">Threshold</span>
              <input
                type="range"
                min={1.96}
                max={Math.max(4, overlay.max - 0.5)}
                step={0.1}
                value={props.threshold}
                onChange={(e) => props.onThreshold(Number(e.target.value))}
              />
            </label>
          </div>
        ) : props.layer === "networks" ? (
          <ul className="network-legend">
            {props.atlas.geometry.networks.map((n) => (
              <li key={n.index}>
                <span className="swatch" style={{ background: n.color }} />
                {props.networks.find((x) => x.index === n.index)?.name ?? n.id}
              </li>
            ))}
          </ul>
        ) : null}
        <button className="text-button no-print" hidden={props.bare} onClick={exportFigure} title="Transparent PNG at 3× resolution">
          Export figure
        </button>
      </div>
    </div>
  );
}
