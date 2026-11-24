import { useEffect } from "react";
import { PersonViewer } from "../people/PersonViewer";
import type { Avatar } from "../types";
import { displayName } from "./Face";

/** One avatar in 3D, over the page: turn them, come closer, read who they are. */
export function PersonModal({ avatar, onClose }: { avatar: Avatar; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="person-modal" role="dialog" aria-modal="true" aria-label={displayName(avatar)} onClick={(e) => e.stopPropagation()}>
        <PersonViewer look={avatar.person?.look} style={avatar.person?.style} poster={avatar.person?.stills?.portrait} name={displayName(avatar)} framing="bust" className="modal-person" />
        <div className="person-modal-text">
          <span className="eyebrow">Simulated decision-maker · fictional</span>
          <h2>{displayName(avatar)}</h2>
          {avatar.person?.name && <p className="role">{avatar.name}</p>}
          <p>{avatar.summary}</p>
          {avatar.nuance && <p className="note">{avatar.nuance}</p>}
          <button className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
