import { useEffect, useState } from "react";
import { api } from "./api";
import { ClaudeDialog } from "./components/ClaudeDialog";
import { Mark } from "./components/Mark";
import type { Avatar, PersonalPattern, Science, Status } from "./types";
import { Site } from "./views/Site";

export function App() {
  const [science, setScience] = useState<Science | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [pattern, setPattern] = useState<PersonalPattern | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    Promise.all([api.science(), api.avatars(), api.status(), api.pattern()])
      .then(([s, a, st, p]) => {
        setScience(s);
        setAvatars(a);
        setStatus(st);
        setPattern(p);
      })
      .catch((e) => setError(`The Reticulate engine is not reachable (${e.message}). Start it with ./Reticulate.command.`));
  }, []);

  if (!science) {
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
        science={science}
        status={status}
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
