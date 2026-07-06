"""Dictionary-based hash cracker.

A hash can't be reversed, so "cracking" means hashing candidate words and
comparing against the target — the same approach hashcat/john use. This module
streams a wordlist and tries each candidate against one or more algorithms.
"""

from __future__ import annotations

import re
import time
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from itertools import islice
from pathlib import Path

from . import hashing, mutations

WORDLIST_DIR = Path(__file__).parent / "wordlists"
COMMON_WORDLIST = WORDLIST_DIR / "common.txt"

# Preferred wordlists, largest/best first. The first one that exists on disk is
# used by default. rockyou (~14M leaked passwords from SecLists) is fetched via
# scripts/fetch_wordlists.sh and isn't committed; common.txt always ships.
WORDLIST_PRIORITY = ["rockyou.txt", "common.txt"]

# When rules are on, only the top N wordlist entries are mutated (full-list
# mutation would be billions of candidates). The plain full list is still tried.
DEFAULT_RULE_SEED_LIMIT = 5000

# Hard ceiling on candidates per crack call so a huge brute-force space (e.g.
# many special chars × long length) can't run for minutes. ~430k hashes/sec in
# pure Python, so 12M ≈ under 30s.
DEFAULT_MAX_CANDIDATES = 12_000_000

# PBKDF2 runs `iterations` HMACs per guess (thousands), so it's orders of
# magnitude slower than a plain hash — the full rockyou scan is out of reach.
# Cap far lower: hint words + rules + the small common list are the practical
# path. A hit on a targeted guess still returns immediately.
DEFAULT_PBKDF2_MAX_CANDIDATES = 20_000

_HEX_RE = re.compile(r"^[0-9a-f]+$")


def default_wordlist() -> Path:
    """Return the best available wordlist on disk (rockyou if fetched, else
    the small committed starter list)."""
    for name in WORDLIST_PRIORITY:
        path = WORDLIST_DIR / name
        if path.exists():
            return path
    return WORDLIST_DIR / "common.txt"


@dataclass
class CrackResult:
    found: bool
    hash: str
    algorithm: str | None = None
    password: str | None = None
    attempts: int = 0
    duration_ms: float = 0.0
    wordlist_exhausted: bool = True
    wordlist: str | None = None
    capped: bool = False  # True if we stopped at the candidate ceiling


def normalize_hash(hash_hex: str) -> str:
    """Lowercase and strip a hash; raise ValueError if it isn't hex."""
    cleaned = hash_hex.strip().lower()
    if not cleaned or not _HEX_RE.match(cleaned):
        raise ValueError("hash must be a non-empty hexadecimal string")
    return cleaned


def iter_wordlist(path: Path | None = None) -> Iterator[str]:
    """Yield candidate passwords from a wordlist file, one per line.

    Defaults to the best available wordlist (see ``default_wordlist``).
    """
    if path is None:
        path = default_wordlist()
    with path.open("r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            word = line.rstrip("\n\r")
            if word:
                yield word


def build_candidates(
    use_rules: bool,
    extra_words: list[str] | None,
    rule_seed_limit: int,
    brute_force: bool = False,
    brute_max_digits: int = 5,
    length: int | None = None,
    special: str = "unknown",
    brute_around: bool = False,
    special_chars: list[str] | None = None,
) -> Iterator[str]:
    """Build the stream of password candidates to try, cheapest first.

    Order matters: targeted guesses (rule-mutated seed words, then the smart
    brute force on those seeds) run before the long plain scan of the full
    wordlist — so a hit on a custom password is fast.
    """
    extra_words = extra_words or []

    if use_rules:
        # 1. User-provided seed words, mutated (e.g. "mors" -> "Mors123").
        yield from mutations.mutate_all(extra_words)

    # 2. Smart brute force on the seed words.
    if brute_force and extra_words:
        if length is not None:
            # Mask/template mode: word + digit runs + an optional symbol in ANY
            # position (incl. between digits), e.g. 'ruki123@123'.
            yield from mutations.brute_templates(
                extra_words,
                length=length,
                special=special,
                special_chars=special_chars,
            )
        else:
            # Length unknown: fall back to suffix/around numeric brute force.
            yield from mutations.brute_append(
                extra_words,
                max_digits=brute_max_digits,
                special=special,
                around=brute_around,
            )

    if use_rules:
        # 3. The small common list, mutated.
        yield from mutations.mutate_all(iter_wordlist(COMMON_WORDLIST))
        # 4. The most common entries of the main list, mutated.
        if rule_seed_limit > 0:
            yield from mutations.mutate_all(
                islice(iter_wordlist(), rule_seed_limit)
            )
    elif not brute_force:
        # No rules and no brute force: still try the raw seed words verbatim.
        yield from extra_words

    # 5. The full wordlist, plain (the big scan).
    yield from iter_wordlist()


def crack(
    hash_hex: str,
    algorithm: str | None = None,
    wordlist: Iterable[str] | None = None,
    use_rules: bool = True,
    extra_words: list[str] | None = None,
    rule_seed_limit: int = DEFAULT_RULE_SEED_LIMIT,
    brute_force: bool = False,
    brute_max_digits: int = 5,
    length: int | None = None,
    special: str = "unknown",
    brute_around: bool = False,
    special_chars: list[str] | None = None,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
) -> CrackResult:
    """Try to recover the plaintext behind ``hash_hex``.

    If ``algorithm`` is None, it's guessed from the hash length. When
    ``use_rules`` is on, base words are mutated (capitalization, numbers, leet).
    When ``brute_force`` is on with a known ``length``, the template generator
    places digits and an optional symbol (``special_chars``) in any position —
    so 'ruki123@123' is reachable. ``max_candidates`` caps the work so a huge
    space can't run forever. Returns a CrackResult.
    """
    target = normalize_hash(hash_hex)

    if algorithm is not None:
        if algorithm not in hashing.ALGORITHMS:
            raise ValueError(f"unsupported algorithm: {algorithm!r}")
        algorithms = [algorithm]
    else:
        algorithms = hashing.detect_algorithms(target)
        if not algorithms:
            raise ValueError(
                f"could not auto-detect algorithm for a {len(target)}-char hash; "
                "pass `algorithm` explicitly"
            )

    if wordlist is not None:
        candidates: Iterable[str] = wordlist
        wordlist_name = "custom"
    else:
        candidates = build_candidates(
            use_rules,
            extra_words,
            rule_seed_limit,
            brute_force=brute_force,
            brute_max_digits=brute_max_digits,
            length=length,
            special=special,
            brute_around=brute_around,
            special_chars=special_chars,
        )
        base_name = default_wordlist().name
        modes = [m for m, on in (("rules", use_rules), ("brute", brute_force)) if on]
        wordlist_name = f"{base_name} + {' + '.join(modes)}" if modes else base_name

    attempts = 0
    capped = False
    start = time.perf_counter()
    for word in candidates:
        for algo in algorithms:
            attempts += 1
            if hashing.compute(algo, word) == target:
                return CrackResult(
                    found=True,
                    hash=target,
                    algorithm=algo,
                    password=word,
                    attempts=attempts,
                    duration_ms=(time.perf_counter() - start) * 1000,
                    wordlist_exhausted=False,
                    wordlist=wordlist_name,
                )
        if attempts >= max_candidates:
            capped = True
            break

    return CrackResult(
        found=False,
        hash=target,
        algorithm=algorithms[0] if len(algorithms) == 1 else None,
        attempts=attempts,
        duration_ms=(time.perf_counter() - start) * 1000,
        wordlist_exhausted=not capped,
        wordlist=wordlist_name,
        capped=capped,
    )


def crack_pbkdf2(
    target: hashing.Pbkdf2Target,
    wordlist: Iterable[str] | None = None,
    use_rules: bool = True,
    extra_words: list[str] | None = None,
    rule_seed_limit: int = DEFAULT_RULE_SEED_LIMIT,
    brute_force: bool = False,
    brute_max_digits: int = 5,
    length: int | None = None,
    special: str = "unknown",
    brute_around: bool = False,
    special_chars: list[str] | None = None,
    max_candidates: int = DEFAULT_PBKDF2_MAX_CANDIDATES,
) -> CrackResult:
    """Recover the password behind a PBKDF2 ``target`` (salt + iterations known).

    Mirrors ``crack`` for the shared options (rules, hint words, brute force),
    but each guess is far more expensive, so the candidate ceiling is low and
    the big wordlist scan is effectively unreachable — hint words + rules are
    the practical route. Returns a CrackResult with algorithm ``"pbkdf2"``.
    """
    label = f"pbkdf2_{target.prf} ({target.iterations:,} iters)"
    tag = f"pbkdf2_{target.prf}"
    if wordlist is not None:
        candidates: Iterable[str] = wordlist
    else:
        candidates = build_candidates(
            use_rules,
            extra_words,
            rule_seed_limit,
            brute_force=brute_force,
            brute_max_digits=brute_max_digits,
            length=length,
            special=special,
            brute_around=brute_around,
            special_chars=special_chars,
        )

    attempts = 0
    capped = False
    start = time.perf_counter()
    for word in candidates:
        attempts += 1
        if hashing.pbkdf2_matches(target, word):
            return CrackResult(
                found=True,
                hash=tag,
                algorithm="pbkdf2",
                password=word,
                attempts=attempts,
                duration_ms=(time.perf_counter() - start) * 1000,
                wordlist_exhausted=False,
                wordlist=label,
            )
        if attempts >= max_candidates:
            capped = True
            break

    return CrackResult(
        found=False,
        hash=tag,
        algorithm="pbkdf2",
        attempts=attempts,
        duration_ms=(time.perf_counter() - start) * 1000,
        wordlist_exhausted=not capped,
        wordlist=label,
        capped=capped,
    )
