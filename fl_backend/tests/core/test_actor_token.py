"""
TESTS · `app/core/actor_token.py` over tokens signed in the test, one rule per case

Every refusal is asserted by its phrase, so a check dropped shows as the next check's phrase or as an
admission rather than passing on some other refusal that happens to follow.
"""

import json
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from typing import Any

import jwt
import pytest

from app.core.actor_token import (
    ACTOR_TOKEN_LIFETIME_S,
    CLOCK_LEEWAY_S,
    ActorClaims,
    ActorTokenKey,
    ActorTokenRefusal,
    Lane,
    jwk_thumbprint,
    verify_actor_token,
)
from app.shared.schemas.bounds import ADMIN_WINDOW_HOURS, PERSON_WINDOW_DAYS
from tests.actor_tokens import ACTOR_TOKEN_PUBLIC_KEY, FOREIGN_SIGNING_KEY, actor_claims, protected_header, public_key_of, sign

KEY = ActorTokenKey.from_public_key(ACTOR_TOKEN_PUBLIC_KEY)
ACTOR = "admin@example.com"
# Past the leeway by a margin a slow machine cannot eat, and inside any other bound.
BEYOND_LEEWAY_S = CLOCK_LEEWAY_S + 30

# The contract's claims, spelled here rather than read off `REQUIRED_CLAIMS`: a claim dropped from
# that tuple would drop its own case too, and the case missing it would never run.
CONTRACT_CLAIMS = ("iss", "aud", "iat", "exp", "jti", "sub", "email", "sid", "amr", "auth_time", "lane")


def refusal(token: str, *, lane: Lane = "admin") -> str:
    with pytest.raises(ActorTokenRefusal) as raised:
        verify_actor_token(token, KEY, lane=lane)
    return raised.value.reason


def claims(lane: Lane = "admin", **overrides: Any) -> dict[str, Any]:
    return {**actor_claims(ACTOR, lane=lane), **overrides}


def encoded(part: dict[str, Any]) -> str:
    return urlsafe_b64encode(json.dumps(part).encode()).rstrip(b"=").decode("ascii")


class TestWhatIsAdmitted:
    def test_an_administrator_s_passkey_token_yields_its_claims(self):
        """The control: every refusal below would pass on a verifier refusing everything."""
        issued = claims()

        assert verify_actor_token(sign(issued), KEY, lane="admin") == ActorClaims(
            sub=issued["sub"],
            email=ACTOR,
            sid=issued["sid"],
            amr=("passkey",),
            auth_time=issued["auth_time"],
            iat=issued["iat"],
            lane="admin",
            jti=issued["jti"],
        )

    def test_a_person_s_code_token_is_admitted_on_the_person_lane(self):
        """No factor rule there: a pupil signs in by code, and a person's session outlives the administrator's window."""
        issued = claims("person", auth_time=int(time.time()) - ADMIN_WINDOW_HOURS * 3600 - 60)

        assert verify_actor_token(sign(issued), KEY, lane="person").amr == ("code",)

    def test_a_token_expired_inside_the_leeway_is_admitted(self):
        """The leeway's own boundary, so a margin dropped to zero is seen rather than inferred from the refusal below."""
        now = int(time.time())

        assert verify_actor_token(sign(claims(iat=now - ACTOR_TOKEN_LIFETIME_S, exp=now - 1)), KEY, lane="admin").email == ACTOR


class TestTheTimeClaims:
    def test_an_expired_token_is_refused(self):
        now = int(time.time())
        assert refusal(sign(claims(iat=now - ACTOR_TOKEN_LIFETIME_S - BEYOND_LEEWAY_S, exp=now - BEYOND_LEEWAY_S))) == "expired"

    def test_a_token_issued_in_the_future_is_refused(self):
        now = int(time.time())
        assert refusal(sign(claims(iat=now + BEYOND_LEEWAY_S, exp=now + BEYOND_LEEWAY_S + 10))) == "issued or valid only in the future"

    def test_a_token_valid_only_from_the_future_is_refused(self):
        """`nbf` is no claim the frontend writes, and one carried is still honoured rather than ignored."""
        assert refusal(sign(claims(nbf=int(time.time()) + BEYOND_LEEWAY_S))) == "issued or valid only in the future"

    def test_a_token_living_longer_than_the_contract_is_refused(self):
        """PyJWT reads `exp` alone, so a day-long token would otherwise pass for a day."""
        now = int(time.time())
        assert refusal(sign(claims(iat=now, exp=now + ACTOR_TOKEN_LIFETIME_S + 1))) == "lifetime too long"

    def test_a_sign_in_dated_in_the_future_is_refused(self):
        assert refusal(sign(claims(auth_time=int(time.time()) + BEYOND_LEEWAY_S))) == "auth_time in the future"


class TestWhoSignedIt:
    def test_the_none_algorithm_is_refused(self):
        token = jwt.encode(claims(), "", algorithm="none", headers=protected_header())
        assert refusal(token) == "algorithm not allowed"

    def test_hs256_under_the_public_key_is_refused(self):
        """The key confusion: the public key is no secret, so an HMAC under it is something anyone can mint."""
        token = jwt.encode(claims(), ACTOR_TOKEN_PUBLIC_KEY, algorithm="HS256", headers=protected_header())
        assert refusal(token) == "algorithm not allowed"

    def test_a_key_nobody_configured_is_refused_by_its_kid(self):
        assert refusal(sign(claims(), private_key=FOREIGN_SIGNING_KEY)) == "unknown kid"

    def test_a_foreign_signature_naming_the_configured_kid_is_refused(self):
        """The `kid` is public, so matching it proves nothing: the signature is what refuses."""
        assert refusal(sign(claims(), private_key=FOREIGN_SIGNING_KEY, header=protected_header())) == "signature does not verify"

    def test_a_tampered_payload_is_refused(self):
        header, _, signature = sign(claims()).split(".")
        forged = encoded(claims(email="owner@example.com"))
        assert refusal(f"{header}.{forged}.{signature}") == "signature does not verify"


class TestTheProtectedHeader:
    def test_the_wrong_typ_is_refused(self):
        """A JWT the frontend signs for any other purpose must never read as an actor."""
        assert refusal(sign(claims(), header={**protected_header(), "typ": "JWT"})) == "wrong typ"

    @pytest.mark.parametrize(
        "header",
        [
            pytest.param({"kid": jwk_thumbprint(ACTOR_TOKEN_PUBLIC_KEY), "typ": None}, id="no typ"),
            pytest.param({"typ": "fl-actor+jwt"}, id="no kid"),
            pytest.param({**protected_header(), "jku": "https://attacker.example/keys"}, id="a jku"),
        ],
    )
    def test_a_header_other_than_alg_typ_and_kid_is_refused(self, header: dict[str, Any]):
        assert refusal(sign(claims(), header=header)) == "protected header is not exactly alg, typ and kid"


class TestTheRegisteredClaims:
    def test_the_wrong_audience_is_refused(self):
        assert refusal(sign(claims(aud="fl-something-else"))) == "wrong audience"

    def test_an_audience_list_holding_ours_is_refused(self):
        """`strict_aud`: a token minted for several audiences is minted for somebody else too."""
        assert refusal(sign(claims(aud=["fl-backend", "fl-something-else"]))) == "wrong audience"

    def test_the_wrong_issuer_is_refused(self):
        assert refusal(sign(claims(iss="fl-something-else"))) == "wrong issuer"

    @pytest.mark.parametrize("claim", CONTRACT_CLAIMS)
    def test_every_required_claim_missing_is_refused(self, claim: str):
        issued = claims()
        del issued[claim]
        assert refusal(sign(issued)) == f"missing claim {claim}"

    @pytest.mark.parametrize(
        ("claim", "value", "reason"),
        [
            pytest.param("email", 7, "email is not a string", id="email a number"),
            pytest.param("sid", "", "sid is not a string", id="sid empty"),
            pytest.param("auth_time", True, "auth_time is not an integer", id="auth_time a boolean"),
            # Stamped when the case runs, never at collection: a full tier outlasts the 30 seconds.
            pytest.param("exp", lambda: float(int(time.time()) + 30), "exp is not an integer", id="exp a float"),
            pytest.param("amr", "passkey", "amr is not a list of factors", id="amr a string"),
            pytest.param("amr", [], "amr is not a list of factors", id="amr empty"),
            pytest.param("lane", "system", "unknown lane", id="an unknown lane"),
        ],
    )
    def test_a_claim_of_the_wrong_shape_is_refused(self, claim: str, value: Any, reason: str):
        value = value() if callable(value) else value
        assert refusal(sign(claims(**{claim: value}))) == reason


class TestTheAdministratorsLane:
    def test_a_person_s_token_on_the_admin_tier_is_refused(self):
        """A pupil's session reaching an admin-tier call through a frontend defect, whatever its address holds."""
        assert refusal(sign(claims("person", amr=["passkey"]))) == "wrong lane"

    def test_an_administrator_s_token_on_a_person_s_route_is_refused(self):
        assert refusal(sign(claims("admin")), lane="person") == "wrong lane"

    def test_a_code_session_on_the_admin_tier_is_refused(self):
        assert refusal(sign(claims(amr=["code"]))) == "not a passkey session"

    def test_a_passkey_beside_another_factor_is_refused(self):
        """Exactly the passkey: `amr` carries the session's one factor, so a second is a token this frontend never mints."""
        assert refusal(sign(claims(amr=["passkey", "code"]))) == "not a passkey session"

    def test_a_sign_in_older_than_the_window_is_refused(self):
        stale = int(time.time()) - ADMIN_WINDOW_HOURS * 3600 - 60
        assert refusal(sign(claims(auth_time=stale))) == "session older than the administrator's window"

    def test_a_sign_in_inside_the_window_is_admitted(self):
        """The window's boundary, so a window shortened to the token's own age is seen."""
        recent = int(time.time()) - ADMIN_WINDOW_HOURS * 3600 + 60
        assert verify_actor_token(sign(claims(auth_time=recent)), KEY, lane="admin").auth_time == recent


class TestThePersonsLane:
    def test_a_sign_in_older_than_the_person_s_window_is_refused(self):
        stale = int(time.time()) - PERSON_WINDOW_DAYS * 86400 - 60
        assert refusal(sign(claims("person", auth_time=stale)), lane="person") == "session older than the person's window"

    def test_a_sign_in_inside_the_person_s_window_is_admitted(self):
        """The window's boundary, as the administrator's lane holds its own."""
        recent = int(time.time()) - PERSON_WINDOW_DAYS * 86400 + 60
        assert verify_actor_token(sign(claims("person", auth_time=recent)), KEY, lane="person").auth_time == recent


class TestTheKeyId:
    def test_the_thumbprint_is_rfc_8037_s_published_answer(self):
        """The known answer from RFC 8037 Appendix A.3, so the frontend's `jose`, held to the same vector, names the same `kid`."""
        assert jwk_thumbprint("11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo") == "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k"

    def test_the_configured_key_s_kid_is_its_thumbprint(self):
        assert KEY.kid == jwk_thumbprint(ACTOR_TOKEN_PUBLIC_KEY)

    def test_a_second_key_has_a_second_kid(self):
        assert jwk_thumbprint(public_key_of(FOREIGN_SIGNING_KEY)) != KEY.kid

    def test_the_configured_value_is_the_raw_32_bytes(self):
        assert len(urlsafe_b64decode(ACTOR_TOKEN_PUBLIC_KEY + "=")) == 32
