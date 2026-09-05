import Link from "next/link";

import { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME, VERTRETUNGSBERECHTIGTE } from "@/core/brand";
import { card } from "@/shared/components/ui/card";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { textLink } from "@/shared/components/ui/textLink";

import type { ReactNode } from "react";

/** One legal paragraph. Spelled once because the page is nothing but paragraphs, and a copy per section drifts. */
const ABSATZ = "fluid-sm text-foreground leading-relaxed font-medium text-pretty";

/**
 * Hand-set, the way `fl_frontend/src/app/sitemap.ts :: CONTENT_LAST_MODIFIED` is: a live `new Date()`
 * is a dynamic read, which would take this page off the static shell.
 */
const STAND = "4. September 2026";

/** Every recipient outside the league, as one card each: five facts across seven rows read as a table nothing can wrap at 375px. */
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
    ort: "Weltweit, am nächsten Rand des Netzes",
    vereinbarung: "Standardvereinbarung, in die Nutzungsbedingungen einbezogen",
  },
  {
    name: "MongoDB, Inc.",
    rolle: "Auftragsverarbeiter",
    inhalt: "Die gesamte Datenbank und ihre Sicherungskopien",
    ort: "Frankfurt am Main",
    vereinbarung: "Standardvereinbarung, in die Cloud-Bedingungen einbezogen",
  },
  {
    name: "Resend, Inc.",
    rolle: "Auftragsverarbeiter",
    inhalt: "Empfängeradresse, Betreff und Inhalt jeder versendeten E-Mail",
    ort: "Vereinigte Staaten",
    vereinbarung: "Auftragsverarbeitungsvertrag mit Standardvertragsklauseln",
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
    name: "WhatsApp",
    rolle: "Anbieter der Messenger-App",
    inhalt: "Telefonnummer und Nachrichten der Personen, die uns auf diesem Weg schreiben",
    ort: "Nicht festgelegt",
    vereinbarung: "Keiner für die gewöhnliche App",
  },
];

/** What is published, against the basis it rests on. */
const VEROEFFENTLICHT = [
  { was: "Name des Teams und Name der Schule", grundlage: "Art. 6 Abs. 1 lit. b DSGVO, Durchführung des Wettbewerbs" },
  {
    was: "Straßenanschrift der Schule als Anschrift des Teams",
    grundlage: "Art. 6 Abs. 1 lit. f DSGVO; das Bewerbungsformular sagt es vorher",
  },
  { was: "Spielpläne, Spieltage, Spielorte, Ergebnisse und Tabellen", grundlage: "Art. 6 Abs. 1 lit. b DSGVO" },
  {
    was: "Kaderlisten: Vorname und erster Buchstabe des Nachnamens",
    grundlage: "Art. 6 Abs. 1 lit. f DSGVO, Durchführung und Darstellung des Wettbewerbs",
  },
  {
    was: "Schiedsrichterinnen und Schiedsrichter an einem Spiel, in derselben Form",
    grundlage: "Art. 6 Abs. 1 lit. f DSGVO, Durchführung und Darstellung des Wettbewerbs",
  },
  {
    was: "Vornamen der Organisatorinnen und Organisatoren auf der Team-Seite",
    grundlage: "Art. 6 Abs. 1 lit. a DSGVO, mit ausdrücklichem Einverständnis",
  },
  {
    was: "Notizen zu einem Spiel und der Grund für den Rückzug eines Teams, als Freitext",
    grundlage: "Art. 6 Abs. 1 lit. f DSGVO; das Eingabefeld weist darauf hin",
  },
];

/** What is kept, and for how long. */
const FRISTEN = [
  { daten: "Bewerbung, bei der nicht alle Kontaktpersonen bestätigt haben", frist: "14 Tage nach dem Eingang, dann Löschung" },
  { daten: "Abgelehnte Bewerbung samt den Daten der drei Kontaktpersonen", frist: "1 Monat nach der Entscheidung" },
  {
    daten: "Angenommene Bewerbung samt den Daten der drei Kontaktpersonen",
    frist: "Bis zum Ende der Saison, die auf die beworbene Saison folgt",
  },
  { daten: "Kontaktdaten der Kontaktpersonen einer Saison", frist: "Dieselbe Frist wie die angenommene Bewerbung" },
  { daten: "Geburtsdatum einer Kontaktperson", frist: "Entsteht erst mit ihrer Bestätigung, dann dieselbe Frist wie die Bewerbung" },
  { daten: "Änderungsprotokoll der Verwaltung", frist: "12 Monate ab dem Eintrag" },
  { daten: "Zugriffsprotokoll des Servers", frist: "Begrenzt durch die Größenrotation des Protokolls, nicht durch eine Frist in Tagen" },
  { daten: "Sicherungskopien der Datenbank", frist: "Etwa 8 Tage" },
  {
    daten: "Daten von Spielerinnen, Spielern und Schiedsrichtern",
    frist: "Solange die Teilnahme läuft, und darüber hinaus bis zu einer Löschung auf Wunsch",
  },
];

function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-y-2">
      <h2 className="fluid-base text-foreground font-extrabold tracking-wide uppercase">{titel}</h2>
      {children}
    </section>
  );
}

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
    <div className={`${PAGE_RISE} max-w-meta flex w-full flex-col items-center gap-y-4 text-left sm:gap-y-8`}>
      <div className="flex flex-col items-center px-2 text-center">
        <h1 className="fluid-2xl lg:fluid-3xl text-field-fg font-black tracking-tight uppercase drop-shadow-md">Datenschutzerklärung</h1>
      </div>

      {/* Neutral rather than the green pitch card the sibling meta views wear: this is a page somebody
          reads end to end, and the field foreground carries a paragraph badly at any length. */}
      <article className={`${card()} flex w-full flex-col gap-y-6 p-5 shadow-xl sm:p-6 lg:gap-y-8 lg:p-8`}>
        <Abschnitt titel="Kurz gesagt">
          <ul className="flex list-disc flex-col gap-y-2 pl-5">
            <li className={ABSATZ}>
              Für die Teilnahme an der Frankfurt-League brauchen wir ein paar Daten von Dir. Mehr als nötig fragen wir nicht ab.
            </li>
            <li className={ABSATZ}>Wenn Dein Name auf dieser Website steht, dann als Vorname und erster Buchstabe des Nachnamens.</li>
            <li className={ABSATZ}>Wer als Kontaktperson einer Bewerbung eingetragen wird, muss mindestens 16 Jahre alt sein.</li>
            <li className={ABSATZ}>
              Wir messen nicht, was Du auf dieser Website tust. Es gibt keine Analyse, kein Tracking, keine Werbung und kein Profiling.
            </li>
            <li className={ABSATZ}>
              Auskunft, Berichtigung, Löschung, Widerspruch, Widerruf: eine E-Mail an <MailLink /> genügt, und Du musst nichts begründen.
            </li>
          </ul>
        </Abschnitt>

        <Abschnitt titel="1. Wer verantwortlich ist">
          <p className={ABSATZ}>Verantwortlich für die Verarbeitung Deiner Daten auf dieser Website ist:</p>
          <p className={ABSATZ}>
            {VEREIN_NAME}
            <br />
            {VEREIN_ANSCHRIFT}
            <br />
            E-Mail: <MailLink />
          </p>
          <p className={ABSATZ}>Vertretungsberechtigt sind {VERTRETUNGSBERECHTIGTE.join(" und ")}, jeweils mit gleichen Befugnissen.</p>
          <p className={ABSATZ}>
            Der Verein befindet sich in Gründung und ist noch in keinem Vereinsregister eingetragen. Eine Telefonnummer für den Verein gibt es
            nicht; wir sind über die E-Mail-Adresse oben erreichbar.
          </p>
        </Abschnitt>

        <Abschnitt titel="2. Wohin Deine Datenschutzanfrage geht">
          <p className={ABSATZ}>
            An <MailLink />. Diese eine Adresse gilt für alles: Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit,
            Widerspruch und den Widerruf einer Einwilligung. Du musst kein Formular ausfüllen und keinen Grund angeben, und ein formloser Satz
            reicht.
          </p>
        </Abschnitt>

        <Abschnitt titel="3. Hosting, Zugriffsdaten und Auslieferung">
          <p className={ABSATZ}>
            Die Website läuft auf einem Server der Hetzner Online GmbH in einem Rechenzentrum in Nürnberg. Hetzner verarbeitet die Daten für uns
            als Auftragsverarbeiter nach Art. 28 DSGVO.
          </p>
          <p className={ABSATZ}>
            Vor diesem Server steht Cloudflare, Inc. als Proxy. Jede Anfrage an diese Website läuft zuerst über Cloudflare, und zwar
            unverschlüsselt an dieser Stelle: Deine IP-Adresse, die aufgerufene Adresse, die technischen Kopfzeilen Deines Browsers und der
            Inhalt jedes abgeschickten Formulars sind dort sichtbar. Cloudflare betreibt sein Netz weltweit, und welcher Standort Deine Anfrage
            annimmt, richtet sich nach Deinem Aufenthaltsort. Grundlage ist die Standardvereinbarung zur Auftragsverarbeitung, die Cloudflare in
            seine Nutzungsbedingungen einbezieht.
          </p>
          <p className={ABSATZ}>
            Bei jedem Aufruf entsteht ein Eintrag im Zugriffsprotokoll des Servers. Er enthält Deine IP-Adresse, den Zeitpunkt, die aufgerufene
            Seite, den Statuscode der Antwort, die Kennung Deines Browsers und die Seite, von der Du gekommen bist. Wie lange ein Eintrag
            bleibt, richtet sich nach dem Umfang des Protokolls: der Server hält die jüngsten Einträge bis zu einer festen Gesamtgröße und
            überschreibt die älteren. Die Einträge werden nicht ausgewertet, nicht mit anderen Daten zusammengeführt und an keinen
            Auswertungsdienst weitergegeben.
          </p>
          <p className={ABSATZ}>
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist der sichere und stabile Betrieb der Website und die
            Abwehr von Angriffen; ohne diese Einträge lässt sich ein Angriff weder erkennen noch nachvollziehen. Dem steht Dein Interesse
            gegenüber, nicht ohne Anlass erfasst zu werden. Wir halten Dein Interesse für gewahrt, weil niemand die Einträge zu einem
            Nutzungsprofil verbindet, sie ausschließlich technischen Zwecken dienen und der Bestand durch die Rotation begrenzt bleibt. Du
            kannst dieser Verarbeitung nach Art. 21 DSGVO widersprechen; Abschnitt 14 sagt, wie.
          </p>
        </Abschnitt>

        <Abschnitt titel="4. Datenbank und Sicherungskopien">
          <p className={ABSATZ}>
            Die Daten der Liga liegen in einer verwalteten Datenbank bei MongoDB, Inc. (MongoDB Atlas). Der Cluster steht in Frankfurt am Main.
            Grundlage ist die Standardvereinbarung zur Auftragsverarbeitung, die MongoDB in seine Cloud-Bedingungen einbezieht.
          </p>
          <p className={ABSATZ}>
            Von dieser Datenbank werden täglich Sicherungskopien angelegt, die etwa acht Tage aufbewahrt und dann überschrieben werden. Sie
            liegen in derselben Region wie der Cluster. Wenn wir Daten auf Deinen Wunsch löschen, sind sie aus der laufenden Datenbank sofort
            verschwunden; in den Sicherungskopien laufen sie innerhalb dieser acht Tage aus.
          </p>
        </Abschnitt>

        <Abschnitt titel="5. E-Mail-Versand">
          <p className={ABSATZ}>
            Die E-Mails der Liga, also Eingangsbestätigungen, Bestätigungslinks, Erinnerungen, Entscheidungen über eine Bewerbung und die
            Anmeldelinks der Administratorinnen und Administratoren, versenden wir über Resend, Inc. mit Sitz in den Vereinigten Staaten.
            Absender ist no-reply@frankfurtleague.de. Zu Resend gelangen die Empfängeradresse, der Betreff und der vollständige Inhalt der
            Nachricht.
          </p>
          <p className={ABSATZ}>
            Resend speichert diese Daten in den Vereinigten Staaten. Das ist eine Übermittlung in ein Drittland. Sie stützt sich auf die
            Standardvertragsklauseln der Europäischen Kommission nach Art. 46 Abs. 2 lit. c DSGVO, die Bestandteil des
            Auftragsverarbeitungsvertrags mit Resend sind.
          </p>
        </Abschnitt>

        <Abschnitt titel="6. Wenn eine Schule sich bewirbt">
          <p className={ABSATZ}>
            Über das Bewerbungsformular kann eine Schule ihre Aufnahme in die Liga beantragen. Bewerben darf sich, wer mindestens 16 Jahre alt
            ist.
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
            Die Anschrift der Schule wird öffentlich, sobald die Bewerbung angenommen ist. Sie erscheint dann als Anschrift des Teams auf dessen
            Seite. Das Formular sagt das an der Stelle, an der die Anschrift eingetragen wird.
          </p>
          <p className={ABSATZ}>
            Jede der drei Kontaktpersonen bekommt eine eigene E-Mail mit einem persönlichen Link. Über diesen Link bestätigt sie ihren Eintrag
            in der genannten Rolle und trägt dabei ihr Geburtsdatum ein. Das Geburtsdatum erreicht uns also erst an dieser Stelle und von der
            Person selbst; wir prüfen damit, ob sie mindestens 16 Jahre alt ist. Das ist keine Einwilligung, sondern eine Bestätigung: Sie
            belegt, dass die angegebene E-Mail-Adresse zu dieser Person gehört, dass die Person von ihrem Eintrag weiß, dass sie mindestens 16
            Jahre alt ist und dass sie diese Datenschutzerklärung zur Kenntnis nehmen konnte. Nach drei Tagen erinnern wir einmal. Die Bewerbung
            bleibt so lange offen, bis alle drei bestätigt haben. Hat nach vierzehn Tagen nicht jede Person bestätigt, löschen wir die Bewerbung
            mit allen Kontaktdaten.
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
            Rechtsgrundlage: Die Angaben zur Schule und zum Team verarbeiten wir nach Art. 6 Abs. 1 lit. b DSGVO, weil ohne sie über die
            Teilnahme nicht entschieden werden kann. Für die Person, die die Bewerbung selbst einreicht und damit ihre eigene Teilnahme
            vorbereitet, gilt dieselbe Grundlage. Für die beiden weiteren eingetragenen Personen stützen wir uns auf Art. 6 Abs. 1 lit. f DSGVO,
            solange sie nicht selbst Partei der Teilnahmevereinbarung sind: Unser berechtigtes Interesse ist, ein Team über die von ihm selbst
            benannten Personen erreichen zu können, ohne die Bewerbung an einer einzigen Adresse hängen zu lassen. Die betroffenen Personen
            müssen damit rechnen, in dieser Rolle benannt zu werden, sie erfahren davon sofort durch die Bestätigungsmail, ihre Daten werden nie
            veröffentlicht, und sie können jederzeit die Löschung verlangen.
          </p>
          <p className={ABSATZ}>
            Wer die Bewerbung sieht: Nur die Administratorinnen und Administratoren der Liga, die dafür angemeldet sein müssen. Eine Bewerbung
            ist über keine öffentliche Adresse abrufbar. Die Kontaktdaten der drei Personen werden zu keinem Zeitpunkt veröffentlicht, auch
            nicht nach der Aufnahme des Teams.
          </p>
          <p className={ABSATZ}>Wie lange wir eine Bewerbung aufbewahren, steht in Abschnitt 13.</p>
        </Abschnitt>

        <Abschnitt titel="7. Wenn Du uns schreibst">
          <p className={ABSATZ}>
            Wenn Du uns an <MailLink /> schreibst, verarbeiten wir Deine Nachricht und Deine Adresse, um zu antworten. Rechtsgrundlage ist Art.
            6 Abs. 1 lit. b DSGVO, soweit es um Deine Teilnahme geht, sonst Art. 6 Abs. 1 lit. f DSGVO mit unserem Interesse, Anfragen zu
            beantworten. Wir löschen die Korrespondenz, sobald sie erledigt ist und keine gesetzliche Aufbewahrungspflicht entgegensteht.
          </p>
          <p className={ABSATZ}>Drei Dinge sagen wir dazu offen, weil sie Dich betreffen:</p>
          <ul className="flex list-disc flex-col gap-y-2 pl-5">
            <li className={ABSATZ}>
              Das Postfach der Liga liegt bei der Proton AG in der Schweiz, auf einem privaten Tarif. Für diesen Tarif besteht kein
              Auftragsverarbeitungsvertrag. Die Schweiz gilt als Land mit einem angemessenen Datenschutzniveau.
            </li>
            <li className={ABSATZ}>
              Einzelne Mitglieder der Liga lesen Liga-Post in ihren privaten Gmail-Konten. Auch dafür besteht kein Auftragsverarbeitungsvertrag,
              weil ein privates Konto keinen vorsieht.
            </li>
            <li className={ABSATZ}>
              Erreicht uns jemand über WhatsApp, oder hat eine Kontaktperson dem Weg zugestimmt (Abschnitt 6), gelangen ihre Telefonnummer und
              ihre Nachrichten zu WhatsApp. Wir nutzen dafür die gewöhnliche WhatsApp-App, für die kein Auftragsverarbeitungsvertrag besteht.
              Wer diesen Weg nicht will, wird ausschließlich per E-Mail und Telefon erreicht.
            </li>
          </ul>
        </Abschnitt>

        <Abschnitt titel="8. Wer Deine Daten außer uns bekommt">
          <div
            role="list"
            className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
            {EMPFAENGER.map((empfaenger) => (
              <div
                role="listitem"
                key={empfaenger.name}
                className="border-border flex flex-col gap-y-3 rounded-2xl border p-4">
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
        </Abschnitt>

        <Abschnitt titel="9. Was auf dieser Website veröffentlicht wird">
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
            Nicht veröffentlicht werden die Kontaktdaten der drei Kontaktpersonen einer Schule samt ihrem Geburtsdatum, die Kontaktdaten und die
            Schule einer Schiedsrichterin oder eines Schiedsrichters und die Stufe einer Spielerin oder eines Spielers, also das Halbjahr der
            Oberstufe von E1 bis Q4.
          </p>
          <p className={ABSATZ}>
            Die beiden vollständigen Namen im Impressum stehen nicht auf der Grundlage aus dieser Aufstellung, sondern weil § 5 DDG und § 18
            Abs. 2 MStV sie verlangen.
          </p>
          <p className={ABSATZ}>
            Freitexte enthalten das, was jemand hineingeschrieben hat. Eine Notiz an einem Spiel und der Grund für einen Rückzug erscheinen
            unverändert auf der Website. Wer dort einen Namen einträgt, veröffentlicht ihn. Wenn in einem solchen Feld etwas über Dich steht,
            das dort nicht hingehört, schreib uns; wir nehmen es heraus.
          </p>
          <p className={ABSATZ}>
            Suchmaschinen: Die öffentlichen Seiten dürfen von Suchmaschinen erfasst werden. Die Verwaltungsbereiche und die Schnittstellen sind
            ausgenommen. Den bekannten Sammelprogrammen für KI-Training untersagen wir das Erfassen dieser Website vollständig, und dieselbe
            Sperre gilt am Rand unseres Netzes.
          </p>
        </Abschnitt>

        <Abschnitt titel="10. Spielerinnen, Spieler, Schiedsrichterinnen und Schiedsrichter">
          <p className={ABSATZ}>
            Wer im Kader eines Teams steht oder ein Spiel pfeift, wird von der Verwaltung der Liga eingetragen. Veröffentlicht werden dann
            Vorname und erster Buchstabe des Nachnamens, bei einer Spielerin und einem Spieler dazu das Team, die Rückennummer und die Position,
            soweit sie angegeben sind.
          </p>
          <p className={ABSATZ}>
            Für Schiedsrichterinnen und Schiedsrichter gilt dieselbe Form: An einem Spiel stehen Vorname und erster Buchstabe des Nachnamens.
            Die Kontaktdaten und die Schule bleiben in der Verwaltung der Liga.
          </p>
          <p className={ABSATZ}>
            Du kannst jederzeit verlangen, dass Dein Name von dieser Website verschwindet, formlos an <MailLink />. Danach nehmen wir ihn
            zeitnah heraus; an einem vergangenen Spiel steht dann ein neutraler Eintrag statt des Namens.
          </p>
        </Abschnitt>

        <Abschnitt titel="11. Cookies und Speicherung in Deinem Browser">
          <p className={ABSATZ}>Diese Website setzt zwei Dinge im Browser, und beide sind für den Betrieb notwendig:</p>
          <ul className="flex list-disc flex-col gap-y-2 pl-5">
            <li className={ABSATZ}>
              Ein Sitzungs-Cookie für angemeldete Administratorinnen und Administratoren. Es entsteht erst bei der Anmeldung, gilt 48 Stunden
              und hält die Sitzung. Wer sich nicht anmeldet, bekommt es nie.
            </li>
            <li className={ABSATZ}>
              Die von Dir gewählte Darstellung, hell oder dunkel. Sie wird im lokalen Speicher Deines Browsers abgelegt, damit die Seite beim
              nächsten Besuch so aussieht, wie Du sie eingestellt hast. Dieser Wert bleibt auf Deinem Gerät und erreicht uns nicht.
            </li>
          </ul>
          <p className={ABSATZ}>
            Beides ist unbedingt erforderlich, um den von Dir gewünschten Dienst bereitzustellen, und deshalb nach § 25 Abs. 2 Nr. 2 TDDDG
            einwilligungsfrei. Darüber hinaus speichern wir nichts in Deinem Browser, und es gibt keinen Cookie-Banner, weil es nichts
            einzuwilligen gibt.
          </p>
          <p className={ABSATZ}>
            Verweise auf Instagram, Threads und GitHub sind gewöhnliche Links und übertragen von sich aus nichts an diese Anbieter. Von diesen
            Anbietern wird nichts in unsere Seiten eingebettet und nichts nachgeladen. Erst wenn Du auf einen dieser Links klickst, erfährt der
            jeweilige Anbieter davon, und ab dann gilt dessen Datenschutzerklärung.
          </p>
        </Abschnitt>

        <Abschnitt titel="12. Keine Analyse, kein Tracking, keine automatisierte Entscheidung">
          <p className={ABSATZ}>
            Wir setzen keine Analysedienste ein, keine Zählpixel, keine Werbenetzwerke und keine Dienste, die Dich über Websites hinweg
            wiedererkennen. Wir erstellen keine Profile und verkaufen keine Daten.
          </p>
          <p className={ABSATZ}>
            Es findet keine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne des Art. 22 DSGVO statt. Über eine Bewerbung
            entscheidet ein Mensch.
          </p>
        </Abschnitt>

        <Abschnitt titel="13. Wie lange wir was speichern">
          <dl className="flex flex-col gap-y-3">
            {FRISTEN.map((eintrag) => (
              <Angabe
                key={eintrag.daten}
                label={eintrag.daten}>
                {eintrag.frist}
              </Angabe>
            ))}
          </dl>
          <p className={ABSATZ}>
            Ergebnisse, Tabellen und Spielpläne vergangener Saisons bleiben als Chronik der Liga bestehen. Wer darin mit Namen steht, kann die
            Löschung verlangen; danach erscheint dort ein neutraler Eintrag statt des Namens.
          </p>
          <p className={ABSATZ}>
            Das Änderungsprotokoll: Jede Änderung an den Daten der Liga wird mit dem vorherigen Stand festgehalten, damit ein Fehler
            zurückgenommen werden kann. Dieses Protokoll kann deshalb auch Deine Daten enthalten. Es wird nach zwölf Monaten gelöscht, und bei
            einer Löschung auf Wunsch werden Deine Einträge darin sofort geleert.
          </p>
        </Abschnitt>

        <Abschnitt titel="14. Deine Rechte">
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
              Situation ergeben (Art. 21 DSGVO). Das betrifft die Zugriffsprotokolle, die Freitexte, die Anschrift der Schule als Anschrift des
              Teams, die Kaderlisten, die Namen der Schiedsrichterinnen und Schiedsrichter an einem Spiel und die Daten der Kontaktpersonen
              einer Bewerbung.
            </li>
            <li className={ABSATZ}>
              Widerruf einer Einwilligung, jederzeit und mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO). Was bis zum Widerruf geschah, bleibt
              rechtmäßig.
            </li>
          </ul>
          <p className={ABSATZ}>
            Wie Du sie ausübst: eine E-Mail an <MailLink />, formlos und ohne Begründung. Wir antworten so schnell wir können und in jedem Fall
            innerhalb der Frist des Art. 12 Abs. 3 DSGVO.
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
            wenn nachvollziehbar bleibt, wer eine Änderung vorgenommen hat. Diese Zeilen werden nach zwölf Monaten wie alle anderen gelöscht.
          </p>
        </Abschnitt>

        <Abschnitt titel="15. Beschwerderecht">
          <p className={ABSATZ}>Du kannst Dich jederzeit bei einer Datenschutzaufsichtsbehörde beschweren. Für uns zuständig ist:</p>
          <p className={ABSATZ}>
            Der Hessische Beauftragte für Datenschutz und Informationsfreiheit
            <br />
            Gustav-Stresemann-Ring 1
            <br />
            65189 Wiesbaden
          </p>
        </Abschnitt>

        <Abschnitt titel="16. Datenschutzbeauftragter">
          <p className={ABSATZ}>
            Wir haben keinen Datenschutzbeauftragten bestellt. Nach unserer Einschätzung besteht dazu keine Pflicht, weil bei uns nicht
            mindestens zwanzig Personen ständig mit der automatisierten Verarbeitung personenbezogener Daten beschäftigt sind und wir weder
            umfangreich besondere Datenkategorien verarbeiten noch eine Tätigkeit ausüben, die eine regelmäßige und systematische Überwachung
            erfordert. Alle Anfragen zum Datenschutz gehen an <MailLink />.
          </p>
        </Abschnitt>

        <Abschnitt titel="17. Änderungen dieser Erklärung">
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
        </Abschnitt>
      </article>
    </div>
  );
}
