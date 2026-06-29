"""Rule-based password mutations.

A plain wordlist only finds passwords that are literally in it. Real passwords
are usually a base word plus predictable tweaks: a capital letter, a trailing
number or year, a "!", some leet substitution. This module takes a base word
and yields those variants — the same idea as hashcat rules.

Example: "mors" -> "Mors", "MORS", "mors123", "Mors123", "M0rs", "Mors!", ...
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator

# Common things people append to a base word.
SUFFIXES = [
    "", "1", "2", "3", "12", "123", "1234", "12345", "11", "21", "69", "007",
    "777", "00", "01", "99", "!", "!!", "@", "#", "$", "1!", "123!", "321",
    "2019", "2020", "2021", "2022", "2023", "2024", "2025",
]

# Less common, but cheap to also try in front.
PREFIXES = ["", "1", "!", "123"]

# Light leet map — one aggressive "translate everything" pass per base.
_LEET = str.maketrans({"a": "@", "e": "3", "i": "1", "o": "0", "s": "$"})


def _case_variants(word: str) -> Iterator[str]:
    seen: set[str] = set()
    for v in (word, word.lower(), word.upper(), word.capitalize()):
        if v and v not in seen:
            seen.add(v)
            yield v


def mutate(word: str, leet: bool = True) -> Iterator[str]:
    """Yield rule-based variants of a single base word (de-duplicated)."""
    bases = list(_case_variants(word))
    if leet:
        bases += [b.translate(_LEET) for b in bases]

    seen: set[str] = set()
    for base in bases:
        for prefix in PREFIXES:
            for suffix in SUFFIXES:
                cand = f"{prefix}{base}{suffix}"
                if cand not in seen:
                    seen.add(cand)
                    yield cand


def mutate_all(words: Iterable[str], leet: bool = True) -> Iterator[str]:
    """Yield mutations for every base word in ``words``."""
    for word in words:
        yield from mutate(word, leet)
