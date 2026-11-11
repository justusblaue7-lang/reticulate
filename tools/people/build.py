"""Build the 3D people from the Microsoft Rocketbox avatar library (MIT licence).

For every entry of cast.yaml this downloads the avatar's FBX model and textures from GitHub,
keeps the FBX as it is (three.js loads and poses it in the browser) and converts the 2048 px
TGA textures into web-sized WebP files:

    web/public/people/<look>/model.fbx
    web/public/people/<look>/<part>.webp       colour (with alpha where the part has it)
    web/public/people/<look>/<part>_n.webp     normal map
    web/public/people/<look>/<part>_r.webp     roughness, derived from the specular map

A part is a material of the model: head, body, opacity (hair and lashes), and accessories
such as a stethoscope. The script also writes web/public/people/index.json and keeps the
Rocketbox licence next to the assets. Downloads are cached (default
~/Library/Caches/reticulate-people), so a re-run only converts.

Usage:  engine/.venv/bin/python tools/people/build.py [--only male_adult_12] [--cache DIR]
Needs:  curl and Pillow (installed with the engine's neuro extra).
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "people"
CAST = Path(__file__).with_name("cast.yaml")
REPO = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master"
TREE = "https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1"

# Longest edge in px per part and map. The face carries the likeness, so the head keeps
# more resolution than the clothes.
SIZES = {
    "head": {"color": 2048, "normal": 1024, "rough": 512},
    "opacity": {"color": 2048, "normal": 1024, "rough": 512},
    "body": {"color": 1024, "normal": 1024, "rough": 512},
}
DEFAULT_SIZE = {"color": 1024, "normal": 512, "rough": 256}
QUALITY = {"color": 86, "normal": 90, "rough": 80}

LICENCE = """Microsoft Rocketbox avatar library, https://github.com/microsoft/Microsoft-Rocketbox
MIT License. Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Textures were converted to WebP and resized; models are unchanged.
"""


def curl(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    subprocess.run(["curl", "-sfL", "--retry", "3", "-o", str(tmp), url], check=True)
    tmp.rename(dest)


def tree(cache: Path) -> list[str]:
    path = cache / "tree.json"
    if not path.exists():
        curl(TREE, path)
    data = json.loads(path.read_text())
    return [t["path"] for t in data["tree"] if t["type"] == "blob"]


def fetch(source: str, files: list[str], cache: Path) -> Path:
    """Download the model and its textures (not the facial-rig variant, not the preview)."""
    prefix = f"Assets/Avatars/{source}/"
    wanted = [
        p
        for p in files
        if p.startswith(prefix)
        and (p.endswith(".tga") or (p.endswith(".fbx") and not p.endswith("_facial.fbx")))
    ]
    if not wanted:
        raise SystemExit(f"{source}: not found in the Rocketbox repository")
    jobs = [(p, cache / p) for p in wanted if not (cache / p).exists()]
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda job: curl(f"{REPO}/{job[0]}", job[1]), jobs))
    return cache / prefix


def part_and_kind(stem: str) -> tuple[str, str] | None:
    """'m007_head_color' -> ('head', 'color'); variants such as '_acu' are skipped."""
    tokens = stem.split("_")[1:]
    kinds = {"color": "color", "normal": "normal", "specular": "rough"}
    if len(tokens) < 2 or tokens[-1] not in kinds:
        return None
    return "_".join(tokens[:-1]), kinds[tokens[-1]]


def bleed(image: Image.Image) -> Image.Image:
    """Carry the colour of hair and lashes into the transparent pixels around them.

    Under the alpha mask the texture is black; texture filtering mixes that black into the
    visible edge of every hair card, which shows as a dark fringe. Normalised blurs at
    growing radii fill each transparent pixel with the colour of the nearest visible ones."""
    import numpy as np
    from scipy.ndimage import gaussian_filter

    data = np.asarray(image, dtype=np.float32) / 255
    rgb, alpha = data[..., :3], data[..., 3]
    weight = (alpha > 0.5).astype(np.float32)
    filled = rgb * weight[..., None]
    known = weight.copy()
    for sigma in (1, 2, 4, 8, 16, 32):
        colour = np.stack([gaussian_filter(rgb[..., c] * weight, sigma) for c in range(3)], axis=-1)
        mass = gaussian_filter(weight, sigma)[..., None]
        guess = colour / np.maximum(mass, 1e-6)
        fresh = (known < 0.5) & (mass[..., 0] > 1e-3)
        filled[fresh] = guess[fresh]
        known[fresh] = 1
    out = np.concatenate([np.where(weight[..., None] > 0, rgb, filled), alpha[..., None]], axis=-1)
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def convert(src: Path, dest: Path, kind: str, size: int) -> bool:
    """Convert one texture; returns whether the saved image keeps an alpha channel."""
    image = Image.open(src)
    image.load()
    if kind == "rough":
        # Rocketbox specular maps are grey levels of shine; roughness is its inverse.
        grey = image.convert("L")
        image = grey.point(lambda v: max(90, 255 - int(v * 0.95))).convert("RGB")
    elif image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    if kind == "color" and image.mode == "RGBA" and image.getextrema()[3][0] == 255:
        image = image.convert("RGB")  # an opaque alpha channel only costs bytes
    if kind == "color" and image.mode == "RGBA":
        image = bleed(image)
    if max(image.size) > size:
        image = image.resize((size, size), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.save(dest, "WEBP", quality=QUALITY[kind], method=6)
    return image.mode == "RGBA"


def build(entry: dict, files: list[str], cache: Path) -> dict:
    look, source = entry["look"], entry["source"]
    folder = fetch(source, files, cache)
    target = OUT / look
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    fbx = next((folder / "Export").glob("*.fbx"))
    shutil.copyfile(fbx, target / "model.fbx")
    parts: dict[str, list[str]] = {}
    for tga in sorted((folder / "Textures").glob("*.tga")):
        found = part_and_kind(tga.stem)
        if not found:
            continue
        part, kind = found
        size = SIZES.get(part, DEFAULT_SIZE)[kind]
        suffix = {"color": "", "normal": "_n", "rough": "_r"}[kind]
        alpha = convert(tga, target / f"{part}{suffix}.webp", kind, size)
        parts.setdefault(part, []).append(kind)
        if alpha:
            parts[part].append("alpha")
    # Some accessories keep their colour (with alpha) as '<part>_opacity' and their normal
    # and specular maps as '<part>': one material in the model, so one part here.
    for part in [p for p in parts if p.endswith("_opacity")]:
        owner = part.removesuffix("_opacity")
        if owner in parts and "color" not in parts[owner] and "color" in parts[part]:
            (target / f"{part}.webp").rename(target / f"{owner}.webp")
            parts[owner] += [k for k in parts.pop(part) if k in ("color", "alpha")]
    total = sum(f.stat().st_size for f in target.iterdir())
    print(f"{look:22s} {len(parts)} parts  {total / 1e6:4.1f} MB")
    return {"look": look, "source": f"Microsoft Rocketbox: {source}", "parts": {k: sorted(v) for k, v in parts.items()}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only", nargs="*", help="build only these looks")
    parser.add_argument("--cache", type=Path, default=Path.home() / "Library" / "Caches" / "reticulate-people")
    args = parser.parse_args()
    cast = yaml.safe_load(CAST.read_text())["people"]
    files = tree(args.cache)
    manifest_path = OUT / "index.json"
    manifest = {p["look"]: p for p in json.loads(manifest_path.read_text())["people"]} if manifest_path.exists() else {}
    for entry in cast:
        if args.only and entry["look"] not in args.only:
            continue
        manifest[entry["look"]] = build(entry, files, args.cache)
    order = [e["look"] for e in cast]
    people = [manifest[look] for look in order if look in manifest]
    manifest_path.write_text(json.dumps({"licence": "MIT, Microsoft Rocketbox", "people": people}, indent=1) + "\n")
    (OUT / "LICENSE-Rocketbox.txt").write_text(LICENCE)
    print(f"{len(people)} people in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
