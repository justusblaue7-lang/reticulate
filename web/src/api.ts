import type { Avatar, Decision, DecisionSummary, Problem, Progress, Rating, Science, Status, TextMap } from "./types";

type AvatarRef = string | Avatar;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? response.statusText);
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const ref = (a: Avatar): AvatarRef => (a.origin === "library" ? a.id : a);

export const api = {
  status: () => request<Status>("/api/status"),
  connectClaude: (api_key: string) => send<Status>("PUT", "/api/settings/claude", { api_key }),
  disconnectClaude: () => send<Status>("DELETE", "/api/settings/claude"),
  science: () => request<Science>("/api/science"),
  avatars: () => request<Avatar[]>("/api/avatars"),
  saveAvatar: (avatar: Avatar) => send<Avatar>("POST", "/api/avatars", avatar),
  deleteAvatar: (id: string) => send<{ deleted: string }>("DELETE", `/api/avatars/${id}`),
  textMap: (text: string) => send<TextMap>("POST", "/api/maps", { text }),
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
  tipping: (id: string, profile: AvatarRef, keys: string[], values: number[], replicates: number) =>
    send<Decision>("POST", `/api/decisions/${id}/tipping`, { profile, keys, values, replicates }),
};
