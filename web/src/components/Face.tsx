import { Cameo } from "../portrait/Cameo";
import type { Avatar } from "../types";
import { DEFAULT_PHENOTYPE } from "./AvatarBuilder";

/** An avatar's cameo, cropped to the head, for lists and panels. */
export function Face({ avatar, size = 34 }: { avatar: Avatar; size?: number }) {
  return <Cameo phenotype={avatar.phenotype ?? DEFAULT_PHENOTYPE} size={size} crop="head" title={avatar.name} />;
}
