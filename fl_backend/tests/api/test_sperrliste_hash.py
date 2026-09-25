import pytest
from pydantic import SecretStr, TypeAdapter

from app.api.sperrliste.schemas import GRUND_HOLDS_AN_ADDRESS, FLPostSperrlistePayload
from app.api.sperrliste.services import (
    SPERRLISTE_ADRESSE_GESPERRT,
    SPERRLISTE_SCHLUESSEL_VERSION,
    adresse_hash,
    find_sperrliste_refusal,
)
from app.shared.schemas.kontakt import CustomEmail

# Obviously fake and distinct: two equal keys would let the separation case below pass vacuously.
KEY = SecretStr("key-one".ljust(64, "0"))
OTHER_KEY = SecretStr("key-two".ljust(64, "0"))

ADDRESS = "Anna.Mueller@Müllerschule.de"

# A fragment of a refused value, sought on its own so no part of the value survives into a message.
SECRET = "Zorbanax"

# The same address as a person could type it. The decomposed umlaut looks equal and is a different
# string, so it is built from its code point; the trailing space is what a paste out of a mail client
# carries.
SAME_ADDRESS = [
    pytest.param("anna.mueller@müllerschule.de", id="lower case"),
    pytest.param("ANNA.MUELLER@MÜLLERSCHULE.DE", id="upper case"),
    pytest.param(f"Anna.Mueller@Mu{chr(0x308)}llerschule.de", id="decomposed umlaut"),
    pytest.param("anna.mueller@xn--mllerschule-thb.de  ", id="punycode, folded, padded"),
]


class TestTheStoredFormOfAnAddress:
    @pytest.mark.parametrize("typed", SAME_ADDRESS)
    def test_every_spelling_of_one_address_reaches_one_row(self, typed: str):
        """The whole of what makes the ban a ban: a spelling that hashes apart is an address the list holds and does not refuse."""

        assert adresse_hash(typed, schluessel=KEY) == adresse_hash(ADDRESS, schluessel=KEY)

    def test_another_address_reaches_another_row(self):
        """The control: a fold wide enough to collapse two people would pass every case above."""

        assert adresse_hash("anna.mueller@muellerschule.de", schluessel=KEY) != adresse_hash(ADDRESS, schluessel=KEY)

    def test_one_address_hashes_differently_under_two_keys(self):
        """What the keying buys, and the reason the key can never be rotated: every stored row was taken under the one in force."""

        assert adresse_hash(ADDRESS, schluessel=KEY) != adresse_hash(ADDRESS, schluessel=OTHER_KEY)

    def test_the_hash_carries_no_part_of_the_address(self):
        """A leaked collection confirms no guess, so nothing recognisable may survive into the stored value."""

        stored = adresse_hash(ADDRESS, schluessel=KEY)

        local_part, domain = ADDRESS.lower().split("@")
        assert "@" not in stored
        for recognisable in (local_part, domain, domain.encode("idna").decode()):
            assert recognisable not in stored.lower()
        # Hex, and the digest's full width: a truncated one is a collision surface nothing reports.
        assert len(stored) == 64
        assert set(stored) <= set("0123456789abcdef")


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

    # What the same inputs produce with the key and the message exchanged, so the case below is
    # shown to separate the two rather than merely to have a literal in it.
    SWAPPED_DIGEST = "bbde862683be3cabdee87e8bf8b94b3cdcc8a732239dc5b26cb2906cb6da0503"

    def test_the_stored_form_is_the_value_computed_outside_this_package(self):
        assert adresse_hash(self.KNOWN_ADDRESS, schluessel=self.KNOWN_MASTER) == self.KNOWN_DIGEST

    def test_the_known_answer_separates_the_key_from_the_message(self):
        """The premise of the case above: without this, a swapped construction would have to be caught by eye."""

        assert self.KNOWN_DIGEST != self.SWAPPED_DIGEST
        assert adresse_hash(self.KNOWN_ADDRESS, schluessel=self.KNOWN_MASTER) != self.SWAPPED_DIGEST

    def test_the_corpus_is_keyed_under_its_own_label_and_never_the_master(self):
        """The sub-key's whole purpose: a second corpus under this master must not be readable from this one."""

        import hashlib
        import hmac

        master = self.KNOWN_MASTER.get_secret_value().encode("utf-8")
        under_the_master = hmac.new(master, b"anna@beispielschule.de", hashlib.sha256).hexdigest()

        assert adresse_hash(self.KNOWN_ADDRESS, schluessel=self.KNOWN_MASTER) != under_the_master

    def test_the_label_the_rows_record_is_the_one_the_key_is_derived_under(self):
        """One string for both, or a row records a label that says nothing about the key that hashed it."""

        assert SPERRLISTE_SCHLUESSEL_VERSION == "sperrliste-v1"


class TestOneCanonicalFormWhateverTheRoute:
    """The two normalisations that meet on this path.

    A payload stores a Unicode domain as its punycode, and an address arriving outside one may carry
    either, so each has to key the row the other does.
    """

    EMAIL = TypeAdapter(CustomEmail)

    # The realistic divergence: one internationalised domain, in the two spellings a client can send.
    PUNYCODE = "Anna@xn--mller-kva.de"
    UNICODE = "anna@müller.de"

    def test_both_spellings_of_one_domain_reach_one_row(self):
        assert adresse_hash(self.PUNYCODE, schluessel=KEY) == adresse_hash(self.UNICODE, schluessel=KEY)

    def test_the_payload_route_and_the_bare_route_agree(self):
        """The two routes, driven apart: one address through the payload's rule first and one straight in."""

        through_a_payload = str(self.EMAIL.validate_python(self.UNICODE))

        # Apart, or the assertion below compares one string's hash with itself.
        assert through_a_payload != self.UNICODE
        assert adresse_hash(through_a_payload, schluessel=KEY) == adresse_hash(self.UNICODE, schluessel=KEY)

    def test_a_value_that_is_no_address_is_refused_rather_than_hashed(self):
        """Loud rather than silent: a digest over junk matches no row and reports nothing."""

        with pytest.raises(ValueError):
            adresse_hash("nonsense", schluessel=KEY)

    def test_the_refusal_quotes_nothing_of_the_value(self):
        """The library's own message carries the rejected value, and this slice keeps addresses out of every traceback."""

        with pytest.raises(ValueError) as raised:
            adresse_hash(f"{SECRET}-Geheim@", schluessel=KEY)

        assert SECRET.lower() not in str(raised.value).lower()
        assert raised.value.__cause__ is None


class TestWhatTheReasonMayHold:
    """`grund` is served, copied whole into a removal's log image and outlives the person's erasure."""

    def _grund(self, grund: str) -> str:
        return FLPostSperrlistePayload(email="admin@beispielschule.de", grund=grund).grund

    @pytest.mark.parametrize(
        "grund",
        [
            pytest.param("zorbanax@beispielschule.de", id="an address alone"),
            pytest.param("Falsche Angabe, siehe zorbanax@beispielschule.de", id="an address inside a sentence"),
            pytest.param("Kontakt: ANNA@XN--MLLER-KVA.DE", id="an address in a punycode domain"),
        ],
    )
    def test_a_reason_carrying_an_address_is_refused(self, grund: str):
        with pytest.raises(ValueError) as raised:
            self._grund(grund)

        assert GRUND_HOLDS_AN_ADDRESS in str(raised.value)

    @pytest.mark.parametrize(
        "grund",
        [
            pytest.param("Nach Absprache @ Schulleitung", id="a bare at-sign with no domain"),
            pytest.param("Siehe Mail vom 3.4.", id="a dot with no at-sign"),
            pytest.param("Falsches Geburtsdatum bei der Anmeldung", id="the ordinary reason"),
        ],
    )
    def test_a_reason_that_is_merely_German_prose_is_accepted(self, grund: str):
        """The decision this rule turns on: a bare `@` is prose, and refusing it would refuse the ordinary case to catch the rare one."""

        assert self._grund(grund) == grund


class TestWhatTheCheckAnswers:
    def test_a_banned_address_is_refused_under_the_published_code(self):
        """The LITERAL: comparing the code to the constant that produced it would hold after a rename the frontend never heard of.

        `fl_backend/app/core/domain.py :: RULES` and each slice's own mapper both key on this string.
        """

        refusal = find_sperrliste_refusal(gesperrt=True)

        assert refusal is not None
        assert refusal.error_code == "REQ-SPERRLISTE-001"
        # The constant beside it, so a rename that moved one and not the other fails here too.
        assert SPERRLISTE_ADRESSE_GESPERRT == "REQ-SPERRLISTE-001"

    def test_an_address_the_list_does_not_hold_is_refused_by_nothing(self):
        """The control: a check refusing everything would pass the case above and stop every sign-up."""

        assert find_sperrliste_refusal(gesperrt=False) is None

    def test_the_refusal_quotes_no_address(self):
        """The detail reaches a log line and an admin's screen, and the address is the one value this feature exists not to keep."""

        refusal = find_sperrliste_refusal(gesperrt=True)

        assert refusal is not None
        assert "@" not in refusal.message
