# Epistemics: what Reticulate may claim

## The evidence bar (1.0)

Since science 1.0 Reticulate states as fact only what holds up in large studies. A claim about
how people decide, and every remedy, needs at least one of:

- a meta-analysis,
- a replication across many labs or countries (Many Labs, Ruggeri et al.),
- a large sample (about 1,000 people or more), or
- field data or randomised field trials.

What does not meet the bar was removed, not relabelled:

- **The eight tendencies** (a working hypothesis, never validated) are replaced by the six
  preferences of the Global Preferences Survey (Falk et al., 2018: about 80,000 people in 76
  countries), measured with the survey's own questions, which were validated against choices
  with real money (Falk et al., 2023; for risk, Dohmen et al., 2011).
- **Your pattern** is your answers to those six questions, no longer sixteen statements
  written for Reticulate. What an answer "goes with" is what the studies found, nothing more.
- **Biases**: 13 remain, each with the large study behind it (`mechanisms.yaml`). Gone are
  biases backed only by brain studies, small experiments or theory (exploration, effort,
  threat, moral intuition, self-control, learning from feedback, trust games as biases,
  cognitive reflection).
- **Remedies**: only two meet the bar — frequencies instead of percentages (meta-analysis;
  Cochrane review of decision aids) and commitment in advance (randomised field trials). All
  "derived" countermoves are gone; a bias without a proven remedy is described, not treated.
- **The dialogue's structure** is that of patient decision aids (Cochrane review: 105 trials,
  31,043 people) and ends with an if-then plan (meta-analysis of 94 tests). Its other
  questions are plain questions and claim nothing. The "six elements of decision quality"
  and the claim that a decision is only as good as its weakest element are gone; the
  conclusion rates coverage, as Claude's reading.
- **The minds** are characters, written by hand: their attitudes are answers to the same six
  questions, spread across the sixteen roughly as answers spread in population surveys (most
  near the middle, few at the ends, returning favours high for most). They are not measured
  and predict no real person; that they are simulations is said wherever they appear.

Older records keep what they were made with; their questions and biases still open, mapped to
what replaced them where needed.

## Provenance labels

| Label | Meaning | Where it appears now |
|---|---|---|
| `measured` | Observed for this person (task, questionnaire, recording) | not yet collected |
| `inferred` | Predicted for this person by a validated model, with uncertainty | not used until such a model exists |
| `meta-analytic` | Aggregated from published group-level studies | every brain map (NeuroQuery, Neurosynth) |
| `authored` | Set by a person | persona scores and traits, builder edits, counterfactual values, anatomy ratings corrected by the user, the person's own pattern (self-rated) |

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

## What the dialogue may say

The dialogue's job is to help a person reach their own decision. The guide asks; it does not
choose.

| Allowed | Not allowed |
|---|---|
| "If you already worked at the start-up, would you switch back?" (a countermove as a question) | "You are suffering from status quo bias." (a diagnosis) |
| "You said security matters most, and you lean toward the riskier option. How do these fit?" | "You should take the offer." |
| Asked "what do you think?": naming the considerations, then handing the decision back | Recommending an option, or inventing facts, figures or studies |
| "Three of five simulated decision-makers would wait. What do you make of their reason?" | Presenting the panel's view as the answer or as expert advice |
| The conclusion in the person's own words, with the reasons they gave | Adding reasons they did not give |
| "You described yourself as someone who takes the safer option. Is that what is happening here?" (at most twice, as a question) | "Because you are cautious, …" or any score or dimension name |
| A question that brings in what a leaning tends to leave out (the cost of not acting, for someone cautious) | Steering the person against their temperament, or treating a leaning as a flaw |
| "You usually stick with what works, and here you propose a leap. What makes this case different?" | "That is not like you." |

The decision-quality ratings in the conclusion (strong, partial, weak per element) are
Claude's reading of the dialogue, labelled as such; they are not a measurement of the
decision's quality, and nothing claims that a decision reached in the dialogue is better.
Whether it is, is the thesis's question (roadmap). Each dialogue records the model, effort
and prompt version, and every question records its move, stage and the mechanism it
counters, so dialogues can be analysed.

## The person's own pattern

The pattern (data/pattern.yaml in the engine, data/pattern.yaml in the data folder) is the
person's answers to the six questions of the Global Preferences Survey, each from 0 to 10. The
questions are validated; one answer per preference is what the survey itself uses, and it
describes an attitude in general, not how the person will decide a particular case. 5 is the
middle of the scale, not the population average.

What an answer goes with is what the cited studies found (dohmen2011, falk2018, falk2023).
The dialogue uses clear leanings to choose where to look: it asks how a leaning bears on this
decision. That use is a design choice, not a tested intervention, and the interface claims no
effect for it; the dialogue study (roadmap) compares dialogues with and without a pattern. A
dialogue keeps a snapshot of the answers it started with, and every question records the
leaning it asks about (`pattern`). The conclusion's "your pattern in this decision" is
Claude's reading of the dialogue, labelled as such.

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

## Names, looks and stereotypes

Avatars are shown as fictional people, with a name and a realistic 3D look (Microsoft
Rocketbox library), so that people can recognise and relate to them. Name and look are
excluded from every prompt (tested): the simulation sees the role only. Personas' looks are
spread across gender, age and skin tone without tracking their roles. Including appearance
or names in a prompt would invite the model to apply stereotypes; if that is ever studied,
it belongs in a separate, preregistered bias probe. The people are fictional: their models
are artist-made, and they are not likenesses of, or simulations of, real persons.

## Validity of the simulation

Whether the model reasons *from the profile*, and not from its own defaults, is an empirical
question for the thesis. The dose–response design measures it directly: a valid profile
effect shows a monotone, replicable change in the theoretically expected factor weights while
unrelated factors stay flat. Report slopes with standard errors and replicate counts; report
the model, effort and prompt version from the run log.

The research context (stored as `neural_context` for older records) is background, not ground
truth: it tells the simulated decision-maker which mechanisms behavioural research documents
for this kind of decision. Since 0.9 it carries no brain regions. Whether it changes the reasoning, and
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
Decisions, dialogues and runs are stored locally in `data/` and are not committed to git. A dialogue holds what a person says about their own life; treat the folder as personal data.

## Science review

Files under `engine/reticulate/data/` are science. Changes need review, and the loader's
cross-reference checks and the tests must pass. When in doubt, rate evidence or map quality
lower.

## No brain in the decision (0.9)

Brain maps describe where published studies report activity on average, across people. They
cannot say how a particular person decides or why, and reading a decision's "neural signature"
from them invited exactly that reading. Since 0.9:

- No decision, mind, dialogue or prompt uses brain maps. The decision's brain tab, each mind's
  brain map, the brain regions in the panel's briefing and the avatar "construct emphasis"
  are gone.
- The brain atlas stays as a separate reference (`#atlas`), labelled as the research
  literature on the average brain.
- Simulated minds are perspectives, not a sample: their choices are not counted into a
  verdict, their self-reported confidence is not shown, and "what would flip it" (re-running
  a mind with one tendency changed) is no longer offered in the interface. It remains a
  research tool for the profile-fidelity study.
