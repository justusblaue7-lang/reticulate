import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ref } from "../api";
import type { Atlas } from "../atlas/load";
import type { BrainRenderer } from "../brain/renderer";
import { AtPlay } from "../components/decision/AtPlay";
import { Brain } from "../components/decision/Brain";
import { Composer, Examples } from "../components/decision/Composer";
import { Homework } from "../components/decision/Homework";
import { estimate, engagedDimensions, observedPerCall, panelCalls, suggestPanel, verdict } from "../components/decision/model";
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

type Busy = { kind: "analyse" | "open" | "save" | "panel" | "tipping"; label: string; since: number; id?: string };

const EMPTY: Problem = { question: "", context: "", options: [] };

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "at-play", label: "What's at play" },
  { id: "watch", label: "Watch out for" },
  { id: "brain", label: "In the brain" },
  { id: "panel", label: "The panel" },
  { id: "homework", label: "Before you decide" },
  { id: "tipping", label: "Tipping points" },
] as const;

const idFromHash = () => location.hash.match(/^#decide\/([0-9a-f]{8,})/)?.[1] ?? null;

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Sheet({ id, title, lede, children }: { id: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="sheet">
      <header className="sheet-head">
        <h2>{title}</h2>
        {lede && <p>{lede}</p>}
      </header>
      {children}
    </section>
  );
}

export function DecisionView({ atlas, science, status, renderer, avatars, onConnect }: Props) {
  const [archive, setArchive] = useState<DecisionSummary[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [draft, setDraft] = useState<Problem>(EMPTY);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [panelRun, setPanelRun] = useState<{ members: Avatar[]; replicates: number } | null>(null);
  const [active, setActive] = useState<string>("overview");
  const current = useRef<string | null>(null);
  const configured = !!status?.claude.configured;
  current.current = decision?.id ?? null;

  const refresh = useCallback(() => api.decisions().then(setArchive).catch(() => undefined), []);

  const open = useCallback(async (id: string | null, push = true) => {
    if (push) history.pushState(null, "", id ? `#decide/${id}` : "#decide");
    setError(null);
    if (!id) {
      setDecision(null);
      window.scrollTo({ top: 0 });
      return;
    }
    setBusy((b) => b ?? { kind: "open", label: "Opening…", since: Date.now() });
    try {
      setDecision(await api.decision(id));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      history.replaceState(null, "", "#decide");
      setDecision(null);
    } finally {
      setBusy((b) => (b?.kind === "open" ? null : b));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = idFromHash();
    if (id) void open(id, false);
    const sync = () => {
      const target = idFromHash();
      if (target !== current.current) void open(target, false);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [refresh, open]);

  // Live progress while the panel or a tipping run is in flight.
  useEffect(() => {
    if (!busy?.id || (busy.kind !== "panel" && busy.kind !== "tipping")) return;
    const id = busy.id;
    const poll = () =>
      api
        .progress(id)
        .then((p) => p && setProgress(p))
        .catch(() => undefined);
    const timer = setInterval(poll, 1000);
    void poll();
    return () => clearInterval(timer);
  }, [busy?.id, busy?.kind]);

  // A printed report shows the reasoning, evidence and weights that the screen folds away.
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

  // Which section is on screen, for the decision bar.
  useEffect(() => {
    if (!decision) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [decision?.id]);

  const run = async (next: Omit<Busy, "since">, call: () => Promise<Decision>, after?: (d: Decision) => void) => {
    setBusy({ ...next, since: Date.now() });
    setProgress(null);
    setError(null);
    try {
      const result = await call();
      // A run that finishes after the user has moved to another decision only updates the list.
      if (next.kind === "analyse" || current.current === result.id) {
        setDecision(result);
        after?.(result);
      }
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const clean = (p: Problem): Problem => ({
    question: p.question.trim(),
    context: p.context.trim(),
    options: p.options.map((o) => o.trim()).filter(Boolean),
  });
  const created = (d: Decision) => {
    history.pushState(null, "", `#decide/${d.id}`);
    setDraft(EMPTY);
    window.scrollTo({ top: 0 });
  };
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const convene = (members: Avatar[], replicates: number, neural: boolean) => {
    if (!decision) return;
    setPanelRun({ members, replicates });
    scrollTo("panel");
    void run({ kind: "panel", label: "The panel is reasoning", id: decision.id }, () => api.convene(decision.id, members.map(ref), replicates, neural));
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this decision and everything in it?")) return;
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
                    {date(d.updated_at)} · {d.verdict ?? "no panel yet"}
                  </span>
                </button>
                <button className="remove" title="Delete" aria-label="Delete this decision" onClick={() => void remove(d.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          {spent > 0 && <p className="spend">{usd(spent)} spent on Claude so far</p>}
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
                Big decisions are rarely made by the facts alone. Losses loom larger than gains, defaults stick, and money already spent keeps
                pulling. Describe your decision, and Reticulate shows which of these forces act on it, how different minds would decide it,
                and what it would take to change the answer.
              </p>
            </header>
            <Composer
              science={science}
              configured={configured}
              problem={draft}
              onProblem={setDraft}
              busy={busy?.kind === "analyse" ? busy : null}
              onConnect={onConnect}
              onAnalyse={() => void run({ kind: "analyse", label: "Claude is reading your decision" }, () => api.createDecision(clean(draft)), created)}
              onSelfRate={(anatomy) => void run({ kind: "analyse", label: "Mapping your answers" }, () => api.createDecision(clean(draft), anatomy), created)}
            />
            {!busy && !draft.question && <Examples onPick={setDraft} />}
            <ol className="how">
              <li>
                <strong>Describe it</strong>
                <span>A sentence is enough. Name the options and add details if you have them.</span>
              </li>
              <li>
                <strong>See what pulls on it</strong>
                <span>The documented biases your decision engages, each with what to do about it.</span>
              </li>
              <li>
                <strong>Ask the panel</strong>
                <span>Simulated decision-makers with different temperaments reason it through.</span>
              </li>
              <li>
                <strong>Find the tipping point</strong>
                <span>Which tendency would have to change for the answer to flip.</span>
              </li>
            </ol>
            <p className="science-strip">
              Built on {science.mechanisms.length} documented decision mechanisms,{" "}
              {science.mechanisms.filter((m) => m.countermove.basis === "tested").length} countermoves tested in intervention studies, and brain
              maps from two research databases of 13,459 and 14,371 studies. Every claim cites its source.
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
            busy={busy}
            progress={progress}
            panelRun={panelRun}
            active={active}
            onConnect={onConnect}
            scrollTo={scrollTo}
            onRevise={() => {
              setDraft(decision.problem);
              void open(null);
            }}
            onConvene={convene}
            onSave={(anatomy) => void run({ kind: "save", label: "Saving the ratings", id: decision.id }, () => api.updateAnatomy(decision.id, anatomy))}
            onTipping={(profile, key, values, replicates) =>
              void run({ kind: "tipping", label: "Testing the tipping point", id: decision.id }, () => api.tipping(decision.id, profile, [key], values, replicates))
            }
            onDelete={() => void remove(decision.id)}
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
  busy: Busy | null;
  progress: Progress | null;
  panelRun: { members: Avatar[]; replicates: number } | null;
  active: string;
  onConnect: () => void;
  scrollTo: (id: string) => void;
  onRevise: () => void;
  onConvene: (members: Avatar[], replicates: number, neural: boolean) => void;
  onSave: (anatomy: Rating[]) => void;
  onTipping: (profile: string | Avatar, key: string, values: number[], replicates: number) => void;
  onDelete: () => void;
}

function Workspace(props: WorkspaceProps) {
  const { atlas, science, renderer, avatars, configured, decision, busy, progress, panelRun, active, onConnect, scrollTo } = props;
  const frame = decision.frame;
  const panel = decision.panel;
  const panelBusy = busy?.kind === "panel" && busy.id === decision.id;
  const options = frame?.options ?? decision.problem.options;
  const engagedCount = decision.signature.mechanisms.filter((m) => m.level >= 2).length || decision.signature.mechanisms.length;
  const suggested = useMemo(() => suggestPanel(avatars, decision, science), [avatars, decision, science]);
  const dims = new Map(science.dimensions.map((d) => [d.id, d.name.toLowerCase()]));
  const engaged = engagedDimensions(decision)
    .slice(0, 2)
    .map((d) => dims.get(d.dimension_id));
  const quick = estimate(panelCalls(decision, suggested.length, 3), observedPerCall(decision));
  const suggestedAvatars = suggested.map((id) => avatars.find((a) => a.id === id)).filter((a): a is Avatar => !!a);
  const v = panel ? verdict(panel) : null;
  const profiles = new Map(panel?.profiles.map((p) => [p.id, p]) ?? []);
  const usage = decision.usage;
  const title = frame?.decision ?? decision.problem.question;

  const download = () => {
    const blob = new Blob([JSON.stringify(decision, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `reticulate-decision-${decision.created_at.slice(0, 10)}-${decision.id.slice(0, 6)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="workspace">
      <div className={`dbar no-print ${active === "overview" ? "at-top" : ""}`}>
        <div className="dbar-title" title={title}>
          {title}
        </div>
        <nav className="dbar-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={active === s.id ? "on" : ""} onClick={() => scrollTo(s.id)}>
              {s.label}
              {s.id === "watch" && engagedCount > 0 && <span className="count">{engagedCount}</span>}
              {s.id === "panel" && panelBusy && <span className="spinner tiny" />}
            </button>
          ))}
        </nav>
        {busy && (busy.kind === "save" || busy.kind === "open") && (
          <span className="dbar-status">
            <span className="spinner tiny" /> {busy.label}
          </span>
        )}
      </div>

      <section id="overview" className="sheet overview">
        <p className="eyebrow">
          Your decision · {date(decision.created_at)}
          {frame ? " · analysed by Claude" : " · rated by you"}
        </p>
        <h1 className="decision-title">{title}</h1>
        {frame && frame.decision.trim() !== decision.problem.question.trim() && <p className="asked">You asked: “{decision.problem.question}”</p>}
        {options.length > 0 && (
          <div className="options-row">
            {options.map((o, i) => (
              <span key={o} className="option-pill">
                <b>{String.fromCharCode(65 + i)}</b>
                {o}
              </span>
            ))}
          </div>
        )}

        {v ? (
          <div className="next verdict-card">
            <div>
              <span className="eyebrow">The panel's verdict</span>
              <p className="next-title">{v.statement}</p>
              <ul className="mini-support">
                {v.ranked
                  .filter((r) => r.ids.length)
                  .map((r) => (
                    <li key={r.option}>
                      <span className="who">
                        {r.ids.map((id) => (
                          <Face key={id} avatar={profiles.get(id)!} size={26} />
                        ))}
                      </span>
                      {r.option}
                    </li>
                  ))}
              </ul>
            </div>
            <button className="button" onClick={() => scrollTo("panel")}>
              Read their reasoning
            </button>
          </div>
        ) : panelBusy ? (
          <div className="next">
            <div>
              <span className="eyebrow">In progress</span>
              <p className="next-title">The panel is reasoning{progress ? ` · ${progress.done} of ${progress.total} calls` : ""}</p>
            </div>
            <button className="button" onClick={() => scrollTo("panel")}>
              Watch the panel
            </button>
          </div>
        ) : (
          <div className="next">
            <div>
              <span className="eyebrow">Next step</span>
              <p className="next-title">Ask the panel how they would decide</p>
              <p className="next-text">
                {suggestedAvatars.length} avatars who differ most on {engaged.length ? engaged.join(" and ") : "how they decide"} reason it
                through, three runs each. {configured ? `About ${usd(quick.usd)} and ${quick.minutes} minutes.` : "This step uses Claude."}
              </p>
            </div>
            <div className="next-faces">
              {suggestedAvatars.map((a) => (
                <Face key={a.id} avatar={a} size={40} />
              ))}
            </div>
            <div className="next-actions">
              {configured ? (
                <button className="button primary" disabled={!!busy} onClick={() => props.onConvene(suggestedAvatars, 3, true)}>
                  Ask the panel
                </button>
              ) : (
                <button className="button primary" onClick={onConnect}>
                  Connect Claude
                </button>
              )}
              <button className="text-button" onClick={() => scrollTo("panel")}>
                Choose the panel yourself
              </button>
            </div>
          </div>
        )}

        {frame && (frame.facts.length > 0 || frame.unknowns.length > 0) && (
          <div className="known">
            {frame.facts.length > 0 && (
              <div>
                <h3 className="subhead">What you know</h3>
                <ul>
                  {frame.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {frame.unknowns.length > 0 && (
              <div>
                <h3 className="subhead">What you don't know yet</h3>
                <ul>
                  {frame.unknowns.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <button className="text-button no-print" onClick={props.onRevise}>
          Revise the question and analyse again
        </button>
      </section>

      <Sheet
        id="at-play"
        title="What's at play"
        lede={
          decision.anatomy.some((r) => r.source === "model")
            ? "The features of your decision that research links to how people decide, rated by Claude from your description. Correct anything that is off; the watch-outs and the brain map follow."
            : "The features of your decision that research links to how people decide, as you rated them."
        }
      >
        <AtPlay science={science} decision={decision} busy={!!busy} onSave={props.onSave} />
      </Sheet>

      <Sheet id="watch" title="Watch out for" lede="Documented mechanisms that decisions like yours engage, how each could pull on you, and what to do about it.">
        <WatchOuts science={science} decision={decision} />
      </Sheet>

      <Sheet id="brain" title="In the brain" lede="What brain-imaging research reports for decisions with these features.">
        <Brain atlas={atlas} science={science} renderer={renderer} decision={decision} />
      </Sheet>

      <Sheet
        id="panel"
        title="The panel"
        lede="Simulated decision-makers reason through your decision, each from its own tendencies, personality and values. They show how different minds would weigh it; none predicts what a real person would do."
      >
        {panelBusy ? (
          <PanelProgress progress={progress} members={panelRun?.members ?? []} replicates={panelRun?.replicates ?? 1} since={busy!.since} />
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

      <Sheet id="homework" title="Before you decide" lede="What to find out first. Tick items off as you settle them.">
        <Homework decision={decision} />
      </Sheet>

      <Sheet
        id="tipping"
        title="Tipping points"
        lede="Would a different temperament flip the answer? Reticulate re-runs one avatar with a single tendency changed and everything else held fixed."
      >
        <Tipping
          science={science}
          decision={decision}
          configured={configured}
          busy={!!busy}
          running={busy?.kind === "tipping" && busy.id === decision.id ? { progress, since: busy.since } : null}
          onRun={props.onTipping}
          onConnect={onConnect}
        />
      </Sheet>

      <footer className="record">
        <div className="record-meta">
          <span>{decision.meta.model ? `Claude ${decision.meta.model}` : "Rated by you"}</span>
          <span>prompts {decision.meta.prompt_version}</span>
          <span>science {decision.meta.science_version}</span>
          {panel && <span>panel briefed on the research: {panel.meta.neural_context ? "yes" : "no"}</span>}
          <span>{usage.calls ? `${usage.calls} Claude call${usage.calls === 1 ? "" : "s"} · ${usd(usage.cost_usd)} at list price` : "No Claude calls"}</span>
        </div>
        <p className="notice">{decision.notice}</p>
        <div className="record-actions no-print">
          <button className="button" onClick={() => window.print()}>
            Print or save as PDF
          </button>
          <button className="button quiet" onClick={download}>
            Download the record
          </button>
          <button className="button quiet danger" onClick={props.onDelete}>
            Delete
          </button>
        </div>
      </footer>
    </div>
  );
}
