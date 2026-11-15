"""A decision as Markdown: the readable copy written next to every record (decision.md)."""

from reticulate import __version__
from reticulate.decision.schemas import Decision
from reticulate.science import science

LEVEL = {"strong": "strong", "partial": "partial", "weak": "weak"}
NOTICE = "Reticulate asks; you decide. Nothing here is financial, legal or medical advice."
STATUS = {"open": "not examined yet", "holds": "holds", "shaky": "shaky", "dropped": "dropped"}


def _bullets(items: list[str]) -> list[str]:
    return [f"- {item}" for item in items]


def _section(title: str, lines: list[str]) -> list[str]:
    return ["", f"## {title}", "", *lines] if lines else []


def _sub(title: str, lines: list[str]) -> list[str]:
    return ["", f"### {title}", "", *lines] if lines else []


def _title(decision: Decision) -> str:
    notes = decision.dialogue.notes if decision.dialogue else None
    if notes and notes.decision:
        return notes.decision
    if decision.frame:
        return decision.frame.decision
    return decision.problem.question


def markdown(decision: Decision) -> str:
    sci = science()
    stages = {s.id: s.name for s in sci.socratic.stages}
    moves = {m.id: m for m in sci.socratic.moves}
    mechanisms = {m.id: m for m in sci.mechanisms}
    dialogue = decision.dialogue
    conclusion = dialogue.conclusion if dialogue else None

    out = [f"# {_title(decision)}", "", f"*{decision.created_at:%d %B %Y} · Reticulate {__version__}*"]
    out += ["", f"> {decision.problem.question}"]
    if decision.problem.options:
        out += [">", "> Options: " + " · ".join(decision.problem.options)]
    if decision.problem.context:
        out += [">", *[f"> {line}" for line in decision.problem.context.splitlines()]]

    if conclusion:
        head = "Your decision" if conclusion.decided else "Where you stand"
        lines = [f"**{conclusion.statement}**"]
        lines += _sub("Reasons", _bullets(conclusion.reasons))
        lines += _sub("What you give up", _bullets(conclusion.tradeoffs))
        lines += _sub("Look at it again if", _bullets(conclusion.revisit_if))
        lines += _sub("First step", [conclusion.first_step, "", f"*{conclusion.if_then}*"] if conclusion.first_step else [])
        if conclusion.review:
            lines += ["", f"Review: {conclusion.review}"]
        if conclusion.pattern_notes:
            dims = {d.id: d.name for d in sci.dimensions}
            lines += _sub(
                "Your pattern in this decision, as Claude reads the dialogue",
                [f"- **{dims.get(n.dimension, n.dimension)}.** {n.note}" for n in conclusion.pattern_notes],
            )
        if conclusion.quality:
            rows = ["| Element | Coverage | Note |", "|---|---|---|"]
            rows += [f"| {stages.get(q.stage, q.stage)} | {LEVEL[q.level]} | {q.note} |" for q in conclusion.quality]
            lines += _sub("Decision quality, as Claude reads the dialogue", rows)
        out += _section(head, lines)
        todo = [f"- [{'x' if q in decision.settled else ' '}] {q}" for q in conclusion.open_questions]
        out += _section("Before you act", todo)

    if dialogue and dialogue.exchanges:
        lines: list[str] = []
        for i, exchange in enumerate(dialogue.exchanges, 1):
            turn = exchange.turn
            move = moves.get(turn.move)
            tag = f"{stages.get(turn.stage, turn.stage)} · {move.name if move else turn.move}"
            if turn.mechanism_id in mechanisms:
                tag += f" · against {mechanisms[turn.mechanism_id].name.lower()}"
            if turn.pattern != "none":
                dim = sci.dimension(turn.pattern)
                value = (dialogue.pattern or {}).get(turn.pattern, 5)
                tag += f" · for your leaning toward {(dim.low_pole if value < 5 else dim.high_pole).lower()}"
            if turn.reflection:
                lines += [f"*{turn.reflection}*", ""]
            lines += [f"**{i}. {turn.question}**  ", f"<sub>{tag}</sub>"]
            if exchange.skipped:
                lines += ["", "> *(skipped)*"]
            elif exchange.answer is not None:
                lines += ["", *[f"> {line}" if line else ">" for line in exchange.answer.splitlines()]]
            lines.append("")
        if dialogue.pattern:
            from reticulate.pattern import leanings

            found = leanings(dialogue.pattern)
            held = ", ".join(
                f"{(sci.dimension(x.dimension).low_pole if x.pole == 'low' else sci.dimension(x.dimension).high_pole).lower()}"
                f" ({sci.dimension(x.dimension).name.lower()} {x.value:g}/10)"
                for x in found
            )
            when = f", self-rated on {dialogue.pattern_at:%d %B %Y}" if dialogue.pattern_at else ""
            lines = [f"*Held with your pattern{when}: {held or 'no pronounced leaning'}.*", "", *lines]
        out += _section("The dialogue", lines[:-1])

        notes = dialogue.notes
        if notes:
            lines = []
            lines += _sub("What matters", _bullets(notes.goals))
            lines += _sub("Options", _bullets(notes.options))
            lines += _sub("Facts", _bullets(notes.facts))
            lines += _sub("Unknowns", _bullets(notes.unknowns))
            lines += _sub("Assumptions", [f"- {a.text} ({STATUS[a.status]})" for a in notes.assumptions])
            if notes.leaning:
                sure = f", {notes.confidence}/10 sure" if notes.confidence >= 0 else ""
                lines += ["", f"Leaning: {notes.leaning}{sure}"]
            out += _section("Working notes", lines)

    rated = [r for r in decision.anatomy if r.level > 0]
    if rated and not decision.watch_outs:
        levels = ["absent", "minor", "present", "central"]
        features = {f.id: f.name for f in sci.features}
        lines = [f"- {features.get(r.feature_id, r.feature_id)}: {levels[r.level]}" + (f". {r.reason}" if r.reason else "") for r in sorted(rated, key=lambda r: -r.level)]
        out += _section("What's at play", lines)

    if decision.watch_outs:
        lines = []
        for note in decision.watch_outs:
            mechanism = mechanisms.get(note.mechanism_id)
            if not mechanism:
                continue
            basis = "tested" if mechanism.countermove.basis == "tested" else "derived, not tested as an intervention"
            lines += [f"- **{mechanism.name}.** {note.here} *What to do:* {note.check} ({basis})"]
        out += _section("Watch out for", lines)

    panel = decision.panel
    if panel:
        names = {p.id: p.person.name if p.person else p.name for p in panel.profiles}
        lines = []
        for pid, views in panel.perspectives.items():
            tally = panel.space.recommendations.get(pid)
            view = views[0]
            share = f" ({tally.counts.get(tally.option, 0)}/{len(views)} runs)" if tally and len(views) > 1 else ""
            lines.append(f"- **{names.get(pid, pid)}** → {tally.option if tally else view.recommendation}{share}: {view.summary}")
        if panel.synthesis:
            lines += ["", panel.synthesis.overview]
        out += _section("The panel (simulated decision-makers)", lines)

    usage = decision.usage
    cost = f", {usage.calls} Claude calls, ${usage.cost_usd:.2f} at list price" if usage.calls and usage.cost_usd else ""
    model = decision.meta.model or (dialogue.meta.model if dialogue else None)
    notice = decision.notice if panel else NOTICE
    out += ["", "---", "", f"<sub>Model: {model or 'none'}{cost}. {notice}</sub>", ""]
    return "\n".join(out)
