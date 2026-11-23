import { useEffect, useRef, useState } from "react";
import { PUBLIC, api } from "../api";
import type { Status } from "../types";

interface Props {
  status: Status | null;
  onStatus: (status: Status) => void;
  onClose: () => void;
}

/** Connect Reticulate to Claude with the user's own Anthropic API key. */
export function ClaudeDialog({ status, onStatus, onClose }: Props) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const connected = !!status?.claude.configured;

  useEffect(() => {
    input.current?.focus();
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      onStatus(await api.connectClaude(key.trim()));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="claude-title">
        <h2 id="claude-title" className="dialog-title">
          {connected ? "Claude is connected" : "Connect Claude"}
        </h2>
        <p className="dialog-text">
          Reticulate uses Claude ({status?.claude.model ?? "claude-haiku-5-5"}) to read your decision and to let the panel reason
          about it. You pay Anthropic directly, and Reticulate shows what every step costs.
        </p>
        {connected ? (
          <>
            <p className="dialog-text">
              Key in use: <span className="mono">{status?.claude.key_hint ?? "from the environment"}</span>.{" "}
              {PUBLIC ? (
                <>It is kept in this browser only and sent to Anthropic with each request; Reticulate's server never stores it.</>
              ) : (
                <>
                  It is stored on this computer only, in <span className="mono">engine/.env</span>.
                </>
              )}
            </p>
            <div className="dialog-actions">
              <button
                className="button quiet"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    onStatus(await api.disconnectClaude());
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove the key
              </button>
              <button className="button primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) void connect();
            }}
          >
            <label className="dialog-label" htmlFor="claude-key">
              Anthropic API key
            </label>
            <input
              id="claude-key"
              ref={input}
              className="field mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <p className="dialog-hint">
              Create one at{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                console.anthropic.com
              </a>{" "}
              → API keys. Reticulate checks it with Anthropic and keeps it{" "}
              {PUBLIC ? (
                "in this browser only. Reticulate's server passes it to Anthropic with each request and never stores it."
              ) : (
                <>
                  on this computer, in <span className="mono">engine/.env</span>.
                </>
              )}
            </p>
            {error && <p className="error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="button quiet" onClick={onClose}>
                Not now
              </button>
              <button type="submit" className="button primary" disabled={busy || !key.trim()}>
                {busy ? "Checking the key…" : "Connect"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
