import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ViewerProps } from "./PersonViewer3D";

// three.js and a person's model (about 2 MB) load only when the person comes into view, and on
// a slow or data-saving connection only when asked for; the portrait stands in until then.
const PersonViewer3D = lazy(() => import("./PersonViewer3D"));

type Connection = { saveData?: boolean; effectiveType?: string };
const slow = () => {
  const c = (navigator as Navigator & { connection?: Connection }).connection;
  return !!c && (c.saveData === true || ["slow-2g", "2g", "3g"].includes(c.effectiveType ?? ""));
};

/** A person: the portrait at once, the 3D figure once it is in view (or tapped on a slow connection). */
export function PersonViewer(props: ViewerProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [wanted, setWanted] = useState(false);
  const [lean] = useState(slow);

  useEffect(() => {
    if (wanted || lean || !holder.current) return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setWanted(true), { rootMargin: "200px" });
    seen.observe(holder.current);
    return () => seen.disconnect();
  }, [wanted, lean]);

  const poster = (
    <div ref={holder} className={`person-viewer ${props.className ?? ""} loading`}>
      <div className="person-stage" />
      {props.look && <img className="person-poster" src={`/people/${props.look}/portrait.webp`} alt="" aria-hidden />}
      {lean && props.look && !wanted && (
        <button className="person-load" onClick={() => setWanted(true)}>
          View in 3D · about 2 MB
        </button>
      )}
    </div>
  );

  return wanted ? <Suspense fallback={poster}>{<PersonViewer3D {...props} />}</Suspense> : poster;
}
