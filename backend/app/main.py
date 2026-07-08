"""Ruki-Pass backend API.

A small FastAPI service for hash-cracking research. MD5 is the first supported
algorithm; the registry in ``hashing.py`` makes adding more a one-line change.
"""

from __future__ import annotations

import json
from typing import Literal

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Load backend/.env (GEMINI_API_KEY, GEMINI_MODEL) before anything reads
# os.environ — explicit path (works regardless of launch dir) and override=True
# so the file always wins over any stale/shadowing shell vars.
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

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
    special_chars: list[str] = Field(
        default_factory=list,
        description="Exact symbols to try (e.g. ['@']) — enables symbol-in-the-middle like 'ruki123@123'.",
    )
    custom_words: list[str] = Field(
        default_factory=list,
        description="An uploaded wordlist — tried early, verbatim (and mutated when rules are on).",
    )
    hash_mode: Literal["plain", "prefix", "suffix", "hmac"] = Field(
        "plain",
        description="Salt/HMAC scheme for plain hashes: H(pw), H(salt+pw), H(pw+salt), HMAC(salt,pw).",
    )
    # PBKDF2-only fields (ignored for plain hashes). Omit salt/iterations when
    # `hash` is a full 'pbkdf2_sha256$iterations$salt$hash' encoded string.
    salt: str | None = Field(
        None,
        description="PBKDF2 salt (text). Not needed if the hash is an encoded string.",
    )
    iterations: int | None = Field(
        None,
        ge=1,
        le=5_000_000,
        description="PBKDF2 iteration count. Not needed if the hash is an encoded string.",
    )
    prf: str = Field(
        "sha256",
        description="PBKDF2 pseudo-random function, e.g. 'sha256'.",
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
    capped: bool = False


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Max crack attempts the assistant may run within a single /api/assist call,
# so it can't loop or burn cost forever.
MAX_CRACK_ATTEMPTS_PER_TURN = 2
# Tighter candidate cap for assistant attempts so each stays fast/interactive.
ASSIST_MAX_CANDIDATES = 6_000_000


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
    # PBKDF2-only (ignored otherwise); omit when the hash is an encoded string.
    salt: str | None = None
    iterations: int | None = None
    prf: str = "sha256"
    # What the user already entered in the form — so the AI won't re-ask it (A).
    extra_words: list[str] = Field(default_factory=list)
    length: int | None = None
    special: Literal["unknown", "yes", "no"] = "unknown"
    special_chars: list[str] = Field(default_factory=list)


def _dispatch_crack(
    hash: str,
    algorithm: str | None,
    *,
    salt: str | None = None,
    iterations: int | None = None,
    prf: str = "sha256",
    hash_mode: str = "plain",
    max_candidates: int | None = None,
    **opts,
) -> cracker.CrackResult:
    """Route a crack request to the right engine by algorithm. bcrypt and PBKDF2
    keep their own low candidate ceilings — the max_candidates override applies
    only to plain hashes. For plain hashes, salt/hash_mode select a salted or
    HMAC scheme. Raises ValueError on an unusable hash/target."""
    if algorithm == "bcrypt":
        return cracker.crack_bcrypt(hashing.validate_bcrypt_hash(hash), **opts)
    if algorithm == "pbkdf2":
        target = hashing.build_pbkdf2_target(hash, salt, iterations, prf)
        return cracker.crack_pbkdf2(target, **opts)
    if max_candidates is not None:
        opts["max_candidates"] = max_candidates
    return cracker.crack(hash, algorithm=algorithm, salt=salt, hash_mode=hash_mode, **opts)


def _dispatch_crack_events(
    hash: str,
    algorithm: str | None,
    *,
    salt: str | None = None,
    iterations: int | None = None,
    prf: str = "sha256",
    hash_mode: str = "plain",
    **opts,
):
    """Streaming counterpart of ``_dispatch_crack`` — returns a generator of
    progress/result event dicts. Eager validation (bcrypt/PBKDF2) raises here;
    plain-hash validation raises when the generator is first advanced."""
    if algorithm == "bcrypt":
        return cracker.crack_bcrypt_events(hashing.validate_bcrypt_hash(hash), **opts)
    if algorithm == "pbkdf2":
        target = hashing.build_pbkdf2_target(hash, salt, iterations, prf)
        return cracker.crack_pbkdf2_events(target, **opts)
    return cracker.crack_events(hash, algorithm=algorithm, salt=salt, hash_mode=hash_mode, **opts)


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
    """Report whether the AI assistant is configured (API key present).

    The model name is redacted if it looks like a secret — guards against a
    misconfigured .env where a key was put in GEMINI_MODEL by mistake.
    """
    model = assistant.MODEL
    safe_model = assistant.redact_secrets(model)
    if safe_model != model:
        safe_model = "(misconfigured: GEMINI_MODEL looks like a key)"
    return {"available": assistant.is_configured(), "model": safe_model}


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

    # Facts the user already gave via the form — passed to the model so it won't
    # re-ask them, and merged into every crack so nothing is dropped (A).
    known = {
        "extra_words": [str(w) for w in req.extra_words],
        "length": req.length,
        "special": req.special,
        "special_chars": [str(c) for c in req.special_chars],
    }

    for _ in range(MAX_CRACK_ATTEMPTS_PER_TURN):
        try:
            decision = assistant.decide(
                req.hash, req.algorithm or "md5", transcript, known
            )
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

        # action == "crack": run the real engine with the model's strategy,
        # merged with the form facts so known info is never dropped, and the
        # model's concrete guesses tried first (B).
        s = decision.strategy
        seeds = list(
            dict.fromkeys([*known["extra_words"], *[str(w) for w in s.get("extra_words", [])]])
        )
        length = s.get("length") if isinstance(s.get("length"), int) else known["length"]
        special = s.get("special") if s.get("special") in {"yes", "no"} else known["special"]
        chars = [str(c) for c in s.get("special_chars", [])] or known["special_chars"]
        try:
            result = _dispatch_crack(
                req.hash,
                req.algorithm,
                salt=req.salt,
                iterations=req.iterations,
                prf=req.prf,
                max_candidates=ASSIST_MAX_CANDIDATES,
                use_rules=bool(s.get("use_rules", True)),
                extra_words=seeds,
                direct_candidates=[str(c) for c in s.get("candidates", [])],
                brute_force=bool(s.get("brute_force", False)),
                length=length if isinstance(length, int) else None,
                special=special,
                special_chars=chars,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        note = str(s.get("note", "")) or "tried a strategy"
        if result.found:
            # Feed the win back into the wordlist so future cracks get it free (C).
            cracker.learn_password(result.password)
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


class VerifyRequest(BaseModel):
    hash: str = Field(..., description="The hash to check against.")
    candidate: str = Field(..., description="The plaintext guess to test.")
    algorithm: str | None = Field(None, description="Hash algorithm; auto-detected if omitted.")
    salt: str | None = None
    iterations: int | None = None
    prf: str = "sha256"
    hash_mode: Literal["plain", "prefix", "suffix", "hmac"] = "plain"


class VerifyResponse(BaseModel):
    match: bool
    algorithm: str | None = None


@app.post("/api/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest) -> VerifyResponse:
    """Check one plaintext guess against a hash — instant, no wordlist search.

    The fast counterpart to /api/crack: useful for bcrypt/PBKDF2 where a full
    crack is slow but testing a single candidate is cheap. A correct guess is
    fed into the learned wordlist so future cracks get it for free.
    """
    algo = req.algorithm
    try:
        if algo == "bcrypt" or (algo is None and hashing.is_bcrypt_hash(req.hash)):
            algo = "bcrypt"
            match = hashing.bcrypt_matches(
                hashing.validate_bcrypt_hash(req.hash), req.candidate
            )
        elif algo == "pbkdf2" or (algo is None and hashing.parse_pbkdf2_encoded(req.hash)):
            algo = "pbkdf2"
            target = hashing.build_pbkdf2_target(req.hash, req.salt, req.iterations, req.prf)
            match = hashing.pbkdf2_matches(target, req.candidate)
        else:
            if algo is None:
                detected = hashing.detect_algorithms(req.hash)
                if not detected:
                    raise ValueError("Could not detect the algorithm — please specify it.")
                algo = detected[0]
            match = hashing.compute_variant(
                algo, req.candidate, req.salt, req.hash_mode
            ) == req.hash.strip().lower()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if match:
        cracker.learn_password(req.candidate)
    return VerifyResponse(match=match, algorithm=algo)


class HashRequest(BaseModel):
    text: str = Field(..., description="The plaintext to hash.")
    algorithm: str = Field(..., description="Which algorithm to hash with.")
    save: bool = Field(
        True,
        description="Add the plaintext to the learned wordlist to improve cracking.",
    )
    salt: str | None = Field(None, description="Salt/key for a salted or HMAC scheme (plain hashes only).")
    hash_mode: Literal["plain", "prefix", "suffix", "hmac"] = Field(
        "plain",
        description="Salt/HMAC scheme for plain hashes; ignored for bcrypt/PBKDF2.",
    )


class HashResponse(BaseModel):
    algorithm: str
    hash: str
    saved: bool


@app.get("/api/hashable")
def hashable() -> dict[str, list[str]]:
    """Algorithms the hash generator can produce."""
    return {"algorithms": hashing.HASHABLE_ALGORITHMS}


@app.post("/api/hash", response_model=HashResponse)
def make_hash(req: HashRequest) -> HashResponse:
    """Hash a plaintext with the chosen algorithm (the reverse of cracking).

    When ``save`` is on, the plaintext is added to the learned wordlist so future
    cracks try it first — a known-password feedback loop.
    """
    if not req.text:
        raise HTTPException(status_code=422, detail="text must not be empty")
    try:
        if req.algorithm in hashing.ALGORITHMS and req.hash_mode != "plain":
            digest = hashing.compute_variant(req.algorithm, req.text, req.salt, req.hash_mode)
        else:
            digest = hashing.generate_hash(req.algorithm, req.text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    saved = cracker.learn_password(req.text) if req.save else False
    return HashResponse(algorithm=req.algorithm, hash=digest, saved=saved)


@app.post("/api/crack", response_model=CrackResponse)
def crack(req: CrackRequest) -> CrackResponse:
    """Attempt to recover the plaintext behind a hash using the wordlist.

    PBKDF2 (algorithm 'pbkdf2') takes a different path: it needs the salt and
    iteration count, supplied either inline in an encoded 'pbkdf2_...' string or
    via the salt/iterations/prf fields.
    """
    try:
        result = _dispatch_crack(
            req.hash,
            req.algorithm,
            salt=req.salt,
            iterations=req.iterations,
            prf=req.prf,
            hash_mode=req.hash_mode,
            use_rules=req.use_rules,
            extra_words=req.extra_words,
            brute_force=req.brute_force,
            brute_max_digits=req.brute_max_digits,
            length=req.length,
            special=req.special,
            brute_around=req.brute_around,
            special_chars=req.special_chars,
            custom_words=req.custom_words,
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
        capped=result.capped,
    )


@app.post("/api/crack/stream")
def crack_stream(req: CrackRequest) -> StreamingResponse:
    """Same as /api/crack, but streams Server-Sent Events so the UI can show a
    live progress counter. Emits ``{"type":"progress",...}`` periodically and a
    final ``{"type":"result",...}`` (or ``{"type":"error",...}``)."""

    def gen():
        try:
            events = _dispatch_crack_events(
                req.hash,
                req.algorithm,
                salt=req.salt,
                iterations=req.iterations,
                prf=req.prf,
                hash_mode=req.hash_mode,
                use_rules=req.use_rules,
                extra_words=req.extra_words,
                brute_force=req.brute_force,
                brute_max_digits=req.brute_max_digits,
                length=req.length,
                special=req.special,
                brute_around=req.brute_around,
                special_chars=req.special_chars,
                custom_words=req.custom_words,
            )
            for ev in events:
                yield f"data: {json.dumps(ev)}\n\n"
        except ValueError as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
