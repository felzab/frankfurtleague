from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from types import MappingProxyType
from typing import Any, Final, Literal

# `is_confirmed`'s "no" as a filter term: `None` alone matches a null and a missing path but never a
# stored `""`, so a filter spelled with it passes over rows the predicate calls unconfirmed
# (`docs/backend/spec.md :: I407`).
UNCONFIRMED_STAMP: Final[Mapping[str, Any]] = {"$in": [None, ""]}


def is_confirmed(einwilligung: Any) -> bool:
    """Whether a consent record carries its own person's confirmation (`docs/backend/spec.md :: I387`).

    In `shared`: every package judging a consent record reads it here, and a copy each is how one comes
    to grant what another refuses.
    """

    # `bestaetigt_am` alone: the one key a seat's `Kenntnisnahme` and a person's `Einwilligung` share.
    stamp = einwilligung.get("bestaetigt_am") if isinstance(einwilligung, Mapping) else None

    # Only a non-empty string confirms: the validator types the stamp as a string or null, so `""` is
    # storable by a hand edit, and the public name read already withholds on it.
    return isinstance(stamp, str) and stamp != ""


# Every page that stamps a label: a name outside it is a type error rather than a 500. The wire
# serves a plain string, so a page added here moves no published schema.
Seite = Literal[
    "bewerbung",
    "bestaetigung_kontakt",
    "bestaetigung_kontakt_verwaltung",
    "bestaetigung_kontakt_saison",
    "bestaetigung_spieler",
    "bestaetigung_spieler_wiederkehrend",
    "bestaetigung_schiedsrichter",
    "konto_spieler",
    "konto_schiedsrichter",
    "konto_kontakt",
]


@dataclass(frozen=True, kw_only=True)
class Fassung:
    """One wording a person was shown, under the label (`text_version`) a record stamps to name it."""

    # A write judges a label against its own page's versions alone.
    seite: Seite
    # The German day the label's pull request merged into `main`, read off git, never a deploy's day.
    gilt_ab: date
    # The order the label freezes, and the order `tests/shared/test_einwilligung.py` digests.
    absaetze: tuple[str, ...]
    schalter: str
    # Every OTHER control the page decides a stored field with, keyed by the value it writes: a label
    # outside the frozen wording is a sentence a record cannot reproduce beside the choice it holds.
    bedienelemente: Mapping[str, str]
    # The same paragraphs keyed by section, where a page places them by key; `None` on a label whose
    # keys were never kept.
    absaetze_nach_schluessel: Mapping[str, str] | None = None


# Each label's own keyed paragraphs, never a map the next rewording edits: a new wording is a new
# map under a new label, and these stay the words their records cite.
_BESTAETIGUNGSSEITE_6: Final[Mapping[str, str]] = MappingProxyType(
    {
        "worum": (
            "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der Frankfurt "
            "League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die Bewerbung abgeschickt "
            "hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer angegeben. Den Link zu dieser "
            "Seite hast Du bekommen, weil wir das nicht einfach so stehen lassen wollen, sondern von Dir selbst hören "
            "möchten, dass es stimmt."
        ),
        "gespeichert": (
            "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir brauchen "
            "sie, um das Team dieser Schule während der Saison zu erreichen, also für Spielansetzungen, Absagen, "
            "Rückfragen und die Entscheidung über die Bewerbung."
        ),
        "geburtsdatum": (
            "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir prüfen "
            "damit, ob Du mindestens {minAlter} Jahre alt bist. So alt muss sein, wer diese Rolle übernimmt. Vorher "
            "hatte es niemand, und niemand hat es für Dich angegeben."
        ),
        "rechtsgrundlage": (
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, den Spielbetrieb der "
            "Liga durchzuführen und dafür ein Team über die von ihm selbst benannten Personen erreichen zu können, "
            "statt eine ganze Saison an einer einzigen Adresse hängen zu lassen. Dass Deine Daten dabei nicht "
            "untergehen, sichern wir so ab: Du erfährst von Deinem Eintrag sofort, nämlich jetzt; nichts davon wird "
            "veröffentlicht; und Du kannst jederzeit verlangen, dass wir alles löschen."
        ),
        "nichtOeffentlich": (
            "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch im "
            "Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere Schulen oder "
            "Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie nur die "
            "Administratorinnen und Administratoren."
        ),
        "fristAbgelehnt": "Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung.",
        "fristAngenommen": (
            "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und löschen Deine "
            "Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem Tag, an dem Du es hier "
            "einträgst."
        ),
        "fristUnvollstaendig": (
            "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen ab dem Versand der "
            "Bestätigungslinks, löschen wir die ganze Bewerbung samt allen Kontaktdaten. Ersetzen wir einen Link "
            "durch einen neuen, beginnt diese Frist für die ganze Bewerbung von vorn; eine Erinnerung verschiebt sie "
            "nicht."
        ),
        "fristOhneEntscheidung": (
            "Bleibt die Bewerbung ohne Entscheidung, löschen wir sie samt allen Kontaktdaten und Deinem Geburtsdatum, "
            "sobald die Saison {saison} vorbei ist."
        ),
        "ablehnen": (
            "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über "
            "„{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der Person "
            "Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann."
        ),
        "ablehnenFolge": ("Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat."),
        "widerruf": (
            "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 DSGVO). "
            "Eine Einwilligung, die man widerrufen müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. "
            "Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose "
            "E-Mail an {kontakt}."
        ),
        "art21": (
            "Der Verarbeitung Deiner Daten kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner "
            "besonderen Situation ergeben (Art. 21 DSGVO)."
        ),
        "whatsapp": (
            "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, "
            "erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. "
            "Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, zu "
            "WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Du "
            "kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an {kontakt}. Was bis dahin "
            "geschah, bleibt rechtmäßig."
        ),
        "klickIdentitaet": "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
        "klickEintrag": "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
        "klickAlter": "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
        "klickHinweise": "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
        "keineEinwilligung": (
            "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der Bewerbung "
            "steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben."
        ),
    }
)

# The applicant page's words for a person the administration seated on an application, whom no
# applicant named: the opening and the legal basis, which would tell them otherwise, are its own.
# Never a label by itself.
_BESTAETIGUNGSSEITE_VERWALTUNG_TEXTE: Final[Mapping[str, str]] = MappingProxyType(
    {
        **_BESTAETIGUNGSSEITE_6,
        "worum": (
            "Die Verwaltung der Frankfurt League hat Dich für die Schule {schule} in der Saison {saison} als {rolle} "
            "eingetragen und dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer angegeben. Den Link zu "
            "dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen lassen wollen, sondern von Dir selbst "
            "hören möchten, dass es stimmt."
        ),
        "rechtsgrundlage": (
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, den Spielbetrieb der "
            "Liga durchzuführen und dafür ein Team über die Personen erreichen zu können, die die Verwaltung für dieses "
            "Team einträgt, statt eine ganze Saison an einer einzigen Adresse hängen zu lassen. Dass Deine Daten dabei "
            "nicht untergehen, sichern wir so ab: Du erfährst von Deinem Eintrag sofort, nämlich jetzt; nichts davon "
            "wird veröffentlicht; und Du kannst jederzeit verlangen, dass wir alles löschen."
        ),
    }
)

# The contact pages' words from the label offering the media consent on: its own paragraph after the
# WhatsApp one, the two sentences calling WhatsApp the only consent, and the WhatsApp paragraph
# naming the account page.
_KONTAKT_MEDIEN: Final[Mapping[str, str]] = MappingProxyType(
    {
        "whatsapp": (
            "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, "
            "erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. "
            "Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, zu "
            "WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Du "
            "kannst diese Einwilligung jederzeit zurücknehmen, in Deinem Konto oder formlos mit einer E-Mail an "
            "{kontakt}. Was bis dahin geschah, bleibt rechtmäßig."
        ),
        "widerruf": (
            "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 DSGVO). "
            "Eine Einwilligung, die man widerrufen müsste, gibt es hier nicht, außer den freiwilligen für WhatsApp und "
            "für Fotos, Videos und Interviews. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}. "
            "Für alles genügt eine formlose E-Mail an {kontakt}."
        ),
        "medien": (
            "Die Liga veröffentlicht manchmal Fotos und Videos von Spieltagen, auf denen auch Kontaktpersonen eines "
            "Teams zu sehen sind, und führt Interviews. Unabhängig von Deiner Bestätigung kannst Du ab "
            "{medienMinAlter} Jahren erlauben, dass Fotos, Videos und Interviews, auf denen Du zu erkennen bist, auf "
            "unserer Website und unserem Instagram-Kanal veröffentlicht werden. Bist Du jünger, fragen wir Dich das "
            "nicht, und wir veröffentlichen keine Fotos oder Videos, auf denen Du zu erkennen bist, und keine "
            "Interviews mit Dir. Diese Erlaubnis ist freiwillig und zunächst ausgeschaltet; ohne sie entsteht Dir kein "
            "Nachteil, und Du kannst sie jederzeit in Deinem Konto zurücknehmen. Rechtsgrundlage dafür ist Deine "
            "Einwilligung (Art. 6 Abs. 1 lit. a und Art. 7 DSGVO). Deine Kontaktdaten werden davon nicht berührt und "
            "nirgends veröffentlicht."
        ),
        "keineEinwilligung": (
            "Eine Einwilligung ist das nicht; einwilligen kannst Du hier nur mit den beiden freiwilligen Schaltern. Du "
            "bestätigst, was in der Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben."
        ),
    }
)


def _mit_medien(seite: Mapping[str, str]) -> Mapping[str, str]:
    """A contact page's paragraphs with the media consent added after the WhatsApp one, in the order the page reads."""

    absaetze: dict[str, str] = {}
    for key, text in seite.items():
        absaetze[key] = _KONTAKT_MEDIEN.get(key, text)
        if key == "whatsapp":
            absaetze["medien"] = _KONTAKT_MEDIEN["medien"]

    return MappingProxyType(absaetze)


_BESTAETIGUNGSSEITE_7: Final[Mapping[str, str]] = _mit_medien(_BESTAETIGUNGSSEITE_6)
_BESTAETIGUNGSSEITE_VERWALTUNG: Final[Mapping[str, str]] = _mit_medien(_BESTAETIGUNGSSEITE_VERWALTUNG_TEXTE)

# The page for a person the administration entered on a team's season row: no application stands
# behind that seat and no submitter is told anything, so every paragraph about either is its own.
_BESTAETIGUNGSSEITE_SAISON: Final[Mapping[str, str]] = MappingProxyType(
    {
        **_BESTAETIGUNGSSEITE_7,
        "worum": (
            "Die Verwaltung der Frankfurt League hat Dich für das Team {schule} in der Saison {saison} als {rolle} "
            "eingetragen und dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer angegeben. Den Link zu "
            "dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen lassen wollen, sondern von Dir selbst "
            "hören möchten, dass es stimmt."
        ),
        "gespeichert": (
            "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir brauchen "
            "sie, um Dein Team während der Saison zu erreichen, also für Spielansetzungen, Absagen und Rückfragen."
        ),
        "geburtsdatum": (
            "Dein Geburtsdatum hat die Verwaltung nicht eingetragen. Du trägst es gleich hier selbst ein, und wir "
            "prüfen damit, ob Du mindestens {minAlter} Jahre alt bist. So alt muss sein, wer diese Rolle übernimmt. "
            "Vorher hatte es niemand, und niemand hat es für Dich angegeben."
        ),
        "rechtsgrundlage": (
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, den Spielbetrieb der "
            "Liga durchzuführen und dafür ein Team über die Personen erreichen zu können, die die Verwaltung für dieses "
            "Team einträgt, statt eine ganze Saison an einer einzigen Adresse hängen zu lassen. Dass Deine Daten dabei "
            "nicht untergehen, sichern wir so ab: Du erfährst von Deinem Eintrag sofort, nämlich jetzt; nichts davon "
            "wird veröffentlicht; und Du kannst jederzeit verlangen, dass wir alles löschen."
        ),
        "fristAbgelehnt": "Widersprichst Du Deinem Eintrag, löschen wir Deine Angaben sofort.",
        "fristAngenommen": (
            "Sonst behalten wir Deine Angaben bis zum Ende der Saison, die auf {saison} folgt, und löschen sie dann. "
            "Für Dein Geburtsdatum gilt dieselbe Frist."
        ),
        "fristUnvollstaendig": (
            "Dieser Link gilt vierzehn Tage ab seinem Versand. Bestätigst Du bis dahin nicht, öffnet er nichts mehr, "
            "und Dein Eintrag bleibt unbestätigt, bis die Verwaltung Dir einen neuen Link schickt; mit ihm beginnt die "
            "Frist von vorn."
        ),
        "fristOhneEntscheidung": ("Übernimmt ein anderes Team den Platz Deines Teams in dieser Saison, löschen wir Deine Angaben sofort."),
        "ablehnen": (
            "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über "
            "„{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann, und die Verwaltung kann "
            "für diese Rolle jemand anderen eintragen."
        ),
        "ablehnenFolge": "Wir entfernen Deine Angaben sofort aus dem Eintrag Deines Teams für diese Saison.",
        "keineEinwilligung": (
            "Eine Einwilligung ist das nicht; einwilligen kannst Du hier nur mit den beiden freiwilligen Schaltern. Du "
            "bestätigst Deinen Eintrag und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben."
        ),
    }
)

# The media switch, worded alike on every page offering it. Each label's digest freezes it, so a
# rewording is a new constant under a new label, never an edit here.
_MEDIEN_SCHALTER: Final = "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen."

_SCHIEDSRICHTERSEITE_3: Final[Mapping[str, str]] = MappingProxyType(
    {
        "worum": (
            "Die Verwaltung der Frankfurt League hat Dich als Schiedsrichterin oder Schiedsrichter eingetragen und "
            "Dir dafür diesen Link geschickt. Auf dieser Seite bestätigst Du den Eintrag und entscheidest, was wir "
            "mit Deinen Angaben tun dürfen."
        ),
        "gespeichert": (
            "Gespeichert sind Dein Name, Deine E-Mail-Adresse und, falls angegeben, Deine Schule und Deine "
            "Telefonnummer, das für Dich hinterlegte Honorar je Spiel sowie das Geburtsdatum, das Du gleich hier "
            "einträgst. Mit Deiner E-Mail-Adresse hast Du zugleich ein Konto auf der Website: Du meldest Dich damit "
            "ohne Passwort an, nimmst dort Ansetzungen an oder lehnst sie ab, reichst Spielberichte ein und siehst "
            "jederzeit, was wir über Dich gespeichert haben."
        ),
        "geburtsdatum": (
            "Spiele leiten kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem Geburtsdatum, das "
            "Du hier einträgst; niemand hat es vorher für Dich angegeben."
        ),
        "wer": (
            "Deine Schule, Deine Kontaktdaten, das Honorar und Dein Geburtsdatum sehen nur die Administratorinnen und "
            "Administratoren der Liga. Diese Angaben werden nirgends veröffentlicht und nicht an Teams, Schulen oder "
            "Dritte weitergegeben."
        ),
        "veroeffentlichung": (
            "Du entscheidest, ob Dein Name im Spielplan bei den Spielen erscheint, die Du leitest: der erste Teil "
            "Deines Namens und vom nächsten nur der Anfangsbuchstabe; ist nur ein Name eingetragen, steht er ganz da. "
            "Wählst Du „intern“, steht dort an der Stelle Deines Namens „anonym“. Am Leiten von Spielen ändert diese "
            "Wahl nichts, und Du kannst sie jederzeit in Deinem Konto umstellen."
        ),
        "medien": (
            "Unabhängig davon kannst Du ab {medienMinAlter} Jahren erlauben, dass Fotos, Videos und Interviews, die "
            "im Rahmen der Liga von Dir entstehen, auf unserer Website und unserem Instagram-Kanal veröffentlicht "
            "werden. Bist Du jünger, fragen wir Dich das nicht, und wir veröffentlichen keine Fotos oder Videos, auf "
            "denen Du zu erkennen bist, und keine Interviews mit Dir. Diese Erlaubnis ist freiwillig und zunächst "
            "ausgeschaltet; ohne sie entsteht Dir kein Nachteil, und auch sie kannst Du jederzeit in Deinem Konto "
            "zurücknehmen."
        ),
        "rechtsgrundlage": (
            "Rechtsgrundlage für die Veröffentlichung Deines Namens im Spielplan und für Fotos, Videos und Interviews "
            "ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und Art. 7 DSGVO). Was wir brauchen, um Dich anzusetzen und "
            "das Honorar auszuzahlen, sind Name, Kontaktdaten, Betrag und Geburtsdatum, dazu Deine Schule, falls Du "
            "sie angibst. Rechtsgrundlage dafür ist unser berechtigtes Interesse, den Spielbetrieb der Liga "
            "durchzuführen (Art. 6 Abs. 1 lit. f DSGVO)."
        ),
        "frist": (
            "Bestätigst Du diese Seite nicht innerhalb von vierzehn Tagen, verfällt der Link; die Verwaltung schickt "
            "Dir auf Wunsch einen neuen. Dein Eintrag ist an keine Saison gebunden und bleibt bestehen, bis er "
            "endgültig gelöscht wird: von Dir selbst, von der Verwaltung oder auf Deinen Wunsch. Setzt die Verwaltung "
            "Dich nur nicht mehr ein, bleibt er bestehen."
        ),
        "widerruf": (
            "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin geschehen ist, "
            "bleibt rechtmäßig. Du kannst außerdem jederzeit die Löschung aller Deiner Daten verlangen (Art. 17 "
            "DSGVO): direkt in Deinem Konto über „{loeschung}“ oder mit einer formlosen E-Mail an {kontakt}. Alle "
            "Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}."
        ),
        "art21": (
            "Der Verarbeitung für den Spielbetrieb kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner "
            "besonderen Situation ergeben (Art. 21 DSGVO)."
        ),
        "klickIdentitaet": "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
        "klickEintrag": "dass Du von Deinem Eintrag als Schiedsrichterin oder Schiedsrichter weißt und er richtig ist,",
        "klickAlter": "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
        "klickEinwilligung": (
            "dass Du in die Veröffentlichung Deines Namens im Spielplan so einwilligst, wie Du es oben gewählt hast, "
            "und in Fotos, Videos und Interviews nur, wenn Du den Schalter eingeschaltet hast,"
        ),
        "klickHinweise": "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
    }
)

_SPIELERSEITE_3: Final[Mapping[str, str]] = MappingProxyType(
    {
        "worum": (
            "Du hast Dich über den Link Deines Teams {team} ({schule}) für die Saison {saison} der Frankfurt League "
            "registriert. Auf dieser Seite bestätigst Du diese Registrierung und entscheidest, was wir mit Deinen "
            "Angaben tun dürfen. Erst danach kann Dein Team Dich in seinen Kader aufnehmen."
        ),
        "gespeichert": (
            "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse, Deine Rückennummer, Deine Position "
            "und Deine Stufe sowie das Geburtsdatum, das Du gleich hier einträgst. Mit Deiner E-Mail-Adresse hast Du "
            "zugleich ein Konto auf der Website: Du meldest Dich damit ohne Passwort an und siehst dort jederzeit, "
            "was wir über Dich gespeichert haben."
        ),
        "geburtsdatum": (
            "Mitspielen kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem Geburtsdatum, das Du "
            "hier einträgst; niemand hat es vorher für Dich angegeben. Ein falsches Geburtsdatum beendet die "
            "Teilnahme: Wir sperren das Konto, und mit dieser E-Mail-Adresse ist für fünf volle Saisons keine neue "
            "Registrierung möglich."
        ),
        "wer": (
            "Trainerin oder Trainer, Ansprechperson und Stellvertretung Deines Teams sehen Deinen Namen, Deine "
            "Nummer, Deine Position und Deine Stufe, entscheiden über die Aufnahme in den Kader und können Nummer, "
            "Position, Stufe und die Kapitänsrolle anpassen. Deine E-Mail-Adresse und Dein Geburtsdatum sehen nur die "
            "Administratorinnen und Administratoren der Liga."
        ),
        "veroeffentlichung": (
            "Du entscheidest, ob Dein Vorname und der Anfangsbuchstabe Deines Nachnamens auf der Website erscheinen: "
            "in der Kaderliste Deines Teams, in Aufstellungen und bei Torschützen und Karten. Mehr als das steht dort "
            "in keinem Fall: nie Dein voller Nachname. Wählst Du „intern“, stehen dort nur Deine Nummer und Deine "
            "Position, und an der Stelle Deines Namens steht „anonym“. Am Mitspielen ändert diese Wahl nichts, und Du "
            "kannst sie jederzeit in Deinem Konto umstellen."
        ),
        "medien": (
            "Unabhängig davon kannst Du ab {medienMinAlter} Jahren erlauben, dass Fotos, Videos und Interviews, die "
            "im Rahmen der Liga von Dir entstehen, auf unserer Website und unserem Instagram-Kanal veröffentlicht "
            "werden. Bist Du jünger, fragen wir Dich das nicht, und wir veröffentlichen keine Fotos oder Videos, auf "
            "denen Du zu erkennen bist, und keine Interviews mit Dir. Diese Erlaubnis ist freiwillig und zunächst "
            "ausgeschaltet; ohne sie entsteht Dir kein Nachteil, und auch sie kannst Du jederzeit in Deinem Konto "
            "zurücknehmen."
        ),
        "rechtsgrundlage": (
            "Rechtsgrundlage für die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens "
            "und für Fotos, Videos und Interviews ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und Art. 7 DSGVO). Was "
            "wir zur Durchführung des Spielbetriebs brauchen, sind Name, E-Mail-Adresse, Nummer, Position, Stufe und "
            "Geburtsdatum in der Verwaltung der Liga. Rechtsgrundlage dafür ist unser berechtigtes Interesse, den "
            "Spielbetrieb der Liga durchzuführen (Art. 6 Abs. 1 lit. f DSGVO)."
        ),
        "frist": (
            "Bestätigst Du diese Seite nicht innerhalb von sieben Tagen, löschen wir die Registrierung von selbst; Du "
            "kannst Dich dann über den Link Deines Teams erneut registrieren. Deine Angaben behalten wir, bis in der "
            "nächsten Saison die Registrierung geschlossen ist. Registrierst Du Dich dort wieder mit derselben "
            "E-Mail-Adresse, bleiben sie erhalten und Du musst nur Deine Wahl bestätigen; andernfalls löschen wir sie "
            "dann vollständig."
        ),
        "widerruf": (
            "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin geschehen ist, "
            "bleibt rechtmäßig. Du kannst außerdem jederzeit die Löschung aller Deiner Daten verlangen (Art. 17 "
            "DSGVO): direkt in Deinem Konto über „{loeschung}“ oder mit einer formlosen E-Mail an {kontakt}. Alle "
            "Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}."
        ),
        "art21": (
            "Der Verarbeitung für den Spielbetrieb kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner "
            "besonderen Situation ergeben (Art. 21 DSGVO)."
        ),
        "klickIdentitaet": "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
        "klickAlter": "dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,",
        "klickEinwilligung": (
            "dass Du in die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens so "
            "einwilligst, wie Du es oben gewählt hast, und in Fotos, Videos und Interviews nur, wenn Du den Schalter "
            "eingeschaltet hast,"
        ),
        "klickHinweise": "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
    }
)

# The pupil page once a registration's fate follows the team's decision: only the retention paragraph,
# which promised the details until the next season's registration closed, is its own.
_SPIELERSEITE_4: Final[Mapping[str, str]] = MappingProxyType(
    {
        **_SPIELERSEITE_3,
        "frist": (
            "Bestätigst Du diese Seite nicht innerhalb von sieben Tagen, löschen wir die Registrierung von selbst; Du "
            "kannst Dich dann über den Link Deines Teams erneut registrieren. Bestätigst Du die Registrierung, behalten "
            "wir sie, bis Dein Team über sie entscheidet: Nimmt es Dich auf, löschen wir sie, und Deine Angaben stehen "
            "von da an in Deinem Kadereintrag; lehnt es sie ab, löschen wir sie einen Monat nach der Entscheidung. Ist "
            "bis zum Ende der Saison nicht entschieden, löschen wir sie dann."
        ),
    }
)

# The pupil page for a pupil the league already holds, confirmed, under this address and name: the
# choices they gave stand and are shown back rather than asked again, so nothing here asks or clicks one.
_SPIELERSEITE_WIEDERKEHREND: Final[Mapping[str, str]] = MappingProxyType(
    {
        "worum": (
            "Du hast Dich über den Link Deines Teams {team} ({schule}) für die Saison {saison} der Frankfurt League "
            "registriert. Auf dieser Seite bestätigst Du diese Registrierung. Erst danach kann Dein Team Dich in "
            "seinen Kader aufnehmen."
        ),
        "gespeichert": (
            "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse, Deine Rückennummer, Deine Position, "
            "Deine Stufe und Dein Geburtsdatum. Mit Deiner E-Mail-Adresse hast Du ein Konto auf der Website: Du "
            "meldest Dich damit ohne Passwort an und siehst dort jederzeit, was wir über Dich gespeichert haben."
        ),
        "geburtsdatum": (
            "Mitspielen kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an Deinem Geburtsdatum: "
            "Kennen wir es schon, steht es unten, sonst trägst Du es hier ein. Ein falsches Geburtsdatum beendet die "
            "Teilnahme: Wir sperren das Konto, und mit dieser E-Mail-Adresse ist für fünf volle Saisons keine neue "
            "Registrierung möglich."
        ),
        "wer": _SPIELERSEITE_4["wer"],
        "einwilligungen": (
            "Du bist bei uns schon eingetragen, und was Du über die Veröffentlichung Deines Vornamens und des "
            "Anfangsbuchstabens Deines Nachnamens und über Fotos, Videos und Interviews entschieden hast, gilt "
            "weiter. Deshalb fragen wir es hier nicht erneut; unten steht, wie Du entschieden hast. In Deinem Konto "
            "kannst Du das jederzeit ändern. Solange Du nicht in der Liga aktiv bist, kannst Du dort eine Erlaubnis "
            "nur zurücknehmen; nimmt Dein Team Dich auf, kannst Du sie dort auch wieder erteilen."
        ),
        "rechtsgrundlage": _SPIELERSEITE_4["rechtsgrundlage"],
        "frist": _SPIELERSEITE_4["frist"],
        "widerruf": _SPIELERSEITE_4["widerruf"],
        "art21": _SPIELERSEITE_4["art21"],
        "klickIdentitaet": _SPIELERSEITE_4["klickIdentitaet"],
        "klickAlter": "dass Du mindestens {minAlter} Jahre alt bist, was wir an Deinem Geburtsdatum prüfen,",
        "klickHinweise": _SPIELERSEITE_4["klickHinweise"],
    }
)

# The account page's three controls, each a page of its own: a press there is no confirmation, so
# it never stamps a confirmation page's label, and the words beside the switch say what it does now.
_KONTO_SPIELER: Final[Mapping[str, str]] = MappingProxyType(
    {
        "veroeffentlichung": (
            "Hier entscheidest Du, ob Dein Vorname und der Anfangsbuchstabe Deines Nachnamens auf der Website "
            "erscheinen: in der Kaderliste Deines Teams, in Aufstellungen und bei Torschützen und Karten. Mit „intern“ "
            "stehen dort nur Deine Nummer und Deine Position, und an der Stelle Deines Namens steht „anonym“. Am "
            "Mitspielen ändert diese Wahl nichts."
        ),
        "medien": (
            "Unabhängig davon entscheidest Du ab {medienMinAlter} Jahren, ob Fotos, Videos und Interviews, die im "
            "Rahmen der Liga von Dir entstehen, auf unserer Website und unserem Instagram-Kanal veröffentlicht werden "
            "dürfen. Bist Du jünger, ist dieser Schalter aus und lässt sich nicht einschalten."
        ),
        "widerruf": (
            "Jede Änderung gilt ab dem Moment, in dem Du sie speicherst; was bis dahin veröffentlicht wurde, bleibt "
            "rechtmäßig (Art. 7 Abs. 3 DSGVO)."
        ),
        # Each shown beside the record its cause holds alone, a retired pupil's and a pending registration's
        # sharing this control's label.
        "nurWiderrufNichtAktiv": (
            "Bist Du nicht mehr in der Liga aktiv, kannst Du eine Erlaubnis hier nur noch zurücknehmen, nicht neu erteilen."
        ),
        "nurWiderrufBisAufnahme": (
            "Solange Dein Team über Deine Registrierung nicht entschieden hat, kannst Du eine Erlaubnis hier nur "
            "zurücknehmen. Nimmt Dein Team Dich auf, kannst Du sie hier auch erteilen."
        ),
    }
)

_KONTO_SCHIEDSRICHTER: Final[Mapping[str, str]] = MappingProxyType(
    {
        "veroeffentlichung": (
            "Hier entscheidest Du, ob Dein Name im Spielplan bei den Spielen erscheint, die Du leitest: der erste Teil "
            "Deines Namens und vom nächsten nur der Anfangsbuchstabe; ist nur ein Name eingetragen, steht er ganz da. "
            "Mit „intern“ steht dort „anonym“. Am Leiten von Spielen ändert diese Wahl nichts."
        ),
        "medien": _KONTO_SPIELER["medien"],
        "widerruf": (
            "Jede Änderung gilt ab dem Moment, in dem Du sie speicherst; was bis dahin veröffentlicht wurde, bleibt "
            "rechtmäßig (Art. 7 Abs. 3 DSGVO)."
        ),
        # Shown beside a retired referee's record alone.
        "nurWiderrufNichtAktiv": (
            "Setzt die Verwaltung Dich nicht mehr ein, kannst Du eine Erlaubnis hier nur noch zurücknehmen, nicht neu erteilen."
        ),
    }
)

_KONTO_KONTAKT: Final[Mapping[str, str]] = MappingProxyType(
    {
        "whatsapp": (
            "Ob wir Dich für {team} in der Saison {saison} auch über WhatsApp erreichen dürfen, entscheidest Du hier. "
            "Ist der Schalter an, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, zu "
            "WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Ist er "
            "aus, erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch."
        ),
        "medien": (
            "Die Liga veröffentlicht manchmal Fotos und Videos von Spieltagen, auf denen auch Kontaktpersonen eines "
            "Teams zu sehen sind, und führt Interviews. Ab {medienMinAlter} Jahren entscheidest Du hier für "
            "{team} in der Saison {saison}, ob Fotos, Videos und Interviews, auf denen Du zu erkennen bist, auf unserer "
            "Website und unserem Instagram-Kanal veröffentlicht werden dürfen. Deine Kontaktdaten werden davon nicht "
            "berührt und nirgends veröffentlicht."
        ),
        "widerruf": (
            "Jede Änderung gilt ab dem Moment, in dem Du sie speicherst; was bis dahin geschah, bleibt rechtmäßig (Art. 7 Abs. 3 DSGVO)."
        ),
        # Each shown beside the seat its cause holds alone. „erteilen“ and never „wieder zustimmen“: most
        # seats reading one never agreed to the choice it names.
        "nurWiderrufVorbei": (
            "Für eine vergangene Saison oder ein Team, das aus der Saison ausgetreten ist, kannst Du eine Erlaubnis "
            "hier nur noch zurücknehmen, nicht neu erteilen."
        ),
        "nurWiderrufBisZusage": (
            "Solange über die Bewerbung nicht entschieden ist, kannst Du eine Erlaubnis hier nur zurücknehmen. Nach "
            "einer Zusage kannst Du sie hier auch erteilen."
        ),
    }
)

# A stored record cites its label alone, so an entry here is never reworded or removed: either leaves a
# record claiming words nobody was shown. Different words are a new label.
FASSUNGEN: Final[Mapping[str, Fassung]] = MappingProxyType(
    {
        "2026-08": Fassung(
            seite="bewerbung",
            gilt_ab=date(2026, 8, 31),
            absaetze=(
                (
                    "Ich bin damit einverstanden, dass die Frankfurt League meinen Namen, meine E-Mail-Adresse, meine "
                    "Telefonnummer und mein Geburtsdatum speichert und mich damit zu dieser Saison erreicht, auch "
                    "über WhatsApp. Diese Angaben bleiben in der Verwaltung der Liga und werden nirgends "
                    "veröffentlicht. Ich kann die Einwilligung jederzeit widerrufen."
                ),
            ),
            schalter="Ja, ich bin einverstanden",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigung": Fassung(
            seite="bewerbung",
            gilt_ab=date(2026, 9, 4),
            absaetze=(
                (
                    "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und "
                    "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der "
                    "Verwaltung der Liga und werden nirgends veröffentlicht."
                ),
                (
                    "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und "
                    "bestätigt dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, "
                    "und daran prüfen wir, ob sie mindestens 16 Jahre alt ist; hier im Formular brauchst Du es nicht. "
                    "Solange nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; nach vierzehn Tagen ohne "
                    "vollständige Bestätigung löschen wir sie samt allen Kontaktdaten. Was wir mit den Daten sonst "
                    "machen und welche Rechte jede dieser Personen hat, steht in der Datenschutzerklärung."
                ),
            ),
            schalter="Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigung-2": Fassung(
            seite="bewerbung",
            gilt_ab=date(2026, 9, 7),
            absaetze=(
                (
                    "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und "
                    "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der "
                    "Verwaltung der Liga und werden nirgends veröffentlicht."
                ),
                (
                    "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und "
                    "bestätigt dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, "
                    "und daran prüfen wir, ob sie mindestens 16 Jahre alt ist; hier im Formular brauchst Du es nicht. "
                    "Solange nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; fehlt vierzehn Tage nach "
                    "dem Versand dieser Links noch eine Bestätigung, löschen wir die Bewerbung samt allen "
                    "Kontaktdaten. Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist von vorn. "
                    "Was wir mit den Daten sonst machen und welche Rechte jede dieser Personen hat, steht in der "
                    "Datenschutzerklärung."
                ),
            ),
            schalter="Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigung-3": Fassung(
            seite="bewerbung",
            gilt_ab=date(2026, 9, 7),
            absaetze=(
                (
                    "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und "
                    "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der "
                    "Verwaltung der Liga und werden nirgends veröffentlicht."
                ),
                (
                    "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und "
                    "bestätigt dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, "
                    "und daran prüfen wir, ob sie mindestens 16 Jahre alt ist; hier im Formular brauchst Du es nicht. "
                    "Solange nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; fehlt vierzehn Tage nach "
                    "dem Versand dieser Links noch eine Bestätigung, löschen wir die Bewerbung samt allen "
                    "Kontaktdaten. Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist für die "
                    "ganze Bewerbung von vorn; eine Erinnerung verschiebt sie nicht. Was wir mit den Daten sonst "
                    "machen und welche Rechte jede dieser Personen hat, steht in der Datenschutzerklärung."
                ),
            ),
            schalter="Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigung-4": Fassung(
            seite="bewerbung",
            gilt_ab=date(2026, 9, 21),
            absaetze=(
                (
                    "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und "
                    "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der "
                    "Verwaltung der Liga und werden nirgends veröffentlicht."
                ),
                (
                    "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und "
                    "bestätigt dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, "
                    "und daran prüfen wir, ob sie das Mindestalter ihrer Rolle erreicht; hier im Formular brauchst Du "
                    "es nicht. Solange nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; fehlt vierzehn "
                    "Tage nach dem Versand dieser Links noch eine Bestätigung, löschen wir die Bewerbung samt allen "
                    "Kontaktdaten. Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist für die "
                    "ganze Bewerbung von vorn; eine Erinnerung verschiebt sie nicht. Was wir mit den Daten sonst "
                    "machen und welche Rechte jede dieser Personen hat, steht in der Datenschutzerklärung."
                ),
            ),
            schalter="Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigung-5": Fassung(
            seite="bewerbung",
            gilt_ab=date(2026, 9, 24),
            absaetze=(
                (
                    "Die Liga speichert von jeder der drei Personen oben Vorname, Nachname, E-Mail-Adresse und "
                    "Telefonnummer, um das Team während dieser Saison zu erreichen. Diese Angaben bleiben in der "
                    "Verwaltung der Liga und werden nirgends veröffentlicht."
                ),
                (
                    "Jede der drei Personen bekommt gleich eine eigene E-Mail mit einem persönlichen Link und "
                    "bestätigt dort selbst, dass die Angaben stimmen. Ihr Geburtsdatum trägt jede dort selbst ein, "
                    "und daran prüfen wir, ob sie das Mindestalter ihrer Rolle erreicht; hier im Formular brauchst Du "
                    "es nicht. Solange nicht alle bestätigt haben, bearbeiten wir die Bewerbung nicht; fehlt vierzehn "
                    "Tage nach dem Versand dieser Links noch eine Bestätigung, löschen wir die Bewerbung samt allen "
                    "Kontaktdaten. Ersetzen wir später einen Link durch einen neuen, beginnt diese Frist für die "
                    "ganze Bewerbung von vorn; eine Erinnerung verschiebt sie nicht. Was wir mit den Daten sonst "
                    "machen und welche Rechte jede dieser Personen hat, steht in der Datenschutzerklärung."
                ),
                (
                    "Der Verarbeitung Deiner Angaben kannst Du jederzeit aus Gründen widersprechen, die sich aus "
                    "Deiner besonderen Situation ergeben (Art. 21 DSGVO)."
                ),
            ),
            schalter="Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigungsseite": Fassung(
            seite="bestaetigung_kontakt",
            gilt_ab=date(2026, 9, 4),
            absaetze=(
                (
                    "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der "
                    "Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die "
                    "Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer "
                    "angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen "
                    "lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt."
                ),
                (
                    "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir "
                    "brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für "
                    "Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung."
                ),
                (
                    "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir "
                    "prüfen damit, ob Du mindestens {minAlter} Jahre alt bist; unter {minAlter} kann bei uns niemand "
                    "mitmachen. Vorher hatte es niemand, und niemand hat es für Dich angegeben."
                ),
                (
                    "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst "
                    "Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst "
                    "benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen "
                    "zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem "
                    "Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit "
                    "verlangen, dass wir alles löschen."
                ),
                (
                    "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch "
                    "im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere "
                    "Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie "
                    "nur die Administratorinnen und Administratoren."
                ),
                ("Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung."),
                (
                    "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und "
                    "löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem "
                    "Tag, an dem Du es hier einträgst."
                ),
                (
                    "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen, löschen wir die ganze "
                    "Bewerbung samt allen Kontaktdaten."
                ),
                (
                    "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über "
                    "den Link „{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und "
                    "sagen der Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen "
                    "kann."
                ),
                ("Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat."),
                (
                    "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 "
                    "DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen "
                    "müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du "
                    "sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}."
                ),
                (
                    "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, "
                    "erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. "
                    "Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, "
                    "zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag "
                    "besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an "
                    "{kontakt}. Was bis dahin geschah, bleibt rechtmäßig."
                ),
                "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
                "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
                ("dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,"),
                "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
                (
                    "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der "
                    "Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben."
                ),
            ),
            schalter="Die Liga darf mich auch über WhatsApp erreichen.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigungsseite-2": Fassung(
            seite="bestaetigung_kontakt",
            gilt_ab=date(2026, 9, 5),
            absaetze=(
                (
                    "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der "
                    "Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die "
                    "Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer "
                    "angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen "
                    "lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt."
                ),
                (
                    "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir "
                    "brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für "
                    "Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung."
                ),
                (
                    "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir "
                    "prüfen damit, ob Du mindestens {minAlter} Jahre alt bist; unter {minAlter} kann bei uns niemand "
                    "mitmachen. Vorher hatte es niemand, und niemand hat es für Dich angegeben."
                ),
                (
                    "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst "
                    "Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst "
                    "benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen "
                    "zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem "
                    "Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit "
                    "verlangen, dass wir alles löschen."
                ),
                (
                    "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch "
                    "im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere "
                    "Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie "
                    "nur die Administratorinnen und Administratoren."
                ),
                ("Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung."),
                (
                    "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und "
                    "löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem "
                    "Tag, an dem Du es hier einträgst."
                ),
                (
                    "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen, löschen wir die ganze "
                    "Bewerbung samt allen Kontaktdaten."
                ),
                (
                    "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über "
                    "„{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der "
                    "Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann."
                ),
                ("Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat."),
                (
                    "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 "
                    "DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen "
                    "müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du "
                    "sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}."
                ),
                (
                    "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, "
                    "erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. "
                    "Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, "
                    "zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag "
                    "besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an "
                    "{kontakt}. Was bis dahin geschah, bleibt rechtmäßig."
                ),
                "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
                "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
                ("dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,"),
                "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
                (
                    "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der "
                    "Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben."
                ),
            ),
            schalter="Die Liga darf mich auch über WhatsApp erreichen.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigungsseite-3": Fassung(
            seite="bestaetigung_kontakt",
            gilt_ab=date(2026, 9, 7),
            absaetze=(
                (
                    "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der "
                    "Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die "
                    "Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer "
                    "angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen "
                    "lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt."
                ),
                (
                    "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir "
                    "brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für "
                    "Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung."
                ),
                (
                    "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir "
                    "prüfen damit, ob Du mindestens {minAlter} Jahre alt bist; unter {minAlter} kann bei uns niemand "
                    "mitmachen. Vorher hatte es niemand, und niemand hat es für Dich angegeben."
                ),
                (
                    "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst "
                    "Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst "
                    "benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen "
                    "zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem "
                    "Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit "
                    "verlangen, dass wir alles löschen."
                ),
                (
                    "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch "
                    "im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere "
                    "Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie "
                    "nur die Administratorinnen und Administratoren."
                ),
                ("Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung."),
                (
                    "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und "
                    "löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem "
                    "Tag, an dem Du es hier einträgst."
                ),
                (
                    "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen ab dem Versand der "
                    "Bestätigungslinks, löschen wir die ganze Bewerbung samt allen Kontaktdaten. Ersetzen wir einen "
                    "Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung von vorn; eine Erinnerung "
                    "verschiebt sie nicht."
                ),
                (
                    "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über "
                    "„{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der "
                    "Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann."
                ),
                ("Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat."),
                (
                    "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 "
                    "DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen "
                    "müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du "
                    "sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}."
                ),
                (
                    "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, "
                    "erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. "
                    "Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, "
                    "zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag "
                    "besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an "
                    "{kontakt}. Was bis dahin geschah, bleibt rechtmäßig."
                ),
                "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
                "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
                ("dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,"),
                "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
                (
                    "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der "
                    "Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben."
                ),
            ),
            schalter="Die Liga darf mich auch über WhatsApp erreichen.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigungsseite-4": Fassung(
            seite="bestaetigung_kontakt",
            gilt_ab=date(2026, 9, 9),
            absaetze=(
                (
                    "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der "
                    "Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die "
                    "Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer "
                    "angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen "
                    "lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt."
                ),
                (
                    "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir "
                    "brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für "
                    "Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung."
                ),
                (
                    "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir "
                    "prüfen damit, ob Du mindestens {minAlter} Jahre alt bist; unter {minAlter} kann bei uns niemand "
                    "mitmachen. Vorher hatte es niemand, und niemand hat es für Dich angegeben."
                ),
                (
                    "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst "
                    "Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst "
                    "benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen "
                    "zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem "
                    "Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit "
                    "verlangen, dass wir alles löschen."
                ),
                (
                    "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch "
                    "im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere "
                    "Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie "
                    "nur die Administratorinnen und Administratoren."
                ),
                ("Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung."),
                (
                    "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und "
                    "löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem "
                    "Tag, an dem Du es hier einträgst."
                ),
                (
                    "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen ab dem Versand der "
                    "Bestätigungslinks, löschen wir die ganze Bewerbung samt allen Kontaktdaten. Ersetzen wir einen "
                    "Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung von vorn; eine Erinnerung "
                    "verschiebt sie nicht."
                ),
                (
                    "Bleibt die Bewerbung ohne Entscheidung, löschen wir sie samt allen Kontaktdaten und Deinem "
                    "Geburtsdatum, sobald die Saison {saison} vorbei ist."
                ),
                (
                    "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über "
                    "„{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der "
                    "Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann."
                ),
                ("Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat."),
                (
                    "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 "
                    "DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen "
                    "müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du "
                    "sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}."
                ),
                (
                    "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, "
                    "erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. "
                    "Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, "
                    "zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag "
                    "besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an "
                    "{kontakt}. Was bis dahin geschah, bleibt rechtmäßig."
                ),
                "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
                "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
                ("dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,"),
                "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
                (
                    "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der "
                    "Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben."
                ),
            ),
            schalter="Die Liga darf mich auch über WhatsApp erreichen.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigungsseite-5": Fassung(
            seite="bestaetigung_kontakt",
            gilt_ab=date(2026, 9, 21),
            absaetze=(
                (
                    "Für die Schule {schule} wurde eine Bewerbung um die Teilnahme an der Saison {saison} der "
                    "Frankfurt League eingereicht. Darin bist Du als {rolle} eingetragen. Die Person, die die "
                    "Bewerbung abgeschickt hat, hat dabei Deinen Namen, Deine E-Mail-Adresse und Deine Telefonnummer "
                    "angegeben. Den Link zu dieser Seite hast Du bekommen, weil wir das nicht einfach so stehen "
                    "lassen wollen, sondern von Dir selbst hören möchten, dass es stimmt."
                ),
                (
                    "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse und Deine Telefonnummer. Wir "
                    "brauchen sie, um das Team dieser Schule während der Saison zu erreichen, also für "
                    "Spielansetzungen, Absagen, Rückfragen und die Entscheidung über die Bewerbung."
                ),
                (
                    "Dein Geburtsdatum steht nicht in der Bewerbung. Du trägst es gleich hier selbst ein, und wir "
                    "prüfen damit, ob Du mindestens {minAlter} Jahre alt bist. So alt muss sein, wer diese Rolle "
                    "übernimmt. Vorher hatte es niemand, und niemand hat es für Dich angegeben."
                ),
                (
                    "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Du selbst an der Liga teilnimmst, sonst "
                    "Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, ein Team über die von ihm selbst "
                    "benannten Personen erreichen zu können, statt eine ganze Saison an einer einzigen Adresse hängen "
                    "zu lassen. Dass Deine Daten dabei nicht untergehen, sichern wir so ab: Du erfährst von Deinem "
                    "Eintrag sofort, nämlich jetzt; nichts davon wird veröffentlicht; und Du kannst jederzeit "
                    "verlangen, dass wir alles löschen."
                ),
                (
                    "Deine Kontaktdaten werden nirgends veröffentlicht. Sie erscheinen weder auf der Teamseite noch "
                    "im Spielplan noch sonst irgendwo auf der Website, und sie werden nicht an andere Teams, andere "
                    "Schulen oder Dritte weitergegeben. Sie bleiben in der Verwaltung der Liga, und dort sehen sie "
                    "nur die Administratorinnen und Administratoren."
                ),
                ("Wird die Bewerbung abgelehnt, löschen wir sie mit allen Kontaktdaten einen Monat nach der Entscheidung."),
                (
                    "Wird sie angenommen, behalten wir sie bis zum Ende der Saison, die auf {saison} folgt, und "
                    "löschen Deine Kontaktdaten dann. Für Dein Geburtsdatum gilt dieselbe Frist, gerechnet ab dem "
                    "Tag, an dem Du es hier einträgst."
                ),
                (
                    "Bestätigen nicht alle eingetragenen Personen innerhalb von vierzehn Tagen ab dem Versand der "
                    "Bestätigungslinks, löschen wir die ganze Bewerbung samt allen Kontaktdaten. Ersetzen wir einen "
                    "Link durch einen neuen, beginnt diese Frist für die ganze Bewerbung von vorn; eine Erinnerung "
                    "verschiebt sie nicht."
                ),
                (
                    "Bleibt die Bewerbung ohne Entscheidung, löschen wir sie samt allen Kontaktdaten und Deinem "
                    "Geburtsdatum, sobald die Saison {saison} vorbei ist."
                ),
                (
                    "Du musst nicht bestätigen. Wenn Du nicht möchtest, dass wir Deine Daten haben, sag uns das über "
                    "„{ablehnen}“ oder mit einer E-Mail an {kontakt}; wir löschen Deinen Eintrag dann und sagen der "
                    "Person Bescheid, die die Bewerbung eingereicht hat, damit sie jemand anderen benennen kann."
                ),
                ("Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat."),
                (
                    "Auch nach einer Bestätigung kannst Du jederzeit die Löschung Deiner Daten verlangen (Art. 17 "
                    "DSGVO) und der Verarbeitung widersprechen (Art. 21 DSGVO). Eine Einwilligung, die man widerrufen "
                    "müsste, gibt es hier nicht, außer der freiwilligen für WhatsApp. Alle Deine Rechte und wie Du "
                    "sie ausübst, stehen in der {datenschutz}. Für alles genügt eine formlose E-Mail an {kontakt}."
                ),
                (
                    "Dieser Schalter ist freiwillig und hat mit der Bestätigung oben nichts zu tun. Lässt Du ihn aus, "
                    "erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es entsteht Dir kein Nachteil. "
                    "Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, "
                    "zu WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag "
                    "besteht. Du kannst diese Einwilligung jederzeit zurücknehmen, formlos mit einer E-Mail an "
                    "{kontakt}. Was bis dahin geschah, bleibt rechtmäßig."
                ),
                "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
                "dass Du von Deinem Eintrag als {rolle} für {schule} weißt und er richtig ist,",
                ("dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,"),
                "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
                (
                    "Eine Einwilligung ist das nicht, und wir holen hier auch keine ein. Du bestätigst, was in der "
                    "Bewerbung steht, und ergänzt Dein Geburtsdatum; die Grundlage dafür steht oben."
                ),
            ),
            schalter="Die Liga darf mich auch über WhatsApp erreichen.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-09-bestaetigungsseite-6": Fassung(
            seite="bestaetigung_kontakt",
            gilt_ab=date(2026, 9, 24),
            absaetze=tuple(_BESTAETIGUNGSSEITE_6.values()),
            absaetze_nach_schluessel=_BESTAETIGUNGSSEITE_6,
            schalter="Die Liga darf mich auch über WhatsApp erreichen.",
            bedienelemente=MappingProxyType({}),
        ),
        "2026-10-bestaetigungsseite-7": Fassung(
            seite="bestaetigung_kontakt",
            gilt_ab=date(2026, 10, 6),
            absaetze=tuple(_BESTAETIGUNGSSEITE_7.values()),
            absaetze_nach_schluessel=_BESTAETIGUNGSSEITE_7,
            schalter="Die Liga darf mich auch über WhatsApp erreichen.",
            bedienelemente=MappingProxyType({"medien": _MEDIEN_SCHALTER}),
        ),
        "2026-10-bestaetigungsseite-verwaltung": Fassung(
            seite="bestaetigung_kontakt_verwaltung",
            gilt_ab=date(2026, 10, 6),
            absaetze=tuple(_BESTAETIGUNGSSEITE_VERWALTUNG.values()),
            absaetze_nach_schluessel=_BESTAETIGUNGSSEITE_VERWALTUNG,
            schalter="Die Liga darf mich auch über WhatsApp erreichen.",
            bedienelemente=MappingProxyType({"medien": _MEDIEN_SCHALTER}),
        ),
        "2026-10-bestaetigungsseite-saison": Fassung(
            seite="bestaetigung_kontakt_saison",
            gilt_ab=date(2026, 10, 6),
            absaetze=tuple(_BESTAETIGUNGSSEITE_SAISON.values()),
            absaetze_nach_schluessel=_BESTAETIGUNGSSEITE_SAISON,
            schalter="Die Liga darf mich auch über WhatsApp erreichen.",
            bedienelemente=MappingProxyType({"medien": _MEDIEN_SCHALTER}),
        ),
        "2026-09-schiedsrichterseite": Fassung(
            seite="bestaetigung_schiedsrichter",
            gilt_ab=date(2026, 9, 22),
            absaetze=(
                (
                    "Die Verwaltung der Frankfurt League hat Dich als Schiedsrichterin oder Schiedsrichter "
                    "eingetragen und Dir dafür diesen Link geschickt. Auf dieser Seite bestätigst Du den Eintrag und "
                    "entscheidest, was wir mit Deinen Angaben tun dürfen."
                ),
                (
                    "Gespeichert sind Dein Vorname, Dein Nachname, Deine Schule, Deine E-Mail-Adresse und Deine "
                    "Telefonnummer, die für Dich hinterlegte Aufwandsentschädigung je Spiel sowie das Geburtsdatum, "
                    "das Du gleich hier einträgst. Deine E-Mail-Adresse ist zugleich Dein Zugang zur Website: Du "
                    "meldest Dich damit ohne Passwort an, nimmst dort Ansetzungen an oder lehnst sie ab, reichst "
                    "Spielberichte ein und siehst jederzeit, was wir über Dich gespeichert haben."
                ),
                (
                    "Spiele leiten kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem "
                    "Geburtsdatum, das Du hier einträgst; niemand hat es vorher für Dich angegeben."
                ),
                (
                    "Deine Schule, Deine Kontaktdaten, die Aufwandsentschädigung und Dein Geburtsdatum sehen nur die "
                    "Administratorinnen und Administratoren der Liga. Diese Angaben werden nirgends veröffentlicht "
                    "und nicht an Teams, Schulen oder Dritte weitergegeben."
                ),
                (
                    "Du entscheidest, ob Dein Vorname und der Anfangsbuchstabe Deines Nachnamens im Spielplan bei den "
                    "Spielen erscheinen, die Du leitest. Mehr als das steht dort in keinem Fall: nie Dein voller "
                    "Nachname. Wählst Du „intern“, steht dort an der Stelle Deines Namens „anonym“. Am Leiten von "
                    "Spielen ändert diese Wahl nichts, und Du kannst sie jederzeit in Deinem Zugang umstellen."
                ),
                (
                    "Unabhängig davon kannst Du erlauben, dass Fotos, Videos und Interviews, die im Rahmen der Liga "
                    "von Dir entstehen, veröffentlicht werden. Diese Erlaubnis ist freiwillig und zunächst "
                    "ausgeschaltet; ohne sie entsteht Dir kein Nachteil, und auch sie kannst Du jederzeit in Deinem "
                    "Zugang zurücknehmen."
                ),
                (
                    "Rechtsgrundlage für die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines "
                    "Nachnamens und für Fotos, Videos und Interviews ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und "
                    "Art. 7 DSGVO). Was wir brauchen, um Dich anzusetzen und die Aufwandsentschädigung auszuzahlen, "
                    "sind Name, Schule, Kontaktdaten, Betrag und Geburtsdatum in der Verwaltung der Liga. "
                    "Rechtsgrundlage dafür ist Deine Tätigkeit für die Liga selbst (Art. 6 Abs. 1 lit. b DSGVO)."
                ),
                (
                    "Bestätigst Du diese Seite nicht innerhalb von vierzehn Tagen, verfällt der Link; die Verwaltung "
                    "schickt Dir auf Wunsch einen neuen. Dein Eintrag ist an keine Saison gebunden und bleibt "
                    "bestehen, solange Du für die Liga Spiele leitest. Du kannst ihn jederzeit selbst löschen."
                ),
                (
                    "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin "
                    "geschehen ist, bleibt rechtmäßig. Du kannst außerdem jederzeit die Löschung aller Deiner Daten "
                    "verlangen (Art. 17 DSGVO): direkt in Deinem Zugang über „{loeschung}“ oder mit einer formlosen "
                    "E-Mail an {kontakt}. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}."
                ),
                "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
                "dass Du von Deinem Eintrag als Schiedsrichterin oder Schiedsrichter weißt und er richtig ist,",
                ("dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,"),
                (
                    "dass Du in die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens so "
                    "einwilligst, wie Du es oben gewählt hast, und in Fotos, Videos und Interviews nur, wenn Du den "
                    "Schalter eingeschaltet hast,"
                ),
                "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
            ),
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Vorname und erster Buchstabe des Nachnamens",
                    "intern": "Intern: dort steht „anonym“",
                }
            ),
        ),
        "2026-09-schiedsrichterseite-2": Fassung(
            seite="bestaetigung_schiedsrichter",
            gilt_ab=date(2026, 9, 24),
            absaetze=(
                (
                    "Die Verwaltung der Frankfurt League hat Dich als Schiedsrichterin oder Schiedsrichter "
                    "eingetragen und Dir dafür diesen Link geschickt. Auf dieser Seite bestätigst Du den Eintrag und "
                    "entscheidest, was wir mit Deinen Angaben tun dürfen."
                ),
                (
                    "Gespeichert sind Dein Name, Deine E-Mail-Adresse und, falls angegeben, Deine Schule und Deine "
                    "Telefonnummer, das für Dich hinterlegte Honorar je Spiel sowie das Geburtsdatum, das Du gleich "
                    "hier einträgst. Deine E-Mail-Adresse ist zugleich Dein Zugang zur Website: Du meldest Dich damit "
                    "ohne Passwort an, nimmst dort Ansetzungen an oder lehnst sie ab, reichst Spielberichte ein und "
                    "siehst jederzeit, was wir über Dich gespeichert haben."
                ),
                (
                    "Spiele leiten kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem "
                    "Geburtsdatum, das Du hier einträgst; niemand hat es vorher für Dich angegeben."
                ),
                (
                    "Deine Schule, Deine Kontaktdaten, das Honorar und Dein Geburtsdatum sehen nur die "
                    "Administratorinnen und Administratoren der Liga. Diese Angaben werden nirgends veröffentlicht "
                    "und nicht an Teams, Schulen oder Dritte weitergegeben."
                ),
                (
                    "Du entscheidest, ob Dein Name im Spielplan bei den Spielen erscheint, die Du leitest: der erste "
                    "Teil Deines Namens und vom nächsten nur der Anfangsbuchstabe; ist nur ein Name eingetragen, "
                    "steht er ganz da. Wählst Du „intern“, steht dort an der Stelle Deines Namens „anonym“. Am Leiten "
                    "von Spielen ändert diese Wahl nichts, und Du kannst sie jederzeit in Deinem Zugang umstellen."
                ),
                (
                    "Unabhängig davon kannst Du ab {medienMinAlter} Jahren erlauben, dass Fotos, Videos und "
                    "Interviews, die im Rahmen der Liga von Dir entstehen, auf unserer Website und unserem "
                    "Instagram-Kanal veröffentlicht werden. Bist Du jünger, fragen wir Dich das nicht, und wir "
                    "veröffentlichen keine Fotos oder Videos, auf denen Du zu erkennen bist, und keine Interviews mit "
                    "Dir. Diese Erlaubnis ist freiwillig und zunächst ausgeschaltet; ohne sie entsteht Dir kein "
                    "Nachteil, und auch sie kannst Du jederzeit in Deinem Zugang zurücknehmen."
                ),
                (
                    "Rechtsgrundlage für die Veröffentlichung Deines Namens im Spielplan und für Fotos, Videos und "
                    "Interviews ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und Art. 7 DSGVO). Was wir brauchen, um "
                    "Dich anzusetzen und das Honorar auszuzahlen, sind Name, Kontaktdaten, Betrag und Geburtsdatum, "
                    "dazu Deine Schule, falls Du sie angibst. Rechtsgrundlage dafür ist unser berechtigtes Interesse, "
                    "den Spielbetrieb der Liga durchzuführen (Art. 6 Abs. 1 lit. f DSGVO)."
                ),
                (
                    "Bestätigst Du diese Seite nicht innerhalb von vierzehn Tagen, verfällt der Link; die Verwaltung "
                    "schickt Dir auf Wunsch einen neuen. Dein Eintrag ist an keine Saison gebunden und bleibt "
                    "bestehen, bis er endgültig gelöscht wird: von Dir selbst, von der Verwaltung oder auf Deinen "
                    "Wunsch. Setzt die Verwaltung Dich nur nicht mehr ein, bleibt er bestehen."
                ),
                (
                    "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin "
                    "geschehen ist, bleibt rechtmäßig. Du kannst außerdem jederzeit die Löschung aller Deiner Daten "
                    "verlangen (Art. 17 DSGVO): direkt in Deinem Zugang über „{loeschung}“ oder mit einer formlosen "
                    "E-Mail an {kontakt}. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}."
                ),
                (
                    "Der Verarbeitung für den Spielbetrieb kannst Du jederzeit aus Gründen widersprechen, die sich "
                    "aus Deiner besonderen Situation ergeben (Art. 21 DSGVO)."
                ),
                "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
                "dass Du von Deinem Eintrag als Schiedsrichterin oder Schiedsrichter weißt und er richtig ist,",
                ("dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,"),
                (
                    "dass Du in die Veröffentlichung Deines Namens im Spielplan so einwilligst, wie Du es oben "
                    "gewählt hast, und in Fotos, Videos und Interviews nur, wenn Du den Schalter eingeschaltet hast,"
                ),
                "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
            ),
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Erster Namensteil und Anfangsbuchstabe des nächsten",
                    "intern": "Intern: dort steht „anonym“",
                }
            ),
        ),
        "2026-09-schiedsrichterseite-3": Fassung(
            seite="bestaetigung_schiedsrichter",
            gilt_ab=date(2026, 10, 3),
            absaetze=tuple(_SCHIEDSRICHTERSEITE_3.values()),
            absaetze_nach_schluessel=_SCHIEDSRICHTERSEITE_3,
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Erster Namensteil und Anfangsbuchstabe des nächsten",
                    "intern": "Intern: dort steht „anonym“",
                }
            ),
        ),
        "2026-09-spielerseite": Fassung(
            seite="bestaetigung_spieler",
            gilt_ab=date(2026, 9, 22),
            absaetze=(
                (
                    "Du hast Dich über den Link Deines Teams {team} ({schule}) für die Saison {saison} der Frankfurt "
                    "League registriert. Auf dieser Seite bestätigst Du diese Registrierung und entscheidest, was wir "
                    "mit Deinen Angaben tun dürfen. Erst danach kann Dein Team Dich in seinen Kader aufnehmen."
                ),
                (
                    "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse, Deine Rückennummer, Deine "
                    "Position und Deine Stufe sowie das Geburtsdatum, das Du gleich hier einträgst. Deine "
                    "E-Mail-Adresse ist zugleich Dein Zugang zur Website: Du meldest Dich damit ohne Passwort an und "
                    "siehst dort jederzeit, was wir über Dich gespeichert haben."
                ),
                (
                    "Mitspielen kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem "
                    "Geburtsdatum, das Du hier einträgst; niemand hat es vorher für Dich angegeben. Ein falsches "
                    "Geburtsdatum beendet die Teilnahme: Wir schließen den Zugang, und mit dieser E-Mail-Adresse ist "
                    "für fünf volle Saisons keine neue Registrierung möglich."
                ),
                (
                    "Trainerin oder Trainer, Ansprechperson und Stellvertretung Deines Teams sehen Deinen Namen, "
                    "Deine Nummer, Deine Position und Deine Stufe, entscheiden über die Aufnahme in den Kader und "
                    "können Nummer, Position, Stufe und die Kapitänsrolle anpassen. Deine E-Mail-Adresse und Dein "
                    "Geburtsdatum sehen nur die Administratorinnen und Administratoren der Liga."
                ),
                (
                    "Du entscheidest, ob Dein Vorname und der Anfangsbuchstabe Deines Nachnamens auf der Website "
                    "erscheinen: in der Kaderliste Deines Teams, in Aufstellungen und bei Torschützen und Karten. "
                    "Mehr als das steht dort in keinem Fall: nie Dein voller Nachname. Wählst Du „intern“, stehen "
                    "dort nur Deine Nummer und Deine Position, und an der Stelle Deines Namens steht „anonym“. Am "
                    "Mitspielen ändert diese Wahl nichts, und Du kannst sie jederzeit in Deinem Zugang umstellen."
                ),
                (
                    "Unabhängig davon kannst Du erlauben, dass Fotos, Videos und Interviews, die im Rahmen der Liga "
                    "von Dir entstehen, veröffentlicht werden. Diese Erlaubnis ist freiwillig und zunächst "
                    "ausgeschaltet; ohne sie entsteht Dir kein Nachteil, und auch sie kannst Du jederzeit in Deinem "
                    "Zugang zurücknehmen."
                ),
                (
                    "Rechtsgrundlage für die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines "
                    "Nachnamens und für Fotos, Videos und Interviews ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und "
                    "Art. 7 DSGVO). Was wir zur Durchführung des Spielbetriebs brauchen, sind Name, E-Mail-Adresse, "
                    "Nummer, Position, Stufe und Geburtsdatum in der Verwaltung der Liga. Rechtsgrundlage dafür ist "
                    "Deine Teilnahme selbst (Art. 6 Abs. 1 lit. b DSGVO)."
                ),
                (
                    "Bestätigst Du diese Seite nicht innerhalb von sieben Tagen, löschen wir die Registrierung von "
                    "selbst; Du kannst Dich dann über den Link Deines Teams erneut registrieren. Deine Angaben "
                    "behalten wir, bis in der nächsten Saison die Registrierung geschlossen ist. Registrierst Du Dich "
                    "dort wieder mit derselben E-Mail-Adresse, bleiben sie erhalten und Du musst nur Deine Wahl "
                    "bestätigen; andernfalls löschen wir sie dann vollständig."
                ),
                (
                    "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin "
                    "geschehen ist, bleibt rechtmäßig. Du kannst außerdem jederzeit die Löschung aller Deiner Daten "
                    "verlangen (Art. 17 DSGVO): direkt in Deinem Zugang über „{loeschung}“ oder mit einer formlosen "
                    "E-Mail an {kontakt}. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}."
                ),
                "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
                ("dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,"),
                (
                    "dass Du in die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens so "
                    "einwilligst, wie Du es oben gewählt hast, und in Fotos, Videos und Interviews nur, wenn Du den "
                    "Schalter eingeschaltet hast,"
                ),
                "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
            ),
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Vorname und erster Buchstabe des Nachnamens",
                    "intern": "Intern: nur Nummer und Position, ohne Namen",
                }
            ),
        ),
        "2026-09-spielerseite-2": Fassung(
            seite="bestaetigung_spieler",
            gilt_ab=date(2026, 9, 24),
            absaetze=(
                (
                    "Du hast Dich über den Link Deines Teams {team} ({schule}) für die Saison {saison} der Frankfurt "
                    "League registriert. Auf dieser Seite bestätigst Du diese Registrierung und entscheidest, was wir "
                    "mit Deinen Angaben tun dürfen. Erst danach kann Dein Team Dich in seinen Kader aufnehmen."
                ),
                (
                    "Gespeichert sind Dein Vorname, Dein Nachname, Deine E-Mail-Adresse, Deine Rückennummer, Deine "
                    "Position und Deine Stufe sowie das Geburtsdatum, das Du gleich hier einträgst. Deine "
                    "E-Mail-Adresse ist zugleich Dein Zugang zur Website: Du meldest Dich damit ohne Passwort an und "
                    "siehst dort jederzeit, was wir über Dich gespeichert haben."
                ),
                (
                    "Mitspielen kann nur, wer mindestens {minAlter} Jahre alt ist. Das prüfen wir an dem "
                    "Geburtsdatum, das Du hier einträgst; niemand hat es vorher für Dich angegeben. Ein falsches "
                    "Geburtsdatum beendet die Teilnahme: Wir schließen den Zugang, und mit dieser E-Mail-Adresse ist "
                    "für fünf volle Saisons keine neue Registrierung möglich."
                ),
                (
                    "Trainerin oder Trainer, Ansprechperson und Stellvertretung Deines Teams sehen Deinen Namen, "
                    "Deine Nummer, Deine Position und Deine Stufe, entscheiden über die Aufnahme in den Kader und "
                    "können Nummer, Position, Stufe und die Kapitänsrolle anpassen. Deine E-Mail-Adresse und Dein "
                    "Geburtsdatum sehen nur die Administratorinnen und Administratoren der Liga."
                ),
                (
                    "Du entscheidest, ob Dein Vorname und der Anfangsbuchstabe Deines Nachnamens auf der Website "
                    "erscheinen: in der Kaderliste Deines Teams, in Aufstellungen und bei Torschützen und Karten. "
                    "Mehr als das steht dort in keinem Fall: nie Dein voller Nachname. Wählst Du „intern“, stehen "
                    "dort nur Deine Nummer und Deine Position, und an der Stelle Deines Namens steht „anonym“. Am "
                    "Mitspielen ändert diese Wahl nichts, und Du kannst sie jederzeit in Deinem Zugang umstellen."
                ),
                (
                    "Unabhängig davon kannst Du ab {medienMinAlter} Jahren erlauben, dass Fotos, Videos und "
                    "Interviews, die im Rahmen der Liga von Dir entstehen, auf unserer Website und unserem "
                    "Instagram-Kanal veröffentlicht werden. Bist Du jünger, fragen wir Dich das nicht, und wir "
                    "veröffentlichen keine Fotos oder Videos, auf denen Du zu erkennen bist, und keine Interviews mit "
                    "Dir. Diese Erlaubnis ist freiwillig und zunächst ausgeschaltet; ohne sie entsteht Dir kein "
                    "Nachteil, und auch sie kannst Du jederzeit in Deinem Zugang zurücknehmen."
                ),
                (
                    "Rechtsgrundlage für die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines "
                    "Nachnamens und für Fotos, Videos und Interviews ist Deine Einwilligung (Art. 6 Abs. 1 lit. a und "
                    "Art. 7 DSGVO). Was wir zur Durchführung des Spielbetriebs brauchen, sind Name, E-Mail-Adresse, "
                    "Nummer, Position, Stufe und Geburtsdatum in der Verwaltung der Liga. Rechtsgrundlage dafür ist "
                    "unser berechtigtes Interesse, den Spielbetrieb der Liga durchzuführen (Art. 6 Abs. 1 lit. f "
                    "DSGVO)."
                ),
                (
                    "Bestätigst Du diese Seite nicht innerhalb von sieben Tagen, löschen wir die Registrierung von "
                    "selbst; Du kannst Dich dann über den Link Deines Teams erneut registrieren. Deine Angaben "
                    "behalten wir, bis in der nächsten Saison die Registrierung geschlossen ist. Registrierst Du Dich "
                    "dort wieder mit derselben E-Mail-Adresse, bleiben sie erhalten und Du musst nur Deine Wahl "
                    "bestätigen; andernfalls löschen wir sie dann vollständig."
                ),
                (
                    "Du kannst jede Einwilligung jederzeit zurücknehmen (Art. 7 Abs. 3 DSGVO); was bis dahin "
                    "geschehen ist, bleibt rechtmäßig. Du kannst außerdem jederzeit die Löschung aller Deiner Daten "
                    "verlangen (Art. 17 DSGVO): direkt in Deinem Zugang über „{loeschung}“ oder mit einer formlosen "
                    "E-Mail an {kontakt}. Alle Deine Rechte und wie Du sie ausübst, stehen in der {datenschutz}."
                ),
                (
                    "Der Verarbeitung für den Spielbetrieb kannst Du jederzeit aus Gründen widersprechen, die sich "
                    "aus Deiner besonderen Situation ergeben (Art. 21 DSGVO)."
                ),
                "dass Du {vorname} bist und diese E-Mail-Adresse Dir gehört,",
                ("dass Du mindestens {minAlter} Jahre alt bist, was wir an dem Geburtsdatum prüfen, das Du hier einträgst,"),
                (
                    "dass Du in die Veröffentlichung Deines Vornamens und des Anfangsbuchstabens Deines Nachnamens so "
                    "einwilligst, wie Du es oben gewählt hast, und in Fotos, Videos und Interviews nur, wenn Du den "
                    "Schalter eingeschaltet hast,"
                ),
                "dass Du diese Hinweise und die Datenschutzerklärung lesen konntest.",
            ),
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Vorname und erster Buchstabe des Nachnamens",
                    "intern": "Intern: nur Nummer und Position, ohne Namen",
                }
            ),
        ),
        "2026-09-spielerseite-3": Fassung(
            seite="bestaetigung_spieler",
            gilt_ab=date(2026, 10, 3),
            absaetze=tuple(_SPIELERSEITE_3.values()),
            absaetze_nach_schluessel=_SPIELERSEITE_3,
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Vorname und erster Buchstabe des Nachnamens",
                    "intern": "Intern: nur Nummer und Position, ohne Namen",
                }
            ),
        ),
        "2026-10-spielerseite-4": Fassung(
            seite="bestaetigung_spieler",
            gilt_ab=date(2026, 10, 6),
            absaetze=tuple(_SPIELERSEITE_4.values()),
            absaetze_nach_schluessel=_SPIELERSEITE_4,
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Vorname und erster Buchstabe des Nachnamens",
                    "intern": "Intern: nur Nummer und Position, ohne Namen",
                }
            ),
        ),
        "2026-10-spielerseite-wiederkehrend": Fassung(
            seite="bestaetigung_spieler_wiederkehrend",
            gilt_ab=date(2026, 10, 6),
            absaetze=tuple(_SPIELERSEITE_WIEDERKEHREND.values()),
            absaetze_nach_schluessel=_SPIELERSEITE_WIEDERKEHREND,
            # The new pupil page's, offered nothing here: the page labels the choices it shows back with them.
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Vorname und erster Buchstabe des Nachnamens",
                    "intern": "Intern: nur Nummer und Position, ohne Namen",
                }
            ),
        ),
        "2026-10-konto-spieler": Fassung(
            seite="konto_spieler",
            gilt_ab=date(2026, 10, 6),
            absaetze=tuple(_KONTO_SPIELER.values()),
            absaetze_nach_schluessel=_KONTO_SPIELER,
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Vorname und erster Buchstabe des Nachnamens",
                    "intern": "Intern: nur Nummer und Position, ohne Namen",
                }
            ),
        ),
        "2026-10-konto-schiedsrichter": Fassung(
            seite="konto_schiedsrichter",
            gilt_ab=date(2026, 10, 6),
            absaetze=tuple(_KONTO_SCHIEDSRICHTER.values()),
            absaetze_nach_schluessel=_KONTO_SCHIEDSRICHTER,
            schalter=_MEDIEN_SCHALTER,
            bedienelemente=MappingProxyType(
                {
                    "kader_oeffentlich": "Erster Namensteil und Anfangsbuchstabe des nächsten",
                    "intern": "Intern: dort steht „anonym“",
                }
            ),
        ),
        "2026-10-konto-kontakt": Fassung(
            seite="konto_kontakt",
            gilt_ab=date(2026, 10, 6),
            absaetze=tuple(_KONTO_KONTAKT.values()),
            absaetze_nach_schluessel=_KONTO_KONTAKT,
            schalter=_MEDIEN_SCHALTER,
            # A switch's words, keyed by the scope it writes when on: off writes `kontaktdaten`, which has none.
            bedienelemente=MappingProxyType({"kontaktdaten_whatsapp": "Die Liga darf mich auch über WhatsApp erreichen."}),
        ),
    }
)


# The label each page stamps on a new acceptance, the one
# `fl_backend/app/api/einwilligung/services.py :: find_fassung_refusal` admits, one for every `Seite`.
LAUFENDE_FASSUNGEN: Final[Mapping[Seite, str]] = MappingProxyType(
    {
        "bewerbung": "2026-09-bestaetigung-5",
        "bestaetigung_kontakt": "2026-10-bestaetigungsseite-7",
        "bestaetigung_kontakt_verwaltung": "2026-10-bestaetigungsseite-verwaltung",
        "bestaetigung_kontakt_saison": "2026-10-bestaetigungsseite-saison",
        "bestaetigung_spieler": "2026-10-spielerseite-4",
        "bestaetigung_spieler_wiederkehrend": "2026-10-spielerseite-wiederkehrend",
        "bestaetigung_schiedsrichter": "2026-09-schiedsrichterseite-3",
        "konto_spieler": "2026-10-konto-spieler",
        "konto_schiedsrichter": "2026-10-konto-schiedsrichter",
        "konto_kontakt": "2026-10-konto-kontakt",
    }
)
