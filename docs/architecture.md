# Architecture

## Components

```
web/ (React, three.js)                          engine/ (Python, FastAPI)
┌──────────────────────────────┐   /api   ┌────────────────────────────────────────────────┐
│ Decide · Avatars · Atlas     │ ───────▶ │ api.py           one lock per decision         │
│                              │          │  ├─ science.py    data/*.yaml, cross-checked   │
│ views/DecisionView — the     │          │  ├─ dialogue/     Socratic turns, conclusion   │
│   dialogue and its tabs      │          │  ├─ decision/     analysis, signature, panel,  │
│ people/ — 3D people (FBX →   │          │  │                tipping points               │
│   posed, lit, spinnable)     │          │  ├─ simulation/   prompts → Claude → analysis  │
│ brain/renderer.ts — one      │          │  ├─ library/      personas + data/avatars      │
│   shared brain renderer      │          │  ├─ atlas/        geometry, literature, build  │
└──────────────┬───────────────┘          │  ├─ runs.py       data/decisions, data/runs    │
               │ static                   │  └─ report.py     decision.md                  │
               ├── web/public/atlas  ◀── reticulate build-atlas ──▶ engine/.cache
               └── web/public/people ◀── tools/people/build.py, bake.py
```

## The dialogue (`reticulate/dialogue/`)

```
Problem ─▶ POST /api/decisions: the record, an empty dialogue, analysis "pending"
              │                 └─▶ background task: analyse (frame, anatomy, watch-outs)
              ▼                                      ─▶ applied to the latest record
         POST …/dialogue: record the answer (saved at once), then engine.ask(history)
              │            ─▶ SocraticTurn {reflection, question, move, stage, mechanism,
              │               why, scale, notes, ready} appended to the latest record
              ▼  (repeat; skip, change an earlier answer, panel notes join the next answer)
         POST …/dialogue/conclude ─▶ Conclusion {choice, statement, reasons, trade-offs,
                                    revisit_if, open questions, first step, if–then,
                                    review, quality per stage}
```

- **Prompt.** `dialogue/prompts.py` compiles one frozen system prompt from
  `data/socratic.yaml` (stages, moves) and `data/mechanisms.yaml` (countermoves). The
  conversation is replayed as alternating messages: the decision, each turn as the JSON the
  model returned, each answer. Both the system prompt and the conversation carry cache
  breakpoints, so a turn pays full price only for what is new. App notes travel inside the
  person's messages in `<note>` and `<panel>` tags. Thinking blocks are not replayed; the
  turn's structured output (with the working notes) carries the state.
- **Pure changes, locked saves.** Engine calls only read a decision; `record_answer`,
  `add_turn`, `conclude`, `revise`, `reopen`, `queue_note` and the decision's `with_*`
  functions return a copy. The API applies them to the latest saved record under a
  per-decision lock, so the dialogue, the background analysis and a running panel never
  overwrite each other. A change that no longer fits (the dialogue moved on) answers 409.
- **The panel in the dialogue.** When a panel finishes, a digest of its result (who chose
  what, where they differ, blind spots) is queued and sent with the person's next answer;
  the guide then asks one "perspectives" question about it.

## Decision analysis (`reticulate/decision/`)

```
analyse (1 call): frame (options, facts, unknowns, factors) + anatomy (18 features, 0–3)
        + a watch-out per engaged mechanism │ or the person's own answers, without Claude
     ▼
signature (deterministic): composite maps per source, agreement, structures, networks,
dimension relevance, decoding, mechanisms, findings
     ▼
panel: perspective(avatar) × replicates with the neural context ─▶ compare ─▶ synthesis
     ▼
tipping points: sensitivity(avatar, dimension or trait, levels) on the same frame
```

Usage is collected per call through a context variable and priced from `config.PRICES`; a
second context variable counts finished calls into a `Progress` that the API serves while a
panel or tipping run is in flight. Re-rating the anatomy drops panels and tipping runs that
saw the old neural context.

## Storage (`reticulate/runs.py`)

```
data/decisions/<date>-<question>-<id8>/decision.json   the record (Decision)
                                      /decision.md     report.markdown(decision), rewritten on save
data/runs/<time>-<kind>-<id8>.json                     command-line simulations and sensitivity runs
data/avatars/<id>.yaml                                 the user's avatars
```

Writes are atomic (temporary file, then rename). On start, records of builds before 0.5
(`engine/runs`, `engine/avatars`) move into `data/`; each file is written to its new place
and read back before the old copy is removed. Tests use a temporary data folder
(`RETICULATE_DATA_DIR`), and the move only ever targets the project's own `data/`.

## The 3D people

`tools/people/cast.yaml` lists the people: eleven personas and a cast for the user's own
avatars, all from the Microsoft Rocketbox library (MIT). `tools/people/build.py` downloads
each FBX model and its 2048 px TGA textures, keeps the model as it is and converts the
textures to WebP (colour, normal, roughness from the specular map; hair and lash colour bled
under the alpha mask). `web/src/people/model.ts` loads the FBX with three.js, replaces its
materials with physically based ones and turns the A-pose into a relaxed stance by rotating
four bones. `stage.ts` is a small studio (studio environment light, warm key with soft
shadows, cool rim, contact shadow) with drag to turn, scroll or buttons from the full figure
to the face, and breathing and small head movements. `tools/people/bake.py` renders each
person's stills (`face.webp`, `portrait.webp`) with the same stage in headless Chrome.

A profile's `person` (a fictional name and a `look`) is shown in the interface and never
rendered into a prompt; the simulation sees the role (`name`) only.

## Interface (`web/src`)

- `views/DecisionView.tsx`: the home (one field for the decision) and the workspace with
  four tabs: Dialogue (stage rail, thread, answer box, working notes, the conclusion; other
  minds and biases at the side), Biases (watch-outs, what's at play), Other minds (panel,
  what would flip it) and In the brain.
- `components/decision/`: `Dialogue`, `Notes`, `Conclusion`, `Composer`, `SelfCheck`,
  `WatchOuts`, `AtPlay`, `Panel`, `Tipping`, `Brain`; `model.ts` holds the shared arithmetic
  (verdict, cost estimates, the suggested panel).
- `people/`: `PersonViewer` (3D), `Bake` (/?people-bake); `components/Face.tsx` shows a
  person's still, `PersonModal.tsx` one person in 3D over the page.
- `brain/renderer.ts`: imperative three.js renderer for the atlas; one instance serves all
  views.
- Print styles turn a decision into a cream-paper document with everything unfolded.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | versions, Claude configured (key's last four characters), literature installed, data folder |
| PUT, DELETE | `/api/settings/claude` | `{api_key}`: check it with the Models API and keep it in `engine/.env`; remove it |
| GET | `/api/science` | dimensions, personality, structures, networks, findings, stimuli, features, mechanisms, the dialogue's stages and moves, references |
| GET, POST | `/api/avatars` | list; create or update one of the user's avatars |
| DELETE | `/api/avatars/{id}` | delete a user avatar (personas are read-only) |
| POST | `/api/maps` | `{text}` → maps in both sources, agreement, decoding |
| GET, POST | `/api/decisions` | list; create (`{problem}` starts a dialogue and the background analysis; `{problem, anatomy}` is rated by hand) |
| GET, DELETE | `/api/decisions/{id}` | one decision; delete it with its folder |
| POST | `/api/decisions/{id}/dialogue` | `{answer?, skip?}`: answer the open question and get the next; without an open question, ask the next one |
| POST | `/api/decisions/{id}/dialogue/conclude` | `{answer?}`: the conclusion |
| POST | `/api/decisions/{id}/dialogue/revise` | `{index}`: answer an earlier question again; what came after is dropped |
| POST | `/api/decisions/{id}/dialogue/reopen` | set the conclusion aside and continue |
| PUT | `/api/decisions/{id}/settled` | `{items}`: the open questions ticked off |
| POST | `/api/decisions/{id}/analysis` | start or retry the background analysis |
| POST | `/api/decisions/{id}/reveal` | show the decision's folder in Finder; returns its path |
| GET | `/api/decisions/{id}/progress` | calls done of planned while a panel or tipping run is in flight; else null |
| PUT | `/api/decisions/{id}/anatomy` | re-rate; recomputes the signature |
| POST | `/api/decisions/{id}/panel` | `{profiles[1–8], replicates[1–5], neural_context}` |
| POST | `/api/decisions/{id}/tipping` | `{profile, keys[1–3], values, replicates}` |

Without a key, the dialogue, analysis, panel and tipping answer 503 and point to "Connect
Claude"; the self-rated anatomy, watch-outs, signature, avatars and atlas work without it.

## Extension points

- **Change how the dialogue questions:** `engine/reticulate/data/socratic.yaml` (stages,
  moves, their basis and references). The prompt is compiled from it; the prompt version
  recorded with every dialogue changes with it.
- **Add a persona:** `engine/reticulate/library/personas/<id>.yaml` with all eight
  dimensions, a nuance, personality and a `person` (name, look); or build one in the app.
- **Add a 3D person:** an entry in `tools/people/cast.yaml`, then `build.py --only <look>`
  and `bake.py --only <look>`.
- **Add a decision feature or mechanism:** `data/decision_features.yaml`,
  `data/mechanisms.yaml` (references, designs and cross-references are checked), then
  `reticulate build-atlas`.
- **Replace construct maps with a fitted model:** produce grid vectors per dimension, label
  them `inferred`; the projector puts any grid map on the atlas.
