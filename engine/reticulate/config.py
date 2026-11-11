"""Runtime settings, read from environment variables and engine/.env."""

import os
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
ENV_FILE = ENGINE_DIR / ".env"
KEY_NAME = "ANTHROPIC_API_KEY"


def load_dotenv(path: Path = ENV_FILE) -> None:
    """Minimal KEY=VALUE reader; real environment variables take precedence."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.split(" #", 1)[0].strip().strip('"').strip("'")
        if value:
            os.environ.setdefault(key.strip(), value)


load_dotenv()


def store_api_key(key: str | None, path: Path | None = None) -> None:
    """Write (or with None remove) the Anthropic key in engine/.env and in this process."""
    path = path or ENV_FILE
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    kept = [line for line in lines if line.strip().partition("=")[0].strip() != KEY_NAME]
    if key:
        kept.append(f"{KEY_NAME}={key}")
        os.environ[KEY_NAME] = key
    else:
        os.environ.pop(KEY_NAME, None)
    path.write_text("".join(f"{line}\n" for line in kept), encoding="utf-8")
    path.chmod(0o600)


def _list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


# List prices in USD per million tokens: input, output, cache read, cache write (5-minute TTL).
PRICES = {"claude-opus-5-5": (4.0, 20.0, 0.20, 5.0)}


@dataclass(frozen=True)
class Settings:
    model: str = field(default_factory=lambda: os.getenv("RETICULATE_MODEL", "claude-opus-5-5"))
    effort: str = field(default_factory=lambda: os.getenv("RETICULATE_EFFORT", "high"))
    concurrency: int = field(default_factory=lambda: int(os.getenv("RETICULATE_CONCURRENCY", "6")))
    runs_dir: Path = field(default_factory=lambda: Path(os.getenv("RETICULATE_RUNS_DIR", ENGINE_DIR / "runs")))
    avatars_dir: Path = field(default_factory=lambda: Path(os.getenv("RETICULATE_AVATARS_DIR", ENGINE_DIR / "avatars")))
    cors_origins: list[str] = field(
        default_factory=lambda: _list("RETICULATE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    )

    @property
    def claude_configured(self) -> bool:
        return bool(os.getenv(KEY_NAME) or os.getenv("ANTHROPIC_AUTH_TOKEN"))

    @property
    def key_hint(self) -> str | None:
        """The key's last four characters, so the user can tell which key is in use."""
        key = os.getenv(KEY_NAME)
        return f"…{key[-4:]}" if key else None


@cache
def settings() -> Settings:
    return Settings()
