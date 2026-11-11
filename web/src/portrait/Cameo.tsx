// A cameo: the avatar's bust in profile, raised in soft relief from a deep-blue ground.
// Each layer (hair, skin, beard, attire) is modelled with a lit and a shaded rim so the
// layers read as relief on relief; soft shading inside the head gives it volume. Fine
// detail is dropped at small sizes, where the cameo crops to the head.

import { useId, useMemo } from "react";
import type { HairColor, Phenotype } from "../types";
import { portrait } from "./geometry";

// Skin tones from light to deep, kept slightly muted so they sit like tinted porcelain.
export const SKIN_TONES = ["#efdccb", "#e5c7aa", "#d5ab88", "#bf8f6b", "#a37452", "#85593d", "#674330", "#4a3024"];
export const HAIR_TONES: Record<HairColor, string> = {
  black: "#252120",
  dark_brown: "#45322a",
  brown: "#6a4b36",
  auburn: "#874a30",
  blond: "#c6a670",
  grey: "#9d9890",
  white: "#dfd9cd",
};
const ATTIRE = {
  crew: { fill: "#384c75" },
  knit: { fill: "#5e7096" },
  turtleneck: { fill: "#d6ccb8" },
  collar: { fill: "#e7e0d0" },
  blazer: { fill: "#26354f" },
} as const;
const SHIRT = "#e9e2d2";
const SCARF = "#a28c79";
const INK = "#0b1226";

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

interface Props {
  phenotype: Phenotype;
  size?: number; // rendered height in px
  crop?: "bust" | "head"; // head: circular medallion for small sizes
  title?: string;
}

export function Cameo({ phenotype, size = 120, crop, title }: Props) {
  const uid = useId().replace(/:/g, "");
  const g = useMemo(() => portrait(phenotype), [phenotype]);
  const mode = crop ?? (size < 90 ? "head" : "bust");
  const detail = size >= 110;
  const skin = SKIN_TONES[phenotype.skin] ?? SKIN_TONES[2];
  const hairTone = HAIR_TONES[phenotype.hair_color];
  const attire = ATTIRE[phenotype.attire].fill;
  const light = ["blond", "grey", "white"].includes(phenotype.hair_color);
  const dark = (c: string, t = 0.4) => mix(c, INK, t);
  const id = (name: string) => `${name}-${uid}`;
  const url = (name: string) => `url(#${id(name)})`;
  const bust = mode === "bust";
  const viewBox = bust ? "0 0 200 240" : "40 34 124 124";
  const width = bust ? (size * 200) / 240 : size;

  return (
    <svg className="cameo" width={width} height={size} viewBox={viewBox} role="img" aria-label={title ?? "Portrait"}>
      <defs>
        <radialGradient id={id("ground")} cx="44%" cy="34%" r="76%">
          <stop offset="0%" stopColor="#24396a" />
          <stop offset="58%" stopColor="#152650" />
          <stop offset="100%" stopColor="#0b1633" />
        </radialGradient>
        <linearGradient id={id("sheen")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor={INK} stopOpacity="0.2" />
        </linearGradient>
        <clipPath id={id("frame")}>{bust ? <ellipse cx="100" cy="120" rx="94" ry="114" /> : <circle cx="102" cy="96" r="61" />}</clipPath>
        <clipPath id={id("head")}>
          <path d={g.head} />
        </clipPath>
        <clipPath id={id("hairclip")}>
          {g.hair && <path d={g.hair} />}
          {g.hairBack && g.hairBackStroke === 0 && <path d={g.hairBack} />}
          {g.lobes.map((o, i) => (
            <circle key={i} cx={o.c[0]} cy={o.c[1]} r={o.r} />
          ))}
        </clipPath>
        <filter id={id("relief")} x="-12%" y="-12%" width="124%" height="124%" colorInterpolationFilters="sRGB">
          <feOffset in="SourceAlpha" dx="1.5" dy="1.9" result="down" />
          <feGaussianBlur in="down" stdDeviation="2.1" result="downBlur" />
          <feComposite in="SourceAlpha" in2="downBlur" operator="arithmetic" k2="1" k3="-1" result="litRim" />
          <feFlood floodColor="#fff6e8" floodOpacity="0.5" />
          <feComposite in2="litRim" operator="in" result="lit" />
          <feOffset in="SourceAlpha" dx="-2" dy="-2.4" result="up" />
          <feGaussianBlur in="up" stdDeviation="2.6" result="upBlur" />
          <feComposite in="SourceAlpha" in2="upBlur" operator="arithmetic" k2="1" k3="-1" result="shadeRim" />
          <feFlood floodColor={INK} floodOpacity="0.55" />
          <feComposite in2="shadeRim" operator="in" result="shade" />
          <feMerge result="merged">
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="shade" />
            <feMergeNode in="lit" />
          </feMerge>
          <feComposite in="merged" in2="SourceAlpha" operator="in" />
        </filter>
        <filter id={id("cast")} x="-10%" y="-10%" width="125%" height="125%">
          <feDropShadow dx="1.8" dy="2.4" stdDeviation="2.4" floodColor="#020611" floodOpacity="0.75" />
        </filter>
        {[1.6, 2.4, 3.2, 4].map((s) => (
          <filter key={s} id={id(`soft${s}`)} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={s} />
          </filter>
        ))}
        <filter id={id("line")} x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="0.3" />
        </filter>
      </defs>

      {bust ? (
        <ellipse cx="100" cy="120" rx="96" ry="116" fill={url("ground")} />
      ) : (
        <circle cx="102" cy="96" r="62" fill={url("ground")} />
      )}

      <g clipPath={url("frame")}>
        <g transform={bust ? "translate(8 12) scale(0.92)" : undefined} filter={url("cast")}>
          {/* hair behind the head (a bun) */}
          {g.hairBack && !g.hairBackFront && (
            <g filter={url("relief")}>
              <path d={g.hairBack} fill={dark(hairTone, 0.15)} />
            </g>
          )}

          {/* bust and clothing */}
          <g filter={url("relief")}>
            <path d={g.bust} fill={attire} />
          </g>
          {detail && g.bustLines.map((d, i) => <path key={i} d={d} fill="none" stroke={dark(attire, 0.32)} strokeWidth="0.8" opacity="0.55" filter={url("line")} />)}

          {/* head and neck */}
          <g filter={url("relief")}>
            <path d={g.head} fill={skin} />
          </g>
          <g clipPath={url("head")}>
            {g.shades.map((s, i) => (
              <path
                key={i}
                d={s.d}
                fill={s.tone === "dark" ? dark(skin, 0.75) : "#fff8ee"}
                opacity={s.tone === "dark" ? s.opacity * (0.75 + phenotype.skin * 0.04) : s.opacity}
                filter={url(`soft${s.blur <= 2 ? 1.6 : s.blur <= 2.8 ? 2.4 : s.blur <= 3.6 ? 3.2 : 4}`)}
              />
            ))}
            <path d={g.head} fill={url("sheen")} />
          </g>
          {g.collar && (
            <g filter={url("relief")}>
              <path d={g.collar} fill={phenotype.attire === "collar" || phenotype.attire === "blazer" ? SHIRT : attire} />
            </g>
          )}
          {detail && g.collarLines.map((d, i) => <path key={i} d={d} fill="none" stroke={dark(attire, 0.3)} strokeWidth="0.75" opacity="0.6" />)}

          {/* hair falling over the neck and shoulders */}
          {g.hairBack && g.hairBackFront && (
            <g filter={url("relief")}>
              {g.hairBackStroke > 0 ? (
                <>
                  <path d={g.hairBack} fill="none" stroke={dark(hairTone, 0.06)} strokeWidth={g.hairBackStroke} strokeLinecap="round" />
                  <path
                    d={g.hairBack}
                    fill="none"
                    stroke={mix(hairTone, "#ffffff", 0.14)}
                    strokeWidth={g.hairBackStroke * 0.55}
                    strokeDasharray={phenotype.hair === "braids" ? "1.6 1.6" : "2.6 1.8"}
                    strokeLinecap="round"
                  />
                </>
              ) : (
                <path d={g.hairBack} fill={dark(hairTone, 0.12)} />
              )}
            </g>
          )}
          {detail && g.backStrands.map((d, i) => <path key={i} d={d} fill="none" stroke={mix(hairTone, i % 2 ? "#ffffff" : INK, 0.25)} strokeWidth="0.6" strokeLinecap="round" opacity="0.55" />)}

          {/* face */}
          {detail &&
            g.lines.map((w, i) => (
              <path key={i} d={w.d} fill="none" stroke={dark(skin, 0.55)} strokeWidth="0.7" strokeLinecap="round" opacity={0.5 * w.opacity} filter={url("line")} />
            ))}
          <path d={g.lips} fill={mix(skin, "#9a4b47", 0.26)} opacity="0.85" />
          <path d={g.mouth} fill="none" stroke={dark(skin, 0.62)} strokeWidth="0.85" strokeLinecap="round" />
          <path d={g.nostril} fill="none" stroke={dark(skin, 0.5)} strokeWidth="0.9" strokeLinecap="round" />
          <g filter={url("relief")}>
            <path d={g.ear} fill={mix(skin, "#b0705a", 0.08)} />
          </g>
          {g.earLines.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={dark(skin, 0.5)} strokeWidth="0.85" strokeLinecap="round" opacity="0.75" />
          ))}
          {detail && <path d={g.eye.crease} fill="none" stroke={dark(skin, 0.45)} strokeWidth="0.6" strokeLinecap="round" opacity="0.6" />}
          <path d={g.eye.lower} fill="none" stroke={dark(skin, 0.5)} strokeWidth="0.6" strokeLinecap="round" opacity="0.55" />
          <circle cx={g.eye.iris[0]} cy={g.eye.iris[1]} r={g.eye.irisR} fill="#1c1716" />
          <path d={g.eye.lid} fill="none" stroke="#1f1918" strokeWidth="1.1" strokeLinecap="round" />
          <path d={g.eye.lash} fill="none" stroke="#1f1918" strokeWidth="0.7" strokeLinecap="round" />
          <path
            d={g.brow}
            fill="none"
            stroke={phenotype.hair === "bald" || phenotype.hair === "headscarf" ? HAIR_TONES[phenotype.age > 60 ? "grey" : "dark_brown"] : dark(hairTone, 0.1)}
            strokeWidth={g.browWidth}
            strokeLinecap="round"
            opacity="0.8"
          />

          {/* facial hair */}
          {g.stubble.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="0.3" fill={dark(hairTone, 0.15)} opacity="0.5" />
          ))}
          {g.beard && (
            <g filter={url("relief")}>
              <path d={g.beard} fill={hairTone} filter={url("line")} />
            </g>
          )}
          {detail && g.beardStrands.map((d, i) => <path key={i} d={d} fill="none" stroke={mix(hairTone, i % 2 ? "#ffffff" : INK, 0.3)} strokeWidth="0.55" opacity="0.6" />)}
          {g.moustache && (
            <g filter={url("relief")}>
              <path d={g.moustache} fill={phenotype.hair_color === "white" || phenotype.hair_color === "grey" ? dark(hairTone, 0.18) : hairTone} />
            </g>
          )}

          {/* hair on the skull */}
          {(g.hair || g.lobes.length > 0) && (
            <g filter={url("relief")}>
              {g.hair && <path d={g.hair} fill={hairTone} />}
              {g.lobes.map((o, i) => (
                <circle key={i} cx={o.c[0]} cy={o.c[1]} r={o.r} fill={hairTone} />
              ))}
            </g>
          )}
          {detail && g.strands.map((d, i) => <path key={i} d={d} fill="none" stroke={mix(hairTone, i % 2 ? "#ffffff" : INK, light ? 0.3 : 0.22)} strokeWidth="0.6" strokeLinecap="round" opacity="0.6" />)}
          {g.curls.length > 0 && (
            <g clipPath={url("hairclip")}>
              {g.curls.map(([x, y], i) =>
                phenotype.hair === "buzz" ? (
                  <circle key={i} cx={x} cy={y} r="0.38" fill={dark(hairTone, 0.25)} opacity="0.55" />
                ) : (
                  <path
                    key={i}
                    d={`M${(x - 1.4).toFixed(2)},${y.toFixed(2)} a1.4,1.2 ${(i * 47) % 180} 1,1 1.6,1.1`}
                    fill="none"
                    stroke={mix(hairTone, i % 3 ? INK : "#ffffff", light ? 0.35 : 0.28)}
                    strokeWidth="0.5"
                    opacity="0.65"
                  />
                ),
              )}
            </g>
          )}

          {/* headscarf */}
          {g.scarf && (
            <g filter={url("relief")}>
              <path d={g.scarf} fill={SCARF} />
            </g>
          )}
          {g.folds.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={dark(SCARF, 0.32)} strokeWidth="1" opacity="0.5" filter={url("line")} />
          ))}

          {g.glasses && (
            <g>
              <path d={g.glasses.arm} fill="none" stroke="#1a1615" strokeWidth="1" strokeLinecap="round" />
              <path d={g.glasses.lens} fill="rgba(222,231,246,0.16)" stroke="#1a1615" strokeWidth="1.05" />
            </g>
          )}
        </g>
      </g>

      {bust ? (
        <>
          <ellipse cx="100" cy="120" rx="95" ry="115" fill="none" stroke="var(--cream, #f3ecdc)" strokeOpacity="0.5" strokeWidth="1.1" />
          <ellipse cx="100" cy="120" rx="90.5" ry="110.5" fill="none" stroke="var(--cream, #f3ecdc)" strokeOpacity="0.16" strokeWidth="0.7" />
        </>
      ) : (
        <circle cx="102" cy="96" r="61.2" fill="none" stroke="var(--cream, #f3ecdc)" strokeOpacity="0.5" strokeWidth="1.3" />
      )}
    </svg>
  );
}
