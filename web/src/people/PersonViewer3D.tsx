import { useEffect, useRef, useState } from "react";
import type { PersonStyle } from "../types";
import { loadCatalogue } from "./catalogue";
import { FRAMES, PersonStage, type Framing } from "./stage";

export interface ViewerProps {
  look: string | null | undefined;
  style?: PersonStyle | null; // how the person is changed; updates live
  poster?: string | null; // a still to show until the 3D is ready (else the built portrait)
  name?: string;
  framing?: Framing;
  className?: string;
  controls?: boolean;
  onMeasure?: (height: number) => void; // the person's built height, in metres
}

/** A person in 3D: drag to turn them, scroll or use the buttons to come closer. Loaded on demand
 * by PersonViewer, which shows the portrait until then. */
export default function PersonViewer3D({ look, style, poster, name, framing = "full", className = "", controls = true, onMeasure }: ViewerProps) {
  const holder = useRef<HTMLDivElement>(null);
  const stage = useRef<PersonStage | null>(null);
  const latest = useRef({ style, onMeasure });
  latest.current = { style, onMeasure };
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [frame, setFrame] = useState<Framing>(framing);

  useEffect(() => {
    if (!holder.current) return;
    const s = new PersonStage(holder.current, { zoom: FRAMES[framing] });
    stage.current = s;
    return () => {
      s.dispose();
      stage.current = null;
    };
    // The stage lives as long as the viewer; framing changes go through setZoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    if (!look) {
      setState("missing");
      return;
    }
    loadCatalogue()
      .then((people) => {
        const asset = people.find((p) => p.look === look);
        if (!asset) throw new Error("not built");
        return stage.current?.show(asset, latest.current.style ?? null);
      })
      .then(() => {
        if (cancelled) return;
        setState("ready");
        const height = stage.current?.builtHeight;
        if (height) latest.current.onMeasure?.(height);
      })
      .catch(() => !cancelled && setState("missing"));
    return () => {
      cancelled = true;
    };
  }, [look]);

  useEffect(() => {
    stage.current?.restyle(style ?? null);
  }, [style]);

  const go = (f: Framing) => {
    setFrame(f);
    stage.current?.setZoom(FRAMES[f]);
  };

  return (
    <div className={`person-viewer ${className} ${state}`}>
      <div className="person-stage" ref={holder} title={state === "ready" ? "Drag to turn, scroll to come closer" : undefined} />
      {state === "loading" && look && <img className="person-poster" src={poster ?? `/people/${look}/portrait.webp`} alt="" aria-hidden />}
      {state === "loading" && <span className="person-wait">Loading {name ?? "this person"}…</span>}
      {state === "missing" && (
        <span className="person-wait">
          {look ? "This person's 3D model is not built yet (tools/people/build.py)." : "No look chosen yet."}
        </span>
      )}
      {controls && state === "ready" && (
        <div className="person-controls" role="group" aria-label="View">
          {(["full", "bust", "face"] as Framing[]).map((f) => (
            <button key={f} className={frame === f ? "on" : ""} onClick={() => go(f)}>
              {f === "full" ? "Figure" : f === "bust" ? "Bust" : "Face"}
            </button>
          ))}
          <span className="person-hint">Drag to turn</span>
        </div>
      )}
    </div>
  );
}
