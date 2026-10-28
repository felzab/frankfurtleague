"""SCRIPTS · `scripts/lib/_lib.sh :: redact_uri_credentials`, the filter a container's log reaches the operator through.

Wrong in either direction and silent in both: a credential reaching the deploy's terminal, or the
host redacted out of the log a failing deploy is read from. Each case is a real error-message shape.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, base_env, lift_function

LIB: Final = Path(__file__).resolve().parent.parent / "lib" / "_lib.sh"

CASES: Final[tuple[tuple[str, str], ...]] = (
    # Replaced: the userinfo, and nothing past it.
    ('Invalid connection string "mongodb://u:pw@host.example.net/db"', 'Invalid connection string "mongodb://<redacted>@host.example.net/db"'),
    ("mongodb+srv://u:pw@cluster.example.net/db", "mongodb+srv://<redacted>@cluster.example.net/db"),
    ("MONGODB://u:pw@host.example.net/db", "MONGODB://<redacted>@host.example.net/db"),
    # An encoded `@` inside the password, which is the only way a MongoDB URI may carry one.
    ("mongodb://u:pw%40x@host.example.net/db", "mongodb://<redacted>@host.example.net/db"),
    # A comma is a sub-delimiter userinfo may hold unencoded, so the bound may not stop at one.
    ("mongodb://u:pw,x@host.example.net/db", "mongodb://<redacted>@host.example.net/db"),
    # A seed list, where the same comma separates hosts instead.
    ("mongodb://u:pw@h1.example.net,h2.example.net/db?replicaSet=rs", "mongodb://<redacted>@h1.example.net,h2.example.net/db?replicaSet=rs"),
    # Fails OPEN where the bound is a character class: a delimiter in the password leaves no `@` inside
    # the class, and ill-formed is the very string a driver could not parse.
    ("mongodb://admin:S3cr3t/Pw@host.example.net/db", "mongodb://<redacted>@host.example.net/db"),
    ("mongodb://admin:S3cr3t?Pw@host.example.net/db", "mongodb://<redacted>@host.example.net/db"),
    ('mongodb://admin:S3cr3t"Pw@host.example.net/db', "mongodb://<redacted>@host.example.net/db"),
    ("mongodb://admin:S3cr3t Pw@host.example.net/db", "mongodb://<redacted>@host.example.net/db"),
    ("mongodb://admin:S3cr3t\tPw@host.example.net/db", "mongodb://<redacted>@host.example.net/db"),
    # Bounded: an `@` further along the line is not the userinfo's, and reaching it costs the host.
    ("mongodb://u:pw@host.example.net/db?authSource=admin&appName=x@y", "mongodb://<redacted>@host.example.net/db?authSource=admin&appName=x@y"),
    ("mongodb://u:pw@host.example.net?appName=x@y", "mongodb://<redacted>@host.example.net?appName=x@y"),
    # A bare `@` past a comma: only stopping at the FIRST `@` keeps the host.
    ("uri=mongodb://u1:p1@h1.example.net:27017,ops@example.com", "uri=mongodb://<redacted>@h1.example.net:27017,ops@example.com"),
    (
        "MONGODB_URI=mongodb://u:p@rs0.example.net:27017,AUTH_USER=admin@example.com",
        "MONGODB_URI=mongodb://<redacted>@rs0.example.net:27017,AUTH_USER=admin@example.com",
    ),
    # Two URIs in one JSON object, the shape a log line carries them in.
    ('a:"mongodb://u:pw@h1.example.net/","mongodb://v:qw@h2.example.net/"', 'a:"mongodb://<redacted>@h1.example.net/","mongodb://<redacted>@h2.example.net/"'),
    ("mongodb://u:pw@h1.example.net/ mongodb://v:qw@h2.example.net/", "mongodb://<redacted>@h1.example.net/ mongodb://<redacted>@h2.example.net/"),
    # Untouched: no userinfo to replace.
    ("mongodb://localhost:27017", "mongodb://localhost:27017"),
    ("mongodb+srv://cluster.example.net/db", "mongodb+srv://cluster.example.net/db"),
    ("write to nobody@example.net about it", "write to nobody@example.net about it"),
    # The gap `docs/logging/spec.md` section 4 records: no URI around it, so nothing matches.
    ("MONGO_PASSWORD=pw", "MONGO_PASSWORD=pw"),
    # The second gap it records: no userinfo, so the first `@` after the scheme is somebody else's and
    # the host goes with it. Nothing on this line was ever secret.
    ("mongodb://localhost:27017 and mail nobody@example.net", "mongodb://<redacted>@example.net"),
)


@pytest.mark.parametrize(("line", "shown"), CASES)
def test_a_container_line_reaches_the_screen_with_its_userinfo_alone_redacted(line: str, shown: str) -> None:
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    done = subprocess.run(
        [BASH, "-c", lift_function(LIB, "redact_uri_credentials") + "\nredact_uri_credentials"],
        input=line + "\n",
        capture_output=True,
        encoding="utf-8",
        env=base_env(),
        check=False,
    )
    assert done.returncode == 0, done.stderr
    assert done.stdout == shown + "\n"
