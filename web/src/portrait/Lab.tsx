// Development view: every avatar's cameo at several sizes (open /?cameo-lab).

import { useEffect, useState } from "react";
import { api } from "../api";
import type { Avatar } from "../types";
import { Cameo } from "./Cameo";

export function Lab() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  useEffect(() => void api.avatars().then(setAvatars), []);
  return (
    <div style={{ background: "#0a1530", minHeight: "100vh", padding: 24, color: "#f3ecdc", display: "flex", flexWrap: "wrap", gap: 22 }}>
      {avatars.map((a) => (
        <figure key={a.id} style={{ margin: 0, width: 230, textAlign: "center" }}>
          {a.phenotype && <Cameo phenotype={a.phenotype} size={270} />}
          <figcaption style={{ fontSize: 12, marginTop: 6 }}>
            {a.name}
            <br />
            <span style={{ opacity: 0.6 }}>
              {a.phenotype?.age} · {a.phenotype?.hair} · {a.phenotype?.attire}
            </span>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 6 }}>
              {a.phenotype && <Cameo phenotype={a.phenotype} size={56} />}
              {a.phenotype && <Cameo phenotype={a.phenotype} size={40} />}
            </div>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
