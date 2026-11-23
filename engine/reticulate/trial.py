"""Free decisions on the house key, for visitors to reticulate.space who have no key of their own.

The public engine stores nothing, so the trial is carried by the visitor in two signed tokens:

- a pass, kept in their browser: how many free decisions they have started. Each new free
  decision spends one and comes back re-signed.
- a grant, kept on each free decision: the decision's id and an expiry, signed. The rest of that
  decision (analysis, dialogue, conclusion, the minds) runs on the house key while it holds.

Both are signed with a secret derived from the house key, so neither can be forged or edited.
A visitor can still start over by clearing their browser; a per-network limit slows that down,
and the hard cap on spending is the spend limit set on the key in the Claude Console.

Settings: RETICULATE_HOUSE_KEY (the key; no trial without it), RETICULATE_TRIAL_DECISIONS
(free decisions per visitor, default 3), RETICULATE_TRIAL_DAYS (how long a free decision can be
worked on, default 14).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass

HOUSE_KEY = "RETICULATE_HOUSE_KEY"


def house_key() -> str | None:
    key = os.getenv(HOUSE_KEY, "").strip()
    return key if key.startswith("sk-ant-") else None


def decisions() -> int:
    return int(os.getenv("RETICULATE_TRIAL_DECISIONS", "3"))


def days() -> int:
    return int(os.getenv("RETICULATE_TRIAL_DAYS", "14"))


def offered() -> dict | None:
    """What the trial offers, for the status; None when there is no house key."""
    return {"decisions": decisions(), "days": days()} if house_key() and decisions() > 0 else None


def _sign(message: str) -> str:
    secret = hashlib.sha256(b"reticulate trial v1\0" + (house_key() or "").encode()).digest()
    digest = hmac.new(secret, message.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest[:24]).decode().rstrip("=")


def _valid(message: str, signature: str) -> bool:
    return hmac.compare_digest(_sign(message), signature)


# ---- the pass: free decisions started --------------------------------------------------------


@dataclass(frozen=True)
class Pass:
    id: str
    used: int

    @property
    def left(self) -> int:
        return max(0, decisions() - self.used)

    @property
    def token(self) -> str:
        message = f"{self.id}.{self.used}"
        return f"{message}.{_sign(message)}"


def read_pass(token: str | None) -> Pass:
    """The visitor's pass; a missing or altered one starts a fresh pass."""
    try:
        pass_id, used, signature = (token or "").split(".")
        if _valid(f"{pass_id}.{used}", signature):
            return Pass(pass_id, int(used))
    except ValueError:
        pass
    return Pass(secrets.token_hex(8), 0)


def spend(p: Pass) -> Pass:
    return Pass(p.id, p.used + 1)


# ---- the grant: one free decision ------------------------------------------------------------


def grant(decision_id: str, now: float | None = None) -> str:
    expires = int((time.time() if now is None else now) + days() * 86400)
    return f"{expires}.{_sign(f'{decision_id}.{expires}')}"


def granted(decision_id: str, token: str | None, now: float | None = None) -> bool | None:
    """True while the grant holds, False once it has expired, None if it is not a grant for this decision."""
    try:
        expires, signature = (token or "").split(".")
        if not _valid(f"{decision_id}.{expires}", signature):
            return None
        return int(expires) > (time.time() if now is None else now)
    except ValueError:
        return None


# ---- a brake per network ---------------------------------------------------------------------
# In memory, so per running instance: it slows a loop down, it is not an accounting.

CALLS_PER_HOUR = 120
_seen: dict[str, deque[float]] = defaultdict(deque)


def allow(ip: str, now: float | None = None) -> bool:
    """Count one call on the house key from this network; False once it is over the hourly limit."""
    now = time.time() if now is None else now
    calls = _seen[ip]
    while calls and calls[0] < now - 3600:
        calls.popleft()
    if len(calls) >= CALLS_PER_HOUR:
        return False
    calls.append(now)
    return True
