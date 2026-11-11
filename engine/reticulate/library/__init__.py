"""The avatar library: shipped personas plus the user's own avatars.

Personas live in reticulate/library/personas and are read-only. Avatars made in the
interface are stored as YAML files in the avatars directory (engine/avatars by default,
not committed to git).
"""

import re
from functools import cache
from importlib.resources import files
from pathlib import Path

import yaml

from reticulate.config import settings
from reticulate.profile import CognitiveProfile


def _read(path: Path, origin: str) -> CognitiveProfile:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if data.get("id") != path.stem:
        raise ValueError(f"{path.name}: id must match the file name")
    return CognitiveProfile.model_validate({**data, "origin": origin})


class Library:
    def __init__(self, profiles: list[CognitiveProfile], user_dir: Path | None = None):
        self._profiles = {p.id: p for p in profiles}
        if len(self._profiles) != len(profiles):
            raise ValueError("duplicate profile ids in library")
        self.user_dir = user_dir

    @classmethod
    def load(cls, directory: Path | None = None, user_dir: Path | None = None) -> "Library":
        root = directory or Path(str(files("reticulate.library").joinpath("personas")))
        profiles = [_read(path, "library") for path in sorted(root.glob("*.yaml"))]
        if user_dir and user_dir.exists():
            profiles += [_read(path, "user") for path in sorted(user_dir.glob("*.yaml"))]
        return cls(profiles, user_dir)

    def list(self) -> list[CognitiveProfile]:
        return list(self._profiles.values())

    def get(self, profile_id: str) -> CognitiveProfile:
        return self._profiles[profile_id]

    def resolve(self, ref: str | CognitiveProfile) -> CognitiveProfile:
        """Accept a library id or an inline profile."""
        return ref if isinstance(ref, CognitiveProfile) else self.get(ref)

    def new_id(self, name: str) -> str:
        base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40] or "avatar"
        candidate, n = base, 2
        while candidate in self._profiles:
            candidate, n = f"{base}_{n}", n + 1
        return candidate

    def save(self, profile: CognitiveProfile) -> CognitiveProfile:
        """Create or replace one of the user's avatars."""
        if not self.user_dir:
            raise ValueError("no directory for user avatars")
        existing = self._profiles.get(profile.id)
        if existing and existing.origin == "library":
            raise ValueError(f"'{profile.id}' is a shipped persona; save a copy under a new id")
        profile = profile.model_copy(update={"origin": "user"})
        self.user_dir.mkdir(parents=True, exist_ok=True)
        data = profile.model_dump(mode="json", exclude={"origin"}, exclude_none=True)
        (self.user_dir / f"{profile.id}.yaml").write_text(
            yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8"
        )
        self._profiles[profile.id] = profile
        return profile

    def delete(self, profile_id: str) -> None:
        profile = self._profiles[profile_id]
        if profile.origin != "user" or not self.user_dir:
            raise ValueError(f"'{profile_id}' is a shipped persona and cannot be deleted")
        (self.user_dir / f"{profile_id}.yaml").unlink(missing_ok=True)
        del self._profiles[profile_id]


@cache
def default_library() -> Library:
    return Library.load(user_dir=settings().avatars_dir)
