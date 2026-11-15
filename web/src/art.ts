import SIZES from "./art-sizes.json";

// The art in Reticulate: twelve works from the project's `socratic art` folder, prepared by
// tools/art/build.py into public/art (which also writes art-sizes.json). Every image is shown
// tinted into the black-and-blue palette; hovering reveals its own colour. Titles are given only where the work is certain;
// otherwise the credit names the source. All photographs are from Unsplash (Unsplash License).

export type ArtSlug =
  | "death-of-socrates"
  | "socrates-athens"
  | "marble-head"
  | "thinker"
  | "philosopher"
  | "bronze"
  | "facade"
  | "trevi"
  | "battle"
  | "ceiling"
  | "statue-night"
  | "drapery";

export interface ArtPiece {
  alt: string;
  title?: string;
  credit: string;
  position?: string; // CSS object-position for crops
  invert?: boolean; // a dark figure on a white ground, shown as light on dark
  tone?: number; // brightness under the tint: lower for high-key photographs, so skies sink into the page
}

export const ART: Record<ArtSlug, ArtPiece> = {
  "death-of-socrates": {
    alt: "Painting: Socrates, in prison, reaches for the cup of hemlock and keeps teaching while his friends grieve.",
    title: "Jacques-Louis David, The Death of Socrates, 1787",
    credit: "The Metropolitan Museum of Art",
    position: "50% 55%",
  },
  "socrates-athens": {
    alt: "Marble statue of Socrates seated in thought, chin in hand, with Apollo on a column behind him.",
    title: "Socrates, Academy of Athens",
    credit: "Photo: Vidar Nordli-Mathisen",
    position: "72% 40%",
    tone: 0.36,
  },
  "marble-head": { alt: "Marble head of a bearded figure emerging from shadow.", credit: "Photo: Chelaxy Designs", position: "50% 30%" },
  thinker: { alt: "Painting of an old man resting his head on his hand, lost in thought.", credit: "Europeana", position: "50% 25%", tone: 0.82 },
  philosopher: { alt: "White marble statue of a bearded philosopher holding a book.", credit: "Photo: John Krach", position: "50% 4%", tone: 0.4 },
  bronze: { alt: "Bronze figure with a trident, balanced on one foot, in silhouette.", credit: "Photo: Riccardo Farinazzo", position: "50% 40%", invert: true, tone: 0.52 },
  facade: { alt: "Statues on the facade of St Peter's Basilica, seen from below.", title: "St Peter's Basilica, Rome", credit: "Photo: Nils", position: "50% 40%", tone: 0.5 },
  trevi: { alt: "The Trevi Fountain in Rome, its many figures among the rocks and water.", title: "Trevi Fountain, Rome", credit: "Photo: Chris Czermak", position: "50% 45%", tone: 0.55 },
  battle: { alt: "Painting of gods and titans battling among clouds and rocks.", credit: "Art Institute of Chicago", position: "50% 40%" },
  ceiling: { alt: "Baroque ceiling fresco of figures rising into a bright sky.", credit: "Photo: Adrianna Geo", position: "50% 35%", tone: 0.6 },
  "statue-night": { alt: "Marble statue of a woman looking upward, lit from above in darkness.", credit: "Photo: Content Pixie", position: "50% 30%", tone: 0.95 },
  drapery: { alt: "Dark marble drapery in close-up.", credit: "Photo: Levi Meir Clancy", position: "50% 50%" },
};

/** The work that stands for each element of decision quality in the dialogue. */
export const STAGE_ART: Record<string, ArtSlug> = {
  frame: "facade",
  goals: "thinker",
  options: "trevi",
  evidence: "philosopher",
  tradeoffs: "bronze",
  commitment: "ceiling",
};

export const artSrc = (slug: ArtSlug, small = false) => `/art/${slug}${small ? "-sm" : ""}.webp`;

/** Both files with their true widths, so the browser picks the right one for portrait works too. */
export const artSrcSet = (slug: ArtSlug) => {
  const size = SIZES[slug];
  return `${artSrc(slug, true)} ${size.sm[0]}w, ${artSrc(slug)} ${size.full[0]}w`;
};

export const credit = (slug: ArtSlug) => {
  const a = ART[slug];
  return `${a.title ? `${a.title}. ` : ""}${a.credit}, via Unsplash`;
};
