import { credit } from "../art";
import { Art } from "../components/Art";

/** Where Socrates began: an honest account of what one does not know. */
export function Passage() {
  return (
    <section className="passage" id="method" aria-label="Where Socrates began">
      <div className="band aporia-band">
        <Art slug="socrates-athens" className="band-art" reveal sizes="(max-width: 980px) 100vw, 70vw" />
        <div className="container band-text">
          <span className="passage-label">Where Socrates began</span>
          <p className="maxim">I know that I don’t know.</p>
          <p className="band-lede">
            A good decision starts with an honest account of what you do not know yet. So Reticulate starts with questions, not answers.
          </p>
          <p className="byline">After Plato, Apology 21d</p>
        </div>
        <p className="band-credit container">{credit("socrates-athens")}</p>
      </div>
    </section>
  );
}
