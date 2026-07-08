import hashlib

import pytest

from app import main
from app.main import VerifyRequest


@pytest.fixture(autouse=True)
def _no_disk_learn(monkeypatch):
    # A correct guess would append to the learned wordlist on disk — stub it out.
    monkeypatch.setattr(main.cracker, "learn_password", lambda text: True)


def test_verify_md5_match():
    h = hashlib.md5(b"hunter2").hexdigest()
    res = main.verify(VerifyRequest(hash=h, candidate="hunter2", algorithm="md5"))
    assert res.match
    assert res.algorithm == "md5"


def test_verify_md5_no_match_autodetect():
    h = hashlib.md5(b"hunter2").hexdigest()
    res = main.verify(VerifyRequest(hash=h, candidate="nope"))  # no algorithm given
    assert not res.match
    assert res.algorithm == "md5"  # detected from the 32-char length


def test_verify_sha256_match_autodetect():
    h = hashlib.sha256(b"correct horse").hexdigest()
    res = main.verify(VerifyRequest(hash=h, candidate="correct horse"))
    assert res.match
    assert res.algorithm == "sha256"
