// The visitor's own records on reticulate.space: decisions, pattern and avatars in this
// browser (IndexedDB), the Anthropic key in localStorage. Nothing of it is kept on a server.

const DB = "reticulate";
const STORES = ["decisions", "summaries", "avatars", "meta"] as const;
type Store = (typeof STORES)[number];

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => STORES.forEach((s) => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("This browser does not allow storage here (private window?)."));
  });
  return opening;
}

function run<T>(store: Store, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = op(d.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const local = {
  get: <T>(store: Store, key: string) => run<T | undefined>(store, "readonly", (s) => s.get(key)),
  all: <T>(store: Store) => run<T[]>(store, "readonly", (s) => s.getAll()),
  put: (store: Store, key: string, value: unknown) => run<IDBValidKey>(store, "readwrite", (s) => s.put(value, key)),
  remove: (store: Store, key: string) => run<undefined>(store, "readwrite", (s) => s.delete(key)),
};

const KEY = "reticulate.anthropic-key";

const TRIAL = "reticulate.trial";

/** The visitor's pass for free decisions on Reticulate's key: signed by the server, counted there. */
export const trialPass = {
  get: (): { token: string; used: number } | null => {
    try {
      const raw = localStorage.getItem(TRIAL);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set: (value: { token: string; used: number }) => {
    try {
      localStorage.setItem(TRIAL, JSON.stringify(value));
    } catch {
      /* storage blocked: the pass lasts for this page only */
    }
  },
};

export const key = {
  get: (): string | null => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: (value: string | null) => {
    try {
      if (value) localStorage.setItem(KEY, value);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage blocked: the key lasts for this page only */
    }
  },
};
