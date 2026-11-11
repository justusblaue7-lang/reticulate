import { useEffect, useState } from "react";
import { api } from "./api";
import { loadAtlas, type Atlas } from "./atlas/load";
import { BrainRenderer } from "./brain/renderer";
import { ClaudeDialog } from "./components/ClaudeDialog";
import type { Avatar, Science, Status } from "./types";
import { AtlasView } from "./views/AtlasView";
import { AvatarsView } from "./views/AvatarsView";
import { DecisionView } from "./views/DecisionView";

type Mode = "decide" | "avatars" | "atlas";

const MODES: { id: Mode; label: string }[] = [
  { id: "decide", label: "Decide" },
  { id: "avatars", label: "Avatars" },
  { id: "atlas", label: "Brain atlas" },
];

const modeFromHash = (): Mode => {
  const hash = location.hash.slice(1).split("/")[0];
  return MODES.some((m) => m.id === hash) ? (hash as Mode) : "decide";
};

export function App() {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [science, setScience] = useState<Science | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(modeFromHash);
  const [renderer, setRenderer] = useState<BrainRenderer | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    loadAtlas()
      .then(setAtlas)
      .catch((e) => setError(`Atlas assets missing (${e.message}). Build them with \`reticulate build-atlas\`.`));
    Promise.all([api.science(), api.avatars(), api.status()])
      .then(([s, a, st]) => {
        setScience(s);
        setAvatars(a);
        setStatus(st);
      })
      .catch((e) => setError(`The Reticulate engine is not reachable (${e.message}). Start it with ./Reticulate.command.`));
    const sync = () => setMode(modeFromHash());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  // One renderer for the whole app: the full-resolution brain is built once and its canvas
  // moves into whichever view shows it.
  useEffect(() => {
    if (!atlas) return;
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    document.body.appendChild(holder);
    setRenderer(new BrainRenderer(holder, atlas));
  }, [atlas]);

  const go = (m: Mode) => {
    setMode(m);
    history.pushState(null, "", `#${m}`);
    window.scrollTo({ top: 0 });
  };

  const ready = atlas && science && renderer;
  const connected = !!status?.claude.configured;

  return (
    <div className="app">
      <header className="masthead no-print">
        <button className="wordmark" onClick={() => go("decide")} title="Start a new decision">
          Reticulate
        </button>
        <nav className="modes" aria-label="Sections">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => go(m.id)}>
              {m.label}
            </button>
          ))}
        </nav>
        <button className={`claude-button ${connected ? "on" : ""}`} onClick={() => setConnecting(true)} disabled={!status}>
          <span className="dot" />
          {!status ? "Engine offline" : connected ? "Claude connected" : "Connect Claude"}
        </button>
      </header>

      {error && <p className="banner error">{error}</p>}
      {!ready && !error && <p className="loading">Loading Reticulate…</p>}

      {ready && mode === "decide" && (
        <DecisionView atlas={atlas} science={science} status={status} renderer={renderer} avatars={avatars} onConnect={() => setConnecting(true)} />
      )}
      {ready && mode === "avatars" && <AvatarsView atlas={atlas} science={science} renderer={renderer} avatars={avatars} onAvatars={setAvatars} />}
      {ready && mode === "atlas" && <AtlasView atlas={atlas} science={science} status={status} renderer={renderer} />}

      {connecting && <ClaudeDialog status={status} onStatus={setStatus} onClose={() => setConnecting(false)} />}
    </div>
  );
}
