# Scientific basis

The machine-readable source of truth is `engine/reticulate/data/`. This document explains what
each part is, where it comes from, and how it was checked.

## 1. Avatars: profile, personality, phenotype

**Decision dimensions.** Eight bipolar tendencies scored 0–10 (5 = no leaning): risk tolerance,
exploration, time horizon, analytical style, experimentation, social orientation, uncertainty
tolerance, cognitive flexibility. Each has a definition, measurable constructs, candidate
instruments (e.g. DOSPERT and BART for risk; IUS-12 for uncertainty; task switching for
flexibility), behavioural anchors for both poles, and references. Known structural issues, to
be settled with data: the dimensions are not orthogonal (exploration–experimentation,
risk–uncertainty); stated and revealed risk correlate weakly (Frey et al., 2017); exploration
may split into directed and random components (Wilson et al., 2014).

**Personality** (`data/personality.yaml`). The Big Five, 0–10 with 5 = population average,
measurable with the BFI-2 (Soto & John, 2017), plus up to three of Schwartz's ten basic values
(Schwartz, 1992, 2012). Traits and dimensions overlap (openness with exploration, neuroticism
with uncertainty tolerance) and should be measured separately. Across domains, risk propensity
rises with extraversion and openness and falls with neuroticism, agreeableness and
conscientiousness (Nicholson et al., 2005). Personality has **no brain map**: in two samples of
about 1,100 people each, the Big Five showed little reliable association with grey- or
white-matter structure (Avinun et al., 2020).

**Phenotype.** Age, skin tone, face, nose, lips, build, hair, facial hair, glasses and attire.
It draws the avatar's cameo portrait and nothing else: the prompt compiler never renders it,
and a test checks that no appearance attribute reaches a prompt. A simulated decision can
therefore not lean on stereotypes about how people look.

**Personas** (`library/personas/`). Eleven authored vignettes, each with a role, situation,
goals, constraints and a *nuance*: where the person departs from the stereotype of the role.
Scores are mid-range and mixed; a test rejects personas pinned to the scale ends. Phenotypes
are spread across age (26–69), skin tone, face and hair without tracking the roles.

## 2. The atlas

| Layer | Source | Notes |
|---|---|---|
| Cortical surface | FreeSurfer fsaverage pial, white, inflated (Fischl et al., 1999) | 163,842 vertices per hemisphere |
| Cortical regions | Desikan–Killiany `aparc` (Desikan et al., 2006) | 34 per hemisphere + medial wall |
| Networks | Yeo et al. (2011) 7-network annotation | published colour table |
| Deep structures | fsaverage `aseg` (Fischl et al., 2002) | 11 structures, 21 meshes |

Every structure has curated functions with review references (`data/regions.yaml`).

## 3. Two literatures on one grid

Both sources are expressed as z-maps over the 28,542 voxels of NeuroQuery's 4-mm MNI152 brain
mask (`atlas/literature.py`), so a term's two maps can be compared voxel by voxel. One sparse
operator projects any such map onto the atlas: cortex sampled at 20/50/80 % of cortical
thickness after the MNI305 → MNI152 transform, deep meshes 1.5 mm inside, structure means over
all aseg voxels. The build checks it against direct trilinear sampling (maximum deviation
8 × 10⁻⁷).

**NeuroQuery** (Dockès et al., 2020): a text-to-brain model trained on 13,459 full-text
articles; 7,547 terms map onto 6,308 distinct features. Feature maps are computed in batch with
the model's own algebra (semantic smoothing, reduced-rank ridge regression, z-transform); a test
checks that they equal the model's output (r > 0.9999).

**Neurosynth** (Yarkoni et al., 2011), release 7: 14,371 studies, 507,891 peaks, 3,228
abstract terms. Each study's activation map is a binary 10-mm sphere around each of its peaks
(MKDA kernel; Wager et al., 2007); Talairach peaks are converted with Lancaster et al. (2007).
A term's map is the association test of the original Neurosynth: a two-way χ² between using the
term (abstract tf-idf ≥ 0.001) and activating a voxel, signed and expressed as z, with the
Benjamini–Hochberg threshold at q = 0.01 reported for each map.

**Vocabulary and decoding.** Every NeuroQuery feature and every Neurosynth term is mapped and
its mean z stored for each of the 90 structures (`vocabulary.json`, `decoding.bin`). Terms are
categorised with the Cognitive Atlas (Poldrack et al., 2011): of NeuroQuery's 6,308 features,
638 are concepts, 47 tasks and 84 disorders; 844 anatomical terms are recognised by word list
and left out of functional decoding, because a structure that decodes to its own name says
nothing about function. The default decoding shows concepts and tasks with at least 50
studies. Maps of free text and decision signatures are decoded by spatial correlation over the
whole grid against those terms in the same source.

**Validation** (reproducible with `reticulate build-atlas`, enforced by tests):

| Check | NeuroQuery | Neurosynth | r between them |
|---|---|---|---|
| Visual scene | lateral occipital, pericalcarine | lateral occipital, pericalcarine | 0.80 |
| Tones | transverse temporal | transverse temporal | 0.86 |
| Speech | banks of STS, superior temporal | banks of STS, superior temporal | 0.83 |
| Touch | postcentral, supramarginal | postcentral, supramarginal | 0.74 |
| Fearful faces | amygdala | amygdala | 0.74 |
| Reward anticipation | nucleus accumbens | nucleus accumbens | 0.76 |
| Stopping | right pars opercularis | right pars opercularis | 0.34 |
| Neurosynth peaks | — | fear (26, −2, −20) amygdala; reward (10, 10, −8) ventral striatum; pain (38, 2, 4) insula; theory of mind (58, −58, 24) right TPJ | — |

Across the 1,507 terms both sources know with at least 50 Neurosynth studies, the two maps
correlate with a median r of 0.39 (interquartile range 0.21–0.58). Agreement is high for
perception and action and lower for abstract constructs, as expected from two methods that
read the literature differently (full text vs abstracts with coordinates).

**Query choices.** Neurosynth terms are used only where they mean the construct: its
"exploration" mostly means exploratory analyses, "effort" mostly listening effort, and it has no
term for discounting, trust, fairness, regret or creativity, so those maps are NeuroQuery only
and the interface says so. NeuroQuery's "trust" literature is dominated by judgements of facial
trustworthiness (amygdala) rather than trust games (caudate); the map carries that note.
"Ambiguity" alone maps lexical ambiguity, so uncertainty uses "decision uncertainty".

**Limits.** Maps are group-level literature aggregates: where studies of a topic report
activation, not how strongly any person's brain responds. Reading a process from activation is
reverse inference (Poldrack, 2006). Spatial correlations between smooth maps are descriptive.

## 4. Region–dimension findings

`data/region_links.yaml` holds 25 curated findings linking a structure to a dimension, each
labelled with its design (within-subject task contrasts, individual differences, lesion, brain
stimulation, meta-analysis or theory), because designs license different conclusions.

## 5. The decision mode

**Anatomy** (`data/decision_features.yaml`). 18 structural features a decision can have:
possible loss, risk with estimable odds, unknown odds, delayed consequences, potential gain,
consequences for others, others' opinions, relying on others, new territory, a default to keep,
prior investment, sustained effort, immediate temptation, analytical complexity, threat, moral
stakes, possible regret and feedback over time. Claude rates each 0–3 from the description, with
a reason; the user can correct every rating.

**Neural signature.** The level-weighted mean of the rated features' maps, in each source. It is
a descriptive composite, not a z-map. Reported with it: the strongest structures, the Yeo
networks of the engaged cortex, the overlap with each dimension's construct map, its decoding,
and the agreement between sources over the features both have maps for.

**Self-check.** Without Claude, the user answers the same 18 features as questions in the second
person (`ask`, e.g. "Could you lose something you already have?") on the same four levels.

**Mechanisms** (`data/mechanisms.yaml`). 19 documented regularities, each with its behavioural
summary, the neural evidence and its design: loss aversion (Kahneman & Tversky, 1979; Tom et
al., 2007; De Martino et al., 2010), probability weighting, ambiguity aversion, present bias,
status quo bias, sunk cost, social conformity, inequity aversion, trust, anticipated regret,
exploration–exploitation, effort discounting, self-control, framing, threat and anxiety, moral
intuition, overconfidence, learning from outcomes and cognitive reflection.

**Countermoves.** Every mechanism has a countermove: what a decision-maker can do about it.
Seven are `tested`, meaning an intervention study shows that the move reduces the effect, and
the study's finding is stored with it: thinking like a trader for loss aversion
(Sokol-Hessner et al., 2009), binding precommitment for present bias (Ariely & Wertenbroch,
2002; Thaler & Benartzi, 2004), cost–benefit training for sunk costs (Larrick et al., 1990),
independent judgements for social conformity (Lorenz et al., 2011), if–then plans for
self-control (Gollwitzer & Sheeran, 2006), reasons-against and the premortem for
overconfidence (Koriat et al., 1980; Veinott et al., 2010) and considering the opposite for
intuitive answers (Lord et al., 1984). The other twelve are `derived`: they follow from the
mechanism (the reversal test for status quo bias, the outside view for probability weighting,
both frames for framing …) but have not been tested as interventions, and the interface says
so.

**Watch-outs.** In the analysis call, Claude writes for every mechanism linked to a feature it
rated 2 or 3 one sentence on how it could pull on this decision and the countermove turned into
one concrete question or step. These are Claude's applications of the curated text, shown as
such next to the general countermove.

**Panel.** Each avatar reasons through the same frame in replicates. With the neural context on,
the prompt includes the anatomy, the engaged mechanisms with their evidence, the engaged
dimensions and the signature's strongest structures, with the instruction to judge how strongly
each mechanism applies to this profile and never to cite brain regions as reasons. Whether this
context changes the reasoning is itself testable: the run record stores whether it was on.

**Tipping points.** Dose–response runs that vary one dimension or Big Five trait of one avatar
at fixed levels, holding everything else fixed, on the same frame and context. The report shows
whether the recommendation flips, and the least-squares slope ± SE of each factor's weight.

## References

Full entries: `engine/reticulate/data/references.yaml` (165 entries). They were assembled from
memory; verify each against the source before citing.
