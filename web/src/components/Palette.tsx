import { useEffect, useMemo, useRef, useState } from "react";
import type { DecisionSummary } from "../types";
import { shortDate, statusLine } from "./decision/Composer";
import { Kbd, Mark } from "./Mark";

interface Item {
  key: string;
  title: string;
  meta?: string;
  tag?: string;
  icon: "new" | "decided" | "open" | "other" | "nav";
  run: () => void;
}

interface Props {
  archive: DecisionSummary[];
  connected: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: (question?: string) => void;
  onSection: (id: string) => void;
  onConnect: () => void;
}

/** ⌘K: find a decision, start one, or jump to a part of the page. */
export function Palette({ archive, connected, onClose, onOpen, onNew, onSection, onConnect }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const decisions: Item[] = archive
      .filter((d) => match(d.title) || match(d.decided ?? ""))
      .map((d) => ({
        key: d.id,
        title: d.title,
        meta: statusLine(d),
        tag: shortDate(d.updated_at),
        icon: d.decided ? "decided" : d.status === "in dialogue" ? "open" : "other",
        run: () => onOpen(d.id),
      }));
    const actions: Item[] = [
      { key: "new", title: q ? `Decide: “${query.trim()}”` : "New decision", icon: "new", run: () => onNew(q ? query.trim() : undefined) },
      ...(
        [
          { key: "you", title: "Your pattern", run: () => onSection("you") },
          { key: "patterns", title: "Other minds", run: () => onSection("patterns") },
          { key: "how", title: "How it works", run: () => onSection("how") },
          { key: "claude", title: connected ? "Claude connection" : "Connect Claude", run: onConnect },
        ] as const
      )
        .filter((a) => match(a.title))
        .map((a) => ({ ...a, icon: "nav" as const })),
    ];
    return [
      { name: "Actions", items: actions },
      { name: "Decisions", items: decisions },
    ].filter((g) => g.items.length);
  }, [archive, query, connected, onOpen, onNew, onSection, onConnect]);

  const flat = groups.flatMap((g) => g.items);
  const current = Math.min(active, flat.length - 1);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(".rc-item.on")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="rc-window palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, flat.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(flat[current]);
          }
        }}
      >
        <div className="rc-search">
          <input ref={input} value={query} placeholder="Search decisions, or type a new one…" onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
        </div>
        <div className="rc-list" ref={list}>
          {groups.map((g) => (
            <div key={g.name}>
              <div className="rc-section">{g.name}</div>
              {g.items.map((item) => {
                const i = flat.indexOf(item);
                return (
                  <button key={item.key} className={`rc-item ${i === current ? "on" : ""}`} onMouseMove={() => setActive(i)} onClick={() => choose(item)}>
                    <span className={`rc-icon ${item.icon === "decided" ? "status decided" : item.icon === "open" ? "status open" : item.icon === "other" ? "status" : item.icon}`}>
                      {item.icon === "new" ? "+" : item.icon === "nav" ? "→" : null}
                    </span>
                    <span className="rc-title">{item.title}</span>
                    {item.meta && <span className="rc-meta">{item.meta}</span>}
                    {item.tag && <span className="rc-tag">{item.tag}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="rc-actionbar">
          <div className="rc-actionbar-left">
            <Mark size={18} />
            <span>Reticulate</span>
          </div>
          <div className="rc-actionbar-right">
            <span className="rc-hint">
              Open <Kbd>↵</Kbd>
            </span>
            <span className="rc-divider" />
            <span className="rc-hint">
              Move <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </span>
            <span className="rc-divider" />
            <span className="rc-hint">
              Close <Kbd>esc</Kbd>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
