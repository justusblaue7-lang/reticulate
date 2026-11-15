"""Reasoning engine: every simulation stage, and every turn of the dialogue, is a
structured-output call to Claude."""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import TYPE_CHECKING, Protocol, TypeVar

import anthropic
from pydantic import BaseModel

from reticulate.config import PRICES
from reticulate.profile import CognitiveProfile
from reticulate.simulation import prompts
from reticulate.simulation.schemas import (
    DecisionAnalysis,
    DecisionFrame,
    Perspective,
    PerspectiveSpace,
    Problem,
    Synthesis,
    Usage,
)

if TYPE_CHECKING:
    from reticulate.dialogue.schemas import Conclusion, Exchange, SocraticTurn

T = TypeVar("T", bound=BaseModel)

_usage: ContextVar[list[Usage] | None] = ContextVar("reticulate_usage", default=None)


@contextmanager
def track_usage() -> Iterator[list[Usage]]:
    """Collect the usage of every engine call made inside the block (across asyncio tasks)."""
    calls: list[Usage] = []
    token = _usage.set(calls)
    try:
        yield calls
    finally:
        _usage.reset(token)


def total(calls: list[Usage]) -> Usage:
    out = Usage()
    for call in calls:
        out = out.merge(call)
    return out


class EngineError(RuntimeError):
    """The engine returned no usable result (refusal, truncation, invalid output)."""


class ReasoningEngine(Protocol):
    name: str
    model: str | None
    effort: str | None
    dialogue_effort: str | None

    async def ask(self, problem: Problem, exchanges: "list[Exchange]", pattern: dict[str, float] | None = None) -> "SocraticTurn": ...

    async def conclude(
        self, problem: Problem, exchanges: "list[Exchange]", pattern: dict[str, float] | None = None
    ) -> "Conclusion": ...

    async def frame(self, problem: Problem) -> DecisionFrame: ...

    async def analyse(self, problem: Problem) -> DecisionAnalysis: ...

    async def perspective(
        self, problem: Problem, frame: DecisionFrame, profile: CognitiveProfile, context: str | None = None
    ) -> Perspective: ...

    async def synthesize(
        self,
        problem: Problem,
        frame: DecisionFrame,
        profiles: list[CognitiveProfile],
        perspectives: dict[str, Perspective],
        space: PerspectiveSpace,
        context: str | None = None,
    ) -> Synthesis: ...


def _clamp(value: int, low: int = 0, high: int = 10) -> int:
    return max(low, min(high, value))


def normalise_perspective(perspective: Perspective, frame: DecisionFrame) -> Perspective:
    """Clamp scales and drop assessments of factors that are not in the frame."""
    known = {f.id for f in frame.factors}
    seen: set[str] = set()
    assessments = []
    for a in perspective.assessments:
        if a.factor_id in known and a.factor_id not in seen:
            seen.add(a.factor_id)
            assessments.append(a.model_copy(update={"weight": _clamp(a.weight)}))
    return perspective.model_copy(update={"assessments": assessments, "confidence": _clamp(perspective.confidence)})


def _price(model: str, usage) -> Usage:
    read = getattr(usage, "cache_read_input_tokens", 0) or 0
    write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    out = Usage(
        calls=1,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_tokens=read,
        cache_write_tokens=write,
    )
    if model in PRICES:
        p_in, p_out, p_read, p_write = PRICES[model]
        cost = (usage.input_tokens * p_in + usage.output_tokens * p_out + read * p_read + write * p_write) / 1e6
        out.cost_usd = round(cost, 4)
    return out


class ClaudeEngine:
    def __init__(
        self,
        model: str,
        effort: str = "high",
        client: anthropic.AsyncAnthropic | None = None,
        dialogue_effort: str = "medium",
    ):
        self.model = model
        self.effort = effort
        self.dialogue_effort = dialogue_effort
        self.name = f"claude:{model}"
        # Resolves credentials from ANTHROPIC_API_KEY (engine/.env is loaded by config).
        self.client = client or anthropic.AsyncAnthropic()

    async def _generate(self, system: str, user: str, schema: type[T], effort: str) -> T:
        return await self._parse(system, [{"role": "user", "content": user}], schema, effort)

    async def _parse(
        self, system: str, messages: list[dict], schema: type[T], effort: str, cached: bool = False, person: str | None = None
    ) -> T:
        extra: dict = {}
        system_param: str | list[dict] = system
        if cached:
            # A dialogue's system prompt is frozen and its conversation only grows, so both are
            # cached: a breakpoint on the system prompt (shared by every dialogue), one on the
            # person's pattern (fixed for the dialogue) and an automatic one on the last
            # message (this dialogue so far).
            system_param = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
            if person:
                system_param.append({"type": "text", "text": person, "cache_control": {"type": "ephemeral"}})
            extra["cache_control"] = {"type": "ephemeral"}
        response = await self.client.beta.messages.parse(
            model=self.model,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            # On a safety decline, re-run on Anthropic's recommended fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=system_param,
            messages=messages,
            output_format=schema,
            **extra,
        )
        calls = _usage.get()
        if calls is not None and response.usage is not None:
            calls.append(_price(response.model or self.model, response.usage))
        if response.stop_reason == "refusal":
            category = response.stop_details.category if response.stop_details else None
            raise EngineError(f"the model declined this request (category: {category})")
        if response.stop_reason == "max_tokens":
            raise EngineError("the response was truncated at max_tokens")
        parsed = response.parsed_output
        if parsed is None:
            raise EngineError(f"no structured output in response {response._request_id}")
        return parsed

    async def frame(self, problem: Problem) -> DecisionFrame:
        system, user = prompts.frame_prompt(problem)
        return await self._generate(system, user, DecisionFrame, effort="medium")

    async def analyse(self, problem: Problem) -> DecisionAnalysis:
        system, user = prompts.analysis_prompt(problem)
        return await self._generate(system, user, DecisionAnalysis, effort="medium")

    async def perspective(self, problem, frame, profile, context=None) -> Perspective:
        system, user = prompts.perspective_prompt(problem, frame, profile, context)
        return normalise_perspective(await self._generate(system, user, Perspective, effort=self.effort), frame)

    async def synthesize(self, problem, frame, profiles, perspectives, space, context=None) -> Synthesis:
        system, user = prompts.synthesis_prompt(problem, frame, profiles, perspectives, space, context)
        return await self._generate(system, user, Synthesis, effort=self.effort)

    async def ask(self, problem: Problem, exchanges: "list[Exchange]", pattern: dict[str, float] | None = None) -> "SocraticTurn":
        from reticulate.dialogue import prompts as dialogue
        from reticulate.dialogue.schemas import SocraticTurn

        messages = dialogue.messages(problem, exchanges)
        return await self._parse(
            dialogue.system_prompt(), messages, SocraticTurn, self.dialogue_effort, cached=True, person=dialogue.person_block(pattern)
        )

    async def conclude(
        self, problem: Problem, exchanges: "list[Exchange]", pattern: dict[str, float] | None = None
    ) -> "Conclusion":
        from reticulate.dialogue import prompts as dialogue
        from reticulate.dialogue.schemas import Conclusion

        messages = dialogue.messages(problem, exchanges, conclude=True)
        return await self._parse(
            dialogue.system_prompt(), messages, Conclusion, self.dialogue_effort, cached=True, person=dialogue.person_block(pattern)
        )
