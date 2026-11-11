import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Anchor, BrainRenderer } from "../brain/renderer";

interface Props {
  renderer: BrainRenderer | null;
  anchor: Anchor | null;
  target: string; // DOM id of the label the line leads to
}

/** An anatomical-plate leader line from a point on the brain to its label in the margin. */
export function LeaderLine({ renderer, anchor, target }: Props) {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const tick = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const line = path.current!;
    const start = dot.current!;
    const end = tick.current!;
    const hide = () => [line, start, end].forEach((el) => el.setAttribute("opacity", "0"));
    if (!renderer || !anchor) {
      hide();
      return;
    }
    const world = new THREE.Vector3();
    const draw = () => {
      const label = document.getElementById(target);
      if (!label || !renderer.anchorVisible(anchor)) return hide();
      const p = renderer.project(renderer.anchorPosition(anchor, world));
      const box = label.getBoundingClientRect();
      if (!p.inView || box.width === 0) return hide();
      const tx = box.left - 10;
      const ty = box.top + Math.min(22, box.height / 2);
      const elbow = tx - 36;
      line.setAttribute("d", `M${p.x},${p.y} L${Math.max(p.x, elbow)},${p.y} L${tx},${ty}`);
      line.setAttribute("stroke-dasharray", p.occluded ? "3 3" : "none");
      start.setAttribute("cx", String(p.x));
      start.setAttribute("cy", String(p.y));
      end.setAttribute("cx", String(tx));
      end.setAttribute("cy", String(ty));
      [line, start, end].forEach((el) => el.setAttribute("opacity", "1"));
    };
    draw();
    const stop = renderer.onFrame(draw);
    window.addEventListener("resize", draw);
    window.addEventListener("scroll", draw, true);
    return () => {
      stop();
      window.removeEventListener("resize", draw);
      window.removeEventListener("scroll", draw, true);
    };
  }, [renderer, anchor, target]);

  return (
    <svg className="leader" aria-hidden>
      <path ref={path} fill="none" stroke="var(--cream)" strokeWidth="0.9" opacity="0" />
      <circle ref={dot} r="3.2" fill="var(--navy-900)" stroke="var(--cream)" strokeWidth="1.2" opacity="0" />
      <circle ref={tick} r="1.8" fill="var(--cream)" opacity="0" />
    </svg>
  );
}
