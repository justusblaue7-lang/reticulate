import { shortCite } from "../format";
import type { Science } from "../types";

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
