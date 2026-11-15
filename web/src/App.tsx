import { useEffect, useState } from "react";
import { api } from "./api";
import { loadAtlas, type Atlas } from "./atlas/load";
import { BrainRenderer } from "./brain/renderer";
import { ClaudeDialog } from "./components/ClaudeDialog";
import { Mark } from "./components/Mark";
import type { Avatar, PersonalPattern, Science, Status } from "./types";
import { Site } from "./views/Site";

export function App() {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [science, setScience] = useState<Science | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [pattern, setPattern] = useState<PersonalPattern | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<BrainRenderer | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    loadAtlas()
      .then(setAtlas)
      .catch((e) => setError(`Atlas assets missing (${e.message}). Build them with \`reticulate build-atlas\`.`));
    Promise.all([api.science(), api.avatars(), api.status(), api.pattern()])
      .then(([s, a, st, p]) => {
        setScience(s);
        setAvatars(a);
        setStatus(st);
        setPattern(p);
      })
      .catch((e) => setError(`The Reticulate engine is not reachable (${e.message}). Start it with ./Reticulate.command.`));
  }, []);

  // One renderer for the whole site: the full-resolution brain is built once and its canvas
  // moves into whichever view shows it.
  useEffect(() => {
    if (!atlas) return;
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    document.body.appendChild(holder);
    setRenderer(new BrainRenderer(holder, atlas));
  }, [atlas]);

  if (!atlas || !science || !renderer) {
    return (
      <div className="boot">
        <img className="boot-art" src="/art/marble-head-sm.webp" alt="" />
        <Mark size={40} />
        {error ? <p className="banner error">{error}</p> : <p>Loading Reticulate…</p>}
      </div>
    );
  }

  return (
    <>
      <Site
        atlas={atlas}
        science={science}
        status={status}
        renderer={renderer}
        avatars={avatars}
        onAvatars={setAvatars}
        pattern={pattern}
        onPattern={setPattern}
        onConnect={() => setConnecting(true)}
      />
      {connecting && <ClaudeDialog status={status} onStatus={setStatus} onClose={() => setConnecting(false)} />}
    </>
  );
}
