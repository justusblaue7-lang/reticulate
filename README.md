# Reticulate

A decision tool built on decision science. You bring a decision; Reticulate questions it in a
**Socratic dialogue**, one question at a time, until you know what matters to you, what you
choose and what you will do first. Beside the dialogue it shows the documented biases that
could pull on the decision (each with a countermove) and the minds you can bring to the
table: simulated decision-makers, each a whole set of attitudes, whose different weighing comes
back to you as a question. Reticulate reads nothing from brain activity; a brain atlas of the
research literature is there to look up, apart from the dialogue.

> Build 0.9. Read [docs/epistemics.md](docs/epistemics.md) before showing results to
> anyone: it states what each part may and may not be taken to mean.

## Open it

Double-click **`Reticulate.command`** in Finder. On first start it sets up Python and the
interface, downloads the brain template and both literature sources, starts everything and
opens <http://localhost:5173>. Close the Terminal window to stop.

The dialogue, the analysis and the panel use Claude with your own Anthropic API key: click
**Connect Claude** at the top right and paste it. Reticulate checks the key with Anthropic and
keeps it in `engine/.env` on this computer. Without a key you can rate a decision yourself
(18 questions) and see the biases that could pull on it.

## How a decision goes

0. **Your pattern** (once, about two minutes). Rate sixteen statements about how you usually
   decide. The dialogue then aims its questions at what your leanings tend to leave out
   (the cost of not acting, for someone cautious; what you would choose if no one knew, for
   someone who weighs others' expectations). It is a self-description, never shown back as a
   label, and stays in `data/pattern.yaml`.
1. **Ask.** Type the decision ("Should I …"); options and details are optional.
2. **Dialogue.** Reticulate asks one question at a time and reflects your answers back. The
   questions walk through the six elements of decision quality (frame, what matters,
   options, evidence, trade-offs, commitment); each says why it is asked, and where a bias
   fits what you said, the question is its countermove. Your **working notes** (what
   matters, options, unknowns, assumptions, your leaning) build up beside the dialogue. You
   can skip a question, change an earlier answer, or decide whenever you are ready.
3. **Your decision.** In your own words: the choice, why, what you give up, when to look
   again, the first step as an if–then plan, the open questions to settle (a checklist),
   and how well the dialogue covered each element of decision quality.
4. **Minds at the table** (optional), beside the dialogue. Each mind shows the attitudes it
   reasons from (its pronounced leanings; open it for priorities, values, goals and
   constraints). Pick who should weigh in and ask them; each one's take appears on its card,
   and what they weigh differently comes back into your dialogue as a question. Their full
   reasoning is under "Their reasoning". They are perspectives to question, not votes.
5. **Biases** fill in by themselves: Claude's analysis runs in the background while you talk.

Every step is saved at once. A dialogue costs about $0.04 a question (usually under $0.60 in
total); the app states the cost before every paid step.

## Where things are

```
Reticulate.command      start the app (double-click)
data/                   everything you make: decisions, your avatars, research runs
                        (see data/README.md; stays on this computer, not in git)
engine/                 Python: science data, the dialogue, decision engine, atlas, API
  reticulate/data/      curated science (YAML): dialogue stages and moves, mechanisms,
                        decision features, dimensions, personality, regions, references
  reticulate/dialogue/  the Socratic dialogue: prompts, turns, conclusion
  reticulate/decision/  analysis, biases from the anatomy, panel
  reticulate/library/   the eleven fictional people (personas)
  tests/                pytest suite
web/                    React + three.js interface
  src/people/           the 3D people: loader, pose, studio, viewer
  public/people/        their models and textures (Microsoft Rocketbox, MIT licence)
tools/                  build scripts: tools/people (3D people), tools/chrome.py
docs/                   architecture, science, epistemics, roadmap
```

Each decision is a folder in `data/decisions/` with `decision.md` (to read; open it in VS Code
with ⇧⌘V for the preview) and `decision.json` (the full record). "Show in folder" in the app
opens it in Finder.

## Saving versions of the project

The project is a git repository. Your data in `data/` is kept out of it on purpose; the code,
science files and docs are in it. To save a version after you changed something: in VS Code,
open Source Control (⌃⇧G), write a short message, click **Commit**. From a terminal:
`git add -A && git commit -m "what changed"`. `git log` lists the versions.

## Developer commands

```bash
cd engine && source .venv/bin/activate
pytest                         # tests; literature tests run when the data are installed
reticulate build-atlas         # regenerate the atlas assets (~30 s once data are downloaded)
reticulate avatars
reticulate simulate "…" -p venture_capitalist -p municipal_treasurer -r 3
reticulate sensitivity "…" -p cooperative_bank_credit_officer -d risk_tolerance -r 3
reticulate serve               # API on :8000
cd ../web && npm run dev       # interface on :5173

# from the project folder:
engine/.venv/bin/python tools/people/build.py   # rebuild the 3D people (tools/people/cast.yaml)
engine/.venv/bin/python tools/people/bake.py    # re-render their portraits (app must be running)
```

Settings live in `engine/.env` (see `engine/.env.example`): `ANTHROPIC_API_KEY`,
`RETICULATE_MODEL` (default `claude-haiku-5-5`), `RETICULATE_EFFORT` (panel, default `high`),
`RETICULATE_DIALOGUE_EFFORT` (dialogue, default `medium`), `RETICULATE_CONCURRENCY`,
`RETICULATE_DATA_DIR` (default `data/`). Claude calls opt into server-side refusal fallback
(on models that have it); the dialogue's system prompt and conversation are prompt-cached.

### reticulate.space

The public site (`VITE_PUBLIC=1`, engine `reticulate.public`, deployed on Vercel) stores
nothing: decisions live in the visitor's browser, and Claude runs on the visitor's own key.
Visitors without one get free decisions on the house key, set in Vercel's environment:
`RETICULATE_HOUSE_KEY` (no free decisions without it), `RETICULATE_TRIAL_DECISIONS`
(default 3 per visitor) and `RETICULATE_TRIAL_DAYS` (how long a free decision can be worked
on, default 14). The visitor's count and each free decision carry a signature, so neither can
be forged; a visitor can still clear their browser and start over, which a per-network limit
slows down. The real cap is the spend limit on that key in the Claude Console.

## Data sources

Downloaded once on first build: fsaverage and its annotations (FreeSurfer, via MNE-Python,
`~/mne_data`), the NeuroQuery model (Dockès et al., 2020), Neurosynth release 7 (Yarkoni et
al., 2011) and the Cognitive Atlas (Poldrack et al., 2011). The 3D people are from the
Microsoft Rocketbox avatar library (MIT licence; `web/public/people/LICENSE-Rocketbox.txt`).
References: `engine/reticulate/data/references.yaml`.

## Documentation

- [docs/architecture.md](docs/architecture.md): components, data flow, API, storage, extension points
- [docs/science.md](docs/science.md): the dialogue, mechanisms, avatars, the atlas, both literatures
- [docs/epistemics.md](docs/epistemics.md): what the dialogue, the minds and the atlas may claim
- [docs/roadmap.md](docs/roadmap.md): next steps toward the thesis
