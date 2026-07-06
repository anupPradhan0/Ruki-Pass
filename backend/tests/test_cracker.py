import hashlib

from app import cracker, hashing

# Small fixed wordlist so tests are fast and don't depend on whether the large
# rockyou.txt has been downloaded.
WORDS = ["123456", "qwerty", "hello123", "dragon", "letmein"]


def test_md5_crack_from_wordlist():
    target = hashlib.md5(b"hello123").hexdigest()
    result = cracker.crack(target, algorithm="md5", wordlist=WORDS)
    assert result.found
    assert result.password == "hello123"
    assert result.algorithm == "md5"
    assert result.wordlist == "custom"


def test_auto_detect_md5_by_length():
    target = hashlib.md5(b"qwerty").hexdigest()
    result = cracker.crack(target, wordlist=WORDS)  # no algorithm passed
    assert result.found
    assert result.password == "qwerty"
    assert result.algorithm == "md5"


def test_sha1_crack():
    target = hashlib.sha1(b"letmein").hexdigest()
    result = cracker.crack(target, algorithm="sha1", wordlist=WORDS)
    assert result.found
    assert result.password == "letmein"
    assert result.algorithm == "sha1"


def test_auto_detect_sha1_by_length():
    # SHA-1 digests are 40 hex chars — auto-detection should pick sha1.
    target = hashlib.sha1(b"dragon").hexdigest()
    result = cracker.crack(target, wordlist=WORDS)  # no algorithm passed
    assert result.found
    assert result.password == "dragon"
    assert result.algorithm == "sha1"


def test_sha256_crack():
    target = hashlib.sha256(b"dragon").hexdigest()
    result = cracker.crack(target, algorithm="sha256", wordlist=WORDS)
    assert result.found
    assert result.password == "dragon"


def test_auto_detect_sha256_by_length():
    # SHA-256 digests are 64 hex chars — auto-detection should pick sha256.
    target = hashlib.sha256(b"qwerty").hexdigest()
    result = cracker.crack(target, wordlist=WORDS)  # no algorithm passed
    assert result.found
    assert result.password == "qwerty"
    assert result.algorithm == "sha256"


def test_not_found_exhausts_wordlist():
    target = hashlib.md5(b"this-is-not-in-the-list-xyz").hexdigest()
    result = cracker.crack(target, algorithm="md5", wordlist=WORDS)
    assert not result.found
    assert result.password is None
    assert result.wordlist_exhausted


def test_invalid_hash_raises():
    try:
        cracker.crack("not-hex!", algorithm="md5", wordlist=WORDS)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for non-hex input")


def test_registry_lengths():
    assert hashing.detect_algorithms("a" * 32) == ["md5"]
    assert "sha256" in hashing.detect_algorithms("a" * 64)


def test_default_wordlist_exists():
    # Either rockyou.txt (if fetched) or common.txt must be available.
    assert cracker.default_wordlist().exists()


def test_mutations_generate_expected_variants():
    from app import mutations

    variants = set(mutations.mutate("mors"))
    assert "Mors123" in variants  # capitalize + append
    assert "MORS" in variants  # uppercase
    assert "M0r$" in variants  # leet (o -> 0, s -> $)


def test_crack_custom_word_with_rules():
    # "Mors123" isn't in any wordlist, but rules build it from the seed "mors".
    target = hashlib.md5(b"Mors123").hexdigest()
    result = cracker.crack(
        target, algorithm="md5", extra_words=["mors"], wordlist=None
    )
    assert result.found
    assert result.password == "Mors123"


def test_brute_force_with_length_and_special():
    # "anup77353" = word + 5 random digits, no special; rules can't build it,
    # but smart brute force with length=9, special="no" finds it.
    target = hashlib.md5(b"anup77353").hexdigest()
    result = cracker.crack(
        target,
        algorithm="md5",
        use_rules=False,
        extra_words=["anup"],
        brute_force=True,
        length=9,
        special="no",
    )
    assert result.found
    assert result.password == "anup77353"


def test_template_symbol_in_the_middle():
    # 'ruki123@123' = word + digits + symbol + digits — only the template
    # generator can place the symbol between digit groups.
    target = hashlib.md5(b"ruki123@123").hexdigest()
    result = cracker.crack(
        target,
        algorithm="md5",
        use_rules=False,
        extra_words=["ruki"],
        brute_force=True,
        length=11,
        special="yes",
        special_chars=["@"],
    )
    assert result.found
    assert result.password == "ruki123@123"


def test_brute_templates_generates_middle_symbol():
    from app import mutations

    gen = mutations.brute_templates(["ab"], length=6, special="yes", special_chars=["@"])
    # word 'ab' (2) + symbol (1) + 3 digits in two runs -> e.g. 'ab1@23'
    assert any(c == "ab1@23" for c in gen)


def test_max_candidates_cap_stops_early():
    target = hashlib.md5(b"zzzznotfound9999").hexdigest()
    result = cracker.crack(
        target,
        algorithm="md5",
        use_rules=False,
        extra_words=["abc"],
        brute_force=True,
        length=12,
        special="unknown",
        max_candidates=1000,
    )
    assert not result.found
    assert result.capped
    assert result.attempts <= 1000 + 1


def test_brute_force_around_word():
    # "45akash5465" = digits + word + digits; only the `around` option builds it.
    target = hashlib.md5(b"45akash5465").hexdigest()
    result = cracker.crack(
        target,
        algorithm="md5",
        use_rules=False,
        extra_words=["akash"],
        brute_force=True,
        length=11,
        special="no",
        brute_around=True,
    )
    assert result.found
    assert result.password == "45akash5465"


def test_around_finds_what_suffix_cannot():
    from app import mutations

    args = dict(length=11, special="no")
    suffix_only = set(mutations.brute_append(["akash"], around=False, **args))
    assert "45akash5465" not in suffix_only  # digits-before is impossible here
    around = mutations.brute_append(["akash"], around=True, **args)
    assert any(c == "45akash5465" for c in around)


def test_brute_append_respects_length():
    from app import mutations

    cands = list(mutations.brute_append(["anup"], length=9, special="no"))
    # Every candidate must be exactly 9 chars (4-char base + 5 digits).
    assert all(len(c) == 9 for c in cands)
    assert "anup77353" in cands


def test_rules_off_skips_mutations():
    target = hashlib.md5(b"Mors123").hexdigest()
    # With rules off and the seed only tried verbatim, "Mors123" won't be built.
    result = cracker.crack(
        target,
        algorithm="md5",
        use_rules=False,
        extra_words=["mors"],
        wordlist=["mors", "other"],
    )
    assert not result.found
