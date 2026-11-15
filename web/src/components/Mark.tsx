/** Reticulate's mark: a small net (reticulum) of four linked nodes on a blue tile. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="mark-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#79b0ff" />
          <stop offset="1" stopColor="#1f5fe0" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#mark-tile)" />
      <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.95">
        <path d="M7 8 L17 7 L16 17 L8 16 Z M7 8 L16 17 M17 7 L8 16" />
      </g>
      <g fill="#fff">
        <circle cx="7" cy="8" r="2" />
        <circle cx="17" cy="7" r="2" />
        <circle cx="16" cy="17" r="2" />
        <circle cx="8" cy="16" r="2" />
      </g>
    </svg>
  );
}

/** A key cap, e.g. <Kbd>⌘</Kbd><Kbd>K</Kbd>. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";
