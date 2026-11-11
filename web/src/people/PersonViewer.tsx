import { useEffect, useRef, useState } from "react";
import { loadCatalogue } from "./model";
import { FRAMES, PersonStage, type Framing } from "./stage";

interface Props {
  look: string | null | undefined;
  name?: string;
  framing?: Framing;
  className?: string;
  controls?: boolean;
}

/** A person in 3D: drag to turn them, scroll or use the buttons to come closer. */
export function PersonViewer({ look, name, framing = "full", className = "", controls = true }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const stage = useRef<PersonStage | null>(null);
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
        return stage.current?.show(asset);
      })
      .then(() => !cancelled && setState("ready"))
      .catch(() => !cancelled && setState("missing"));
    return () => {
      cancelled = true;
    };
  }, [look]);

  const go = (f: Framing) => {
    setFrame(f);
    stage.current?.setZoom(FRAMES[f]);
  };

  return (
    <div className={`person-viewer ${className} ${state}`}>
      <div className="person-stage" ref={holder} title={state === "ready" ? "Drag to turn, scroll to come closer" : undefined} />
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
