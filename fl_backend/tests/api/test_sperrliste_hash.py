import pytest
from pydantic import SecretStr, ValidationError

from app.api.sperrliste.schemas import FLPostSperrlistePayload
from app.api.sperrliste.services import (
    SPERRLISTE_SCHLUESSEL_VERSION,
    adresse_hash,
    stored_adresse_hash,
)
from app.shared.sub_keys import derive_sub_key

# Obviously fake.
KEY = SecretStr("key-one".ljust(64, "0"))

ADDRESS = "Anna.Mueller@Muellerschule.de"

# A fragment of a refused value, sought on its own so no part of the value survives into a message.
SECRET = "Zorbanax"

# The same address as a person could type it: the trailing space is what a paste out of a mail client
# carries, and the no-break space one out of a web page.
SAME_ADDRESS = [
    pytest.param("anna.mueller@muellerschule.de", id="lower case"),
    pytest.param("ANNA.MUELLER@MUELLERSCHULE.DE", id="upper case"),
    pytest.param(f"{chr(0xA0)}anna.mueller@muellerschule.de  ", id="padded"),
]


class TestTheStoredFormOfAnAddress:
    @pytest.mark.parametrize("typed", SAME_ADDRESS)
    def test_every_spelling_of_one_address_reaches_one_row(self, typed: str):
        """The whole of what makes the ban a ban: a spelling that hashes apart is an address the list holds and does not refuse."""

        assert adresse_hash(typed, key=KEY) == adresse_hash(ADDRESS, key=KEY)

    def test_another_address_reaches_another_row(self):
        """The control: a fold wide enough to collapse two people would pass every case above."""

        assert adresse_hash("anna.mueller@mullerschule.de", key=KEY) != adresse_hash(ADDRESS, key=KEY)

    def test_a_stored_address_no_ban_can_key_is_barred_by_none_rather_than_refused(self):
        """The Postausgang's hand-out judges every address it holds in one read: one stored address raising would stop every mail."""

        assert stored_adresse_hash("jürgen@schule.de", key=KEY) is None
        assert stored_adresse_hash(ADDRESS, key=KEY) == adresse_hash(ADDRESS, key=KEY)


class TestTheConstructionItself:
    """The known answer.

    Every other case here compares `adresse_hash` with itself, so a construction swapped end for
    end — the key as the message, the message as the key — passes all of them.
    """

    # The VALUE, not a re-derivation: computed outside this package with a `python -c` one-liner over
    # `hmac` and `hashlib` alone, spelling HMAC-SHA256(HMAC-SHA256(master, label), identifier) by
    # hand. Nothing under `app/` was imported to produce it.
    KNOWN_MASTER = SecretStr("known-answer-key".ljust(64, "0"))
    KNOWN_ADDRESS = "Anna@Beispielschule.de"
    KNOWN_DIGEST = "4dd560c5783a9caa34984fabed329577d8c50e82fa60c464d7c4f717b067aba3"

    def test_the_stored_form_is_the_value_computed_outside_this_package(self):
        assert adresse_hash(self.KNOWN_ADDRESS, key=self.KNOWN_MASTER) == self.KNOWN_DIGEST

    @pytest.mark.parametrize("typed", ["anna@xn--mller-kva.de", "Anna@XN--MLLER-KVA.DE"], ids=["as stored", "in capitals"])
    def test_an_international_domain_keys_decoded_as_every_stored_ban_was_keyed(self, typed: str):
        """The list holds keyed hashes alone, which nothing re-keys: a key moved off the stored bans' form lifts each such ban in silence."""

        import hashlib
        import hmac

        sub_key = derive_sub_key(self.KNOWN_MASTER, SPERRLISTE_SCHLUESSEL_VERSION)
        decoded = hmac.new(sub_key, "anna@müller.de".encode(), hashlib.sha256).hexdigest()

        assert adresse_hash(typed, key=self.KNOWN_MASTER) == decoded


class TestWhatTheHashRefuses:
    @pytest.mark.parametrize("value", ["nonsense", "anna@müller.de"], ids=["no address", "a Unicode domain"])
    def test_a_value_the_rule_refuses_is_refused_rather_than_hashed(self, value: str):
        """Loud rather than silent: a digest over junk matches no row and reports nothing."""

        with pytest.raises(ValueError):
            adresse_hash(value, key=KEY)

    def test_the_refusal_quotes_nothing_of_the_value(self):
        """The library's own message carries the rejected value, and this slice keeps addresses out of every traceback."""

        with pytest.raises(ValueError) as raised:
            adresse_hash(f"{SECRET}-Geheim@", key=KEY)

        assert SECRET.lower() not in str(raised.value).lower()
        assert raised.value.__cause__ is None


class TestWhatTheReasonMayHold:
    """`grund` is served, copied whole into a removal's log image and outlives the person's erasure."""

    def _grund(self, grund: str) -> str:
        return FLPostSperrlistePayload(email="admin@beispielschule.de", grund=grund, notify=False).grund

    @pytest.mark.parametrize(
        "grund",
        [
            pytest.param("zorbanax@beispielschule.de", id="an address alone"),
            pytest.param("Falsche Angabe, siehe zorbanax@beispielschule.de", id="an address inside a sentence"),
            pytest.param("Kontakt: ANNA@XN--MLLER-KVA.DE", id="an address in a punycode domain"),
        ],
    )
    def test_a_reason_carrying_an_address_is_refused(self, grund: str):
        with pytest.raises(ValidationError) as raised:
            self._grund(grund)

        assert [error["type"] for error in raised.value.errors()] == ["address_in_free_text"]
