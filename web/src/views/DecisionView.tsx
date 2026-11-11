import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ref } from "../api";
import type { Atlas } from "../atlas/load";
import type { BrainRenderer } from "../brain/renderer";
import { AtPlay } from "../components/decision/AtPlay";
import { Brain } from "../components/decision/Brain";
import { Composer, Examples } from "../components/decision/Composer";
import { Conclusion } from "../components/decision/Conclusion";
import { DialogueThread, StageRail, type DialogueBusy } from "../components/decision/Dialogue";
import { estimate, observedPerCall, panelCalls, suggestPanel, TURN_USD, verdict } from "../components/decision/model";
import { Notes } from "../components/decision/Notes";
import { PanelProgress, PanelResult, PanelSetup } from "../components/decision/Panel";
import { Tipping } from "../components/decision/Tipping";
import { WatchOuts } from "../components/decision/WatchOuts";
import { Face } from "../components/Face";
import { usd } from "../format";
import type { Avatar, Decision, DecisionSummary, Problem, Progress, Rating, Science, Status } from "../types";

interface Props {
  atlas: Atlas;
  science: Science;
  status: Status | null;
  renderer: BrainRenderer;
  avatars: Avatar[];
  onConnect: () => void;
}

type Work = { kind: "start" | "open" | "save" | "panel" | "tipping" | "self"; label: string; since: number; id?: string };
type Tab = "dialogue" | "biases" | "panel" | "brain";

const TABS: { id: Tab; label: string }[] = [
  { id: "dialogue", label: "Dialogue" },
  { id: "biases", label: "Biases" },
  { id: "panel", label: "Other minds" },
  { id: "brain", label: "In the brain" },
];

const EMPTY: Problem = { question: "", context: "", options: [] };

const route = () => {
  const m = location.hash.match(/^#decide\/([0-9a-f]{8,})(?:\/(\w+))?/);
  const tab = TABS.some((t) => t.id === m?.[2]) ? (m![2] as Tab) : "dialogue";
  return { id: m?.[1] ?? null, tab };
};

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const newer = (a: Decision, b: Decision | null) => !b || b.id !== a.id || a.updated_at >= b.updated_at;

export function DecisionView({ atlas, science, status, renderer, avatars, onConnect }: Props) {
  const [archive, setArchive] = useState<DecisionSummary[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [draft, setDraft] = useState<Problem>(EMPTY);
  const [work, setWork] = useState<Work | null>(null);
  const [talk, setTalk] = useState<DialogueBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [talkError, setTalkError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [panelRun, setPanelRun] = useState<{ members: Avatar[]; replicates: number } | null>(null);
  const [tab, setTab] = useState<Tab>(route().tab);
  const current = useRef<Decision | null>(null);
  const configured = !!status?.claude.configured;
  current.current = decision;

  const refresh = useCallback(() => api.decisions().then(setArchive).catch(() => undefined), []);

  /** Apply a record from the engine, unless a newer one is already shown. */
  const apply = useCallback((d: Decision) => {
    if (current.current && current.current.id !== d.id) return;
    if (newer(d, current.current)) setDecision(d);
  }, []);

  const go = (id: string | null, next: Tab = "dialogue", push = true) => {
    if (push) history.pushState(null, "", id ? `#decide/${id}${next === "dialogue" ? "" : `/${next}`}` : "#decide");
    setTab(next);
  };

  const open = useCallback(async (id: string | null, next: Tab = "dialogue", push = true) => {
    if (push) history.pushState(null, "", id ? `#decide/${id}${next === "dialogue" ? "" : `/${next}`}` : "#decide");
    setError(null);
    setTalkError(null);
    setTab(next);
    if (!id) {
      setDecision(null);
      window.scrollTo({ top: 0 });
      return;
    }
    if (current.current?.id === id) return;
    setWork({ kind: "open", label: "Opening…", since: Date.now() });
    try {
      setDecision(await api.decision(id));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(message(e));
      history.replaceState(null, "", "#decide");
      setDecision(null);
    } finally {
      setWork((w) => (w?.kind === "open" ? null : w));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const { id, tab: t } = route();
    if (id) void open(id, t, false);
    const sync = () => {
      const r = route();
      if (r.id !== current.current?.id) void open(r.id, r.tab, false);
      else setTab(r.tab);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [refresh, open]);

  // Claude's analysis runs in the background after a decision starts; fetch it when it lands.
  useEffect(() => {
    if (decision?.analysis !== "pending") return;
    const id = decision.id;
    const timer = setInterval(() => {
      api
        .decision(id)
        .then((d) => {
          if (d.analysis !== "pending") {
            apply(d);
            void refresh();
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [decision?.id, decision?.analysis, apply, refresh]);

  // Live progress while the panel or a tipping run is in flight.
  useEffect(() => {
    if (!work?.id || (work.kind !== "panel" && work.kind !== "tipping")) return;
    const id = work.id;
    const poll = () =>
      api
        .progress(id)
        .then((p) => p && setProgress(p))
        .catch(() => undefined);
    const timer = setInterval(poll, 1000);
    void poll();
    return () => clearInterval(timer);
  }, [work?.id, work?.kind]);

  // A printed decision shows what the screen folds away.
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = [...document.querySelectorAll<HTMLDetailsElement>(".workspace details:not(.tech):not(.again)")].filter((d) => !d.open);
      opened.forEach((d) => (d.open = true));
    };
    const after = () => opened.forEach((d) => (d.open = false));
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const run = async (next: Omit<Work, "since">, call: () => Promise<Decision>) => {
    setWork({ ...next, since: Date.now() });
    setProgress(null);
    setError(null);
    try {
      apply(await call());
      void refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setWork(null);
      setProgress(null);
    }
  };

  // --- the dialogue ---------------------------------------------------------------------

  const speak = async (kind: "reply" | "conclude", id: string, answer: string | null, call: () => Promise<Decision>) => {
    setTalk({ kind, since: Date.now(), answer });
    setTalkError(null);
    try {
      apply(await call());
    } catch (e) {
      setTalkError(message(e));
      // The answer may have been saved before the call failed; show what the engine has.
      api.decision(id).then(apply).catch(() => undefined);
    } finally {
      setTalk(null);
      void refresh();
    }
  };

  const clean = (p: Problem): Problem => ({
    question: p.question.trim(),
    context: p.context.trim(),
    options: p.options.map((o) => o.trim()).filter(Boolean),
  });

  const start = async () => {
    setWork({ kind: "start", label: "Starting the dialogue", since: Date.now() });
    setError(null);
    try {
      const created = await api.createDecision(clean(draft));
      current.current = created;
      setDecision(created);
      setDraft(EMPTY);
      go(created.id);
      window.scrollTo({ top: 0 });
      setWork(null);
      void refresh();
      await speak("reply", created.id, null, () => api.reply(created.id, null));
    } catch (e) {
      setError(message(e));
      setWork(null);
    }
  };

  const selfRate = (anatomy: Rating[]) =>
    void (async () => {
      setWork({ kind: "self", label: "Mapping your answers", since: Date.now() });
      try {
        const created = await api.createDecision(clean(draft), anatomy);
        current.current = created;
        setDecision(created);
        setDraft(EMPTY);
        go(created.id, "biases");
        void refresh();
      } catch (e) {
        setError(message(e));
      } finally {
        setWork(null);
      }
    })();

  const convene = (members: Avatar[], replicates: number, neural: boolean) => {
    if (!decision) return;
    setPanelRun({ members, replicates });
    void run({ kind: "panel", label: "The panel is reasoning", id: decision.id }, () => api.convene(decision.id, members.map(ref), replicates, neural));
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this decision and its folder?")) return;
    await api.deleteDecision(id);
    if (decision?.id === id) void open(null);
    void refresh();
  };

  const spent = archive.reduce((sum, d) => sum + (d.cost_usd ?? 0), 0);
  const showHistory = archive.length > 0 || !!decision;

  return (
    <main className={`decide-app ${showHistory ? "" : "solo"}`}>
      {showHistory && (
        <aside className="history no-print">
          <button className="button primary new" onClick={() => void open(null)}>
            New decision
          </button>
          <h2 className="eyebrow">Your decisions</h2>
          <ul>
            {archive.map((d) => (
              <li key={d.id} className={decision?.id === d.id ? "on" : ""}>
                <button className="open" onClick={() => void open(d.id)}>
                  <span className="h-title">{d.title}</span>
                  <span className="h-meta">
                    {date(d.updated_at)} ·{" "}
                    {d.decided ? `Decided: ${d.decided}` : d.status === "in dialogue" ? `In dialogue · ${d.questions} question${d.questions === 1 ? "" : "s"}` : d.verdict ?? d.status}
                  </span>
                </button>
                <button className="remove" title="Delete" aria-label="Delete this decision" onClick={() => void remove(d.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="spend">
            {spent > 0 && <>{usd(spent)} spent on Claude · </>}saved in {status?.data_dir ?? "data"}/decisions
          </p>
        </aside>
      )}

      <div className="stage">
        {error && (
          <p className="banner error" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </p>
        )}

        {!decision ? (
          <div className="home">
            <header className="home-head">
              <h1>What are you deciding?</h1>
              <p>
                Think it through in a short Socratic dialogue. Reticulate asks one question at a time, built on decision science, until you
                know what you want, what you choose and what you will do first. You decide; it asks.
              </p>
            </header>
            <Composer
              science={science}
              configured={configured}
              problem={draft}
              onProblem={setDraft}
              busy={work?.kind === "start" || work?.kind === "self" ? work : null}
              onConnect={onConnect}
              onStart={() => void start()}
              onSelfRate={selfRate}
            />
            {!work && !draft.question && <Examples onPick={setDraft} />}
            <p className="science-strip">
              Questions follow the six elements of decision quality, with {science.socratic.moves.filter((m) => m.basis === "tested").length} of
              its moves and {science.mechanisms.filter((m) => m.countermove.basis === "tested").length} of its countermoves to biases tested in
              studies. Every claim cites its source; every decision is saved as a file you can read.
            </p>
          </div>
        ) : (
          <Workspace
            atlas={atlas}
            science={science}
            renderer={renderer}
            avatars={avatars}
            configured={configured}
            decision={decision}
            tab={tab}
            work={work}
            talk={talk}
            talkError={talkError}
            progress={progress}
            panelRun={panelRun}
            onTab={(t) => go(decision.id, t)}
            onConnect={onConnect}
            onAnswer={(answer) => void speak("reply", decision.id, answer, () => api.reply(decision.id, answer))}
            onSkip={() => void speak("reply", decision.id, null, () => api.reply(decision.id, null, true))}
            onConclude={(answer) => void speak("conclude", decision.id, answer, () => api.conclude(decision.id, answer))}
            onNext={() => void speak("reply", decision.id, null, () => api.reply(decision.id, null))}
            onRevise={(index) => void api.revise(decision.id, index).then(apply).catch((e) => setTalkError(message(e)))}
            onReopen={() => void api.reopen(decision.id).then(apply).catch((e) => setTalkError(message(e)))}
            onSettle={(items) => {
              setDecision({ ...decision, settled: items });
              void api.settle(decision.id, items).then(apply).catch((e) => setError(message(e)));
            }}
            onAnalyse={() => void api.analyse(decision.id).then(apply).catch((e) => setError(message(e)))}
            onConvene={convene}
            onSave={(anatomy) => void run({ kind: "save", label: "Saving the ratings", id: decision.id }, () => api.updateAnatomy(decision.id, anatomy))}
            onTipping={(profile, key, values, replicates) =>
              void run({ kind: "tipping", label: "Testing the tipping point", id: decision.id }, () => api.tipping(decision.id, profile, [key], values, replicates))
            }
            onReveal={() => void api.reveal(decision.id).catch((e) => setError(message(e)))}
            onDelete={() => void remove(decision.id)}
            onRestart={() => {
              setDraft(decision.problem);
              void open(null);
            }}
          />
        )}
      </div>
    </main>
  );
}

interface WorkspaceProps {
  atlas: Atlas;
  science: Science;
  renderer: BrainRenderer;
  avatars: Avatar[];
  configured: boolean;
  decision: Decision;
  tab: Tab;
  work: Work | null;
  talk: DialogueBusy;
  talkError: string | null;
  progress: Progress | null;
  panelRun: { members: Avatar[]; replicates: number } | null;
  onTab: (tab: Tab) => void;
  onConnect: () => void;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
  onConclude: (answer: string | null) => void;
  onNext: () => void;
  onRevise: (index: number) => void;
  onReopen: () => void;
  onSettle: (items: string[]) => void;
  onAnalyse: () => void;
  onConvene: (members: Avatar[], replicates: number, neural: boolean) => void;
  onSave: (anatomy: Rating[]) => void;
  onTipping: (profile: string | Avatar, key: string, values: number[], replicates: number) => void;
  onReveal: () => void;
  onDelete: () => void;
  onRestart: () => void;
}

function Sheet({ title, lede, children }: { title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section className="sheet">
      <header className="sheet-head">
        <h2>{title}</h2>
        {lede && <p>{lede}</p>}
      </header>
      {children}
    </section>
  );
}

function Waiting({ decision, onAnalyse, configured, onConnect }: { decision: Decision; onAnalyse: () => void; configured: boolean; onConnect: () => void }) {
  if (decision.analysis === "pending") {
    return (
      <p className="waiting" role="status">
        <span className="spinner" /> Reticulate is reading your decision for documented biases and the research behind them. This takes about a
        minute and runs while you talk.
      </p>
    );
  }
  if (decision.analysis === "failed") {
    return (
      <div className="dialogue-error">
        <p>The analysis did not finish: {decision.analysis_error}</p>
        <button className="button" onClick={configured ? onAnalyse : onConnect}>
          {configured ? "Try again" : "Connect Claude"}
        </button>
      </div>
    );
  }
  return (
    <div className="waiting">
      <p>Claude has not analysed this decision yet. One call, about $0.08.</p>
      <button className="button" onClick={configured ? onAnalyse : onConnect}>
        {configured ? "Analyse it" : "Connect Claude"}
      </button>
    </div>
  );
}

function Workspace(props: WorkspaceProps) {
  const { atlas, science, renderer, avatars, configured, decision, tab, work, talk, progress, panelRun, onTab, onConnect } = props;
  const dialogue = decision.dialogue;
  const panel = decision.panel;
  const panelBusy = work?.kind === "panel" && work.id === decision.id;
  const analysed = decision.analysis === "done" || decision.anatomy.some((r) => r.level > 0);
  const biases = decision.signature.mechanisms.filter((m) => m.level >= 2).length || decision.signature.mechanisms.length;
  const suggested = useMemo(() => suggestPanel(avatars, decision, science), [avatars, decision, science]);
  const suggestedAvatars = suggested.map((id) => avatars.find((a) => a.id === id)).filter((a): a is Avatar => !!a);
  const quick = estimate(panelCalls(decision, suggestedAvatars.length, 2), observedPerCall(decision));
  const title = dialogue?.exchanges.at(-1)?.turn.notes.decision || decision.frame?.decision || decision.problem.question;
  const usage = decision.usage;
  const model = decision.dialogue?.meta.model ?? decision.meta.model;
  const v = panel ? verdict(panel) : null;
  const profiles = new Map(panel?.profiles.map((p) => [p.id, p]) ?? []);

  const download = () => {
    const blob = new Blob([JSON.stringify(decision, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `reticulate-decision-${decision.created_at.slice(0, 10)}-${decision.id.slice(0, 6)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const otherMinds = (
    <section className="minds">
      <h3 className="eyebrow">Other minds</h3>
      {panelBusy ? (
        <>
          <p className="note">
            {panelRun?.members.length ?? 0} simulated decision-makers are reasoning it through{progress ? ` · ${progress.done} of ${progress.total} calls` : ""}. Keep
            talking; their reasons join the dialogue when they are done.
          </p>
          <div className="minds-faces">
            {(panelRun?.members ?? []).map((a) => (
              <span key={a.id} className={(progress?.labels[a.id] ?? 0) >= (panelRun?.replicates ?? 1) ? "answered" : "waiting"}>
                <Face avatar={a} size={34} />
              </span>
            ))}
          </div>
        </>
      ) : v ? (
        <>
          <p className="minds-verdict">{v.statement}</p>
          <div className="minds-faces">
            {v.ranked
              .filter((r) => r.ids.length)
              .flatMap((r) => r.ids)
              .map((id) => (
                <Face key={id} avatar={profiles.get(id)!} size={34} />
              ))}
          </div>
          <p className="note">{dialogue?.pending.length ? "Their reasons go along with your next answer." : "Their reasons are part of the dialogue."}</p>
          <button className="text-button" onClick={() => onTab("panel")}>
            Read their reasoning
          </button>
        </>
      ) : (
        <>
          <p className="note">
            {suggestedAvatars.length} simulated decision-makers with different temperaments reason through your decision. What they weigh differently
            comes back into the dialogue as a question for you.
          </p>
          <div className="minds-faces">
            {suggestedAvatars.map((a) => (
              <Face key={a.id} avatar={a} size={34} />
            ))}
          </div>
          {configured ? (
            <button className="button small" disabled={!!work} onClick={() => props.onConvene(suggestedAvatars, 2, true)}>
              Ask them · about {usd(quick.usd)}, {quick.minutes} min
            </button>
          ) : (
            <button className="button small" onClick={onConnect}>
              Connect Claude
            </button>
          )}
        </>
      )}
    </section>
  );

  const biasHint =
    decision.analysis === "pending" ? (
      <section className="hint">
        <h3 className="eyebrow">Biases</h3>
        <p className="note">
          <span className="spinner tiny" /> Looking for documented biases in your decision…
        </p>
      </section>
    ) : decision.watch_outs.length || biases ? (
      <section className="hint">
        <h3 className="eyebrow">Biases</h3>
        <p className="note">
          {biases} documented {biases === 1 ? "bias" : "biases"} could pull on this decision:{" "}
          {decision.signature.mechanisms
            .slice(0, 3)
            .map((m) => science.mechanisms.find((x) => x.id === m.mechanism_id)?.name.toLowerCase())
            .join(", ")}
          .
        </p>
        <button className="text-button" onClick={() => onTab("biases")}>
          What to do about them
        </button>
      </section>
    ) : null;

  return (
    <div className="workspace">
      <div className="dbar no-print">
        <div className="dbar-title" title={title}>
          {title}
        </div>
        <nav className="dbar-nav" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => onTab(t.id)}>
              {t.label}
              {t.id === "biases" && decision.analysis === "pending" && <span className="spinner tiny" />}
              {t.id === "biases" && decision.analysis !== "pending" && biases > 0 && <span className="count">{biases}</span>}
              {t.id === "panel" && panelBusy && <span className="spinner tiny" />}
            </button>
          ))}
        </nav>
        {work && (work.kind === "save" || work.kind === "open") && (
          <span className="dbar-status">
            <span className="spinner tiny" /> {work.label}
          </span>
        )}
      </div>

      {tab === "dialogue" && (
        <div className="talk">
          <div className="talk-main">
            <p className="eyebrow">
              Your decision · {date(decision.created_at)}
              {dialogue ? ` · ${dialogue.exchanges.length} question${dialogue.exchanges.length === 1 ? "" : "s"}` : ""}
            </p>
            <h1 className="decision-title">{decision.problem.question}</h1>
            {decision.problem.options.length > 0 && (
              <div className="options-row">
                {decision.problem.options.map((o, i) => (
                  <span key={o} className="option-pill">
                    <b>{String.fromCharCode(65 + i)}</b>
                    {o}
                  </span>
                ))}
              </div>
            )}
            {dialogue && <StageRail science={science} decision={decision} />}
            {dialogue?.conclusion && (
              <Conclusion
                science={science}
                decision={decision}
                busy={!!talk}
                onSettle={props.onSettle}
                onReopen={props.onReopen}
                onPanel={() => onTab("panel")}
                onReveal={props.onReveal}
              />
            )}
            {dialogue ? (
              dialogue.conclusion ? (
                <details className="transcript">
                  <summary>The dialogue · {dialogue.exchanges.length} questions</summary>
                  <DialogueThread
                    science={science}
                    decision={decision}
                    busy={talk}
                    error={props.talkError}
                    configured={configured}
                    onAnswer={props.onAnswer}
                    onSkip={props.onSkip}
                    onConclude={props.onConclude}
                    onRevise={props.onRevise}
                    onRetry={props.onNext}
                    onConnect={onConnect}
                  />
                </details>
              ) : (
                <DialogueThread
                  science={science}
                  decision={decision}
                  busy={talk}
                  error={props.talkError}
                  configured={configured}
                  onAnswer={props.onAnswer}
                  onSkip={props.onSkip}
                  onConclude={props.onConclude}
                  onRevise={props.onRevise}
                  onRetry={props.onNext}
                  onConnect={onConnect}
                />
              )
            ) : (
              <div className="start-dialogue">
                <p>
                  Think this decision through in a Socratic dialogue: one question at a time, until your decision and your first step are clear.
                  About {usd(TURN_USD)} a question.
                </p>
                {configured ? (
                  <button className="button primary" disabled={!!talk} onClick={props.onNext}>
                    Start the dialogue
                  </button>
                ) : (
                  <button className="button primary" onClick={onConnect}>
                    Connect Claude to start
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="talk-side no-print">
            <Notes notes={dialogue?.exchanges.at(-1)?.turn.notes} />
            {otherMinds}
            {biasHint}
          </div>
        </div>
      )}

      {tab === "biases" && (
        <>
          <Sheet title="Watch out for" lede="Documented mechanisms that decisions like yours engage, how each could pull on you, and what to do about it.">
            {analysed ? <WatchOuts science={science} decision={decision} /> : <Waiting decision={decision} onAnalyse={props.onAnalyse} configured={configured} onConnect={onConnect} />}
          </Sheet>
          {analysed && (
            <Sheet
              title="What's at play"
              lede={
                decision.anatomy.some((r) => r.source === "model")
                  ? "The features of your decision that research links to how people decide, rated by Claude from your description. Correct anything that is off; the watch-outs and the brain map follow."
                  : "The features of your decision that research links to how people decide, as you rated them."
              }
            >
              <AtPlay science={science} decision={decision} busy={!!work} onSave={props.onSave} />
            </Sheet>
          )}
        </>
      )}

      {tab === "panel" && (
        <>
          <Sheet
            title="Other minds"
            lede="Simulated decision-makers reason through your decision, each from its own tendencies, personality and values. Their reasons come back into your dialogue as a perspective to question; none of them predicts what a real person would do."
          >
            {panelBusy ? (
              <PanelProgress progress={progress} members={panelRun?.members ?? []} replicates={panelRun?.replicates ?? 1} since={work!.since} />
            ) : panel ? (
              <>
                <PanelResult science={science} decision={decision} />
                <details className="again no-print">
                  <summary>Ask a different panel</summary>
                  <PanelSetup science={science} decision={decision} avatars={avatars} configured={configured} onConvene={props.onConvene} onConnect={onConnect} again />
                </details>
              </>
            ) : (
              <PanelSetup science={science} decision={decision} avatars={avatars} configured={configured} onConvene={props.onConvene} onConnect={onConnect} />
            )}
          </Sheet>
          <Sheet
            title="What would flip it"
            lede="Would a different temperament change the answer? Reticulate re-runs one person with a single tendency changed and everything else held fixed."
          >
            <Tipping
              science={science}
              decision={decision}
              configured={configured}
              busy={!!work}
              running={work?.kind === "tipping" && work.id === decision.id ? { progress, since: work.since } : null}
              onRun={props.onTipping}
              onConnect={onConnect}
            />
          </Sheet>
        </>
      )}

      {tab === "brain" && (
        <Sheet title="In the brain" lede="What brain-imaging research reports for decisions with these features.">
          {analysed ? <Brain atlas={atlas} science={science} renderer={renderer} decision={decision} /> : <Waiting decision={decision} onAnalyse={props.onAnalyse} configured={configured} onConnect={onConnect} />}
        </Sheet>
      )}

      <footer className="record">
        <div className="record-meta">
          <span>{model ? `Claude ${model}` : decision.dialogue ? "Claude" : "Rated by you"}</span>
          {decision.dialogue && <span>dialogue prompts {decision.dialogue.meta.prompt_version}</span>}
          <span>science {decision.meta.science_version}</span>
          <span>{usage.calls ? `${usage.calls} Claude call${usage.calls === 1 ? "" : "s"} · ${usd(usage.cost_usd)} at list price` : "No Claude calls"}</span>
        </div>
        <p className="notice">{panel ? decision.notice : "Reticulate asks; you decide. Nothing here is financial, legal or medical advice."}</p>
        <div className="record-actions no-print">
          <button className="button" onClick={props.onReveal}>
            Show in folder
          </button>
          <button className="button quiet" onClick={() => window.print()}>
            Print or save as PDF
          </button>
          <button className="button quiet" onClick={download}>
            Download the record
          </button>
          <button className="button quiet" onClick={props.onRestart}>
            New decision from this question
          </button>
          <button className="button quiet danger" onClick={props.onDelete}>
            Delete
          </button>
        </div>
      </footer>
    </div>
  );
}
