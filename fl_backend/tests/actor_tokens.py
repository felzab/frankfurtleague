"""
TESTS · actor tokens signed as the frontend's server signs them, under a pair made for this run

The pair is generated when the suite imports this module, so no signing key is ever committed, and
`tests/config.py :: build_test_config` configures its public half exactly as a deployment would.
"""

import secrets
import time
from base64 import urlsafe_b64encode
from collections.abc import Iterator, Mapping
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app.core.actor_token import (
    ACTOR_TOKEN_ALGORITHM,
    ACTOR_TOKEN_AUDIENCE,
    ACTOR_TOKEN_ISSUER,
    ACTOR_TOKEN_LIFETIME_S,
    ACTOR_TOKEN_TYPE,
    PASSKEY_FACTOR,
    Lane,
    jwk_thumbprint,
)
from app.core.security import ACTOR_HEADER


def public_key_of(private_key: Ed25519PrivateKey) -> str:
    """The public half as `ACTOR_TOKEN_PUBLIC_KEY` spells it: RFC 8037's `x`."""

    raw = private_key.public_key().public_bytes(encoding=Encoding.Raw, format=PublicFormat.Raw)
    return urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


SIGNING_KEY = Ed25519PrivateKey.generate()
ACTOR_TOKEN_PUBLIC_KEY = public_key_of(SIGNING_KEY)

# A pair no configuration names: what a token signed by anyone but the frontend is signed under.
FOREIGN_SIGNING_KEY = Ed25519PrivateKey.generate()

# How long before its token a session was made: inside the administrator's window, and not the token's own instant.
SESSION_AGE_S = 60


def actor_claims(email: str, *, lane: Lane = "admin") -> dict[str, Any]:
    """Every claim the contract requires, as a session of `lane`'s guard would carry them: an administrator's by passkey, a person's by code."""

    now = int(time.time())
    return {
        "iss": ACTOR_TOKEN_ISSUER,
        "aud": ACTOR_TOKEN_AUDIENCE,
        "iat": now,
        "exp": now + ACTOR_TOKEN_LIFETIME_S,
        "jti": secrets.token_urlsafe(16),
        "sub": f"user-{email}",
        "email": email,
        "sid": f"session-{email}",
        "amr": [PASSKEY_FACTOR] if lane == "admin" else ["code"],
        "auth_time": now - SESSION_AGE_S,
        "lane": lane,
    }


def protected_header(private_key: Ed25519PrivateKey = SIGNING_KEY) -> dict[str, Any]:
    """`alg` aside, which `jwt.encode` writes from its argument."""

    return {"typ": ACTOR_TOKEN_TYPE, "kid": jwk_thumbprint(public_key_of(private_key))}


def sign(claims: Mapping[str, Any], *, private_key: Ed25519PrivateKey = SIGNING_KEY, header: Mapping[str, Any] | None = None) -> str:
    return jwt.encode(
        dict(claims), private_key, algorithm=ACTOR_TOKEN_ALGORITHM, headers=dict(protected_header(private_key) if header is None else header)
    )


def actor_token(email: str, *, lane: Lane = "admin") -> str:
    return sign(actor_claims(email, lane=lane))


class SignedActor(Mapping[str, str]):
    """`base` beside an `X-FL-Actor` signed when the header is read.

    A token signed at import expires a minute into a suite whose cases were collected long before they run.
    """

    def __init__(self, email: str, base: Mapping[str, str] | None = None, *, lane: Lane = "admin") -> None:
        self.email = email
        self.base = dict(base or {})
        self.lane: Lane = lane

    def __getitem__(self, name: str) -> str:
        return actor_token(self.email, lane=self.lane) if name == ACTOR_HEADER else self.base[name]

    def __iter__(self) -> Iterator[str]:
        return iter((*self.base, ACTOR_HEADER))

    def __len__(self) -> int:
        return len(self.base) + 1
