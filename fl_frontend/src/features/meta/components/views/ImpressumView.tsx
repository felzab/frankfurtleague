import Link from "next/link";

import { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME, VORSTAND } from "@/core/brand";
import { card } from "@/shared/components/ui/card";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";
import { textLink } from "@/shared/components/ui/textLink";

import { LegalSection } from "../ui/LegalSection";

/** One legal paragraph. Spelled once because the page is nothing but paragraphs, and a copy per section drifts. */
const ABSATZ_CLASSES = "fluid-sm leading-relaxed font-medium text-pretty text-foreground";

export function ImpressumView() {
  return (
    <div className={`${PAGE_RISE_CLASSES} flex w-full flex-col gap-6`}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>Impressum</h1>
      </header>

      <article className={`${card()} flex w-full flex-col gap-y-6 p-4 sm:p-6 lg:gap-y-8 lg:p-8`}>
        <LegalSection title="Angaben gemäß § 5 DDG">
          <p className={ABSATZ_CLASSES}>
            {VEREIN_NAME}
            <br />
            {VEREIN_ANSCHRIFT}
          </p>
        </LegalSection>

        <LegalSection title="Vertreten durch den Vorstand">
          <p className={ABSATZ_CLASSES}>
            {VORSTAND.map((mitglied) => (
              <span key={mitglied.name}>
                {mitglied.name}, {mitglied.amt}
                <br />
              </span>
            ))}
          </p>
          <p className={ABSATZ_CLASSES}>Jeweils zwei Vorstandsmitglieder vertreten den Verein gemeinsam.</p>
        </LegalSection>

        <LegalSection title="Kontakt">
          <p className={ABSATZ_CLASSES}>
            E-Mail:{" "}
            <Link
              href={`mailto:${KONTAKT_EMAIL}`}
              className={textLink()}>
              {KONTAKT_EMAIL}
            </Link>
          </p>
          <p className={ABSATZ_CLASSES}>
            Der Verein hat keinen Telefonanschluss. Über die E-Mail-Adresse oben erreichst Du uns in jeder Angelegenheit, und wir antworten so
            schnell wir können.
          </p>
        </LegalSection>

        <LegalSection title="Registereintrag">
          <p className={ABSATZ_CLASSES}>Eingetragen im Vereinsregister des Amtsgerichts Frankfurt am Main unter der Nummer VR 17757.</p>
        </LegalSection>

        <LegalSection title="Umsatzsteuer-Identifikationsnummer">
          <p className={ABSATZ_CLASSES}>Der Verein hat keine Umsatzsteuer-Identifikationsnummer nach § 27 a Umsatzsteuergesetz.</p>
        </LegalSection>

        <LegalSection title="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
          <p className={ABSATZ_CLASSES}>
            {VORSTAND.filter((mitglied) => mitglied.vorsitz).map((mitglied) => (
              <span key={mitglied.name}>
                {mitglied.name}, {VEREIN_ANSCHRIFT}
                <br />
              </span>
            ))}
          </p>
        </LegalSection>

        <LegalSection title="Haftung für Inhalte">
          <p className={ABSATZ_CLASSES}>
            Wir stellen die Inhalte dieser Website nach bestem Wissen zusammen und halten sie aktuell, soweit uns das möglich ist. Für ihre
            Richtigkeit und Vollständigkeit können wir nicht einstehen. Als Diensteanbieter sind wir nach § 7 Abs. 1 DDG für eigene Inhalte
            verantwortlich, aber nach den §§ 8 bis 10 DDG nicht verpflichtet, fremde Informationen zu überwachen oder nach Umständen zu
            forschen, die auf eine rechtswidrige Tätigkeit hinweisen. Sobald wir von einer konkreten Rechtsverletzung erfahren, entfernen wir
            den betreffenden Inhalt umgehend.
          </p>
          <p className={ABSATZ_CLASSES}>
            Spielpläne, Ergebnisse und Tabellen dieser Website geben den Stand wieder, den die Liga zuletzt eingetragen hat. Sie sind kein
            amtliches Ergebnis und begründen keinen Anspruch.
          </p>
        </LegalSection>

        <LegalSection title="Haftung für Links">
          <p className={ABSATZ_CLASSES}>
            Diese Website verweist an einigen Stellen auf fremde Websites, etwa auf die Seiten der teilnehmenden Schulen und auf unsere Profile
            in sozialen Netzwerken. Auf deren Inhalte haben wir keinen Einfluss, und wir machen sie uns nicht zu eigen. Für sie ist stets deren
            Anbieter verantwortlich. Zum Zeitpunkt der Verlinkung waren dort keine Rechtsverstöße erkennbar. Erfahren wir von einem, entfernen
            wir den Link.
          </p>
        </LegalSection>

        <LegalSection title="Urheberrecht">
          <p className={ABSATZ_CLASSES}>
            Die Inhalte dieser Website, also Texte, Bilder, Grafiken und die Zusammenstellung der Liga-Daten, sind urheberrechtlich geschützt.
            Jede Verwendung außerhalb der Schranken des Urheberrechts braucht unsere Zustimmung. Für den privaten Gebrauch darfst Du die Seiten
            selbstverständlich lesen, ausdrucken und weiterschicken.
          </p>
        </LegalSection>

        <LegalSection title="Name und Logo">
          <p className={ABSATZ_CLASSES}>
            Der Name „Frankfurt League“ in jeder Schreibweise, auch „Frankfurt-League“ und „frankfurtleague“, jede damit verwechselbar ähnliche
            Bezeichnung sowie das Logo der Liga und alle davon abgeleiteten Gestaltungen sind der Liga vorbehalten. Der Quellcode dieser Website
            ist zwar öffentlich einsehbar und lizenziert, der Name und die Gestaltung sind ausdrücklich nicht lizenziert: Die Lizenz des
            Quellcodes räumt daran keine Rechte ein, und auch sonst räumen wir daran keine ein. Wenn Du den Namen oder das Logo verwenden
            möchtest, frag uns unter {KONTAKT_EMAIL}.
          </p>
        </LegalSection>

        <LegalSection title="Verbraucherstreitbeilegung">
          <p className={ABSATZ_CLASSES}>
            Wir sind nicht bereit und nicht verpflichtet, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
            teilzunehmen.
          </p>
        </LegalSection>

        <LegalSection title="Datenschutz">
          <p className={ABSATZ_CLASSES}>
            Was wir mit Deinen Daten machen, steht in der{" "}
            <Link
              href="/datenschutz"
              prefetch={false}
              className={textLink()}>
              Datenschutzerklärung
            </Link>
            .
          </p>
        </LegalSection>
      </article>
    </div>
  );
}
