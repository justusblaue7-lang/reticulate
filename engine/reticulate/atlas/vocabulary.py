"""Term categories for decoding, from the Cognitive Atlas.

The Cognitive Atlas (Poldrack et al., 2011) is a curated ontology of mental concepts,
experimental tasks and disorders. A vocabulary term counts as a concept, task or disorder
when it matches the name or an alias of an atlas entry after normalisation (case,
punctuation, a plural ending, a trailing "task"). Anatomical terms are recognised with a
word list so that decoding can leave them out: a structure that decodes to its own name says
nothing about its function. Everything else is "other" (methods, populations, molecules …).
"""

import json
import os
import re
import urllib.request
from pathlib import Path

COGNITIVE_ATLAS_DIR = Path(os.getenv("RETICULATE_COGNITIVE_ATLAS", Path.home() / "cognitiveatlas_data"))
COGNITIVE_ATLAS_URL = "https://www.cognitiveatlas.org/api/v-alpha/{}?format=json"
KINDS = ("concept", "task", "disorder")
CATEGORIES = {
    "concept": "Cognitive Atlas concept",
    "task": "Cognitive Atlas task",
    "disorder": "Cognitive Atlas disorder",
    "anatomy": "Anatomical term",
    "other": "Other term",
}

# A term is anatomical if it contains a structure noun, or consists only of location words.
ANATOMY_NOUNS = set(
    """cortex cortices cortical gyrus gyri sulcus sulci lobe lobes lobule lobules nucleus nuclei thalamus thalamic
    amygdala amygdalae hippocampus hippocampal insula insular striatum striatal putamen caudate pallidum accumbens
    cerebellum cerebellar brainstem pons pontine medulla midbrain mesencephalon precuneus cuneus cingulate cingulum
    fusiform operculum opercular callosum fornix septum septal hypothalamus hypothalamic claustrum tegmentum
    tegmental nigra colliculus colliculi geniculate pulvinar habenula vermis ventricle ventricles tract tracts
    fasciculus capsule brodmann ba commissure uncus tectum tonsil flocculus subthalamic amygdaloid parahippocampal
    entorhinal perirhinal orbitofrontal prefrontal premotor precentral postcentral supramarginal angular lingual
    calcarine pericalcarine rolandic sylvian heschl planum splenium genu rostrum vmpfc dlpfc vlpfc dmpfc mpfc ofc
    acc pcc tpj ifg mfg sfg stg mtg itg ips fef sma presma ppc v1 v2 v3 v4 v5 mt mst lgn ffa ppa eba""".split()
)
LOCATION_WORDS = set(
    """frontal parietal temporal occipital limbic anterior posterior superior inferior medial lateral dorsal ventral
    rostral caudal left right bilateral middle mid area areas region regions gray grey white matter hemisphere
    hemispheres hemispheric lobar pole poles basal ganglia deep subcortical cerebral brain dorsomedial
    ventromedial dorsolateral ventrolateral anterolateral posteromedial frontoparietal frontotemporal
    temporoparietal parietooccipital occipitotemporal""".split()
)


def fetch_cognitive_atlas(directory: Path = COGNITIVE_ATLAS_DIR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for kind in KINDS:
        path = directory / f"{kind}.json"
        if not path.exists():
            print(f"downloading Cognitive Atlas {kind}s …")
            urllib.request.urlretrieve(COGNITIVE_ATLAS_URL.format(kind), path)
    return directory


def normalise(text: str) -> str:
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _variants(key: str) -> list[str]:
    out = [key]
    if key.endswith("ies"):
        out.append(key[:-3] + "y")
    elif key.endswith("s") and not key.endswith("ss"):
        out.append(key[:-1])
    if key.endswith(" task"):
        out.append(key[:-5])
    return out


class CognitiveAtlas:
    def __init__(self, directory: Path = COGNITIVE_ATLAS_DIR):
        self.entries: dict[str, tuple[str, str, str]] = {}  # normalised name -> (kind, id, name)
        for kind in KINDS:  # concepts take precedence over tasks, tasks over disorders
            for entry in json.loads((directory / f"{kind}.json").read_text(encoding="utf-8")):
                name = str(entry.get("name") or "").strip()
                if not name:
                    continue
                aliases = [a.strip() for a in re.split(r"[;,]", str(entry.get("alias") or "")) if len(a.strip()) >= 4]
                for label in [name, *aliases]:
                    for key in _variants(normalise(label)):
                        self.entries.setdefault(key, (kind, str(entry["id"]), name))

    def match(self, term: str) -> tuple[str, str, str] | None:
        key = normalise(term)
        if len(key) < 3:
            return None
        for candidate in [*_variants(key), f"{key} task"]:
            if candidate in self.entries:
                return self.entries[candidate]
        return None


def is_anatomical(term: str) -> bool:
    words = normalise(term).split()
    if not words:
        return False
    return any(w in ANATOMY_NOUNS for w in words) or all(w in LOCATION_WORDS or w in ANATOMY_NOUNS for w in words)


def categorise(term: str, atlas: CognitiveAtlas) -> tuple[str, str | None, str | None]:
    """(category, Cognitive Atlas id, Cognitive Atlas name)."""
    if is_anatomical(term):
        return "anatomy", None, None
    hit = atlas.match(term)
    if hit:
        kind, entry_id, name = hit
        return kind, entry_id, name
    return "other", None, None
