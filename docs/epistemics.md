# Epistemics: what Reticulate may claim

## Provenance labels

| Label | Meaning | Where it appears now |
|---|---|---|
| `measured` | Observed for this person (task, questionnaire, recording) | not yet collected |
| `inferred` | Predicted for this person by a validated model, with uncertainty | not used until such a model exists |
| `meta-analytic` | Aggregated from published group-level studies | every brain map (NeuroQuery, Neurosynth) |
| `authored` | Set by a person | persona scores and traits, builder edits, counterfactual values, anatomy ratings corrected by the user |

A derived quantity is never labelled more strongly than its weakest input. The construct
emphasis map and the decision signature combine `meta-analytic` maps with `authored` weights
(profile scores, anatomy levels) and are described as such. An anatomy rating drafted by Claude
is a reading of the user's text, not a measurement; the report marks who set each rating.

## What was removed in 0.2, and why

| Removed | Reason |
|---|---|
| Hand-set "engagement index" per brain system | Numbers (e.g. 0.93) looked like measurements but came from invented weights and an arbitrary transform |
| Coupling strengths between systems | No empirical basis |
| Correlations between dimensions and factor weights across 3–8 personas | Statistically meaningless at that n and confounded, since personas differ on several dimensions at once. Replaced by dose–response experiments |
| Offline "fake" simulation engine as a product mode | Produced plausible-looking but invented perspectives. Kept only as a test double |

## Claims policy

| Allowed | Not allowed |
|---|---|
| "Studies of risky choice report activation in the ventral striatum (meta-analytic map)." | "This avatar's ventral striatum is more active." |
| "The constructs that set this profile apart are processed in …" | "This is how this person's brain works." |
| "In a dose–response run, the weight on concentration risk fell by 0.99 points per point of risk tolerance (± SE, n runs)." | Causal claims from comparisons between personas |
| "A simulated decision-maker with these tendencies might weigh …" | "What a venture capitalist would decide." |

The brain views always state their source, and the overlay reveal is described as a
threshold sweep, not neural timing.

## What a decision report may say

| Allowed | Not allowed |
|---|---|
| "Three of four simulated decision-makers choose B; the cautious profiles weigh the irreversibility most." | "You should choose B." |
| "Decisions with possible losses engage loss aversion: people typically need about twice the gain to accept a loss (Tom et al., 2007)." | "Your loss aversion is 2." |
| "Studies of possible loss report activation in the nucleus accumbens and amygdala (NeuroQuery and Neurosynth agree, r = 0.64)." | "This decision will activate your amygdala." |
| "With only risk tolerance raised from 2 to 8, the credit officer's recommendation flips to B." | "Risk-tolerant people choose B." |
| "Thinking of a choice as one of many reduced loss aversion in an experiment (tested countermove)." | Presenting a derived countermove as proven, or any countermove as guaranteed to work |
| "Loss aversion could make the €40,000 loom larger than an equal chance of gain" (a watch-out: a possibility) | "You are loss-averse here" (a diagnosis) |

The report says that its perspectives are simulated, prints the model, prompts, replicates,
tokens and cost, and gives no financial, legal or medical advice. Countermoves carry their
basis ("Tested in an intervention study" or "Follows from the research; not tested as an
intervention"), and Claude's watch-outs are labelled as applying them to this decision.

## Appearance and stereotypes

Avatars have a drawn phenotype so that people can recognise and relate to them. Appearance is
excluded from every prompt (tested), and personas' phenotypes are spread across age, skin tone
and hair without tracking their roles. Including appearance in a prompt would invite the model
to apply stereotypes; if that is ever studied, it belongs in a separate, preregistered bias
probe.

## Validity of the simulation

Whether the model reasons *from the profile*, and not from its own defaults, is an empirical
question for the thesis. The dose–response design measures it directly: a valid profile
effect shows a monotone, replicable change in the theoretically expected factor weights while
unrelated factors stay flat. Report slopes with standard errors and replicate counts; report
the model, effort and prompt version from the run log.

The neural context is background, not ground truth: it tells the simulated decision-maker which
mechanisms research documents for this kind of decision. Whether it changes the reasoning, and
whether that makes the simulation more faithful to people, is open; each panel records whether
the context was on, so the two conditions can be compared.

## Personas and real people

Personas are authored vignettes of roles, not people. Figure-inspired profiles (based on
public material about real persons) are supported by the schema only with a list of sources;
none ship. Before adding any, plan a documented dossier per person and legal review of
personality rights (*allgemeines Persönlichkeitsrecht*), and do not generate quotes.

## Personal data

Personal cognitive twins will hold questionnaire and task data that may count as health data
under GDPR Art. 9. Get a data-protection assessment and explicit consent before collecting any.
Runs are stored locally in `engine/runs/` and are not committed to git.

## Science review

Files under `engine/reticulate/data/` are science. Changes need review, and the loader's
cross-reference checks and the tests must pass. When in doubt, rate evidence or map quality
lower.
