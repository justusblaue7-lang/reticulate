import { key, local, trialPass } from "./store";
import type { Avatar, Decision, DecisionSummary, PersonalPattern, Problem, Progress, Rating, Science, Status } from "./types";

type AvatarRef = string | Avatar;

/** Built for reticulate.space: the visitor's own key, everything kept in their browser. */
export const PUBLIC = import.meta.env.VITE_PUBLIC === "1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const k = PUBLIC ? key.get() : null;
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(k ? { "x-anthropic-key": k } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : body?.detail ? JSON.stringify(body.detail) : publicFailure(response.status);
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

const publicFailure = (status: number) =>
  status === 504 ? "Claude took too long to answer. Try again; long panels work better with fewer replicates." : `The engine answered ${status}.`;

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const ref = (a: Avatar): AvatarRef => (a.origin === "library" ? a.id : a);

// ---- the local app: the engine on this computer keeps everything --------------------------

const localApi = {
  status: () => request<Status>("/api/status"),
  connectClaude: (api_key: string) => send<Status>("PUT", "/api/settings/claude", { api_key }),
  disconnectClaude: () => send<Status>("DELETE", "/api/settings/claude"),
  science: () => request<Science>("/api/science"),
  pattern: () => request<PersonalPattern | null>("/api/pattern"),
  savePattern: (answers: Record<string, number>, adjust: Record<string, number> = {}) => send<PersonalPattern>("PUT", "/api/pattern", { answers, adjust }),
  deletePattern: () => send<{ deleted: boolean }>("DELETE", "/api/pattern"),
  avatars: () => request<Avatar[]>("/api/avatars"),
  saveAvatar: (avatar: Avatar) => send<Avatar>("POST", "/api/avatars", avatar),
  deleteAvatar: (id: string) => send<{ deleted: string }>("DELETE", `/api/avatars/${id}`),
  decisions: () => request<DecisionSummary[]>("/api/decisions"),
  decision: (id: string) => request<Decision>(`/api/decisions/${id}`),
  deleteDecision: (id: string) => send<{ deleted: string }>("DELETE", `/api/decisions/${id}`),
  progress: (id: string) => request<Progress | null>(`/api/decisions/${id}/progress`),
  createDecision: (problem: Problem, anatomy?: Rating[]) => send<Decision>("POST", "/api/decisions", { problem, anatomy }),
  analyse: (id: string) => send<Decision>("POST", `/api/decisions/${id}/analysis`),
  reply: (id: string, answer: string | null, skip = false) => send<Decision>("POST", `/api/decisions/${id}/dialogue`, { answer, skip }),
  conclude: (id: string, answer: string | null) => send<Decision>("POST", `/api/decisions/${id}/dialogue/conclude`, { answer }),
  revise: (id: string, index: number) => send<Decision>("POST", `/api/decisions/${id}/dialogue/revise`, { index }),
  reopen: (id: string) => send<Decision>("POST", `/api/decisions/${id}/dialogue/reopen`),
  settle: (id: string, items: string[]) => send<Decision>("PUT", `/api/decisions/${id}/settled`, { items }),
  reveal: (id: string) => send<{ path: string }>("POST", `/api/decisions/${id}/reveal`),
  updateAnatomy: (id: string, anatomy: Rating[]) => send<Decision>("PUT", `/api/decisions/${id}/anatomy`, { anatomy }),
  convene: (id: string, profiles: AvatarRef[], replicates: number, neural_context: boolean) =>
    send<Decision>("POST", `/api/decisions/${id}/panel`, { profiles, replicates, neural_context }),
};

// ---- the public site: a stateless engine, the records in this browser ---------------------

type Result = { decision: Decision; summary: DecisionSummary; trial?: { token: string; used: number; left: number } | null };

/** What the site offers for free on Reticulate's key, as the last status said. */
let offer: { decisions: number; days: number } | null = null;

/** Free decisions this visitor has left, or null when there is no free offer or they use their own key. */
export function freeLeft(): number | null {
  if (!PUBLIC || !offer || key.get()) return null;
  return Math.max(0, offer.decisions - (trialPass.get()?.used ?? 0));
}

export const freeOffer = () => (PUBLIC ? offer : null);

/** Whether this decision runs free on Reticulate's key: started free, still within its days, no own key since. */
export function onFreeDecision(d: Decision | null): boolean {
  if (!PUBLIC || !d?.trial_grant || key.get()) return false;
  return Number(d.trial_grant.split(".")[0]) * 1000 > Date.now();
}

const keep = async ({ decision, summary }: Result) => {
  await local.put("decisions", decision.id, decision);
  await local.put("summaries", decision.id, summary);
  return decision;
};

const stored = async (id: string) => {
  const d = await local.get<Decision>("decisions", id);
  if (!d) throw new Error("This decision is not in this browser.");
  return d;
};

const pattern = () => local.get<PersonalPattern>("meta", "pattern").then((p) => p ?? null);

/** Apply a change on the server to the decision as stored now, and keep the result. */
const on = async (id: string, path: string, body: object = {}) =>
  keep(await send<Result>("POST", `/api/decision/${path}`, { decision: await stored(id), ...body }));

/** Claude's analysis runs while the dialogue goes on; it is applied to the decision as it is by then. */
const analyseInBackground = async (id: string) => {
  let analysed: object;
  try {
    analysed = await send<object>("POST", "/api/decision/analyse", { decision: await stored(id) });
  } catch (e) {
    analysed = { error: e instanceof Error ? e.message : String(e) };
  }
  await on(id, "apply-analysis", analysed).catch(() => undefined);
};

const withKey = (status: Status): Status => {
  const k = key.get();
  return { ...status, claude: { ...status.claude, configured: !!k, key_hint: k ? `…${k.slice(-4)}` : null } };
};

const download = (name: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const publicApi: typeof localApi = {
  status: async () => {
    const status = await request<Status>("/api/status");
    offer = status.trial ?? null;
    return withKey(status);
  },
  connectClaude: async (api_key: string) => {
    await send("POST", "/api/key", { api_key });
    key.set(api_key.trim());
    return publicApi.status();
  },
  disconnectClaude: async () => {
    key.set(null);
    return publicApi.status();
  },
  science: () => request<Science>("/api/science"),
  pattern,
  savePattern: async (answers, adjust = {}) => {
    const p = await send<PersonalPattern>("POST", "/api/pattern", { answers, adjust });
    await local.put("meta", "pattern", p);
    return p;
  },
  deletePattern: async () => {
    await local.remove("meta", "pattern");
    return { deleted: true };
  },
  avatars: async () => [...(await request<Avatar[]>("/api/avatars")), ...(await local.all<Avatar>("avatars"))],
  saveAvatar: async (avatar) => {
    const known = avatar.origin === "user" && (await local.get<Avatar>("avatars", avatar.id));
    const checked = known ? { ...avatar, kind: "persona" as Avatar["kind"] } : await send<Avatar>("POST", "/api/avatar", { profile: avatar });
    await local.put("avatars", checked.id, checked);
    return checked;
  },
  deleteAvatar: async (id) => {
    await local.remove("avatars", id);
    return { deleted: id };
  },
  decisions: async () => (await local.all<DecisionSummary>("summaries")).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  decision: stored,
  deleteDecision: async (id) => {
    await local.remove("decisions", id);
    await local.remove("summaries", id);
    return { deleted: id };
  },
  progress: async () => null,
  createDecision: async (problem, anatomy) => {
    // Without a key of their own, a new dialogue is one of the visitor's free decisions.
    const pass = !anatomy && !key.get() ? trialPass.get() : null;
    const result = await request<Result>("/api/decision/new", {
      method: "POST",
      body: JSON.stringify({ problem, anatomy, pattern: await pattern() }),
      headers: pass ? { "x-reticulate-trial": pass.token } : {},
    });
    if (result.trial) trialPass.set({ token: result.trial.token, used: result.trial.used });
    const d = await keep(result);
    if (!anatomy) void analyseInBackground(d.id);
    return d;
  },
  analyse: async (id) => {
    const d = await stored(id);
    if (d.analysis === "pending") return d;
    const pending = { ...d, analysis: "pending", analysis_error: null } as Decision;
    await local.put("decisions", id, pending);
    void analyseInBackground(id);
    return pending;
  },
  reply: async (id, answer, skip = false) => on(id, "reply", { answer, skip, pattern: await pattern() }),
  conclude: (id, answer) => on(id, "conclude", { answer }),
  revise: (id, index) => on(id, "revise", { index }),
  reopen: (id) => on(id, "reopen"),
  settle: (id, items) => on(id, "settle", { items }),
  reveal: async (id) => {
    const d = await stored(id);
    download(`reticulate-${id.slice(0, 8)}.json`, JSON.stringify(d, null, 2), "application/json");
    return { path: "your downloads" };
  },
  updateAnatomy: (id, anatomy) => on(id, "anatomy", { anatomy }),
  convene: (id, profiles, replicates, neural_context) => on(id, "panel", { profiles, replicates, neural_context }),
};

export const api = PUBLIC ? publicApi : localApi;
