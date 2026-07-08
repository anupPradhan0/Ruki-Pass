import hashlib

from app import cracker, hashing


def test_compute_variant_modes():
    assert hashing.compute_variant("md5", "pw") == hashlib.md5(b"pw").hexdigest()
    assert hashing.compute_variant("md5", "pw", "s", "prefix") == hashlib.md5(b"spw").hexdigest()
    assert hashing.compute_variant("md5", "pw", "s", "suffix") == hashlib.md5(b"pws").hexdigest()
    assert (
        hashing.compute_variant("sha256", "pw", "key", "hmac")
        == __import__("hmac").new(b"key", b"pw", "sha256").hexdigest()
    )


def test_crack_salted_prefix():
    target = hashlib.sha256(b"NaCl" + b"letmein").hexdigest()
    result = cracker.crack(
        target, algorithm="sha256", salt="NaCl", hash_mode="prefix",
        extra_words=["letmein"], use_rules=False,
    )
    assert result.found
    assert result.password == "letmein"


def test_custom_wordlist_is_tried():
    target = hashlib.md5(b"zzTOPsecretzz").hexdigest()
    result = cracker.crack(
        target, algorithm="md5", custom_words=["zzTOPsecretzz"], use_rules=False,
    )
    assert result.found
    assert result.password == "zzTOPsecretzz"


def test_crack_events_streams_progress_and_result():
    # A guaranteed miss over enough candidates to emit at least one progress tick.
    words = [f"w{i}" for i in range(cracker.PROGRESS_EVERY + 100)]
    target = hashlib.sha256(b"definitely-not-in-the-list").hexdigest()
    events = list(
        cracker.crack_events(
            target, "sha256", custom_words=words, use_rules=False,
            max_candidates=cracker.PROGRESS_EVERY + 50,
        )
    )
    kinds = [e["type"] for e in events]
    assert "progress" in kinds
    assert events[-1]["type"] == "result"
    assert events[-1]["found"] is False
    assert events[-1]["capped"] is True


def test_crack_events_finds_via_stream():
    target = hashlib.md5(b"streamme").hexdigest()
    events = list(
        cracker.crack_events(target, "md5", extra_words=["streamme"], use_rules=False)
    )
    result = events[-1]
    assert result["type"] == "result"
    assert result["found"] is True
    assert result["password"] == "streamme"
    assert result["algorithm"] == "md5"
