from reticulate.simulation.prompts import PROMPT_VERSION, perspective_prompt, render_profile


def test_profile_rendering_reflects_leaning_strength_and_nuance(library):
    text = render_profile(library.get("insurance_claims_clerk"))
    assert "risk_taking: 1/10" in text and "strong leaning toward cautious" in text
    assert "Nuance:" in text and "small print" in text


def test_neutral_dimensions_get_no_anchor(library):
    text = render_profile(library.get("software_developer"))
    line = next(line for line in text.splitlines() if line.startswith("- risk_taking"))
    assert "no clear leaning" in line


async def test_perspective_prompt_puts_profile_in_system_and_frame_in_user(library, engine, problem):
    frame = await engine.frame(problem)
    system, user = perspective_prompt(problem, frame, library.get("apprentice_carpenter"))
    assert "<profile>" in system and "Apprentice carpenter" in system
    assert "<decision_frame>" in user and "Lübbecke" in user


def test_prompt_version_is_a_short_hash():
    assert len(PROMPT_VERSION) == 12 and int(PROMPT_VERSION, 16) >= 0


def test_personality_is_rendered_and_appearance_never_is(library):
    profile = library.get("software_founder")
    text = render_profile(profile)
    assert "Personality, Big Five" in text and "- neuroticism: 3/10" in text and "Achievement" in text
    for leak in ("coily", "skin", "phenotype", "glasses", "58"):
        assert leak not in text.lower()
    # A look changed in the builder stays out of the prompt as well.
    from reticulate.profile import Person, PersonStyle

    changed = profile.model_copy(update={"person": Person(name="Ada", look="male_adult_01", style=PersonStyle(skin="#66442f", top="#1f2d4d", height=1.05))})
    text = render_profile(changed)
    for leak in ("#66442f", "#1f2d4d", "ada", "male_adult", "1.05"):
        assert leak not in text.lower()


def test_neural_context_lists_anatomy_mechanisms_and_signature():
    from reticulate.decision import Rating, signature
    from reticulate.simulation.prompts import render_neural_context

    anatomy = [Rating(feature_id="possible_loss", level=3, reason="Savings are at stake"), Rating(feature_id="upside", level=1)]
    text = render_neural_context(signature(anatomy), anatomy)
    assert "Possible loss, central: Savings are at stake" in text
    assert "Loss aversion (through possible loss, central)" in text
    assert "not anyone's brain" in text or "Meta-analytic signature" not in text
