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
    "extra_words": ["<seed word>", ...],           // words to build guesses from (a name, pet, team, etc.)
    "use_rules": true,                             // capitalization / leet / common suffixes
    "brute_force": true,                           // build word + numbers (+ optional symbol)
    "length": <int or null>,                       // EXACT total length if known — makes it much faster
    "special": "no" | "yes" | "unknown",           // does it contain a special character?
    "special_chars": ["@"],                        // the EXACT symbols the user mentioned, if any
    "note": "<what this attempt tries>"
  },
  "reason": "<why you are giving up>"              // ONLY when action == "give_up"
}

How the engine works (you only choose the strategy — the engine does the work):
- With brute_force + a known length, it places the word, digit groups, and ONE \
symbol in ANY arrangement, including the symbol BETWEEN digits — so shapes like \
'ruki123@123' (word+digits+symbol+digits) are fully covered.
- Always pass the EXACT length and, if the user named a symbol like '@', put it \
in special_chars (e.g. ["@"]). Both make the search dramatically faster.

Rules for choosing the action:
- If you do NOT yet have any candidate word, action "ask" — one short batch of \
questions (word/name, length, special char). Ask only ONCE.
- As soon as you have at least one candidate word AND a rough length, action \
"crack". Do NOT keep asking — never re-ask something already answered above.
- After a failed crack, refine the strategy (different words, special toggled, \
adjusted length) and crack again — don't fall back to asking.
- A password with no memorable word and truly random characters may be \
uncrackable by guessing — then action "give_up" with an honest reason.
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
    # Real Gemini keys start with "AIza" (legacy) or "AQ." (new auth keys).
    # Catch the common mix-up of putting the model name or a placeholder here.
    if not (api_key.startswith("AIza") or api_key.startswith("AQ.")):
        raise AssistantError(
            f"GEMINI_API_KEY in backend/.env doesn't look like an API key "
            f"(it starts with '{api_key[:6]}…'). A real key starts with 'AQ.' or "
            "'AIza'. You may have put the model name there by mistake — the model "
            "goes in GEMINI_MODEL, the key in GEMINI_API_KEY. Get a key at "
            "https://aistudio.google.com/apikey."
        )
    # Imported lazily so the rest of the app runs without google-genai installed.
    from google import genai
    from google.genai import types

    # 60s cap so a slow/stuck call returns an error instead of hanging forever.
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=60_000),
    )


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

    # If the user has already answered, force a crack instead of re-asking.
    if any(m.get("role") == "user" for m in transcript):
        lines.append(
            "The user has ALREADY answered above. Do NOT ask more questions — "
            "choose action 'crack' now, deriving extra_words / length / special "
            "/ special_chars from their answers."
        )
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
        text = str(exc)
        if "API_KEY_INVALID" in text or "API key not valid" in text:
            raise AssistantError(
                "Gemini rejected the API key. Check that GEMINI_API_KEY in "
                "backend/.env is the full key with no quotes or spaces, and that "
                "it hasn't been auto-disabled (new AQ. keys are revoked if Google "
                "detects them leaked). Generate a fresh key at "
                "https://aistudio.google.com/apikey, put it in backend/.env, and "
                "restart the backend."
            ) from exc
        if "PERMISSION_DENIED" in text or "403" in text:
            raise AssistantError(
                f"Gemini denied access for model '{MODEL}'. The key may not have "
                "access to this model — try GEMINI_MODEL=gemini-2.5-flash in .env."
            ) from exc
        raise AssistantError(f"Gemini request failed: {text}") from exc

    raw = (response.text or "").strip()
    if not raw:
        raise AssistantError("Model returned an empty response.")

    data = _extract_json(raw)
    action = data.get("action")
    if action not in {"ask", "crack", "give_up"}:
        raise AssistantError(f"Model returned an unknown action: {action!r}")

    # Safety net: if the model tries to ask again after the user already
    # answered, force a crack so it can't loop on questions.
    user_answered = any(m.get("role") == "user" for m in transcript)
    if action == "ask" and user_answered:
        action = "crack"

    return Decision(
        thought=str(data.get("thought", "")),
        action=action,
        questions=[str(q) for q in data.get("questions", []) if str(q).strip()],
        strategy=data.get("strategy") or {},
        reason=str(data.get("reason", "")),
    )
