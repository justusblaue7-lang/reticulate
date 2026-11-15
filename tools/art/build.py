"""Turn the photographs in `socratic art/` into the web app's art (web/public/art).

Each source image becomes `<slug>.webp` (within 2000 × 2600 px, so portrait works stay sharp
on a full-height stage) and `<slug>-sm.webp` (within 800 px), stripped of metadata; scanned
paintings lose their mount (TRIM). The pixel sizes go to web/src/art-sizes.json, so the
interface can offer the browser the right file.  The interface tints them itself (src/art.ts, styles.css), so
the files keep their colour. Run from the project folder:

    python3 tools/art/build.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "socratic art"
OUT = ROOT / "web" / "public" / "art"
SIZES_FILE = ROOT / "web" / "src" / "art-sizes.json"

# source file stem (Unsplash download name) -> slug used by the interface
ART = {
    "the-metropolitan-museum-of-art-k8_t_yszkvA-unsplash": "death-of-socrates",
    "vidar-nordli-mathisen-7nH0Flkz854-unsplash": "socrates-athens",
    "chelaxy-designs-Fz4CP8Ra3b4-unsplash": "marble-head",
    "europeana-0kkm6hMHBMo-unsplash": "thinker",
    "john-krach-jHwl-q4gbPQ-unsplash": "philosopher",
    "riccardo-farinazzo-lGIOSX7t1Mo-unsplash": "bronze",
    "nils-kaEhf0eZme8-unsplash": "facade",
    "chris-czermak-PamFFHL6fVY-unsplash": "trevi",
    "art-institute-of-chicago-ipSboBjLyGM-unsplash": "battle",
    "adrianna-geo-1rBg5YSi00c-unsplash": "ceiling",
    "content-pixie-kAkmmMwNIJo-unsplash": "statue-night",
    "levi-meir-clancy-XpxRqoyUcVw-unsplash": "drapery",
}

SIZES = {"": (2000, 2600), "-sm": (800, 800)}

# Scans of paintings that carry a dark mount or a light edge: trim this fraction from every
# side, so a work can dissolve into the page without a frame showing at its edge.
TRIM = {"death-of-socrates": 0.022, "battle": 0.012}


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    missing = [stem for stem in ART if not (SOURCE / f"{stem}.jpg").exists()]
    if missing:
        sys.exit(f"missing in {SOURCE}: {', '.join(missing)}")
    total = 0
    sizes: dict[str, dict[str, list[int]]] = {}
    for stem, slug in ART.items():
        with Image.open(SOURCE / f"{stem}.jpg") as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        if slug in TRIM:
            dx, dy = round(image.width * TRIM[slug]), round(image.height * TRIM[slug])
            image = image.crop((dx, dy, image.width - dx, image.height - dy))
        for suffix, box in SIZES.items():
            copy = image.copy()
            copy.thumbnail(box, Image.Resampling.LANCZOS)
            target = OUT / f"{slug}{suffix}.webp"
            copy.save(target, "WEBP", quality=78 if not suffix else 76, method=6)
            sizes.setdefault(slug, {})["sm" if suffix else "full"] = [copy.width, copy.height]
            total += target.stat().st_size
        print(f"{slug:18} {image.width}×{image.height}")
    lines = [f'  "{slug}": {json.dumps(size, separators=(", ", ": "))}' for slug, size in sizes.items()]
    SIZES_FILE.write_text("{\n" + ",\n".join(lines) + "\n}\n")
    print(f"{len(ART)} images, {total / 1e6:.1f} MB in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    build()
