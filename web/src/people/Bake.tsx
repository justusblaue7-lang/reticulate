// /?people-bake renders every person's stills (face.webp, portrait.webp) with the same stage
// as the 3D viewer. tools/people/bake.py opens this page in headless Chrome, collects the
// images from window.__stills and writes them into web/public/people.

import { useEffect, useRef, useState } from "react";
import { loadCatalogue } from "./model";
import { PersonStage } from "./stage";

declare global {
  interface Window {
    __stills?: Record<string, { face: string; portrait: string }>;
    __bakeDone?: boolean;
  }
}

export function Bake() {
  const holder = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const only = new URLSearchParams(location.search).get("only")?.split(",");
    const stage = new PersonStage(holder.current!, { interactive: false, idle: false });
    window.__stills = {};
    (async () => {
      for (const asset of await loadCatalogue()) {
        if (only && !only.includes(asset.look)) continue;
        await stage.show(asset);
        window.__stills![asset.look] = {
          face: stage.snapshot(320, 320, 1, 0.38),
          portrait: stage.snapshot(480, 600, 0.62, 0.3),
        };
        setLog((l) => [...l, asset.look]);
      }
      window.__bakeDone = true;
    })().catch((e) => {
      setLog((l) => [...l, `error: ${e}`]);
      window.__bakeDone = true;
    });
    return () => stage.dispose();
  }, []);

  return (
    <div style={{ padding: 20, color: "#f3ecdc", fontFamily: "monospace" }}>
      <div ref={holder} style={{ width: 480, height: 600 }} />
      <p>{log.join(" · ")}</p>
    </div>
  );
}
