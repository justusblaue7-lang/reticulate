# Roadmap

## Done

**0.1 Foundation:** science data, profiles, simulation pipeline, API, first interface.

**0.2 Research build**
- [x] Full-resolution fsaverage atlas: 68 cortical regions, 22 deep structures, cerebellum, brainstem
- [x] Inspector per structure: curated functions, Yeo networks, NeuroQuery decoding, construct overlap, design-labelled findings
- [x] Stimulation mode: 27 meta-analytic stimulus maps plus free-text stimuli, with validity checks
- [x] Eleven non-stereotypical persona avatars with profile glyphs
- [x] Replicated simulations, dose–response experiments with slope ± SE, run log with full metadata
- [x] Removed unscientific elements (see epistemics.md); one-click launcher; figure export

**0.3 Decision build**
- [x] Full NeuroQuery vocabulary (6,308 features) decoded on every structure; batched maps equal the model's
- [x] Neurosynth release 7 re-analysed on the same grid (association test, 14,371 studies); every curated map in both sources with agreement; median r 0.39 over 1,507 shared terms
- [x] Cognitive Atlas categories for decoding; free-text and vocabulary maps from both sources
- [x] Decision mode: anatomy (18 features), neural signature, 19 mechanisms with evidence, panel with neural context, report, tipping points, archive with token cost, print to PDF
- [x] Avatars with personality (Big Five, Schwartz values) and a drawn phenotype (cameo), excluded from prompts; avatar builder; user avatars
- [x] Deep-blue and cream design; three modes instead of four

**0.4 Product build**
- [x] The decision bar: one field for the decision, options as chips, optional details, example decisions; a self-check of 18 questions without AI
- [x] A decision workspace instead of chapters: overview with the next step or the verdict, what's at play, watch-outs, brain, panel, before you decide, tipping points, with a sticky section bar
- [x] Countermoves for all 19 mechanisms, seven tested in intervention studies; decision-specific watch-outs written in the analysis call
- [x] Suggested panel (the avatars who differ most on what the decision engages); one-click panel from the overview; live progress per avatar
- [x] Connect Claude in the app (key checked with Anthropic, stored in engine/.env); cost and time estimate before every paid step; spend shown in the decision list
- [x] Tipping points accumulate; verdicts in the decision list; checklist of open questions; print with reasoning and evidence unfolded

**0.5 Dialogue build**
- [x] The Socratic dialogue as the way into every decision: one question at a time along the six elements of decision quality, twelve moves (five tested), countermoves to biases asked as questions, working notes, skip, change an earlier answer, conclude when ready
- [x] The conclusion: the decision in the person's words, reasons, trade-offs, signals to revisit, an if–then first step, a review date, open questions as a checklist saved with the decision, and decision quality per element
- [x] Claude's analysis runs in the background; the panel's result goes back into the dialogue as a perspective to question; one lock per decision so nothing overwrites anything
- [x] Real people in 3D: 32 fictional people from the Microsoft Rocketbox library (MIT), posed, studio-lit and spinnable, with names; looks chosen from the cast in the builder; names and looks never enter a prompt
- [x] A data folder in the project: one folder per decision with the record and a readable Markdown copy; avatars and research runs beside it; records of earlier builds moved in automatically
- [x] Version history: the project is a git repository; personal data stays out of it

**0.6 Product site**
- [x] One page instead of three modes: a hero with the command window (type the decision, add options and details, open a recent one, try an example), how it works, biases with countermoves, the cognitive patterns, one call to action
- [x] ⌘K palette: find any decision, start one from the query, jump to a section; replaces the history sidebar
- [x] Black-and-blue design: near-black ground, one blue accent, Inter and Instrument Serif, rounded windows and cards, key caps for shortcuts
- [x] Removed the standalone Brain-atlas mode (structure index, literature map browser, free-text maps); the brain stays in each decision and each pattern
- [x] "Avatars" are called cognitive patterns (minds, in the panel); version and prompt numbers leave the screen and stay in the record

**0.7 Your pattern, and the art**
- [x] Your pattern: sixteen self-rating statements, two per dimension with one reversed, scored 0–10; adjustable; saved in data/pattern.yaml; labelled self-rated, never measured
- [x] The dialogue holds a snapshot of the pattern from its start. For each clear leaning it asks one counterweight question where the decision touches it, gives priority to the mechanisms the leaning makes likelier, names departures from the usual leaning, asks in the person's style, and never shows scores or labels. Each question records the leaning it counterweighs; the conclusion says how the leanings showed (Claude's reading)
- [x] The art: the works of `socratic art/`, prepared by tools/art/build.py and gathered into one passage through the Socratic method: a framed work held still while the questions pass ("I know that I don't know", then one question per element of decision quality), the current work slowly regaining its colour; *The Death of Socrates* closes it. Two framed plates with museum labels elsewhere; each element's work heads the open decision as the dialogue moves; credits on the home page

**0.9 Attitudes, not brains; one room for the decision**
- [x] Removed every brain model from the decision and the minds: the "In the brain" tab, each mind's brain map, the regions in the panel's briefing, construct emphasis. The atlas is a separate reference (#atlas), loaded only when opened
- [x] Removed what reads as evidence but is not: the panel's vote tally, self-reported confidence, and tipping points in the interface
- [x] The decision is a room: you on the left, the dialogue in the command window with a pinned answer bar, the minds at the table on the right, each with its attitudes and pickable; their takes appear on their cards
- [x] Each mind's dossier shows all its attitudes: tendencies, personality, values, wants, constraints, priorities and voice
- [x] Runs on Claude Haiku 5.5 by default (about 40 times cheaper than Opus 5.5); `RETICULATE_MODEL` switches it
- [x] "Download PDF" replaces printing: the whole decision as a document to keep, with a page for the review
- [x] Free decisions on reticulate.space: three per visitor on the house key (`reticulate.trial`), then their own key

**1.0 Only what large studies show** (docs/epistemics.md, "The evidence bar")
- [x] Attitudes: the six preferences of the Global Preferences Survey replace the eight hypothetical tendencies; your pattern is the survey's six validated questions
- [x] Biases: 13 with a meta-analysis, multi-lab replication or field data behind each; remedies only where trials prove them (2); no "derived" countermoves or moves
- [x] The dialogue follows the structure of decision aids (Cochrane review); "decision quality" claims removed
- [x] Sixteen minds from everyday life, 8 women and 8 men aged 19 to 72, answers spread like population surveys
- [x] Home: the self section quotes the Apology ("to examine myself and others"), the close the Crito; one closing call; one place to pick the minds

## Next, for the thesis

0. **Dialogue study.** Does the dialogue improve decisions, and does holding it with the
   person's pattern add to that (pattern vs. no pattern, recorded per question)? Compare people who decide with
   the dialogue against people who see only the analysis (or nothing), on decision quality
   rated blind by trained raters, decisional conflict (O'Connor, 1995), regret and stated
   confidence after a few weeks. Pre-register; record every dialogue's moves and stages.
1. **Profile-fidelity study.** Run dose–response sweeps for all eight dimensions on a fixed set
   of decision problems, five replicates each, and test for monotone, replicable effects on the
   theoretically expected factors. This is the core validation of the method.
2. **Model comparison.** Repeat the fidelity study across models and effort levels, and record
   cost per run.
3. **Inter-run reliability.** Estimate replicate variance per factor to choose the number of
   replicates needed for a given precision.
4. **Human comparison.** Have participants with measured scores (DOSPERT, IUS-12, delay
   discounting) rate the same factors, and compare their weights with the simulated ones.
5. **Personal profiles.** Licensed questionnaires and browser tasks produce `measured` scores
   with reliability estimates.
6. ~~Fitted brain model.~~ Dropped in 0.9: Reticulate does not infer attitudes from brain data.
7. **Neural-context ablation.** Run the fidelity study with and without the neural context and
   test whether the context makes profile effects larger, more specific or more human-like.
8. **Anatomy reliability.** Compare Claude's anatomy ratings with ratings by trained humans on
   a set of decisions (weighted kappa per feature), and with users' own self-check answers.
9. **Countermove uptake.** Whether users who see a countermove change their stated choice or
   confidence, compared with users who see only the mechanism.
10. **Cost calibration.** Replace the per-call cost estimate with the measured average once real
    runs exist.

## Open questions

- The brief's section 8 (personalised Reticulate) was cut off after "reaction-time
  measurements"; its remaining requirements are unknown.
- Which decision domains does the thesis study (personal finance, entrepreneurship, public
  decisions)? This decides the problem set for the fidelity study.
