# Reticulate

Decision analysis grounded in decision science and neuroscience. You describe a real decision;
Reticulate shows which documented mechanisms (loss aversion, status quo bias, present bias …)
it engages and what to do about each, what brain-imaging research reports for decisions like
it, how a panel of simulated decision-makers with different temperaments would decide it, and
which tendency would have to change for the answer to flip.

> Build 0.4. Read [docs/epistemics.md](docs/epistemics.md) before showing results to
> anyone: it states what each number may and may not be taken to mean.

## Open it

Double-click **`Reticulate.command`** in Finder. On first start it sets up Python and the
interface, downloads the brain template and both literature sources, starts everything and
opens <http://localhost:5173>. Close the Terminal window to stop. From a terminal:
`./Reticulate.command`.

Analysis and the panel use Claude with your own Anthropic API key: click **Connect Claude** at
the top right and paste it. Reticulate checks the key with Anthropic and keeps it in
`engine/.env` on this computer. Without a key you can still rate a decision yourself (18
questions) and get its watch-outs and brain map.

## The three modes

| Mode | What it does | Basis |
|---|---|---|
| **Decide** | The product. Type the decision into the decision bar (options and details optional). One Claude call restates it, separates what you know from what you don't, rates 18 documented features ("What's at play") and writes, for every mechanism they engage, how it could pull on this decision and a concrete countermove ("Watch out for"). "In the brain" shows where imaging studies of those features report activity, in two literatures. "Ask the panel" lets five suggested avatars (the ones who differ most on what the decision engages) reason it through in replicates, with live progress; the result is a verdict, their reasoning, disagreements and factor weights. "Before you decide" collects the open questions as a checklist; "Tipping points" re-runs one avatar with one tendency changed. Every decision is kept with model, prompts, tokens and cost, and prints as a PDF. | Claude (structured outputs); 19 mechanisms with countermoves; NeuroQuery and Neurosynth |
| **Avatars** | Eleven authored personas and your own. Each has a drawn phenotype (a cameo portrait), a personality (Big Five and Schwartz values), eight decision tendencies and their construct map on the brain. The builder edits all of it live. Appearance never enters a simulation. | Authored vignettes; BFI-2 and Schwartz frameworks; construct maps |
| **Brain atlas** | Every structure of the brain on the full-resolution fsaverage surface, with functions, networks and a decoding against the full vocabularies of both literatures. Any term or phrase can be mapped; every curated map is shown in NeuroQuery, Neurosynth and their agreement. | Desikan–Killiany, Yeo-7, FreeSurfer aseg; NeuroQuery (13,459 articles), Neurosynth (14,371 studies), Cognitive Atlas |

## Layout

```
Reticulate.command        one-click launcher
engine/                   Python: science data, literature sources, atlas build, decision engine, API
  reticulate/data/        curated science (YAML): dimensions, personality, regions, findings,
                          stimuli, decision features, mechanisms, references
  reticulate/library/     persona avatars (YAML)
  reticulate/atlas/       fsaverage geometry, NeuroQuery and Neurosynth on one grid, build, runtime
  reticulate/decision/    decision mode: analysis, neural signature, panel, tipping points
  reticulate/simulation/  prompts, Claude engine, comparison and dose–response analysis
  avatars/, runs/         your avatars and decision records (not in git)
web/                      React + three.js interface
  src/portrait/           the cameo portraits
  public/atlas/           generated atlas assets
docs/                     architecture, science, epistemics, roadmap
```

## Developer commands

```bash
cd engine && source .venv/bin/activate
pytest                         # tests; literature tests run when the data are installed
reticulate build-atlas         # regenerate the atlas assets (~30 s once data are downloaded)
reticulate avatars
reticulate simulate "…" -p venture_capitalist -p municipal_treasurer -r 3
reticulate sensitivity "…" -p cooperative_bank_credit_officer -d risk_tolerance -r 3
reticulate serve               # API on :8000
cd ../web && npm run dev       # interface on :5173 (open /?cameo-lab for every portrait)
```

Settings live in `engine/.env` (see `engine/.env.example`): `ANTHROPIC_API_KEY`,
`RETICULATE_MODEL` (default `claude-opus-5-5`), `RETICULATE_EFFORT` (default `high`),
`RETICULATE_CONCURRENCY`. Claude calls opt into server-side refusal fallback.

## Data sources

Downloaded once on first build: fsaverage and its annotations (FreeSurfer, via MNE-Python,
`~/mne_data`), the NeuroQuery model (Dockès et al., 2020, `~/neuroquery_data`), Neurosynth
release 7 (Yarkoni et al., 2011, `~/neurosynth_data`) and the Cognitive Atlas (Poldrack et al.,
2011, `~/cognitiveatlas_data`). References: `engine/reticulate/data/references.yaml`.

## Documentation

- [docs/architecture.md](docs/architecture.md): components, data flow, API, extension points
- [docs/science.md](docs/science.md): dimensions, personality, the atlas, both literatures and their validation, the decision mode
- [docs/epistemics.md](docs/epistemics.md): provenance, claims policy, what a decision may say
- [docs/roadmap.md](docs/roadmap.md): next steps toward the thesis
