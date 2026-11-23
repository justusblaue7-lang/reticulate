import { useState } from "react";
import type { Decision, Science } from "../types";

/** Download the whole decision as a PDF: decision, review page, dialogue, biases, minds. */
export function PdfButton({ science, decision, className = "button" }: { science: Science; decision: Decision; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const { downloadRecord } = await import("./pdf");
      await downloadRecord(science, decision);
    } catch (e) {
      setError(`The PDF could not be made (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className={className} onClick={make} disabled={busy} title="The whole decision as a PDF: what you decided, a page for the review, the dialogue, the biases and the minds">
        {busy ? "Making the PDF…" : "Download PDF"}
      </button>
      {error && (
        <span className="pdf-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
