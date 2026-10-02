"""
CORE · the signed actor token, verified

The frontend's server signs who a request is attributed to, and this module is the one place that
signature is believed: the admin key alone names nobody. Pure, raising `ActorTokenRefusal` with a
fixed phrase the log may carry; `app/core/security.py` turns it into the response.
"""

import hashlib
import json
import re
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass
from typing import Any, Final, Literal, Self, get_args

import jwt

from app.shared.schemas.bounds import ADMIN_WINDOW_HOURS, PERSON_WINDOW_DAYS

# Fixed strings rather than configuration: one issuer and one audience exist, and a value an
# environment could change would let a token minted for another service pass (RFC 8725 §3.9).
ACTOR_TOKEN_ISSUER: Final = "fl-frontend"
ACTOR_TOKEN_AUDIENCE: Final = "fl-backend"
# Explicit typing, so no other JWT the frontend ever signs reads as an actor (RFC 8725 §3.11).
ACTOR_TOKEN_TYPE: Final = "fl-actor+jwt"
# The one algorithm, never read off the token: an allow-list of one is what refuses `none` and the
# HS256-under-the-public-key confusion (RFC 8725 §3.1, RFC 8037).
ACTOR_TOKEN_ALGORITHM: Final = "EdDSA"
ACTOR_TOKEN_LIFETIME_S: Final = 60
# Both containers read one host's clock, so the margin covers a request in flight, not drift.
CLOCK_LEEWAY_S: Final = 5
# A minted token is well under half of this; the bound keeps a hostile header off the decoder.
ACTOR_TOKEN_MAX_LENGTH: Final = 2048

# Exactly what the frontend writes: `jku`, `jwk`, `x5u` or `crit` would each ask the verifier to
# fetch or trust something this module never consults, so their presence is itself a refusal.
PROTECTED_HEADER: Final = frozenset({"alg", "typ", "kid"})

Lane = Literal["admin", "person"]
# `amr` values of our own: RFC 8176 registers no passkey, so neither side reads a registered one.
PASSKEY_FACTOR: Final = "passkey"

# PyJWT checks a claim's presence only where `require` names it (`jwt.types.Options :: require`).
REQUIRED_CLAIMS: Final = ("iss", "aud", "iat", "exp", "jti", "sub", "email", "sid", "amr", "auth_time", "lane")

# Three base64url segments and nothing else: what fails this is a header nobody signed, answered 400
# rather than as a token that failed its checks.
COMPACT_JWS_PATTERN: Final = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")

# RFC 8037's `x`: 32 raw bytes, base64url without padding, which is exactly 43 characters.
ED25519_PUBLIC_KEY_PATTERN: Final = re.compile(r"[A-Za-z0-9_-]{43}")
ED25519_PUBLIC_KEY_BYTES: Final = 32


class ActorTokenRefusal(Exception):
    """Why a token is refused, in a phrase of this module's own, and the token's `jti` where its signature held.

    Both reach the log line, where neither the token nor PyJWT's rendering of it may.
    """

    def __init__(self, reason: str, *, jti: str | None = None):
        super().__init__(reason)
        self.reason = reason
        self.jti = jti


@dataclass(frozen=True, kw_only=True)
class ActorClaims:
    sub: str
    # The folded sign-in identifier, what grants and `aktionen` key on.
    email: str
    sid: str
    amr: tuple[str, ...]
    auth_time: int
    # When the frontend's guard read the session, which it judges its own windows after.
    iat: int
    lane: Lane
    jti: str


def ed25519_public_key(value: str) -> bytes:
    """`ValueError` for anything but the one canonical spelling of 32 bytes.

    `urlsafe_b64decode` alone drops a stray character and takes a non-canonical last digit, so a
    typo could still boot.
    """

    if ED25519_PUBLIC_KEY_PATTERN.fullmatch(value) is None:
        raise ValueError("must be the unpadded base64url of a raw 32-byte Ed25519 public key")
    raw = urlsafe_b64decode(value + "=")
    if len(raw) != ED25519_PUBLIC_KEY_BYTES or urlsafe_b64encode(raw).rstrip(b"=").decode("ascii") != value:
        raise ValueError("must be the unpadded base64url of a raw 32-byte Ed25519 public key")
    return raw


def jwk_thumbprint(public_key: str) -> str:
    """RFC 7638's thumbprint, which PyJWT does not compute.

    RFC 8037's three members, sorted and unspaced as RFC 7638 §3.3 fixes, so the frontend's `jose`
    derives the same `kid` from the same key.
    """

    canonical = json.dumps({"crv": "Ed25519", "kty": "OKP", "x": public_key}, separators=(",", ":"), sort_keys=True)
    return urlsafe_b64encode(hashlib.sha256(canonical.encode("ascii")).digest()).rstrip(b"=").decode("ascii")


@dataclass(frozen=True)
class ActorTokenKey:
    """The one key a token may be signed under, built once when the application is."""

    jwk: jwt.PyJWK
    kid: str

    @classmethod
    def from_public_key(cls, public_key: str) -> Self:
        """`ValueError` where `public_key` is no Ed25519 key, so the boot names the variable rather than failing on the first request."""

        ed25519_public_key(public_key)
        try:
            # A JWK rather than a PEM: the configured value IS RFC 8037's `x`, and a PyJWK binds its
            # algorithm, so a token's header cannot choose another (`jwt.api_jws :: _verify_signature`).
            jwk = jwt.PyJWK({"kty": "OKP", "crv": "Ed25519", "x": public_key}, algorithm=ACTOR_TOKEN_ALGORITHM)
        except jwt.PyJWKError:
            raise ValueError("must be an Ed25519 public key") from None
        return cls(jwk=jwk, kid=jwk_thumbprint(public_key))


# Most specific first: `InvalidSignatureError` is a `DecodeError`, and each is an `InvalidTokenError`.
_PYJWT_REASONS: Final[tuple[tuple[type[jwt.PyJWTError], str], ...]] = (
    (jwt.ExpiredSignatureError, "expired"),
    (jwt.ImmatureSignatureError, "issued or valid only in the future"),
    (jwt.InvalidAudienceError, "wrong audience"),
    (jwt.InvalidIssuerError, "wrong issuer"),
    (jwt.InvalidAlgorithmError, "algorithm not allowed"),
    (jwt.InvalidSignatureError, "signature does not verify"),
    (jwt.InvalidIssuedAtError, "iat is not a number"),
    (jwt.DecodeError, "undecodable"),
    (jwt.PyJWTError, "invalid"),
)


def _refusal_for(error: jwt.PyJWTError) -> ActorTokenRefusal:
    if isinstance(error, jwt.MissingRequiredClaimError):
        # `claim` is one of `REQUIRED_CLAIMS` or `aud`/`iss`, names this module chose.
        return ActorTokenRefusal(f"missing claim {error.claim}")
    return ActorTokenRefusal(next(reason for kind, reason in _PYJWT_REASONS if isinstance(error, kind)))


def _is_integer(value: Any) -> bool:
    # `bool` is an `int`, and PyJWT's own `int(...)` takes a float or a numeric string.
    return type(value) is int


def _non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and value != ""


def _claims_of(payload: dict[str, Any], lane: Lane) -> ActorClaims:
    """The claims PyJWT leaves unread, judged; what they carry is the frontend's session, so a wrong type is a refusal."""

    for name in ("sub", "email", "sid", "jti"):
        if not _non_empty_string(payload[name]):
            raise ActorTokenRefusal(f"{name} is not a string")
    for name in ("iat", "exp", "auth_time"):
        if not _is_integer(payload[name]):
            raise ActorTokenRefusal(f"{name} is not an integer")
    amr = payload["amr"]
    if not isinstance(amr, list) or not amr or not all(_non_empty_string(factor) for factor in amr):
        raise ActorTokenRefusal("amr is not a list of factors")
    if payload["lane"] not in get_args(Lane):
        raise ActorTokenRefusal("unknown lane")

    # The contract's lifetime, held here too: PyJWT reads `exp` alone, so a token minted to live a day
    # would otherwise pass for a day.
    if payload["exp"] - payload["iat"] > ACTOR_TOKEN_LIFETIME_S:
        raise ActorTokenRefusal("lifetime too long")
    if payload["auth_time"] > time.time() + CLOCK_LEEWAY_S:
        raise ActorTokenRefusal("auth_time in the future")
    # Which guard minted it: a person's session may never act on the admin tier, whatever it holds.
    if payload["lane"] != lane:
        raise ActorTokenRefusal("wrong lane")

    return ActorClaims(
        sub=payload["sub"],
        email=payload["email"],
        sid=payload["sid"],
        amr=tuple(amr),
        auth_time=payload["auth_time"],
        iat=payload["iat"],
        lane=payload["lane"],
        jti=payload["jti"],
    )


def _signed_jti(token: str, key: ActorTokenKey) -> str | None:
    """The `jti` of a token the configured key signed, or `None`.

    Verified afresh rather than read after a failure: an id nobody signed names no minted token, only a stranger's text.
    """

    try:
        signed = jwt.PyJWS().decode_complete(token, key.jwk, algorithms=[ACTOR_TOKEN_ALGORITHM])
        jti = json.loads(signed["payload"]).get("jti")
    except jwt.PyJWTError, ValueError, AttributeError:
        return None
    return jti if _non_empty_string(jti) else None


def verify_actor_token(token: str, key: ActorTokenKey, *, lane: Lane) -> ActorClaims:
    """The claims `token` carries, once its signature, header, registered claims and `lane` have held.

    Each lane caps the session's age at its own window, and the admin lane also demands a passkey.
    """

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as error:
        raise _refusal_for(error) from None
    # Judged before the signature only to name the reason: every branch here refuses, none admits.
    if header.keys() != PROTECTED_HEADER:
        raise ActorTokenRefusal("protected header is not exactly alg, typ and kid")
    if header["typ"] != ACTOR_TOKEN_TYPE:
        raise ActorTokenRefusal("wrong typ")
    # An old key's token after a rotation lands here, which is the reason worth reading in the log.
    if header["kid"] != key.kid:
        raise ActorTokenRefusal("unknown kid")

    try:
        return _verified_claims(token, key, lane)
    except ActorTokenRefusal as refusal:
        # Asked only once a refusal is certain, so an admitted request verifies its signature once.
        raise ActorTokenRefusal(refusal.reason, jti=_signed_jti(token, key)) from None


def _verified_claims(token: str, key: ActorTokenKey, lane: Lane) -> ActorClaims:
    try:
        payload = jwt.decode(
            token,
            key.jwk,
            algorithms=[ACTOR_TOKEN_ALGORITHM],
            audience=ACTOR_TOKEN_AUDIENCE,
            issuer=ACTOR_TOKEN_ISSUER,
            leeway=CLOCK_LEEWAY_S,
            # `strict_aud`: one audience, a string, equal to ours -- never a list that merely holds it.
            options={"require": list(REQUIRED_CLAIMS), "strict_aud": True},
        )
    except jwt.PyJWTError as error:
        raise _refusal_for(error) from None

    claims = _claims_of(payload, lane)

    if lane == "admin":
        if claims.amr != (PASSKEY_FACTOR,):
            raise ActorTokenRefusal("not a passkey session")
        # The frontend's own window, re-asked here, so a session the frontend failed to expire still
        # meets a limit on this side (`app/shared/schemas/bounds.py :: ADMIN_WINDOW_HOURS`). At `iat`
        # rather than this clock, as the step-up is (`docs/backend/spec.md :: I527`).
        if claims.iat - claims.auth_time > ADMIN_WINDOW_HOURS * 3600:
            raise ActorTokenRefusal("session older than the administrator's window")
    # The person's window, re-asked for the same reason (`app/shared/schemas/bounds.py :: PERSON_WINDOW_DAYS`).
    elif claims.iat - claims.auth_time > PERSON_WINDOW_DAYS * 86400:
        raise ActorTokenRefusal("session older than the person's window")

    return claims
