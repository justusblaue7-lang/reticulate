import type React from "react";
import { ART, artSrc, artSrcSet, credit, type ArtSlug } from "../art";

interface Props {
  slug: ArtSlug;
  className?: string;
  /** Hovering slowly reveals the work's own colour. */
  reveal?: boolean;
  /** Show the credit on hover. */
  caption?: boolean;
  /** The image is decoration next to text that says the same; screen readers skip it. */
  decorative?: boolean;
  eager?: boolean;
  sizes?: string;
}

/** A work of art, tinted into the black-and-blue palette. */
export function Art({ slug, className = "", reveal = false, caption = false, decorative = false, eager = false, sizes = "100vw" }: Props) {
  const piece = ART[slug];
  return (
    <figure className={`art ${reveal ? "reveal" : ""} ${piece.invert ? "invert" : ""} ${className}`}>
      <img
        src={artSrc(slug)}
        srcSet={artSrcSet(slug)}
        sizes={sizes}
        alt={decorative ? "" : piece.alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={{ objectPosition: piece.position, ...(piece.tone ? { "--tone": piece.tone } : {}) } as React.CSSProperties}
        draggable={false}
      />
      {caption && <figcaption>{credit(slug)}</figcaption>}
    </figure>
  );
}
