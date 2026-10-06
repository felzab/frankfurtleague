import dataclasses
import hashlib
from collections.abc import Mapping
from datetime import date
from typing import Any, Final, cast, get_args

import pytest

from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN, Fassung, Seite, is_confirmed
from app.shared.schemas.bounds import EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH

STAMP = "2026-02-01"


@pytest.mark.parametrize(
    "einwilligung",
    [None, "2026-02-01", {}, {"bestaetigt_am": None}, {"bestaetigt_am": ""}],
    ids=["null record", "no mapping", "no stamp key", "null stamp", "empty stamp"],
)
def test_every_shape_short_of_a_stamp_is_unconfirmed(einwilligung: Any):
    """The seat's, the pupil's and the referee's shapes together; the empty string is the one a presence test calls stamped."""

    assert is_confirmed(einwilligung) is False


def test_a_stamp_confirms():
    """The control: without it every case above passes on a predicate answering no to everything."""

    assert is_confirmed({"umfang": "kontaktdaten", "bestaetigt_am": STAMP}) is True


# Ported once with the words from the frontend's own pin, equal digests over the identical join
# proving the port; this is now their only pin. Frozen once a deployed build served a label: moved
# words are a new label.
FASSUNG_DIGESTS: Final[Mapping[str, str]] = {
    "2026-08": "5ee0fd132685f067dfcb5efd9a85e1df36fabdfcb5dab451c98d760a262c4dc8",
    "2026-09-bestaetigung": "2b7227c1252f386e7c9f68967f049fa78a353540dfd309d3fc5bdce3e4c0d7fa",
    "2026-09-bestaetigung-2": "061b910a47324eb91c9c6b81191804b44b015ee5153b6c8843c884422d02f811",
    "2026-09-bestaetigung-3": "694d9949915bbb999214f6e0f276a20020e464bdd28955152d58c19edc803a22",
    "2026-09-bestaetigung-4": "6cd1ecde85282bb369a0e3437915752bf0ac4fe1dc35b0fe8b4ba2b15f84ecf3",
    "2026-09-bestaetigung-5": "f111318b2d71ef2a8cddaa0eb98fe525f18d0c754408e450e397a77a4ffb1d09",
    "2026-09-bestaetigungsseite": "0f43376babe1890edc2e38e482300d940b50de65c75b2f8bdeb4393be1a459f6",
    "2026-09-bestaetigungsseite-2": "a3f63055cde360a1a547f6e04e547101d90af2de71b89058e4a684d5e1f4ed2f",
    "2026-09-bestaetigungsseite-3": "d14ba6338194b3ba562ab09a76472af2bd7b7834e9a4b7956046025b8c8f3f19",
    "2026-09-bestaetigungsseite-4": "5bd721936cf000ca996d98013728b06af2d116d0e19b69d9c29771965a40a411",
    "2026-09-bestaetigungsseite-5": "8d3de56751483fe06311f894784b4562908e9d133386e004e9702db6e631215a",
    "2026-09-bestaetigungsseite-6": "1227f765f47568c1ef105d9ccddeee88732e5bf37b768eaa285b2717f236c905",
    "2026-09-schiedsrichterseite": "21e9351ead79fce150e6dc1c822b0912ae630c493935fb901992a17948d893f0",
    "2026-09-schiedsrichterseite-2": "57f8835d93222b31f07fcc344d7e49825dff32e042d3f08203c26e4e5ea1acd2",
    "2026-09-schiedsrichterseite-3": "42a7cb76d1b0c7f89fff39ed3c16431e1bae66463ce6a71572ddb684d4426807",
    "2026-09-spielerseite": "e3b95487516031a6f42bd6eba653ee1b3e7e32708a226d2cdf5067c2119b76d9",
    "2026-09-spielerseite-2": "eae0481230b89f7c1c21b53cca87acc81058bde375544b98b2907e880e16cdeb",
    "2026-09-spielerseite-3": "08810bd6501bdde29d871b01a4878f77b2e25d2562bb63e5b8d6ef8d4db74a48",
    # The account page's three, minted over the backend's words: no frontend copy of them ever existed.
    "2026-10-konto-spieler": "f74896a1b38592d5558ea0685eab6db1d97e27dcf158e913e19c804658961ff6",
    "2026-10-konto-schiedsrichter": "c19cab56bfd34675507b17933d1c355a98b268d36f6ead18aa07fcda12a28192",
    "2026-10-konto-kontakt": "20efbd427de15ae5d7e422d4c0ae73b27e096365523e38b0261f44939899ece0",
    "2026-10-spielerseite-4": "0490d658a40af1a93a487338c2edaea205073bab924f15a060d236c04812fd5b",
    "2026-10-bestaetigungsseite-7": "c60d790129420fda529b1c7d790d6cf0dd3dead79ad7189cd7664e53f7641f01",
    "2026-10-bestaetigungsseite-verwaltung": "783c9d3c23d444371ac861d1d30cf2ec9412f5c0f8f6a9f526ea8ad51710a709",
    "2026-10-bestaetigungsseite-saison": "f336b66db9ad01b1636f0eda72d48a8f0e851960e8851a302e6c3a547cf460b5",
    "2026-10-spielerseite-wiederkehrend": "3f77c8bf080b11a7609697ffdab2712d1b4502a5229736b5d94950e6154952e8",
}


# What the digest leaves out, frozen beside it for the digest's reason: a label moved to another page
# is admitted on that page by the judgement, and a page reading its sections by key loses a renamed one.
FASSUNG_STAMMDATEN: Final[Mapping[str, tuple[str, date, tuple[str, ...] | None]]] = {
    "2026-08": ("bewerbung", date(2026, 8, 31), None),
    "2026-09-bestaetigung": ("bewerbung", date(2026, 9, 4), None),
    "2026-09-bestaetigung-2": ("bewerbung", date(2026, 9, 7), None),
    "2026-09-bestaetigung-3": ("bewerbung", date(2026, 9, 7), None),
    "2026-09-bestaetigung-4": ("bewerbung", date(2026, 9, 21), None),
    "2026-09-bestaetigung-5": ("bewerbung", date(2026, 9, 24), None),
    "2026-09-bestaetigungsseite": ("bestaetigung_kontakt", date(2026, 9, 4), None),
    "2026-09-bestaetigungsseite-2": ("bestaetigung_kontakt", date(2026, 9, 5), None),
    "2026-09-bestaetigungsseite-3": ("bestaetigung_kontakt", date(2026, 9, 7), None),
    "2026-09-bestaetigungsseite-4": ("bestaetigung_kontakt", date(2026, 9, 9), None),
    "2026-09-bestaetigungsseite-5": ("bestaetigung_kontakt", date(2026, 9, 21), None),
    "2026-09-bestaetigungsseite-6": (
        "bestaetigung_kontakt",
        date(2026, 9, 24),
        (
            "worum",
            "gespeichert",
            "geburtsdatum",
            "rechtsgrundlage",
            "nichtOeffentlich",
            "fristAbgelehnt",
            "fristAngenommen",
            "fristUnvollstaendig",
            "fristOhneEntscheidung",
            "ablehnen",
            "ablehnenFolge",
            "widerruf",
            "art21",
            "whatsapp",
            "klickIdentitaet",
            "klickEintrag",
            "klickAlter",
            "klickHinweise",
            "keineEinwilligung",
        ),
    ),
    "2026-09-schiedsrichterseite": ("bestaetigung_schiedsrichter", date(2026, 9, 22), None),
    "2026-09-schiedsrichterseite-2": ("bestaetigung_schiedsrichter", date(2026, 9, 24), None),
    "2026-09-schiedsrichterseite-3": (
        "bestaetigung_schiedsrichter",
        date(2026, 10, 3),
        (
            "worum",
            "gespeichert",
            "geburtsdatum",
            "wer",
            "veroeffentlichung",
            "medien",
            "rechtsgrundlage",
            "frist",
            "widerruf",
            "art21",
            "klickIdentitaet",
            "klickEintrag",
            "klickAlter",
            "klickEinwilligung",
            "klickHinweise",
        ),
    ),
    "2026-09-spielerseite": ("bestaetigung_spieler", date(2026, 9, 22), None),
    "2026-09-spielerseite-2": ("bestaetigung_spieler", date(2026, 9, 24), None),
    "2026-09-spielerseite-3": (
        "bestaetigung_spieler",
        date(2026, 10, 3),
        (
            "worum",
            "gespeichert",
            "geburtsdatum",
            "wer",
            "veroeffentlichung",
            "medien",
            "rechtsgrundlage",
            "frist",
            "widerruf",
            "art21",
            "klickIdentitaet",
            "klickAlter",
            "klickEinwilligung",
            "klickHinweise",
        ),
    ),
    "2026-10-konto-spieler": (
        "konto_spieler",
        date(2026, 10, 3),
        (
            "veroeffentlichung",
            "medien",
            "widerruf",
            "nurWiderrufNichtAktiv",
            "nurWiderrufBisAufnahme",
        ),
    ),
    "2026-10-konto-schiedsrichter": (
        "konto_schiedsrichter",
        date(2026, 10, 3),
        (
            "veroeffentlichung",
            "medien",
            "widerruf",
            "nurWiderrufNichtAktiv",
        ),
    ),
    "2026-10-konto-kontakt": (
        "konto_kontakt",
        date(2026, 10, 3),
        (
            "whatsapp",
            "medien",
            "widerruf",
            "nurWiderrufVorbei",
            "nurWiderrufBisZusage",
        ),
    ),
    "2026-10-bestaetigungsseite-7": (
        "bestaetigung_kontakt",
        date(2026, 10, 3),
        (
            "worum",
            "gespeichert",
            "geburtsdatum",
            "rechtsgrundlage",
            "nichtOeffentlich",
            "fristAbgelehnt",
            "fristAngenommen",
            "fristUnvollstaendig",
            "fristOhneEntscheidung",
            "ablehnen",
            "ablehnenFolge",
            "widerruf",
            "art21",
            "whatsapp",
            "medien",
            "klickIdentitaet",
            "klickEintrag",
            "klickAlter",
            "klickHinweise",
            "keineEinwilligung",
        ),
    ),
    "2026-10-bestaetigungsseite-verwaltung": (
        "bestaetigung_kontakt_verwaltung",
        date(2026, 10, 3),
        (
            "worum",
            "gespeichert",
            "geburtsdatum",
            "rechtsgrundlage",
            "nichtOeffentlich",
            "fristAbgelehnt",
            "fristAngenommen",
            "fristUnvollstaendig",
            "fristOhneEntscheidung",
            "ablehnen",
            "ablehnenFolge",
            "widerruf",
            "art21",
            "whatsapp",
            "medien",
            "klickIdentitaet",
            "klickEintrag",
            "klickAlter",
            "klickHinweise",
            "keineEinwilligung",
        ),
    ),
    "2026-10-bestaetigungsseite-saison": (
        "bestaetigung_kontakt_saison",
        date(2026, 10, 3),
        (
            "worum",
            "gespeichert",
            "geburtsdatum",
            "rechtsgrundlage",
            "nichtOeffentlich",
            "fristAbgelehnt",
            "fristAngenommen",
            "fristUnvollstaendig",
            "fristOhneEntscheidung",
            "ablehnen",
            "ablehnenFolge",
            "widerruf",
            "art21",
            "whatsapp",
            "medien",
            "klickIdentitaet",
            "klickEintrag",
            "klickAlter",
            "klickHinweise",
            "keineEinwilligung",
        ),
    ),
    "2026-10-spielerseite-4": (
        "bestaetigung_spieler",
        date(2026, 10, 3),
        (
            "worum",
            "gespeichert",
            "geburtsdatum",
            "wer",
            "veroeffentlichung",
            "medien",
            "rechtsgrundlage",
            "frist",
            "widerruf",
            "art21",
            "klickIdentitaet",
            "klickAlter",
            "klickEinwilligung",
            "klickHinweise",
        ),
    ),
    "2026-10-spielerseite-wiederkehrend": (
        "bestaetigung_spieler_wiederkehrend",
        date(2026, 10, 3),
        (
            "worum",
            "gespeichert",
            "geburtsdatum",
            "wer",
            "einwilligungen",
            "rechtsgrundlage",
            "frist",
            "widerruf",
            "art21",
            "klickIdentitaet",
            "klickAlter",
            "klickHinweise",
        ),
    ),
}


def fassung_digest(fassung: Fassung) -> str:
    """Every word the label freezes, joined as the frontend's digest joins them: the paragraphs, the switch, each control."""

    controls = [f"{key}={fassung.bedienelemente[key]}" for key in sorted(fassung.bedienelemente)]

    return hashlib.sha256("\n".join([*fassung.absaetze, fassung.schalter, *controls]).encode("utf-8")).hexdigest()


class TestTheRegistryOfWordings:
    def test_every_label_still_holds_the_words_its_digest_was_minted_over(self):
        """Both directions: a new label fails until its own digest is minted, and a digest whose label is gone fails."""

        assert sorted(FASSUNG_DIGESTS) == sorted(FASSUNGEN), "a label has no frozen digest, or the reverse"
        assert {label: fassung_digest(fassung) for label, fassung in FASSUNGEN.items()} == FASSUNG_DIGESTS

    def test_every_label_keeps_the_page_the_day_and_the_section_keys_it_was_given(self):
        """Both directions, as the digests: a label is pinned here before it lands, and a pin whose label is gone fails."""

        assert {
            label: (
                fassung.seite,
                fassung.gilt_ab,
                None if fassung.absaetze_nach_schluessel is None else tuple(fassung.absaetze_nach_schluessel),
            )
            for label, fassung in FASSUNGEN.items()
        } == FASSUNG_STAMMDATEN

    def test_every_page_runs_a_label_of_its_own(self):
        for seite, label in LAUFENDE_FASSUNGEN.items():
            assert label in FASSUNGEN, f"{seite} runs {label}, which the registry does not hold"
            assert FASSUNGEN[label].seite == seite, f"{seite} runs {label}, a version of another page"

    def test_every_declared_page_runs_a_label(self):
        """The type names a page and the mapping runs one: a page added to either alone fails here."""

        assert set(get_args(Seite)) == set(LAUFENDE_FASSUNGEN)

    def test_every_label_belongs_to_a_declared_page(self):
        """A label of an undeclared page could never be stamped, and a write judging it would find no running label."""

        assert {fassung.seite for fassung in FASSUNGEN.values()} == set(LAUFENDE_FASSUNGEN)

    def test_each_page_runs_its_latest_label(self):
        """Pins WHICH label runs, which the digests do not: a running label moved back to an earlier one passes every other case."""

        for seite, label in LAUFENDE_FASSUNGEN.items():
            latest = max(fassung.gilt_ab for fassung in FASSUNGEN.values() if fassung.seite == seite)

            assert FASSUNGEN[label].gilt_ab == latest, f"{seite} runs {label}, older than a label of its own page"

    def test_a_later_label_of_a_page_never_took_effect_before_an_earlier_one(self):
        """In registry order, which is the order each page's labels were minted in."""

        for seite in LAUFENDE_FASSUNGEN:
            days = [fassung.gilt_ab for fassung in FASSUNGEN.values() if fassung.seite == seite]

            assert days == sorted(days), f"{seite}'s labels took effect out of the order they were minted in"

    def test_keyed_paragraphs_are_the_frozen_ones_in_order(self):
        """The page places its sections by key and the label freezes them by position, so the two may never part."""

        keyed = {
            label: (tuple(fassung.absaetze_nach_schluessel.values()), fassung.absaetze)
            for label, fassung in FASSUNGEN.items()
            if fassung.absaetze_nach_schluessel is not None
        }

        assert keyed, "no label carries keyed paragraphs, so this case compares nothing"
        for label, (nach_schluessel, absaetze) in keyed.items():
            assert nach_schluessel == absaetze, label

    def test_every_running_label_a_page_places_by_key_carries_its_keys(self):
        """The confirmation pages render by key; a running label of theirs without keys leaves the page nothing to place."""

        for seite in (
            "bestaetigung_kontakt",
            "bestaetigung_kontakt_verwaltung",
            "bestaetigung_kontakt_saison",
            "bestaetigung_spieler",
            "bestaetigung_spieler_wiederkehrend",
            "bestaetigung_schiedsrichter",
        ):
            assert FASSUNGEN[LAUFENDE_FASSUNGEN[seite]].absaetze_nach_schluessel is not None, seite

    def test_the_seated_persons_page_differs_from_the_applicants_by_its_opening_and_its_legal_basis_alone(self):
        """Both are one page to the person reading it; a sentence reworded on one side only would tell two people two rules.

        The two that differ say who entered the person, which no applicant did on this page.
        """

        bewerbung = FASSUNGEN[LAUFENDE_FASSUNGEN["bestaetigung_kontakt"]]
        verwaltung = FASSUNGEN[LAUFENDE_FASSUNGEN["bestaetigung_kontakt_verwaltung"]]
        assert bewerbung.absaetze_nach_schluessel is not None and verwaltung.absaetze_nach_schluessel is not None

        anders = {key for key, text in verwaltung.absaetze_nach_schluessel.items() if bewerbung.absaetze_nach_schluessel.get(key) != text}

        assert list(verwaltung.absaetze_nach_schluessel) == list(bewerbung.absaetze_nach_schluessel)
        assert anders == {"worum", "rechtsgrundlage"}
        assert (verwaltung.schalter, dict(verwaltung.bedienelemente)) == (bewerbung.schalter, dict(bewerbung.bedienelemente))

    @pytest.mark.parametrize("seite", ["bestaetigung_kontakt", "bestaetigung_kontakt_verwaltung", "bestaetigung_kontakt_saison"])
    def test_both_contact_pages_offer_the_media_consent_beside_the_whatsapp_one(self, seite: Seite):
        """A seat's `medien` is asked on whichever page the link opens, its paragraph naming the age the switch is offered from."""

        fassung = FASSUNGEN[LAUFENDE_FASSUNGEN[seite]]
        assert fassung.absaetze_nach_schluessel is not None

        assert set(fassung.bedienelemente) == {"medien"}
        assert "{medienMinAlter}" in fassung.absaetze_nach_schluessel["medien"]
        assert "außer der freiwilligen für WhatsApp" not in fassung.absaetze_nach_schluessel["widerruf"]

    def test_the_season_rows_page_keeps_the_applicants_words_but_where_they_speak_of_the_application(self):
        """A person the administration entered on a team's season row reads nothing of an application or its submitter."""

        bewerbung = FASSUNGEN[LAUFENDE_FASSUNGEN["bestaetigung_kontakt"]]
        saison = FASSUNGEN[LAUFENDE_FASSUNGEN["bestaetigung_kontakt_saison"]]
        assert bewerbung.absaetze_nach_schluessel is not None and saison.absaetze_nach_schluessel is not None

        anders = {key for key, text in saison.absaetze_nach_schluessel.items() if bewerbung.absaetze_nach_schluessel.get(key) != text}

        assert list(saison.absaetze_nach_schluessel) == list(bewerbung.absaetze_nach_schluessel)
        assert {key for key, text in bewerbung.absaetze_nach_schluessel.items() if "Bewerbung" in text} <= anders
        assert not [key for key, text in saison.absaetze_nach_schluessel.items() if "Bewerbung" in text]
        assert (saison.schalter, dict(saison.bedienelemente)) == (bewerbung.schalter, dict(bewerbung.bedienelemente))

    def test_the_pupil_page_changed_its_retention_paragraph_alone(self):
        """The running pupil label is the earlier one but for when a registration goes, which the notice states the same way."""

        earlier = FASSUNGEN["2026-09-spielerseite-3"].absaetze_nach_schluessel
        running = FASSUNGEN[LAUFENDE_FASSUNGEN["bestaetigung_spieler"]].absaetze_nach_schluessel
        assert earlier is not None and running is not None

        assert {key for key, text in running.items() if earlier.get(key) != text} == {"frist"}
        assert "bis in der nächsten Saison die Registrierung geschlossen ist" not in running["frist"]
        assert "einen Monat nach der Entscheidung" in running["frist"]

    def test_the_returning_pupils_page_keeps_the_pupil_pages_words_but_where_they_ask_a_choice_or_the_birthdate(self):
        """One registration under one set of rules: a sentence reworded on one page alone would tell two pupils two rules.

        No choice is asked, its switch and controls being the words the stored choices are shown back under.
        """

        neu = FASSUNGEN[LAUFENDE_FASSUNGEN["bestaetigung_spieler"]]
        wiederkehrend = FASSUNGEN[LAUFENDE_FASSUNGEN["bestaetigung_spieler_wiederkehrend"]]
        assert neu.absaetze_nach_schluessel is not None and wiederkehrend.absaetze_nach_schluessel is not None

        geteilt = {key for key, text in wiederkehrend.absaetze_nach_schluessel.items() if neu.absaetze_nach_schluessel.get(key) == text}

        assert geteilt == {"wer", "rechtsgrundlage", "frist", "widerruf", "art21", "klickIdentitaet", "klickHinweise"}
        assert not {"veroeffentlichung", "medien", "klickEinwilligung"} & set(wiederkehrend.absaetze_nach_schluessel)
        assert (wiederkehrend.schalter, dict(wiederkehrend.bedienelemente)) == (neu.schalter, dict(neu.bedienelemente))

    @pytest.mark.parametrize("seite", ["bestaetigung_kontakt", "bestaetigung_kontakt_verwaltung", "bestaetigung_kontakt_saison"])
    def test_the_whatsapp_consent_is_taken_back_on_the_account_page_under_the_words_it_was_given(self, seite: Seite):
        """The contact page names the account page, and the account page's switch reads as the one the consent was given on."""

        kontakt = FASSUNGEN[LAUFENDE_FASSUNGEN[seite]]
        konto = FASSUNGEN[LAUFENDE_FASSUNGEN["konto_kontakt"]]
        assert kontakt.absaetze_nach_schluessel is not None

        assert "in Deinem Konto" in kontakt.absaetze_nach_schluessel["whatsapp"]
        assert konto.bedienelemente["kontaktdaten_whatsapp"] == kontakt.schalter

    def test_no_word_is_empty_or_padded(self):
        for label, fassung in FASSUNGEN.items():
            assert fassung.absaetze, f"{label} holds no paragraph"
            for text in (*fassung.absaetze, fassung.schalter, *fassung.bedienelemente.values()):
                assert text and text == text.strip(), f"{label} holds an empty or padded text"

    def test_no_word_holds_a_line_break(self):
        """The digest joins its texts with newlines, so a paragraph holding one digests as two paragraphs would."""

        for label, fassung in FASSUNGEN.items():
            for text in (*fassung.absaetze, fassung.schalter, *fassung.bedienelemente, *fassung.bedienelemente.values()):
                assert "\n" not in text and "\r" not in text, f"{label} holds a line break"

    def test_every_label_fits_the_length_a_record_may_cite(self):
        for label in FASSUNGEN:
            assert len(label) <= EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, label

    def test_no_reader_can_reword_a_label_in_place(self):
        """Read-only all the way down: a caller writing into a served mapping would reword it for every later request."""

        fassung = FASSUNGEN["2026-09-spielerseite-3"]
        mappings = ((FASSUNGEN, "2026-09-spielerseite-3"), (LAUFENDE_FASSUNGEN, "bewerbung"), (fassung.bedienelemente, "intern"))

        for mapping, key in (*mappings, (fassung.absaetze_nach_schluessel, "worum")):
            with pytest.raises(TypeError):
                cast(Any, mapping)[key] = "anders"
        with pytest.raises(dataclasses.FrozenInstanceError):
            cast(Any, fassung).schalter = "anders"
