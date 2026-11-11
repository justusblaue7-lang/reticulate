"""Command-line interface: `reticulate avatars | simulate | sensitivity | build-atlas | serve`."""

import argparse
import asyncio

from reticulate import runs
from reticulate.config import settings
from reticulate.library import default_library
from reticulate.simulation import ClaudeEngine, Problem, sensitivity, simulate


def _engine() -> ClaudeEngine:
    config = settings()
    if not config.claude_configured:
        raise SystemExit("Claude is not configured: connect it in the app or add ANTHROPIC_API_KEY to engine/.env")
    return ClaudeEngine(config.model, config.effort, dialogue_effort=config.dialogue_effort)


def _avatars(_: argparse.Namespace) -> None:
    for p in default_library().list():
        scores = " ".join(f"{v.value:>3g}" for v in p.dimensions.values())
        print(f"{p.id:<34} {scores}   {p.name}")


def _simulate(args: argparse.Namespace) -> None:
    library = default_library()
    profiles = [library.get(pid) for pid in args.profile]
    problem = Problem(question=args.question, context=args.context)
    result = asyncio.run(simulate(problem, profiles, _engine(), replicates=args.replicates))
    path = runs.save(result)
    print(f"Decision: {result.frame.decision}\n")
    for p in profiles:
        t = result.space.recommendations[p.id]
        print(f"[{p.name}] -> {t.option}  {t.counts}")
    print("\nMean factor weight (most contested first):")
    print(f"{'':<30}" + "".join(f"{p.id[:12]:>14}" for p in profiles))
    for f in result.space.factors:
        cells = "".join(f"{f.weights[p.id].mean:>14.1f}" if p.id in f.weights else f"{'-':>14}" for p in profiles)
        print(f"{f.name[:28]:<30}{cells}{' *' if f.contested else ''}")
    print(f"\nSaved to {path}")


def _sensitivity(args: argparse.Namespace) -> None:
    profile = default_library().get(args.profile)
    problem = Problem(question=args.question, context=args.context)
    result = asyncio.run(
        sensitivity(problem, profile, args.dimension, args.values, _engine(), replicates=args.replicates)
    )
    path = runs.save(result)
    for c in result.curves:
        se = f" ± {c.slope_se:.2f}" if c.slope_se is not None else ""
        means = "  ".join(f"{p.value:g}:{p.mean:.1f}" for p in c.points)
        print(f"{c.name[:30]:<32} slope {c.slope:+.2f}{se:<8}  {means}")
    print(f"\nSaved to {path}")


def _serve(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run("reticulate.api:app", host=args.host, port=args.port, reload=args.reload)


def _build_atlas(_: argparse.Namespace) -> None:
    from reticulate.atlas.build import build

    build()


def main() -> None:
    parser = argparse.ArgumentParser(prog="reticulate")
    commands = parser.add_subparsers(required=True)

    sub = commands.add_parser("avatars", help="list the avatar library")
    sub.set_defaults(run=_avatars)

    for name, run, help_ in (("simulate", _simulate, "compare avatars on a decision"),
                             ("sensitivity", _sensitivity, "dose–response run on one dimension")):
        sub = commands.add_parser(name, help=help_)
        sub.add_argument("question")
        sub.add_argument("--context", default="")
        sub.add_argument("-r", "--replicates", type=int, default=1)
        sub.set_defaults(run=run)
        if name == "simulate":
            sub.add_argument("-p", "--profile", action="append", required=True, help="avatar id (repeatable)")
        else:
            sub.add_argument("-p", "--profile", required=True)
            sub.add_argument("-d", "--dimension", required=True)
            sub.add_argument("-v", "--values", type=float, nargs="+", default=[0, 2.5, 5, 7.5, 10])

    sub = commands.add_parser("build-atlas", help="regenerate the atlas assets in web/public/atlas")
    sub.set_defaults(run=_build_atlas)

    sub = commands.add_parser("serve", help="run the HTTP API")
    sub.add_argument("--host", default="127.0.0.1")
    sub.add_argument("--port", type=int, default=8000)
    sub.add_argument("--reload", action="store_true")
    sub.set_defaults(run=_serve)

    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
