"""AI strategist layer (Google Gemini / Gemma).

When the deterministic cracker fails, this module asks Gemma to act as a
pentester: it asks the user targeted questions, then turns the answers into a
crack *strategy* (parameters for cracker.crack). Gemma does NOT crack anything
itself — it only plans; the deterministic engine still does the real work.

Gemma on the Gemini API has no native tool-calling, so the model communicates
by returning a strict JSON object that we parse here.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

# Configurable via .env — defaults to the Gemma 4 26B (A4B MoE) model.
MODEL = os.environ.get("GEMINI_MODEL", "gemma-4-26b-a4b-it")
API_KEY_ENV = "GEMINI_API_KEY"

INSTRUCTIONS = """\
You are the strategist for a password-recovery research tool. A hash could not \
be cracked by the automatic pipeline (wordlist + mutation rules + numeric \
brute-force). Your job is to recover it by asking the user smart questions and \
then choosing a cracking STRATEGY. You never compute hashes yourself — a \
deterministic engine does that when you choose action "crack".

You MUST reply with ONLY a single JSON object (no prose, no markdown fences), \
using exactly this shape:

{
  "thought": "<one short sentence of reasoning>",
  "action": "ask" | "crack" | "give_up",
  "questions": ["<short question>", ...],        // ONLY when action == "ask" (1-3 items)
  "strategy": {                                    // ONLY when action == "crack"
    "extra_words": ["<seed word>", ...],           // words to build guesses from (e.g. a name, pet, team)
    "use_rules": true,                             // capitalization / leet / common suffixes
    "brute_force": true,                           // append numbers to the seed words
    "length": <int or null>,                       // total password length if known, else null
    "special": "no" | "yes" | "unknown",           // does it contain a special character?
    "brute_around": true,                          // numbers may sit before/around the word (e.g. 12word34)
    "note": "<what this attempt tries>"
  },
  "reason": "<why you are giving up>"              // ONLY when action == "give_up"
}

Guidance:
- Start by ASKING (action "ask") if you have no useful hints yet. Ask about: is \
it the user's own password, an approximate length, memorable words (name, pet, \
team, place), birth years or favourite numbers, capital letters, special chars.
- Once you have hints, choose action "crack" with a focused strategy. Knowing \
the length and special-char answer makes brute-force far faster — fill them in.
- After a failed crack attempt, refine: try other seed words, toggle \
brute_around, adjust length, or ask one more question.
- A password with no word and truly random characters may be uncrackable by \
guessing — in that case action "give_up" with an honest reason.
"""


@dataclass
class Decision:
    thought: str
    action: str  # "ask" | "crack" | "give_up"
    questions: list[str]
    strategy: dict
    reason: str


class AssistantError(RuntimeError):
    """Raised when the assistant can't run (missing key, bad model reply)."""


def _read_api_key() -> str | None:
    """Read the key from GEMINI_API_KEY or GOOGLE_API_KEY, tolerating the
    common .env mistakes: surrounding quotes and stray whitespace/newlines."""
    raw = os.environ.get(API_KEY_ENV) or os.environ.get("GOOGLE_API_KEY")
    if not raw:
        return None
    return raw.strip().strip('"').strip("'").strip()


def is_configured() -> bool:
    return bool(_read_api_key())


# Patterns that look like credentials — redacted from any text we store, echo
# back to the browser, or send to the model.
_SECRET_PATTERNS = [
    re.compile(r"AIza[0-9A-Za-z_\-]{20,}"),       # Google API key
    re.compile(r"\bAQ\.[0-9A-Za-z_\-]{15,}"),      # Google OAuth token
    re.compile(r"\bya29\.[0-9A-Za-z_\-]+"),        # Google OAuth access token
    re.compile(r"\bsk-[0-9A-Za-z_\-]{20,}"),       # generic secret keys
]


def redact_secrets(text: str) -> str:
    """Replace anything that looks like an API key / token with [redacted]."""
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[redacted]", text)
    return text


def _client():
    api_key = _read_api_key()
    if not api_key:
        raise AssistantError(
            f"{API_KEY_ENV} is not set. Add it to backend/.env to enable the AI assistant."
        )
    # Imported lazily so the rest of the app runs without google-genai installed.
    from google import genai

    return genai.Client(api_key=api_key)


def _build_prompt(hash_hex: str, algorithm: str, transcript: list[dict]) -> str:
    lines = [
        INSTRUCTIONS,
        "",
        f"Target hash: {hash_hex}",
        f"Algorithm: {algorithm}",
        "Already failed automatically: wordlist (rockyou ~14M), mutation rules, "
        "and numeric brute-force without hints.",
        "",
        "Conversation so far:",
    ]
    if transcript:
        for msg in transcript:
            role = msg.get("role", "?")
            text = msg.get("text", "")
            lines.append(f"[{role}] {text}")
    else:
        lines.append("(nothing yet — this is the first turn)")
    lines.append("")
    lines.append("Respond with the JSON object now.")
    return "\n".join(lines)


def _extract_json(text: str) -> dict:
    """Pull the JSON object out of the model's reply, tolerating code fences."""
    cleaned = text.strip()
    # Strip ```json ... ``` or ``` ... ``` fences if present.
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Fallback: grab the first {...} block.
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise AssistantError(f"Model did not return valid JSON: {text[:200]!r}")


def decide(hash_hex: str, algorithm: str, transcript: list[dict]) -> Decision:
    """Ask Gemma for the next step given the conversation so far."""
    client = _client()
    prompt = _build_prompt(hash_hex, algorithm, transcript)

    try:
        response = client.models.generate_content(model=MODEL, contents=prompt)
    except Exception as exc:  # network / auth / model errors
        raise AssistantError(f"Gemini request failed: {exc}") from exc

    raw = (response.text or "").strip()
    if not raw:
        raise AssistantError("Model returned an empty response.")

    data = _extract_json(raw)
    action = data.get("action")
    if action not in {"ask", "crack", "give_up"}:
        raise AssistantError(f"Model returned an unknown action: {action!r}")

    return Decision(
        thought=str(data.get("thought", "")),
        action=action,
        questions=[str(q) for q in data.get("questions", []) if str(q).strip()],
        strategy=data.get("strategy") or {},
        reason=str(data.get("reason", "")),
    )
