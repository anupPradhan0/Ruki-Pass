"""Ruki-Pass backend API.

A small FastAPI service for hash-cracking research. MD5 is the first supported
algorithm; the registry in ``hashing.py`` makes adding more a one-line change.
"""

from __future__ import annotations

from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Load backend/.env (GEMINI_API_KEY, GEMINI_MODEL) before anything reads os.environ.
load_dotenv()

from . import assistant, cracker, hashing

app = FastAPI(
    title="Ruki-Pass API",
    description="Hash-cracking research API (MD5 and more).",
    version="0.1.0",
)

# Allow the Vite dev server to call us during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CrackRequest(BaseModel):
    hash: str = Field(..., description="The hash to crack, as a hex string.")
    algorithm: str | None = Field(
        None,
        description="Hash algorithm (e.g. 'md5'). Auto-detected from length if omitted.",
    )
    use_rules: bool = Field(
        True,
        description="Apply mutation rules (capitalization, numbers, leet) to base words.",
    )
    extra_words: list[str] = Field(
        default_factory=list,
        description="Extra seed words (e.g. a name) to mutate, like 'mors' -> 'Mors123'.",
    )
    brute_force: bool = Field(
        False,
        description="Brute-force numeric suffixes on the seed words (e.g. 'anup' -> 'anup77353').",
    )
    brute_max_digits: int = Field(
        5,
        ge=1,
        le=8,
        description="Max trailing digits to try when length is unknown.",
    )
    length: int | None = Field(
        None,
        ge=1,
        le=64,
        description="Known total password length — prunes the brute-force search.",
    )
    special: Literal["unknown", "yes", "no"] = Field(
        "unknown",
        description="Whether the password contains a special character.",
    )
    brute_around: bool = Field(
        False,
        description="Also place digits before/around the word ('45akash5465'), not just at the end.",
    )


class CrackResponse(BaseModel):
    found: bool
    hash: str
    algorithm: str | None = None
    password: str | None = None
    attempts: int
    duration_ms: float
    wordlist_exhausted: bool
    wordlist: str | None = None


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Max crack attempts the assistant may run within a single /api/assist call,
# so it can't loop or burn cost forever.
MAX_CRACK_ATTEMPTS_PER_TURN = 4


class TranscriptMessage(BaseModel):
    role: Literal["assistant", "user", "system"]
    text: str


class AssistRequest(BaseModel):
    hash: str = Field(..., description="The hash to recover.")
    algorithm: str | None = Field(None, description="Hash algorithm, e.g. 'md5'.")
    transcript: list[TranscriptMessage] = Field(
        default_factory=list,
        description="Conversation so far. Empty on the first call.",
    )


class AssistResponse(BaseModel):
    # need_input → show questions; solved → password; gave_up / exhausted → stop.
    status: Literal["need_input", "solved", "gave_up", "exhausted"]
    thought: str = ""
    questions: list[str] = Field(default_factory=list)
    password: str | None = None
    attempts: int | None = None
    strategy_note: str | None = None
    reason: str | None = None
    transcript: list[TranscriptMessage] = Field(default_factory=list)


@app.get("/api/assist/status")
def assist_status() -> dict[str, object]:
    """Report whether the AI assistant is configured (API key present)."""
    return {"available": assistant.is_configured(), "model": assistant.MODEL}


@app.post("/api/assist", response_model=AssistResponse)
def assist(req: AssistRequest) -> AssistResponse:
    """Advance the AI-assisted cracking loop by one user-facing step.

    The model decides to ask the user questions, run a crack strategy, or give
    up. Crack attempts run server-side against the real engine; the loop pauses
    and returns to the client whenever it needs the user to answer something.
    """
    # Redact any credential-looking text a user may have pasted, so it's never
    # stored, echoed back to the browser, or sent on to the model.
    transcript = [
        {"role": m.role, "text": assistant.redact_secrets(m.text)}
        for m in req.transcript
    ]

    for _ in range(MAX_CRACK_ATTEMPTS_PER_TURN):
        try:
            decision = assistant.decide(req.hash, req.algorithm or "md5", transcript)
        except assistant.AssistantError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        if decision.action == "ask":
            for q in decision.questions:
                transcript.append({"role": "assistant", "text": q})
            return AssistResponse(
                status="need_input",
                thought=decision.thought,
                questions=decision.questions,
                transcript=[TranscriptMessage(**m) for m in transcript],
            )

        if decision.action == "give_up":
            return AssistResponse(
                status="gave_up",
                thought=decision.thought,
                reason=decision.reason,
                transcript=[TranscriptMessage(**m) for m in transcript],
            )

        # action == "crack": run the real engine with the model's strategy.
        s = decision.strategy
        try:
            result = cracker.crack(
                req.hash,
                algorithm=req.algorithm,
                use_rules=bool(s.get("use_rules", True)),
                extra_words=[str(w) for w in s.get("extra_words", [])],
                brute_force=bool(s.get("brute_force", False)),
                length=s.get("length") if isinstance(s.get("length"), int) else None,
                special=s.get("special", "unknown")
                if s.get("special") in {"yes", "no", "unknown"}
                else "unknown",
                brute_around=bool(s.get("brute_around", False)),
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        note = str(s.get("note", "")) or "tried a strategy"
        if result.found:
            transcript.append(
                {"role": "system", "text": f"Crack attempt ({note}): FOUND '{result.password}'."}
            )
            return AssistResponse(
                status="solved",
                thought=decision.thought,
                password=result.password,
                attempts=result.attempts,
                strategy_note=note,
                transcript=[TranscriptMessage(**m) for m in transcript],
            )

        # Not found — record the outcome and let the model react on the next pass.
        transcript.append(
            {
                "role": "system",
                "text": f"Crack attempt ({note}): NOT FOUND after "
                f"{result.attempts:,} candidates.",
            }
        )

    # Ran out of attempts for this turn without solving or asking.
    return AssistResponse(
        status="exhausted",
        thought="Tried several strategies this round without success.",
        transcript=[TranscriptMessage(**m) for m in transcript],
    )


@app.get("/api/algorithms")
def algorithms() -> dict[str, list[str]]:
    """List every hash algorithm the cracker currently supports."""
    return {"algorithms": hashing.supported_algorithms()}


@app.post("/api/crack", response_model=CrackResponse)
def crack(req: CrackRequest) -> CrackResponse:
    """Attempt to recover the plaintext behind a hash using the wordlist."""
    try:
        result = cracker.crack(
            req.hash,
            algorithm=req.algorithm,
            use_rules=req.use_rules,
            extra_words=req.extra_words,
            brute_force=req.brute_force,
            brute_max_digits=req.brute_max_digits,
            length=req.length,
            special=req.special,
            brute_around=req.brute_around,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return CrackResponse(
        found=result.found,
        hash=result.hash,
        algorithm=result.algorithm,
        password=result.password,
        attempts=result.attempts,
        duration_ms=round(result.duration_ms, 3),
        wordlist_exhausted=result.wordlist_exhausted,
        wordlist=result.wordlist,
    )
