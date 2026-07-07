"""Registry of supported hash algorithms.

Adding a new algorithm is intentionally a one-line change: register its name
and a function that turns raw bytes into a lowercase hex digest. Everything
else (the API, the cracker, auto-detection by length) reads from this registry,
so MD5 is just the first of many.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import re
from collections.abc import Callable
from dataclasses import dataclass

# name -> function(bytes) -> hex digest (lowercase)
ALGORITHMS: dict[str, Callable[[bytes], str]] = {
    "md5": lambda b: hashlib.md5(b).hexdigest(),
    "sha1": lambda b: hashlib.sha1(b).hexdigest(),
    "sha224": lambda b: hashlib.sha224(b).hexdigest(),
    "sha256": lambda b: hashlib.sha256(b).hexdigest(),
    "sha384": lambda b: hashlib.sha384(b).hexdigest(),
    "sha512": lambda b: hashlib.sha512(b).hexdigest(),
}

# Hex-digest length -> algorithms that produce that length, used to guess the
# algorithm when the caller doesn't specify one.
LENGTH_TO_ALGORITHMS: dict[int, list[str]] = {}
for _name, _fn in ALGORITHMS.items():
    _length = len(_fn(b""))
    LENGTH_TO_ALGORITHMS.setdefault(_length, []).append(_name)


def supported_algorithms() -> list[str]:
    """Names of every registered algorithm."""
    return list(ALGORITHMS)


def compute(algorithm: str, text: str) -> str:
    """Hash ``text`` (UTF-8) with ``algorithm`` and return a hex digest."""
    fn = ALGORITHMS[algorithm]
    return fn(text.encode("utf-8"))


def detect_algorithms(hash_hex: str) -> list[str]:
    """Best-effort guess of which algorithms could have produced this hash,
    based on its hex length. Returns an empty list if nothing matches."""
    return LENGTH_TO_ALGORITHMS.get(len(hash_hex.strip()), [])


# ---------------------------------------------------------------------------
# PBKDF2 — a slow, salted key-derivation function, NOT a plain hash.
#
# Unlike the algorithms above, verifying a candidate needs the SALT and the
# ITERATION count as well as the password, so PBKDF2 lives outside the simple
# name->digest ALGORITHMS registry. Two input shapes are accepted:
#   1. A Django-style encoded string: pbkdf2_<prf>$<iterations>$<salt>$<b64hash>
#      (salt + iterations are embedded — the user pastes one value).
#   2. A raw derived key (hex or base64) plus an explicit salt/iterations/prf.
# ---------------------------------------------------------------------------

# PRF (pseudo-random function) names hashlib.pbkdf2_hmac accepts.
PBKDF2_PRFS = {"sha1", "sha224", "sha256", "sha384", "sha512", "md5"}

# Hard ceiling on iterations so one malformed/huge target can't hang the machine
# for minutes on a single candidate (PBKDF2 cost scales linearly with them).
MAX_PBKDF2_ITERATIONS = 5_000_000

_PBKDF2_ENCODED_RE = re.compile(
    r"^pbkdf2_(?P<prf>[a-z0-9]+)\$(?P<iterations>\d+)\$(?P<salt>[^$]*)\$(?P<hash>[A-Za-z0-9+/=_\-]+)$"
)


@dataclass
class Pbkdf2Target:
    """Everything needed to test a password against a PBKDF2 hash."""

    prf: str          # e.g. "sha256"
    iterations: int
    salt: bytes
    digest: bytes     # the expected derived key, raw bytes

    @property
    def dklen(self) -> int:
        return len(self.digest)


def _b64_to_bytes(text: str) -> bytes:
    """Decode base64 (standard or URL-safe), tolerating missing padding."""
    padded = text + "=" * (-len(text) % 4)
    try:
        return base64.b64decode(padded)
    except (binascii.Error, ValueError):
        return base64.urlsafe_b64decode(padded)


def _decode_key(text: str) -> bytes:
    """Decode a derived key given as hex or base64 into raw bytes."""
    s = text.strip()
    if len(s) % 2 == 0 and re.fullmatch(r"[0-9a-fA-F]+", s):
        return bytes.fromhex(s)
    return _b64_to_bytes(s)


def parse_pbkdf2_encoded(encoded: str) -> Pbkdf2Target | None:
    """Parse a 'pbkdf2_<prf>$<iterations>$<salt>$<b64hash>' string, or return
    None if the text isn't in that shape (so the caller can fall back to
    explicit fields)."""
    m = _PBKDF2_ENCODED_RE.match(encoded.strip())
    if not m:
        return None
    prf = m.group("prf")
    if prf not in PBKDF2_PRFS:
        raise ValueError(f"unsupported PBKDF2 PRF: {prf!r}")
    return Pbkdf2Target(
        prf=prf,
        iterations=int(m.group("iterations")),
        salt=m.group("salt").encode("utf-8"),
        digest=_b64_to_bytes(m.group("hash")),
    )


def build_pbkdf2_target(
    hash_str: str,
    salt: str | None = None,
    iterations: int | None = None,
    prf: str = "sha256",
) -> Pbkdf2Target:
    """Build a Pbkdf2Target from either an encoded string (salt/iterations
    embedded) or a raw derived key plus explicit salt/iterations/prf. Raises
    ValueError on anything unusable."""
    target = parse_pbkdf2_encoded(hash_str)
    if target is None:
        if not (salt or "").strip() or iterations is None:
            raise ValueError(
                "PBKDF2 needs a salt and an iteration count. Paste a "
                "'pbkdf2_sha256$iterations$salt$hash' string, or fill in the "
                "salt and iterations fields."
            )
        if prf not in PBKDF2_PRFS:
            raise ValueError(f"unsupported PBKDF2 PRF: {prf!r}")
        try:
            digest = _decode_key(hash_str)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("PBKDF2 hash must be valid hex or base64") from exc
        if not digest:
            raise ValueError("PBKDF2 hash is empty")
        target = Pbkdf2Target(
            prf=prf,
            iterations=int(iterations),
            salt=salt.encode("utf-8"),
            digest=digest,
        )
    if target.iterations < 1:
        raise ValueError("PBKDF2 iterations must be >= 1")
    if target.iterations > MAX_PBKDF2_ITERATIONS:
        raise ValueError(
            f"PBKDF2 iterations {target.iterations:,} exceed the safety limit "
            f"of {MAX_PBKDF2_ITERATIONS:,}."
        )
    return target


def pbkdf2_matches(target: Pbkdf2Target, password: str) -> bool:
    """True if ``password`` derives ``target``'s expected key."""
    derived = hashlib.pbkdf2_hmac(
        target.prf,
        password.encode("utf-8"),
        target.salt,
        target.iterations,
        target.dklen,
    )
    return hmac.compare_digest(derived, target.digest)


# ---------------------------------------------------------------------------
# bcrypt — another slow, salted hash. Like PBKDF2 it can't be reversed and each
# guess is expensive, but its 60-char string is fully self-contained
# ($2<ver>$<cost>$<22-char salt><31-char digest>), so the user pastes one value
# and nothing else. bcrypt isn't in the stdlib, so we lean on the `bcrypt`
# package (imported lazily, with a clear message if it's not installed).
# ---------------------------------------------------------------------------

# $2a$/$2b$/$2x$/$2y$ + two-digit cost + 53 base64-ish chars = 60 total.
_BCRYPT_RE = re.compile(r"^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$")


def _import_bcrypt():
    try:
        import bcrypt
    except ImportError as exc:  # pragma: no cover - only if dep is missing
        raise ValueError(
            "bcrypt support needs the 'bcrypt' package. Run 'uv add bcrypt' "
            "(or 'uv sync') in the backend/ directory, then restart the server."
        ) from exc
    return bcrypt


def is_bcrypt_hash(text: str) -> bool:
    """True if ``text`` looks like a bcrypt hash string."""
    return bool(_BCRYPT_RE.match(text.strip()))


def bcrypt_cost(hashed: str) -> int | None:
    """The work factor embedded in a bcrypt hash (e.g. 12), or None if unclear."""
    parts = hashed.strip().split("$")
    if len(parts) >= 3 and parts[2].isdigit():
        return int(parts[2])
    return None


def validate_bcrypt_hash(text: str) -> str:
    """Return the cleaned bcrypt hash, or raise ValueError if it's malformed or
    the bcrypt package isn't available."""
    hashed = text.strip()
    if not is_bcrypt_hash(hashed):
        raise ValueError(
            "Not a valid bcrypt hash — expected something like "
            "'$2b$12$...' (60 characters)."
        )
    _import_bcrypt()  # fail early with a clear message if the dep is missing
    return hashed


def bcrypt_matches(hashed: str, password: str) -> bool:
    """True if ``password`` verifies against the bcrypt ``hashed`` string."""
    bcrypt = _import_bcrypt()
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        # A candidate with e.g. a null byte, or a malformed hash — not a match.
        return False


# ---------------------------------------------------------------------------
# Hash generation — the reverse of cracking: turn a plaintext into a hash with a
# chosen algorithm. bcrypt/PBKDF2 get sensible defaults + a random salt.
# ---------------------------------------------------------------------------

# Everything the generator can produce (registry hashes + the two slow KDFs).
HASHABLE_ALGORITHMS = [*ALGORITHMS, "bcrypt", "pbkdf2"]

PBKDF2_DEFAULT_ITERATIONS = 260_000  # Django's modern default


def generate_hash(algorithm: str, text: str) -> str:
    """Hash ``text`` with ``algorithm`` and return a string. Plain hashes are
    hex; bcrypt and PBKDF2 return their self-contained encoded strings."""
    if algorithm in ALGORITHMS:
        return compute(algorithm, text)
    if algorithm == "bcrypt":
        bcrypt = _import_bcrypt()
        return bcrypt.hashpw(text.encode("utf-8"), bcrypt.gensalt()).decode()
    if algorithm == "pbkdf2":
        salt = base64.b64encode(os.urandom(12)).decode().replace("$", "")
        dk = hashlib.pbkdf2_hmac(
            "sha256", text.encode("utf-8"), salt.encode("utf-8"),
            PBKDF2_DEFAULT_ITERATIONS,
        )
        return f"pbkdf2_sha256${PBKDF2_DEFAULT_ITERATIONS}${salt}${base64.b64encode(dk).decode()}"
    raise ValueError(f"unsupported algorithm: {algorithm!r}")
