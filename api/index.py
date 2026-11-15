"""Vercel entry point for reticulate.space: the stateless public engine (engine/reticulate/public.py)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))

from reticulate.public import app  # noqa: E402

__all__ = ["app"]
