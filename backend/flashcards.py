"""AI flashcard generation: turn pasted text or a topic into front/back cards.

Reuses the story generator's provider plumbing (PROVIDERS / generate_with_provider),
so any configured provider — including custom OpenAI-compatible endpoints — works.
"""
import json
import re
from typing import Optional

from story_generator import StoryGenerator, NoValidKeysError  # noqa: F401 (re-exported for main.py)


MAX_SOURCE_CHARS = 20000

STYLES = {
    "qa": "Question & Answer — each card asks one clear question and answers it precisely.",
    "vocab": "Vocabulary — the front is a term/word/phrase, the back is its meaning, translation or explanation.",
    "list": "Key facts — the front names a concept, date or entity, the back states the fact worth remembering.",
}


def build_flashcard_prompt(
    text: str,
    count: int,
    style: str = "qa",
    language: str = "auto",
    definition_language: Optional[str] = None,
    extra_instructions: Optional[str] = None,
) -> str:
    style_line = STYLES.get(style, STYLES["qa"])
    lang_line = "Use the same language as the material for both sides." if language == "auto" \
        else f"Write the FRONT in {language}."
    def_line = ""
    if definition_language and definition_language != "auto":
        def_line = f" Write the BACK in {definition_language}."
    extra = f"\nExtra instructions from the learner: {extra_instructions}" if extra_instructions else ""

    return f"""You are an expert flashcard writer using proven techniques (atomic knowledge, active recall).
Create exactly {count} flashcards from the material below.

Card style: {style_line}
{lang_line}{def_line}
Rules:
- FRONT and BACK must be plain text only (no markdown, no HTML, no line numbering).
- One atomic fact per card; keep the FRONT under 200 characters where possible.
- No duplicates or near-duplicates; do not invent facts that are not in the material.
- Add 0-2 short lowercase topic tags per card under the "tags" key (optional).

Respond with ONLY a JSON array, no prose and no code fences, shaped like:
[{{"front": "...", "back": "...", "tags": ["topic"]}}]
{extra}
Material:
\"\"\"{text[:MAX_SOURCE_CHARS]}\"\"\""""


def parse_flashcards(raw: str, max_cards: int = 100) -> list[dict]:
    """Extract the JSON card array from a model response (tolerates fences/prose around it)."""
    if not raw:
        raise ValueError("Empty response")
    cleaned = raw.strip()
    # Drop markdown code fences if present.
    fence = re.search(r"```(?:json)?\s*(.*?)```", cleaned, re.S)
    if fence:
        cleaned = fence.group(1).strip()
    # Locate the outermost JSON array.
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON array in response")
    try:
        data = json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}") from e
    if not isinstance(data, list):
        raise ValueError("Response is not a list")

    cards = []
    seen = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        front = str(item.get("front", "")).strip()
        back = str(item.get("back", "")).strip()
        if not front or not back:
            continue
        key = front.lower()
        if key in seen:
            continue
        seen.add(key)
        tags = item.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        tags = [str(t).strip() for t in tags if str(t).strip()][:2]
        cards.append({"front": front[:500], "back": back[:1000], "tags": tags})
        if len(cards) >= max_cards:
            break
    if not cards:
        raise ValueError("Model returned no usable cards")
    return cards


async def generate_flashcards(
    api_keys: dict[str, str],
    text: str,
    count: int,
    style: str = "qa",
    language: str = "auto",
    definition_language: Optional[str] = None,
    extra_instructions: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> tuple[list[dict], str | None, str | None]:
    """Generate flashcards. Returns (cards, provider_used, model_used)."""
    prompt = build_flashcard_prompt(text, count, style, language, definition_language, extra_instructions)
    generator = StoryGenerator(api_keys)
    raw, used_provider, used_model = await generator.generate_with_provider(
        prompt, provider=provider, model=model, base_url=base_url,
    )
    return parse_flashcards(raw), used_provider, used_model
