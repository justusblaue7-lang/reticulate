import { SOURCE_LABEL, SOURCE_LINE } from "../format";
import type { Source } from "../types";

export type Choice = Source | "both";

/** Which literature source a brain map shows: NeuroQuery, Neurosynth, or where both agree. */
export function SourceSwitch({
  value,
  onChange,
  available,
  both = true,
}: {
  value: Choice;
  onChange: (c: Choice) => void;
  available: Record<Source, boolean>;
  both?: boolean;
}) {
  const choices = both ? (["neuroquery", "neurosynth", "both"] as const) : (["neuroquery", "neurosynth"] as const);
  return (
    <div className="source-switch no-print">
      <div className="segmented" role="group" aria-label="Source">
        {choices.map((c) => {
          const ok = c === "both" ? available.neuroquery && available.neurosynth : available[c];
          return (
            <button
              key={c}
              className={value === c ? "on" : ""}
              disabled={!ok}
              title={ok ? SOURCE_LINE[c] : c === "both" ? "Needs both sources" : `${SOURCE_LABEL[c]} has no term for this`}
              onClick={() => onChange(c)}
            >
              {c === "both" ? "Agreement" : SOURCE_LABEL[c]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
