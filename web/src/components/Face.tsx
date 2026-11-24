import { useState } from "react";
import { portraitUrl } from "../people/catalogue";
import type { Avatar } from "../types";

/** What an avatar is called in the interface: the person's name, else the role. */
export const displayName = (a: Avatar) => a.person?.name || a.name;

const initials = (text: string) =>
  text
    .split(/\s+/)
    .filter((w) => /^[A-ZÀ-ÞĀ-Ž]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("") || "?";

/** An avatar's face: a still of its 3D person (as changed, if it was), in a round frame. */
export function Face({ avatar, size = 34, kind = "face" }: { avatar: Avatar; size?: number; kind?: "face" | "portrait" }) {
  const look = avatar.person?.look;
  const stills = avatar.person?.stills;
  const [failed, setFailed] = useState<string | null>(null);
  const name = displayName(avatar);
  if (!look || failed === look) {
    return (
      <span className="face blank" style={{ width: size, height: size, fontSize: size * 0.36 }} title={name} aria-label={name}>
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      className={`face ${kind}`}
      src={stills ? stills[kind] : portraitUrl(look, kind)}
      width={size}
      height={kind === "portrait" ? Math.round(size * 1.25) : size}
      alt={name}
      title={name}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(look)}
    />
  );
}
