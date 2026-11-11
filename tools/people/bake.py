"""Render the stills of the 3D people (face.webp, portrait.webp) with the app's own stage.

Start the interface first (./Reticulate.command, or `npm run dev` in web/), then:

    engine/.venv/bin/python tools/people/bake.py [--only male_adult_12 …] [--url http://127.0.0.1:5173]

The page /?people-bake renders every person in headless Chrome; this script collects the
images and writes them next to each model in web/public/people.
"""

import argparse
import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from chrome import chrome  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "people"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--url", default="http://127.0.0.1:5173")
    args = parser.parse_args()
    query = f"?people-bake{'&only=' + ','.join(args.only) if args.only else ''}"
    with chrome() as browser:
        page = browser.open(args.url + "/" + query, 900, 900)
        page.wait("window.__bakeDone === true", timeout=900, every=1)
        stills = json.loads(page.eval("JSON.stringify(window.__stills)"))
        page.close()
    for look, images in stills.items():
        for kind, url in images.items():
            png = base64.b64decode(url.split(",", 1)[1])
            Image.open(io.BytesIO(png)).save(OUT / look / f"{kind}.webp", "WEBP", quality=90, method=6)
        print(f"{look}: face.webp, portrait.webp")
    print(f"{len(stills)} people baked")


if __name__ == "__main__":
    main()
