import Link from "next/link";

import { LINK_VALIDITY_MINUTES } from "@/core/authEmail";
import { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME } from "@/core/brand";
import { ADMIN_WINDOW_HOURS, SESSION_EXPIRES_IN_DAYS } from "@/core/sessionLifetimes";
import {
  BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
  BEWERBUNG_MAX_ALTER,
  BEWERBUNG_MIN_ALTER,
  VERTRETUNG_MIN_ALTER,
} from "@/features/bewerbungen/constants";
import { MEDIEN_MIN_ALTER, REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE, REGISTRIERUNG_MIN_ALTER } from "@/features/registrierungen/constants";
import { SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE } from "@/features/schiedsrichter/constants";
import { card } from "@/shared/components/ui/card";
import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { textLink } from "@/shared/components/ui/textLink";

import { LegalSection } from "../ui/LegalSection";

import type { ReactNode } from "react";

/** One legal paragraph. Spelled once because the page is nothing but paragraphs, and a copy per section drifts. */
const ABSATZ = "fluid-sm text-foreground leading-relaxed font-medium text-pretty";

/**
 * Hand-set, the way `fl_frontend/src/app/sitemap.ts :: CONTENT_LAST_MODIFIED` is: a live `new Date()`
 * is a dynamic read, which would take this page off the static shell.
 */
const STAND = "23. September 2026";

/** Every recipient outside the league, as one card each: a recipient's facts, read as a table, are a row nothing can wrap at 375px. */
const EMPFAENGER = [
  {
    name: "Hetzner Online GmbH",
    rolle: "Auftragsverarbeiter",
    inhalt: "Alles, was auf dem Server liegt oder ihn erreicht, samt Zugriffsprotokoll",
    ort: "Nürnberg, Deutschland",
    vereinbarung: "Auftragsverarbeitungsvertrag nach Art. 28 DSGVO",
  },
  {
    name: "Cloudflare, Inc.",
    rolle: "Auftragsverarbeiter",
    inhalt: "Jede Anfrage im Klartext: Adresse, aufgerufene Seite, Kopfzeilen, Formularinhalte",
    ort: "Weltweit, am nächsten Rand des Netzes; Sitz in den Vereinigten Staaten",
    vereinbarung: "Standardvereinbarung, in die Nutzungsbedingungen einbezogen; Übermittlung nach dem EU-US Data Privacy Framework",
  },
  {
    name: "MongoDB, Inc.",
    rolle: "Auftragsverarbeiter",
    inhalt: "Die gesamte Datenbank und ihre Sicherungskopien",
    ort: "Frankfurt am Main",
    vereinbarung: "Standardvereinbarung, in die Cloud-Bedingungen einbezogen",
  },
  {
    name: "Resend (Plus Five Five, Inc.)",
    rolle: "Auftragsverarbeiter",
    inhalt: "Empfängeradresse, Betreff und Inhalt jeder versendeten E-Mail, dazu eine Zuordnungskennung",
    ort: "Vereinigte Staaten",
    vereinbarung: "Auftragsverarbeitungsvertrag mit Standardvertragsklauseln; zertifiziert nach dem EU-US Data Privacy Framework",
  },
  {
    name: "Proton AG",
    rolle: "Anbieter des Postfachs der Liga",
    inhalt: "Jede an die Liga gerichtete Nachricht und jede Antwort",
    ort: "Schweiz",
    vereinbarung: "Keiner auf dem genutzten privaten Tarif",
  },
  {
    name: "Google (Gmail)",
    rolle: "Anbieter privater Konten",
    inhalt: "Liga-Post, die ein Mitglied in seinem privaten Gmail-Konto öffnet",
    ort: "Nicht festgelegt",
    vereinbarung: "Keiner, weil ein privates Konto keinen vorsieht",
  },
  {
    name: "WhatsApp Ireland Limited",
    rolle: "Anbieter der Messenger-App",
    inhalt: "Telefonnummer und Nachrichten der Personen, denen wir dort einzeln schreiben oder die uns dort schreiben",
    ort: "Irland; WhatsApp übermittelt Daten nach dem EU-US Data Privacy Framework an seine Muttergesellschaften in den Vereinigten Staaten",
    vereinbarung: "Keiner für die gewöhnliche App",
  },
  {
    name: "Meta (Instagram)",
    rolle: "Anbieter der Plattform Instagram, für seine eigene Verarbeitung selbst verantwortlich",
    inhalt: "Fotos, Videos und Interviews, die wir auf dem Instagram-Kanal der Liga veröffentlichen (Abschnitt 9)",
    ort: "Nicht festgelegt; die Muttergesellschaft Meta Platforms, Inc. in den Vereinigten Staaten ist nach dem EU-US Data Privacy Framework zertifiziert",
    vereinbarung: "Keiner; es gelten die Nutzungsbedingungen von Instagram",
  },
];

/** What is published, against the basis it rests on. */
const VEROEFFENTLICHT = [
  {
    was: "Name des Teams und Name der Schule",
    grundlage:
      "Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, den Spielbetrieb der Liga durchzuführen und öffentlich zu zeigen, wer mitspielt",
  },
  {
    was: "Straßenanschrift der Schule als Anschrift des Teams",
    grundlage:
      "Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, zu zeigen, welche Schule hinter einem Team steht und wo sie liegt; das Bewerbungsformular sagt es vorher",
  },
  {
    was: "Spielpläne, Spieltage, Spielorte, Ergebnisse und Tabellen",
    grundlage:
      "Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, den Spielbetrieb der Liga durchzuführen und seine Spiele und Ergebnisse öffentlich zu machen",
  },
  {
    was: "Kaderlisten: Vorname und erster Buchstabe des Nachnamens, sofern die Person dafür eine Einwilligung erteilt hat",
    grundlage: "Art. 6 Abs. 1 lit. a DSGVO, mit ausdrücklicher Einwilligung",
  },
  {
    was: "Schiedsrichterinnen und Schiedsrichter an einem Spiel: erster Namensteil und, wenn ein weiterer eingetragen ist, dessen Anfangsbuchstabe",
    grundlage: "Art. 6 Abs. 1 lit. f DSGVO, Durchführung und Darstellung des Spielbetriebs der Liga",
  },
  {
    was: "Vornamen der Organisatorinnen und Organisatoren auf der Seite „Organisation“",
    grundlage: "Art. 6 Abs. 1 lit. a DSGVO, mit ausdrücklichem Einverständnis",
  },
  {
    was: `Fotos und Videos von Spielerinnen, Spielern, Schiedsrichterinnen und Schiedsrichtern ab ${String(MEDIEN_MIN_ALTER)} Jahren, auf denen die Person zu erkennen ist, und Interviews mit ihr, nur wenn sie den Schalter dafür eingeschaltet hat; veröffentlicht auf dieser Website und auf dem Instagram-Kanal der Liga`,
    grundlage: "Art. 6 Abs. 1 lit. a DSGVO, mit ausdrücklicher Einwilligung; Zweck ist, über die Liga zu berichten",
  },
  {
    was: "Notizen zu einem Spiel, der Grund für den Rückzug eines Teams und die Beschreibung eines Teams, als Freitext",
    grundlage:
      "Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, über Spiele und Rückzüge zu berichten und Teams sich vorstellen zu lassen; das Eingabefeld weist darauf hin",
  },
];

/** What is kept, and for how long. */
const FRISTEN = [
  {
    daten: "Bewerbung, bei der nicht alle Kontaktpersonen bestätigt haben",
    frist: `${String(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)} Tage ab dem Versand der Bestätigungslinks, dann Löschung; ein Ersatzlink setzt die Frist für die ganze Bewerbung neu, eine Erinnerung nicht. Ist die Adresse der Ansprechperson dauerhaft nicht erreichbar, bleibt die Bewerbung stehen, bis die Verwaltung eine erreichbare Adresse einträgt oder über die Bewerbung entscheidet, längstens bis zum Ende der beworbenen Saison; die angekündigte Löschung ginge sonst an niemanden`,
  },
  { daten: "Abgelehnte Bewerbung samt den Daten der drei Kontaktpersonen", frist: "1 Monat nach der Entscheidung" },
  {
    daten: "Angenommene Bewerbung samt den Daten der drei Kontaktpersonen",
    frist: "Bis zum Ende der Saison, die auf die beworbene Saison folgt",
  },
  {
    daten: "Bewerbung, über die nicht entschieden wurde, samt den Daten der drei Kontaktpersonen",
    frist: "Bis zum Ende der beworbenen Saison",
  },
  {
    daten: "Registrierung eines Spielers oder einer Spielerin",
    frist: `${String(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)} Tage ab dem Versand des Bestätigungslinks, wenn die Registrierung nicht bestätigt wird, dann Löschung; eine Erinnerung verschiebt diese Frist nicht. Bestätigte Registrierungen behalten wir, bis in der nächsten Saison die Registrierung geschlossen ist, und löschen sie dann, sofern nicht dieselbe E-Mail-Adresse sich dort wieder registriert hat. Eine abgelehnte Registrierung löschen wir einen Monat nach der Entscheidung`,
  },
  { daten: "Kontaktdaten der Kontaktpersonen einer Saison", frist: "Dieselbe Frist wie die angenommene Bewerbung" },
  {
    daten: "Registrierungslink eines Teams: der Link als unlesbarer Schlüssel, dazu das Datum und die anlegende Person aus der Verwaltung",
    frist:
      "Kein eigener Zeitraum: Der Link endet mit der Registrierungsfrist der Saison, für die er gilt, oder sobald die Verwaltung ihn zurückzieht oder durch einen neuen ersetzt. Der Eintrag dazu enthält den Link nur als unlesbaren Schlüssel, nennt keine Spielerin und keinen Spieler und bleibt mit dem Datum und der E-Mail-Adresse der Person aus der Verwaltung, die ihn angelegt hat, bestehen.",
  },
  { daten: "Geburtsdatum einer Kontaktperson", frist: "Entsteht erst mit ihrer Bestätigung, dann dieselbe Frist wie die Bewerbung" },
  {
    daten:
      "Bestätigung einer Schiedsrichterin oder eines Schiedsrichters: Geburtsdatum, die beiden Antworten (Veröffentlichung, Medien) und die Fassung des Textes; dazu der Bestätigungslink als unlesbarer Schlüssel mit Versanddatum und Frist",
    frist: `Solange der Eintrag besteht: Die Angaben gehen mit dem Eintrag. Der Link gilt ${String(SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE)} Tage ab dem Versand, wird durch jeden neuen Link ersetzt und mit dem Eintrag gelöscht`,
  },
  {
    daten: "Gesperrte E-Mail-Adresse, als unlesbarer Schlüssel, dazu der Grund, das Datum und die eintragende Person aus der Verwaltung",
    frist:
      "Fünf volle Saisons nach der Saison des Eintrags; danach wird der Eintrag bei der nächsten Saisonaktivierung von selbst gelöscht. Die Verwaltung kann die Sperre jederzeit vorher aufheben. Bis dahin bleibt der Eintrag auch bestehen, wenn die übrigen Daten gelöscht werden",
  },
  {
    daten: "Anmeldung zur Verwaltung: E-Mail-Adresse, Anmeldelink, Sitzung und Passkey",
    // Each figure read off the constant the sign-in enforces, never typed: a copy typed here is a
    // promise nothing keeps.
    frist: `Ein Anmeldelink gilt ${String(LINK_VALIDITY_MINUTES)} Minuten und wird danach gelöscht; das gilt auch für eine Adresse, die jemand ohne Zugang in das Anmeldeformular einträgt. Eine Sitzung läuft ab, wenn sie ${String(SESSION_EXPIRES_IN_DAYS)} Tage lang nicht genutzt wurde; für die Verwaltung gilt sie höchstens ${String(ADMIN_WINDOW_HOURS)} Stunden. Adresse und Passkey einer Administratorin oder eines Administrators bleiben, solange der Zugang besteht, und werden auf Wunsch gelöscht`,
  },
  {
    daten: "Änderungsprotokoll der Verwaltung",
    frist: "12 Monate ab dem Eintrag; am Ende dieser Saison wird das Protokoll einmalig vollständig gelöscht",
  },
  {
    daten: "Zugriffsprotokoll des Servers",
    frist: "Höchstens acht Tage; gelöscht wird beim Wechsel der Protokolldatei, einmal täglich und früher bei Erreichen der Größengrenze",
  },
  {
    daten: "Betriebsprotokoll der Anwendung",
    frist: "Begrenzt durch eine feste Gesamtgröße; die bei jeder Auslieferung angelegte Kopie wird nach 30 Tagen gelöscht",
  },
  { daten: "Sicherungskopien der Datenbank", frist: "Etwa 8 Tage" },
  {
    daten: "Daten von Spielerinnen, Spielern und Schiedsrichtern",
    frist:
      "Bei Spielerinnen und Spielern: solange die Teilnahme läuft, und darüber hinaus bis zu einer Löschung auf Wunsch; am Ende dieser Saison löschen wir einmalig die Daten aller Spielerinnen und Spieler. Bei Schiedsrichterinnen und Schiedsrichtern: bis die Verwaltung den Eintrag endgültig löscht, von sich aus oder weil Du es verlangst",
  },
];

/** A `<dl>` is this pair's only valid parent: the pairing is what makes the value a fact about the label. */
function Angabe({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <dt className="fluid-xxs text-foreground-muted font-bold">{label}</dt>
      <dd className="fluid-sm text-foreground min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

function MailLink() {
  return (
    <Link
      href={`mailto:${KONTAKT_EMAIL}`}
      className={textLink()}>
      {KONTAKT_EMAIL}
    </Link>
  );
}

export function DatenschutzView() {
  return (
    <div className={`${PAGE_RISE} flex w-full flex-col gap-6`}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING} fluid-3xl`}>Datenschutzerklärung</h1>
      </header>

      <article className={`${card()} flex w-full flex-col gap-y-6 p-4 sm:p-6 lg:gap-y-8 lg:p-8`}>
        <LegalSection title="Kurz gesagt">
          <ul className="flex list-disc flex-col gap-y-2 pl-5">
            <li className={ABSATZ}>
              Für die Teilnahme an der Frankfurt League brauchen wir ein paar Daten von Dir. Mehr als nötig fragen wir nicht ab.
            </li>
            <li className={ABSATZ}>
              Wenn Du bei uns mitspielst oder pfeifst und Dein Name auf dieser Website steht, dann als Vorname und erster Buchstabe des
              Nachnamens; wie das bei Schiedsrichterinnen und Schiedsrichtern genau aussieht, steht in Abschnitt 10.
            </li>
            <li className={ABSATZ}>
              Mitspielen, Pfeifen und Kontaktperson einer Bewerbung sein kann nur, wer mindestens {REGISTRIERUNG_MIN_ALTER} Jahre alt ist; als
              Ansprechperson oder Stellvertretung mindestens {VERTRETUNG_MIN_ALTER}.
            </li>
            <li className={ABSATZ}>
              Wir messen nicht, was Du auf dieser Website tust. Es gibt keine Analyse, kein Tracking, keine Werbung und kein Profiling.
            </li>
            <li className={ABSATZ}>
              Auskunft, Berichtigung, Löschung, Widerspruch, Widerruf: Eine E-Mail an <MailLink /> genügt. Begründen musst Du nur einen
              Widerspruch, und zwar mit Deiner besonderen Situation (Abschnitt 14).
            </li>
          </ul>
        </LegalSection>

        <LegalSection title="1. Wer verantwortlich ist">
          <p className={ABSATZ}>Verantwortlich für die Verarbeitung Deiner Daten auf dieser Website ist:</p>
          <p className={ABSATZ}>
            {VEREIN_NAME}
            <br />
            {VEREIN_ANSCHRIFT}
            <br />
            E-Mail: <MailLink />
          </p>
          <p className={ABSATZ}>Vertreten wird der Verein durch seinen Vorstand; jeweils zwei Vorstandsmitglieder vertreten ihn gemeinsam.</p>
          <p className={ABSATZ}>
            Der Verein ist im Vereinsregister des Amtsgerichts Frankfurt am Main unter VR 17757 eingetragen. Eine Telefonnummer für den Verein
            gibt es nicht; wir sind über die E-Mail-Adresse oben erreichbar.
          </p>
        </LegalSection>

        <LegalSection title="2. Wohin Deine Datenschutzanfrage geht">
          <p className={ABSATZ}>
            An <MailLink />. Diese eine Adresse gilt für alles: Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit,
            Widerspruch und den Widerruf einer Einwilligung. Du musst kein Formular ausfüllen, und ein formloser Satz reicht. Einen Grund nennst
            Du nur bei einem Widerspruch: Deine besondere Situation (Abschnitt 14).
          </p>
        </LegalSection>

        <LegalSection title="3. Hosting, Zugriffsdaten und Auslieferung">
          <p className={ABSATZ}>
            Die Website läuft auf einem Server der Hetzner Online GmbH in einem Rechenzentrum in Nürnberg. Hetzner verarbeitet die Daten für uns
            als Auftragsverarbeiter nach Art. 28 DSGVO.
          </p>
          <p className={ABSATZ}>
            Vor diesem Server steht Cloudflare, Inc. als Proxy. Jede Anfrage an diese Website läuft zuerst über Cloudflare, und zwar
            unverschlüsselt an dieser Stelle: Deine IP-Adresse, die aufgerufene Adresse, die technischen Kopfzeilen Deines Browsers und der
            Inhalt jedes abgeschickten Formulars sind dort sichtbar. Cloudflare betreibt sein Netz weltweit, und welcher Standort Deine Anfrage
            annimmt, richtet sich nach Deinem Aufenthaltsort. Grundlage ist die Standardvereinbarung zur Auftragsverarbeitung, die Cloudflare in
            seine Nutzungsbedingungen einbezieht. Cloudflare, Inc. hat seinen Sitz in den Vereinigten Staaten, und Deine Anfrage kann auch an
            einem Standort außerhalb der EU angenommen werden. Das ist eine Übermittlung in ein Drittland. Sie stützt sich auf den
            Angemessenheitsbeschluss der Europäischen Kommission zum EU-US Data Privacy Framework (Durchführungsbeschluss (EU) 2023/1795, Art.
            45 DSGVO). Nach diesem Framework ist Cloudflare zertifiziert; entfällt die Zertifizierung, gelten die Standardvertragsklauseln der
            Europäischen Kommission (Art. 46 Abs. 2 lit. c DSGVO). Eine Kopie der Klauseln schicken wir Dir auf Anfrage an <MailLink />. Wie
            lange Cloudflare selbst Angaben zu Deiner Anfrage aufbewahrt, legt Cloudflare fest; wir können das nicht einstellen.
          </p>
          <p className={ABSATZ}>
            Bei jedem Aufruf entsteht ein Eintrag im Zugriffsprotokoll des Servers. Er enthält Deine IP-Adresse, den Zeitpunkt, die aufgerufene
            Seite, den Statuscode der Antwort, die Kennung Deines Browsers und die Seite, von der Du gekommen bist. Der Bestand ist nach dem
            Alter begrenzt: ein Eintrag bleibt höchstens acht Tage. Gelöscht wird beim Wechsel der Protokolldatei: einmal täglich, und früher,
            wenn die Datei vorher ihre Größengrenze erreicht. Die Einträge werden nicht ausgewertet, nicht mit anderen Daten zusammengeführt und
            an keinen Auswertungsdienst weitergegeben.
          </p>
          <p className={ABSATZ}>
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist der sichere und stabile Betrieb der Website und die
            Abwehr von Angriffen; ohne diese Einträge lässt sich ein Angriff weder erkennen noch nachvollziehen. Dem steht Dein Interesse
            gegenüber, nicht ohne Anlass erfasst zu werden. Wir halten Dein Interesse für gewahrt, weil niemand die Einträge zu einem
            Nutzungsprofil verbindet, sie ausschließlich technischen Zwecken dienen und kein Eintrag länger als acht Tage bleibt. Du kannst
            dieser Verarbeitung nach Art. 21 DSGVO widersprechen; Abschnitt 14 sagt, wie. Das Betriebsprotokoll der Anwendung verarbeiten wir
            auf derselben Grundlage und zu demselben Zweck; wie lange es bleibt, steht in Abschnitt 13.
          </p>
        </LegalSection>

        <LegalSection title="4. Datenbank und Sicherungskopien">
          <p className={ABSATZ}>
            Die Daten der Liga liegen in einer verwalteten Datenbank bei MongoDB, Inc. (MongoDB Atlas). Der Cluster steht in Frankfurt am Main.
            Grundlage ist die Standardvereinbarung zur Auftragsverarbeitung, die MongoDB in seine Cloud-Bedingungen einbezieht.
          </p>
          <p className={ABSATZ}>
            Von dieser Datenbank werden täglich Sicherungskopien angelegt, die etwa acht Tage aufbewahrt und dann überschrieben werden. Sie
            liegen in derselben Region wie der Cluster. Wenn wir Daten auf Deinen Wunsch löschen, sind sie aus der laufenden Datenbank sofort
            verschwunden; in den Sicherungskopien laufen sie innerhalb dieser acht Tage aus.
          </p>
        </LegalSection>

        <LegalSection title="5. E-Mail-Versand">
          <p className={ABSATZ}>
            Alle E-Mails der Liga versenden wir über Resend. Unser Vertragspartner dafür ist die Plus Five Five, Inc. mit Sitz in den
            Vereinigten Staaten, die den Dienst unter diesem Namen betreibt. Absender ist no-reply@frankfurtleague.de. Zu Resend gelangen die
            Empfängeradresse, der Betreff, der vollständige Inhalt der Nachricht und eine Kennung, mit der wir eine Zustellmeldung dem Eintrag
            zuordnen, um den es geht.
          </p>
          <p className={ABSATZ}>
            Resend speichert diese Daten in den Vereinigten Staaten. Das ist eine Übermittlung in ein Drittland. Sie stützt sich auf die
            Standardvertragsklauseln der Europäischen Kommission nach Art. 46 Abs. 2 lit. c DSGVO, die Bestandteil des
            Auftragsverarbeitungsvertrags mit Resend sind; außerdem ist das Unternehmen nach dem EU-US Data Privacy Framework zertifiziert
            (Durchführungsbeschluss (EU) 2023/1795, Art. 45 DSGVO). Eine Kopie der Klauseln schicken wir Dir auf Anfrage an <MailLink />.
          </p>
          <p className={ABSATZ}>
            Wir messen nicht, ob eine E-Mail geöffnet oder ob ein Link darin angeklickt wird. Unsere Nachrichten enthalten dafür weder ein
            Zählpixel noch umgeschriebene Links.
          </p>
          <p className={ABSATZ}>
            Resend meldet uns aber zurück, was mit der Zustellung selbst geschehen ist: ob eine Nachricht angenommen, zugestellt oder verzögert
            wurde, ob sie unzustellbar war, ob Resend sie zurückgehalten hat und ob sie als Spam gemeldet wurde. Diesen Zustellstand speichern
            wir bei dem Eintrag, um den es in der Nachricht geht. So sieht die Verwaltung, wen sie nicht erreicht. Rechtsgrundlage ist Art. 6
            Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, zu erkennen, wen unsere Nachrichten nicht erreichen. Der Zustellstand wird
            zusammen mit diesem Eintrag gelöscht; beim Registrierungslink eines Teams, dessen Eintrag bestehen bleibt (Abschnitt 13), bleibt er
            bestehen.
          </p>
        </LegalSection>

        <LegalSection title="6. Wenn eine Schule sich bewirbt">
          <p className={ABSATZ}>
            Über das Bewerbungsformular kann eine Schule ihre Aufnahme in die Liga beantragen. Als Kontaktperson eingetragen werden darf, wer
            mindestens {BEWERBUNG_MIN_ALTER} Jahre alt ist; als Ansprechperson oder Stellvertretung nur, wer mindestens {VERTRETUNG_MIN_ALTER}{" "}
            Jahre alt ist.
          </p>
          <p className={ABSATZ}>Was in das Formular eingetragen wird:</p>
          <ul className="flex list-disc flex-col gap-y-2 pl-5">
            <li className={ABSATZ}>
              Angaben zur Schule: Kurzname des Teams, vollständiger Name der Schule, zweistelliges Kürzel, Schulform, Straßenanschrift und,
              falls vorhanden, die Website der Schule.
            </li>
            <li className={ABSATZ}>
              Angaben zum Trikotsatz, zur voraussichtlichen Kadergröße und zur Größe des Abi-Jahrgangs, aus dem das Team kommt.
            </li>
            <li className={ABSATZ}>Ein freies Feld für einen Wunschgegner.</li>
            <li className={ABSATZ}>
              Drei Kontaktpersonen, nämlich Ansprechperson, Stellvertretung und Trainer, jeweils mit Vorname, Nachname, E-Mail-Adresse und
              Telefonnummer. Eine Person kann zwei dieser Rollen ausfüllen. Das Geburtsdatum fragt das Formular nicht ab; jede der drei Personen
              trägt es selbst auf ihrer Bestätigungsseite ein.
            </li>
          </ul>
          <p className={ABSATZ}>
            Freiwillig sind nur die Website der Schule, die Angabe zu vorhandenen Trikotsätzen und der Wunschgegner. Alles andere brauchen wir,
            um über die Bewerbung zu entscheiden; ohne diese Angaben lässt sich das Formular nicht abschicken.
          </p>
          <p className={ABSATZ}>
            Die Anschrift der Schule wird öffentlich, sobald die Bewerbung angenommen ist. Sie erscheint dann als Anschrift des Teams auf dessen
            Seite. Das Formular sagt das an der Stelle, an der die Anschrift eingetragen wird.
          </p>
          <p className={ABSATZ}>
            Jede der drei Kontaktpersonen bekommt eine eigene E-Mail mit einem persönlichen Link. Über diesen Link bestätigt sie ihren Eintrag
            in der genannten Rolle und trägt dabei ihr Geburtsdatum ein. Das Geburtsdatum erreicht uns also erst an dieser Stelle und von der
            Person selbst; wir prüfen damit, ob sie das Mindestalter ihrer Rolle erreicht: {BEWERBUNG_MIN_ALTER} Jahre für die Trainerin oder
            den Trainer, {VERTRETUNG_MIN_ALTER} Jahre für Ansprechperson und Stellvertretung. Das ist keine Einwilligung, sondern eine
            Bestätigung: Sie belegt, dass die angegebene E-Mail-Adresse zu dieser Person gehört, dass die Person von ihrem Eintrag weiß, dass
            sie dieses Mindestalter erreicht und dass sie diese Datenschutzerklärung zur Kenntnis nehmen konnte. Nach drei Tagen erinnern wir
            einmal. Die Bewerbung bleibt so lange offen, bis alle drei bestätigt haben. Hat vierzehn Tage nach dem Versand dieser E-Mails nicht
            jede Person bestätigt, löschen wir die Bewerbung mit allen Kontaktdaten. Ersetzen wir einen Link durch einen neuen, beginnt diese
            Frist für die ganze Bewerbung von vorn; eine Erinnerung verschiebt sie nicht.
          </p>
          <p className={ABSATZ}>
            Auf derselben Seite steht ein freiwilliger Schalter: Die Liga darf Dich auch über WhatsApp erreichen. Das ist die einzige
            Einwilligung, die wir an dieser Stelle einholen (Art. 6 Abs. 1 lit. a und Art. 7 DSGVO). Sie ist von der Bestätigung getrennt und
            keine Bedingung der Bewerbung; lässt Du den Schalter aus, erreichen wir Dich per E-Mail und, wenn es eilt, telefonisch, und es
            entsteht Dir kein Nachteil. Schaltest Du ihn ein, gelangen Deine Telefonnummer und die Nachrichten, die wir Dir schreiben, zu
            WhatsApp; wir nutzen dort die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Du kannst diese Einwilligung
            jederzeit mit Wirkung für die Zukunft widerrufen, formlos an <MailLink />. Was bis dahin geschah, bleibt rechtmäßig.
          </p>
          <p className={ABSATZ}>
            Rechtsgrundlage für alle Angaben der Bewerbung, zur Schule, zum Team und zu den drei eingetragenen Personen, ist Art. 6 Abs. 1 lit.
            f DSGVO. Unser berechtigtes Interesse ist, den Spielbetrieb der Liga durchzuführen: über die Teilnahme einer Schule zu entscheiden
            und ein Team über die von ihm selbst benannten Personen zu erreichen, ohne die Bewerbung an einer einzigen Adresse hängen zu lassen.
            Die Angaben zu den beiden weiteren Personen erhalten wir von der Person, die die Bewerbung einreicht. Wer eingetragen wird, muss
            damit rechnen, in dieser Rolle benannt zu werden, erfährt davon sofort durch die Bestätigungsmail, wird nie veröffentlicht und kann
            jederzeit die Löschung verlangen oder widersprechen (Abschnitt 14).
          </p>
          <p className={ABSATZ}>
            Wer die Bewerbung sieht: Nur die Administratorinnen und Administratoren der Liga, die dafür angemeldet sein müssen. Eine Bewerbung
            ist über keine öffentliche Adresse abrufbar. Die Kontaktdaten der drei Personen werden zu keinem Zeitpunkt veröffentlicht, auch
            nicht nach der Aufnahme des Teams.
          </p>
          <p className={ABSATZ}>Wie lange wir eine Bewerbung aufbewahren, steht in Abschnitt 13.</p>
        </LegalSection>

        <LegalSection title="7. Wenn Du uns schreibst">
          <p className={ABSATZ}>
            Wenn Du uns an <MailLink /> schreibst, verarbeiten wir Deine Nachricht und Deine Adresse, um zu antworten. Rechtsgrundlage ist Art.
            6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, Anfragen zu beantworten und den Spielbetrieb der Liga durchzuführen. Wir
            löschen die Korrespondenz, sobald sie erledigt ist und keine gesetzliche Aufbewahrungspflicht entgegensteht.
          </p>
          <p className={ABSATZ}>Drei Dinge sagen wir dazu offen, weil sie Dich betreffen:</p>
          <ul className="flex list-disc flex-col gap-y-2 pl-5">
            <li className={ABSATZ}>
              Das Postfach der Liga liegt bei der Proton AG in der Schweiz, auf einem privaten Tarif. Für diesen Tarif besteht kein
              Auftragsverarbeitungsvertrag. Die Schweiz gilt als Land mit einem angemessenen Datenschutzniveau (Entscheidung 2000/518/EG der
              Europäischen Kommission, fortgeltend nach Art. 45 Abs. 9 DSGVO).
            </li>
            <li className={ABSATZ}>
              Einzelne Mitglieder der Liga lesen Liga-Post in ihren privaten Gmail-Konten. Auch dafür besteht kein Auftragsverarbeitungsvertrag,
              weil ein privates Konto keinen vorsieht.
            </li>
            <li className={ABSATZ}>
              WhatsApp ist kein Kanal der Liga. Wir schreiben dort nur einzelnen Personen, die uns ihre Nummer dafür gegeben haben, etwa mit dem
              Schalter in Abschnitt 6, und wer uns dort schreibt, bekommt dort Antwort. Dann gelangen die Telefonnummer und die Nachrichten zu
              WhatsApp; wir nutzen die gewöhnliche App, für die kein Auftragsverarbeitungsvertrag besteht. Nötig ist WhatsApp nie: Per E-Mail
              erreichst Du uns, und wir Dich, immer.
            </li>
          </ul>
        </LegalSection>

        <LegalSection title="8. Wer Deine Daten außer uns bekommt">
          <div
            role="list"
            className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
            {EMPFAENGER.map((empfaenger) => (
              <div
                role="listitem"
                key={empfaenger.name}
                className="border-border flex flex-col gap-y-3 rounded-xl border p-4">
                <div className="fluid-sm text-foreground font-extrabold tracking-wide uppercase">{empfaenger.name}</div>
                <dl className="flex flex-col gap-y-2">
                  <Angabe label="Rolle">{empfaenger.rolle}</Angabe>
                  <Angabe label="Was dorthin gelangt">{empfaenger.inhalt}</Angabe>
                  <Angabe label="Wo">{empfaenger.ort}</Angabe>
                  <Angabe label="Vereinbarung">{empfaenger.vereinbarung}</Angabe>
                </dl>
              </div>
            ))}
          </div>
          <p className={ABSATZ}>
            Darüber hinaus geben wir keine Daten weiter. Es gibt keinen Verkauf, keine Werbepartner und keine Weitergabe an andere Vereine oder
            Verbände.
          </p>
        </LegalSection>

        <LegalSection title="9. Was wir veröffentlichen">
          <dl className="flex flex-col gap-y-3">
            {VEROEFFENTLICHT.map((eintrag) => (
              <Angabe
                key={eintrag.was}
                label={eintrag.was}>
                {eintrag.grundlage}
              </Angabe>
            ))}
          </dl>
          <p className={ABSATZ}>
            Bist Du jünger als {MEDIEN_MIN_ALTER} Jahre, veröffentlichen wir keine Fotos oder Videos, auf denen Du zu erkennen bist, und keine
            Interviews mit Dir.
          </p>
          <p className={ABSATZ}>
            Nicht veröffentlicht werden die Kontaktdaten und Geburtsdaten aller Personen, alles, was eine Registrierung enthält, die
            Kontaktpersonen einer Bewerbung, die Antworten zu Veröffentlichung und Medien, die Stufe einer Spielerin oder eines Spielers sowie
            die Schule und das Honorar einer Schiedsrichterin oder eines Schiedsrichters. Die Stufe ist das Halbjahr der Oberstufe von E1 bis
            Q4.
          </p>
          <p className={ABSATZ}>
            Die vollständigen Namen der Vorstandsmitglieder im Impressum stehen nicht auf der Grundlage aus dieser Aufstellung, sondern weil wir
            als Anbieter dieser Website angeben müssen, wer den Verein vertritt: nach § 18 Abs. 1 MStV und, soweit er für diese Website gilt,
            nach § 5 DDG (Art. 6 Abs. 1 lit. c DSGVO). Diese Namen stehen auch im öffentlich einsehbaren Quellcode dieser Website.
          </p>
          <p className={ABSATZ}>
            Freitexte enthalten das, was jemand hineingeschrieben hat. Eine Notiz an einem Spiel, der Grund für einen Rückzug und die
            Beschreibung eines Teams erscheinen unverändert auf der Website. Wer dort einen Namen einträgt, veröffentlicht ihn. Wenn in einem
            solchen Feld etwas über Dich steht, das dort nicht hingehört, schreib uns; wir nehmen es heraus.
          </p>
          <p className={ABSATZ}>
            Suchmaschinen: Die öffentlichen Seiten dürfen von Suchmaschinen erfasst werden. Die Verwaltungsbereiche und die Schnittstellen sind
            ausgenommen. Den bekannten Sammelprogrammen für KI-Training untersagen wir das Erfassen dieser Website vollständig, und dieselbe
            Sperre gilt am Rand unseres Netzes.
          </p>
        </LegalSection>

        <LegalSection title="10. Spielerinnen, Spieler, Schiedsrichterinnen und Schiedsrichter">
          <p className={ABSATZ}>
            Wer im Kader eines Teams steht, meldet sich über den Link seines Teams selbst an und bestätigt das per E-Mail. Wer ein Spiel pfeift,
            wird von der Verwaltung eingetragen, immer mit E-Mail-Adresse, und bestätigt den Eintrag über einen Link, den wir an diese Adresse
            senden. Vorname und erster Buchstabe des Nachnamens einer Spielerin oder eines Spielers werden nur veröffentlicht, wenn für diese
            Person eine Einwilligung dafür festgehalten ist; ohne sie steht die Person als „anonym“ im Kader. Diese Einwilligung gibst Du
            selbst, auch wenn Du noch nicht volljährig bist. Team, Rückennummer und Position stehen in beiden Fällen dort, soweit sie angegeben
            sind.
          </p>
          <p className={ABSATZ}>
            Rechtsgrundlage für die Daten, die wir für Deine Teilnahme brauchen, ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse
            ist, den Spielbetrieb der Liga durchzuführen: Kader und Schiedsrichtereinsätze zu führen, das Mindestalter zu prüfen und Dich zu
            erreichen. Weil viele, die mitspielen oder pfeifen, noch minderjährig sind, veröffentlichen wir von Spielerinnen und Spielern auf
            dieser Grundlage nichts: Dein Name im Kader erscheint nur mit Deiner Einwilligung (Abschnitt 9). Den Namen einer Schiedsrichterin
            oder eines Schiedsrichters an einem Spiel veröffentlichen wir auf dieser Grundlage, wie Abschnitt 9 es beschreibt. Du kannst
            jederzeit widersprechen oder die Löschung verlangen (Abschnitt 14).
          </p>
          <p className={ABSATZ}>
            Wer sich über den Link eines Teams registriert oder einen Eintrag als Schiedsrichterin oder Schiedsrichter bestätigt, trägt dabei
            das eigene Geburtsdatum ein. Die Angabe ist Pflicht und wird nicht veröffentlicht: Mitspielen und Pfeifen kann nur, wer mindestens{" "}
            {REGISTRIERUNG_MIN_ALTER} Jahre alt ist, und das prüfen wir an diesem Datum. Bei Spielerinnen und Spielern, die schon vor der
            Registrierung im Kader standen, kann die Verwaltung das Geburtsdatum nachtragen.
          </p>
          <p className={ABSATZ}>
            Bei Schiedsrichterinnen und Schiedsrichtern wird der Name als ein Feld erfasst, und an einem Spiel steht davon der erste Namensteil
            und vom nächsten nur der Anfangsbuchstabe. Bei einem Namenszusatz wie „van“ ist das dessen Buchstabe und nicht der des Nachnamens,
            und ist nur ein einzelner Name eingetragen, steht dieser ganz da. Die Kontaktdaten und die Schule bleiben in der Verwaltung der
            Liga.
          </p>
          <p className={ABSATZ}>
            Bei Schiedsrichterinnen und Schiedsrichtern trägt die Verwaltung Name und Kontaktdaten ein, dazu die Schule, wenn es eine gibt, so
            wie Du oder die Person, die Dich uns genannt hat, sie uns mitgeteilt hat. Dazu halten wir das Honorar fest, das Dir für ein Spiel
            zusteht, damit wir wissen, was wir Dir schulden; ausgezahlt wird es außerhalb dieser Website. Wird Dein Eintrag endgültig gelöscht,
            geht Dein üblicher Betrag mit ihm; verlangst Du die Löschung, bleibt an einem Spiel, das schon angesetzt oder gespielt ist, der
            Betrag für dieses Spiel ohne Deinen Namen stehen. Setzt die Verwaltung Dich nur nicht mehr ein, bleibt Dein Eintrag mit dem Betrag
            bestehen.
          </p>
          <p className={ABSATZ}>
            Du kannst jederzeit verlangen, dass Dein Name von dieser Website verschwindet, formlos an <MailLink />. Danach nehmen wir ihn
            innerhalb eines Monats heraus; an einem vergangenen Spiel steht dann ein neutraler Eintrag statt des Namens.
          </p>
        </LegalSection>

        <LegalSection title="11. Cookies und Speicherung in Deinem Browser">
          <p className={ABSATZ}>Diese Website legt in Deinem Browser nur ab, was für ihren Betrieb notwendig ist:</p>
          <ul className="flex list-disc flex-col gap-y-2 pl-5">
            <li className={ABSATZ}>
              Ein Sitzungs-Cookie für angemeldete Administratorinnen und Administratoren. Es entsteht erst bei der Anmeldung und hält die
              Sitzung. Das Cookie selbst läuft ab, wenn die Sitzung {SESSION_EXPIRES_IN_DAYS} Tage lang nicht genutzt wurde; für den Zugang zur
              Verwaltung prüfen wir bei jedem Aufruf zusätzlich, ob die Anmeldung nicht länger als {ADMIN_WINDOW_HOURS} Stunden her ist, und
              verlangen danach eine neue Anmeldung. Wer sich nicht anmeldet, bekommt es nie. Rechtsgrundlage für die Anmeldung zur Verwaltung
              ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, dass nur berechtigte Personen die Verwaltung erreichen.
            </li>
            <li className={ABSATZ}>
              Während eine Administratorin oder ein Administrator einen Passkey einrichtet oder sich damit anmeldet, ein zweites Cookie, das
              diesen einen Vorgang zusammenhält. Es läuft nach fünf Minuten ab.
            </li>
            <li className={ABSATZ}>
              Eine Freigabe von Cloudflare, wenn Du die Anmeldeseite oder das Bewerbungsformular aufrufst. Cloudflare prüft dort mit einer
              kurzen automatischen Abfrage Deines Browsers, ob ein Mensch die Seite aufruft, und legt danach einen Nachweis in Deinem Browser
              ab, damit das Formular abgeschickt werden kann. Der Nachweis gilt höchstens 30 Minuten.
            </li>
            <li className={ABSATZ}>
              Die von Dir gewählte Darstellung, hell oder dunkel. Sie wird im lokalen Speicher Deines Browsers abgelegt, damit die Seite beim
              nächsten Besuch so aussieht, wie Du sie eingestellt hast. Dieser Wert bleibt auf Deinem Gerät und erreicht uns nicht.
            </li>
          </ul>
          <p className={ABSATZ}>
            Was wir selbst ablegen, ist unbedingt erforderlich, um den von Dir gewünschten Dienst bereitzustellen, und deshalb nach § 25 Abs. 2
            Nr. 2 TDDDG einwilligungsfrei. Die Abfrage und die Freigabe von Cloudflare setzen wir ohne Einwilligung ein, weil sie die Anmeldung
            und das Formular vor automatisiertem Missbrauch schützen (§ 25 Abs. 2 Nr. 2 TDDDG). Darüber hinaus wird nichts in Deinem Browser
            abgelegt, und es gibt keinen Cookie-Banner, weil wir für nichts davon eine Einwilligung einholen.
          </p>
          <p className={ABSATZ}>
            Verweise auf Instagram, Threads und GitHub sind gewöhnliche Links und übertragen von sich aus nichts an diese Anbieter. Von diesen
            Anbietern wird nichts in unsere Seiten eingebettet und nichts nachgeladen. Erst wenn Du auf einen dieser Links klickst, erfährt der
            jeweilige Anbieter davon, und ab dann gilt dessen Datenschutzerklärung.
          </p>
        </LegalSection>

        <LegalSection title="12. Keine Analyse, kein Tracking; was automatisch geprüft wird">
          <p className={ABSATZ}>
            Wir setzen keine Analysedienste ein, keine Zählpixel, keine Werbenetzwerke und keine Dienste, die Dich über Websites hinweg
            wiedererkennen. Wir erstellen keine Profile und verkaufen keine Daten.
          </p>
          <p className={ABSATZ}>
            Über eine Bewerbung entscheidet ein Mensch. Von dem, was Du auf dieser Website eintragen kannst, weist sie ohne einen Menschen nur
            zweierlei zurück: ein Geburtsdatum, das Du auf Deiner Bestätigungsseite als Spielerin oder Spieler, als Schiedsrichterin oder
            Schiedsrichter oder als Kontaktperson einer Bewerbung einträgst, wenn es unter dem Mindestalter Deiner Rolle liegt oder ein Alter
            über {BEWERBUNG_MAX_ALTER} Jahren ergibt, und eine E-Mail-Adresse, die gesperrt ist. Beide Zurückweisungen prüft auf Deinen Wunsch
            ein Mensch: Schreib an <MailLink />, dann sieht sich jemand aus der Verwaltung Deinen Fall an und antwortet Dir. Ein
            zurückgewiesenes Geburtsdatum wird nicht gespeichert; war es ein Tippfehler, trägst Du über denselben Link das richtige Datum ein,
            solange er gilt. Liegt Dein Geburtsdatum tatsächlich unter dem Mindestalter, bleibt es auch nach der Prüfung bei der Zurückweisung,
            weil die Liga jede Rolle erst ab ihrem Mindestalter vergibt. Eine Sperre kann die Verwaltung nach der Prüfung aufheben. Ist der
            Kader eines Teams voll, nimmt er keine weitere Registrierung an; das ist eine Grenze des Kaders und keine Entscheidung über Dich.
            Profiling findet nicht statt.
          </p>
        </LegalSection>

        <LegalSection title="13. Wie lange wir was speichern">
          <dl className="flex flex-col gap-y-3">
            {FRISTEN.map((eintrag) => (
              <Angabe
                key={eintrag.daten}
                label={eintrag.daten}>
                {eintrag.frist}
              </Angabe>
            ))}
          </dl>
          {/* Two erasures, so two sentences: a referee's copy on every match survives with the name
              nulled (`docs/glossary.md :: Schiedsrichter`), where a pupil's erasure takes the person and
              their squad rows outright (`:: inactive_since`). */}
          <p className={ABSATZ}>
            Ergebnisse, Tabellen und Spielpläne vergangener Saisons bleiben als Chronik der Liga bestehen. Der Name einer Schiedsrichterin oder
            eines Schiedsrichters an einem vergangenen Spiel wird auf Wunsch gelöscht; dort steht dann ein neutraler Eintrag. Aus den
            Kaderlisten verschwindet der Name einer Spielerin oder eines Spielers dagegen ganz.
          </p>
          <p className={ABSATZ}>
            Das Änderungsprotokoll: Jede Änderung an den Daten der Liga wird mit dem vorherigen Stand festgehalten, damit ein Fehler
            zurückgenommen werden kann. Dieses Protokoll kann deshalb auch Deine Daten enthalten. Bei einer Löschung auf Wunsch werden Deine
            Einträge darin sofort geleert. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, Fehler in den Daten
            der Liga erkennen und rückgängig machen zu können.
          </p>
        </LegalSection>

        <LegalSection title="14. Deine Rechte">
          <p className={ABSATZ}>Du hast uns gegenüber die folgenden Rechte:</p>
          <ul className="flex list-disc flex-col gap-y-2 pl-5">
            <li className={ABSATZ}>Auskunft darüber, ob und welche Daten wir über Dich verarbeiten (Art. 15 DSGVO).</li>
            <li className={ABSATZ}>Berichtigung unrichtiger und Vervollständigung unvollständiger Daten (Art. 16 DSGVO).</li>
            <li className={ABSATZ}>Löschung Deiner Daten (Art. 17 DSGVO).</li>
            <li className={ABSATZ}>Einschränkung der Verarbeitung (Art. 18 DSGVO).</li>
            <li className={ABSATZ}>
              Datenübertragbarkeit, also die Herausgabe der Daten, die Du uns gegeben hast, in einem gängigen Format (Art. 20 DSGVO).
            </li>
            <li className={ABSATZ}>
              Widerspruch gegen jede Verarbeitung, die wir auf ein berechtigtes Interesse stützen, aus Gründen, die sich aus Deiner besonderen
              Situation ergeben (Art. 21 DSGVO). Das betrifft jede Verarbeitung, für die diese Erklärung Art. 6 Abs. 1 lit. f DSGVO als
              Rechtsgrundlage nennt, auch die Daten Deiner Teilnahme und den Eintrag einer gesperrten E-Mail-Adresse.
            </li>
            <li className={ABSATZ}>
              Widerruf einer Einwilligung, jederzeit und mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO). Das betrifft den Namen einer
              Spielerin oder eines Spielers in den Kaderlisten, die Erlaubnis für Fotos, Videos und Interviews, die Vornamen der
              Organisatorinnen und Organisatoren auf der Seite „Organisation“ und den freiwilligen Schalter für WhatsApp. Ein Vorname auf der
              Seite „Organisation“ steht auch im öffentlich einsehbaren Quellcode dieser Website: Ein Widerruf nimmt ihn von der Website und aus
              der aktuellen Fassung des Quellcodes, frühere Fassungen bleiben in dessen öffentlicher Versionsgeschichte erhalten. Was bis zum
              Widerruf geschah, bleibt rechtmäßig.
            </li>
          </ul>
          <p className={ABSATZ}>
            Wie Du sie ausübst: eine formlose E-Mail an <MailLink />. Begründen musst Du nur einen Widerspruch, mit Deiner besonderen Situation.
            Wir antworten so schnell wir können und in jedem Fall innerhalb der Frist des Art. 12 Abs. 3 DSGVO.
          </p>
          <p className={ABSATZ}>
            Was eine Löschung erreicht und was nicht: Aus der laufenden Datenbank sind Deine Daten sofort verschwunden. In den Sicherungskopien
            bleiben sie bis zu etwa acht Tage länger, weil eine Sicherung nicht einzeln geändert werden kann; danach laufen die Kopien von
            selbst aus, und wir stellen aus einer Sicherung nichts wieder her, ohne Deine Löschung erneut auszuführen.
          </p>
          <p className={ABSATZ}>
            Wenn mehrere Personen ein Postfach teilen: Löschen wir anhand einer E-Mail-Adresse, kann diese Adresse zu mehreren Personen gehören,
            etwa bei einem gemeinsamen Postfach einer Schule. In diesem Fall zeigen wir Dir vorher, welche Einträge betroffen wären, und löschen
            erst nach Deiner Bestätigung.
          </p>
          <p className={ABSATZ}>
            Eine Einschränkung gilt für Administratorinnen und Administratoren der Liga: Ihre E-Mail-Adresse bleibt in den Zeilen des
            Änderungsprotokolls stehen, die ihre eigenen Änderungen festhalten, auch nach einer Löschung. Das Protokoll hat nur dann einen Sinn,
            wenn nachvollziehbar bleibt, wer eine Änderung vorgenommen hat. Diese Zeilen werden wie alle anderen gelöscht. Außerdem bleibt ihre
            E-Mail-Adresse bei jedem Registrierungslink eines Teams stehen, den sie angelegt haben; dieser Eintrag wird nicht gelöscht
            (Abschnitt 13).
          </p>
          <p className={ABSATZ}>
            Eine zweite Einschränkung gilt für gesperrte E-Mail-Adressen: Von der gesperrten Adresse selbst speichern wir nichts, sondern nur
            einen unlesbaren Schlüssel. Daneben stehen der Grund, das Datum und die E-Mail-Adresse der Person aus der Verwaltung, die die Sperre
            eingetragen hat. Der Grund ist ein freier Text; steht darin ein Name, bleibt er mit dem Eintrag stehen. Dieser Eintrag bleibt auch
            nach einer Löschung bestehen, bis die Sperre nach fünf vollen Saisons endet oder die Verwaltung sie vorher aufhebt. Wir speichern
            diesen Eintrag auf Grundlage unseres berechtigten Interesses daran, eine gesperrte Adresse nicht erneut zuzulassen (Art. 6 Abs. 1
            lit. f DSGVO).
          </p>
        </LegalSection>

        <LegalSection title="15. Beschwerderecht">
          <p className={ABSATZ}>Du kannst Dich jederzeit bei einer Datenschutzaufsichtsbehörde beschweren. Für uns zuständig ist:</p>
          <p className={ABSATZ}>
            Der Hessische Beauftragte für Datenschutz und Informationsfreiheit
            <br />
            Gustav-Stresemann-Ring 1
            <br />
            65189 Wiesbaden
          </p>
        </LegalSection>

        <LegalSection title="16. Datenschutzbeauftragter">
          <p className={ABSATZ}>
            Wir haben keinen Datenschutzbeauftragten bestellt. Nach unserer Einschätzung besteht dazu keine Pflicht, weil bei uns nicht
            mindestens zwanzig Personen ständig mit der automatisierten Verarbeitung personenbezogener Daten beschäftigt sind und wir weder
            umfangreich besondere Datenkategorien verarbeiten noch eine Tätigkeit ausüben, die eine regelmäßige und systematische Überwachung
            erfordert. Alle Anfragen zum Datenschutz gehen an <MailLink />.
          </p>
        </LegalSection>

        <LegalSection title="17. Änderungen dieser Erklärung">
          <p className={ABSATZ}>
            Wenn sich ändert, was wir verarbeiten, ändern wir diese Erklärung mit. Der Stand unten sagt Dir, welche Fassung Du gerade liest.
            Eine Änderung, die eine Einwilligung von Dir betrifft, holen wir gesondert ein; wir stützen uns nicht darauf, dass Du eine neue
            Fassung gelesen hättest.
          </p>
          <p className={ABSATZ}>
            Wer wir sind und wie Du uns erreichst, steht im{" "}
            <Link
              href="/impressum"
              prefetch={false}
              className={textLink()}>
              Impressum
            </Link>
            .
          </p>
          <p className="muted-meta">Stand: {STAND}</p>
        </LegalSection>
      </article>
    </div>
  );
}
