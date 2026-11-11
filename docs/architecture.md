# Architecture

## Components

```
web/ (React, three.js)                          engine/ (Python, FastAPI)
┌──────────────────────────────┐   /api   ┌────────────────────────────────────────────────┐
│ Decide · Avatars · Atlas     │ ───────▶ │ api.py                                         │
│                              │          │  ├─ science.py    data/*.yaml, cross-checked   │
│ brain/renderer.ts — one      │          │  ├─ library/      personas + engine/avatars    │
│   shared three.js renderer   │          │  ├─ atlas/        geometry, literature, build, │
│   whose canvas moves between │          │  │                runtime (maps, composites)   │
│   views                      │          │  ├─ decision/     anatomy, signature, panel,   │
│ portrait/ — cameo portraits  │          │  │                tipping points               │
│                              │          │  ├─ simulation/   prompts → Claude → analysis  │
└──────────────┬───────────────┘          │  └─ runs.py       records in engine/runs       │
               │ /atlas/* (static)         └────────────────────────────────────────────────┘
               └── web/public/atlas ◀── reticulate build-atlas ──▶ engine/.cache
```

## Atlas build (`reticulate/atlas/build.py`)

Inputs: fsaverage (MNE), the NeuroQuery model, Neurosynth release 7, the Cognitive Atlas and the
curated YAML; missing downloads are fetched.

1. **Geometry.** Full-resolution pial, white and inflated surfaces with Desikan–Killiany
   regions, Yeo-7 networks, sulcal depth and region boundaries; deep structures from aseg by
   marching cubes and Taubin smoothing; a glass envelope on fsaverage5's triangulation.
2. **Projector.** A sparse operator from the 28,542-voxel NeuroQuery grid to the atlas layout
   (`[lh | rh | deep]` vertices) and to the 90 structure means, checked against direct sampling
   and cached in `engine/.cache/projector.npz`.
3. **Sources** (`atlas/literature.py`). NeuroQuery feature maps in batch from the model's own
   matrices; Neurosynth study activation (10-mm spheres, cached) and association tests.
4. **Vocabulary** (`atlas/vocabulary.py`). Every term of both sources decoded on every structure
   (`decoding.bin`, int16), categorised with the Cognitive Atlas, cross-linked between sources,
   with per-term agreement (`vocabulary.json`).
5. **Curated maps.** Constructs, stimuli and decision features in each source that covers them
   (`maps/<id>.<nq|ns>.i8`), with top structures, coverage, construct overlap, Neurosynth study
   counts and FDR thresholds, and agreement (`maps.json`); grid vectors in `engine/.cache/curated.npz`.

## Runtime (`reticulate/atlas/runtime.py`)

Loads the projector, the curated grid maps and both sources once (about 3 s) and serves the map
of any text (NeuroQuery, plus Neurosynth when the text is one of its terms) and level-weighted
composites. Maps are described by display range, coverage, top structures, Yeo network shares,
construct overlap and a decoding against the functional terms of the same source.

## Decision mode (`reticulate/decision/`)

```
Problem ─▶ analyse (1 call): frame (options, facts, unknowns, factors) + anatomy (18 features, 0–3)
              │        + a watch-out (how it could pull, its countermove applied) per engaged mechanism
              │        or the user's own answers to the 18 questions, without Claude
              ▼
         signature (deterministic): composite maps per source, agreement, structures, networks,
         dimension relevance, decoding, mechanisms, findings
              ▼
         panel: perspective(avatar) × replicates with the neural context ─▶ compare ─▶ synthesis
              ▼
         tipping points: sensitivity(avatar, dimension or trait, levels) on the same frame;
                         runs accumulate, a re-run of the same avatar and tendency replaces it
              ▼
         runs.save → engine/runs/<time>-decision-<id>.json, rewritten as steps complete
```

Usage is collected per call through a context variable and priced from `config.PRICES`; a
second context variable counts finished calls into a `Progress` that the API serves while a
panel or tipping run is in flight. Re-rating the anatomy drops panels and tipping runs that saw
the old neural context.

## Interface (`web/src`)

- `brain/renderer.ts`: imperative three.js renderer (BVH picking, pial→inflated morph,
  shader overlays). One instance serves all views; `attach()` moves its canvas.
- `portrait/`: the cameo geometry (Loomis proportions moved by the phenotype) and its SVG
  rendering with layered relief.
- `views/DecisionView.tsx`: the decision bar (home) and the decision workspace with its
  sticky section bar; `components/decision/` holds the composer and self-check, what's at
  play, watch-outs, brain, panel (setup, live progress, result), before-you-decide checklist
  and tipping points; `model.ts` holds the shared arithmetic (verdict, cost estimate, the
  suggested panel by farthest-point selection on the engaged dimensions).
- `components/ClaudeDialog.tsx`: connecting an Anthropic key.
- Print styles turn a decision into a cream-paper document with reasoning and evidence unfolded.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | versions, Claude configured (with the key's last four characters)?, literature installed? |
| PUT, DELETE | `/api/settings/claude` | `{api_key}`: check it with the Models API and keep it in `engine/.env`; remove it |
| GET | `/api/science` | dimensions, personality, structures, networks, findings, stimuli, features, mechanisms, references |
| GET, POST | `/api/avatars` | list; create or update one of the user's avatars |
| DELETE | `/api/avatars/{id}` | delete a user avatar (personas are read-only) |
| POST | `/api/maps` | `{text}` → maps in both sources, agreement, decoding |
| GET, POST | `/api/decisions` | archive; create (Claude analysis, or `{anatomy}` by hand) |
| GET, DELETE | `/api/decisions/{id}` | one decision record |
| GET | `/api/decisions/{id}/progress` | calls done of planned, per avatar, while a panel or tipping run is in flight; else null |
| PUT | `/api/decisions/{id}/anatomy` | re-rate; recomputes the signature |
| POST | `/api/decisions/{id}/panel` | `{profiles[1–8], replicates[1–5], neural_context}` |
| POST | `/api/decisions/{id}/tipping` | `{profile, keys[1–3], values, replicates}` |

Without a key, analysis, panel and tipping answer 503 and point to “Connect Claude”; the
self-rated anatomy, watch-outs, signature, avatars and atlas work without it.

## Extension points

- **Add a persona:** `engine/reticulate/library/personas/<id>.yaml` with all eight dimensions,
  a nuance, personality and phenotype; or build one in the interface.
- **Add a decision feature or mechanism:** `data/decision_features.yaml`, `data/mechanisms.yaml`
  (references, designs and cross-references are checked), then `reticulate build-atlas`.
- **Add a stimulus:** `data/stimuli.yaml` with a NeuroQuery query and Neurosynth terms.
- **Replace construct maps with a fitted model:** produce grid vectors per dimension, label them
  `inferred`; the projector puts any grid map on the atlas.
