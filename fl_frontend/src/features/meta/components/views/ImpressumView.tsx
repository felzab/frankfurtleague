import Link from "next/link";

import { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME, VERTRETUNGSBERECHTIGTE } from "@/core/brand";
import { card } from "@/shared/components/ui/card";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { textLink } from "@/shared/components/ui/textLink";

import type { ReactNode } from "react";

/** One legal paragraph. Spelled once because the page is nothing but paragraphs, and a copy per section drifts. */
const ABSATZ = "fluid-sm text-foreground leading-relaxed font-medium text-pretty";

function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-y-2">
      <h2 className="fluid-base text-foreground font-extrabold tracking-wide uppercase">{titel}</h2>
      {children}
    </section>
  );
}

export function ImpressumView() {
  return (
    <div className={`${PAGE_RISE} max-w-meta flex w-full flex-col items-center gap-y-4 text-left sm:gap-y-8`}>
      <div className="flex flex-col items-center px-2 text-center">
        <h1 className="fluid-2xl lg:fluid-3xl text-field-fg font-black tracking-tight uppercase drop-shadow-md">Impressum</h1>
      </div>

      {/* Neutral rather than the green pitch card the sibling meta views wear: this is a page somebody
          reads end to end, and the field foreground carries a paragraph badly at any length. */}
      <article className={`${card()} flex w-full flex-col gap-y-6 p-5 shadow-xl sm:p-6 lg:gap-y-8 lg:p-8`}>
        <Abschnitt titel="Angaben gemäß § 5 DDG">
          <p className={ABSATZ}>
            {VEREIN_NAME}
            <br />
            {VEREIN_ANSCHRIFT}
          </p>
        </Abschnitt>

        <Abschnitt titel="Vertreten durch">
          <p className={ABSATZ}>
            {VERTRETUNGSBERECHTIGTE.map((person) => (
              <span key={person}>
                {person}
                <br />
              </span>
            ))}
          </p>
          <p className={ABSATZ}>Beide sind einzeln zur Vertretung des Vereins berechtigt.</p>
        </Abschnitt>

        <Abschnitt titel="Kontakt">
          <p className={ABSATZ}>
            E-Mail:{" "}
            <Link
              href={`mailto:${KONTAKT_EMAIL}`}
              className={textLink()}>
              {KONTAKT_EMAIL}
            </Link>
          </p>
          <p className={ABSATZ}>
            Der Verein hat keinen Telefonanschluss. Über die E-Mail-Adresse oben erreichst Du uns in jeder Angelegenheit, und wir antworten so
            schnell wir können.
          </p>
        </Abschnitt>

        <Abschnitt titel="Registereintrag">
          <p className={ABSATZ}>
            Der Verein befindet sich in Gründung. Er ist in keinem Vereinsregister eingetragen, weshalb hier weder ein Registergericht noch eine
            Registernummer stehen kann. Sobald die Eintragung erfolgt ist, ergänzen wir beides an dieser Stelle.
          </p>
        </Abschnitt>

        <Abschnitt titel="Umsatzsteuer-Identifikationsnummer">
          <p className={ABSATZ}>Der Verein hat keine Umsatzsteuer-Identifikationsnummer nach § 27 a Umsatzsteuergesetz.</p>
        </Abschnitt>

        <Abschnitt titel="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
          <p className={ABSATZ}>
            {VERTRETUNGSBERECHTIGTE.map((person) => (
              <span key={person}>
                {person}, {VEREIN_ANSCHRIFT}
                <br />
              </span>
            ))}
          </p>
        </Abschnitt>

        <Abschnitt titel="Haftung für Inhalte">
          <p className={ABSATZ}>
            Wir stellen die Inhalte dieser Website nach bestem Wissen zusammen und halten sie aktuell, soweit uns das möglich ist. Für ihre
            Richtigkeit und Vollständigkeit können wir nicht einstehen. Als Diensteanbieter sind wir nach § 7 Abs. 1 DDG für eigene Inhalte
            verantwortlich, aber nach den §§ 8 bis 10 DDG nicht verpflichtet, fremde Informationen zu überwachen oder nach Umständen zu
            forschen, die auf eine rechtswidrige Tätigkeit hinweisen. Sobald wir von einer konkreten Rechtsverletzung erfahren, entfernen wir
            den betreffenden Inhalt umgehend.
          </p>
          <p className={ABSATZ}>
            Spielpläne, Ergebnisse und Tabellen dieser Website geben den Stand wieder, den die Liga zuletzt eingetragen hat. Sie sind kein
            amtliches Ergebnis und begründen keinen Anspruch.
          </p>
        </Abschnitt>

        <Abschnitt titel="Haftung für Links">
          <p className={ABSATZ}>
            Diese Website verweist an einigen Stellen auf fremde Websites, etwa auf die Seiten der teilnehmenden Schulen und auf unsere Profile
            in sozialen Netzwerken. Auf deren Inhalte haben wir keinen Einfluss, und wir machen sie uns nicht zu eigen. Für sie ist stets deren
            Anbieter verantwortlich. Zum Zeitpunkt der Verlinkung waren dort keine Rechtsverstöße erkennbar. Erfahren wir von einem, entfernen
            wir den Link.
          </p>
        </Abschnitt>

        <Abschnitt titel="Urheberrecht">
          <p className={ABSATZ}>
            Die Inhalte dieser Website, also Texte, Bilder, Grafiken und die Zusammenstellung der Liga-Daten, sind urheberrechtlich geschützt.
            Jede Verwendung außerhalb der Schranken des Urheberrechts braucht unsere Zustimmung. Für den privaten Gebrauch darfst Du die Seiten
            selbstverständlich lesen, ausdrucken und weiterschicken.
          </p>
        </Abschnitt>

        <Abschnitt titel="Name und Logo">
          <p className={ABSATZ}>
            „Frankfurt-League“ und „frankfurtleague“ in jeder Schreibweise sowie das Logo der Liga und alle davon abgeleiteten Gestaltungen sind
            der Liga vorbehalten. Der Quellcode dieser Website ist zwar öffentlich einsehbar und lizenziert, der Name und die Gestaltung sind es
            ausdrücklich nicht: die Lizenz des Quellcodes räumt daran keine Rechte ein, und auch sonst räumen wir daran keine ein. Wenn Du Name
            oder Logo verwenden möchtest, frag uns unter {KONTAKT_EMAIL}.
          </p>
        </Abschnitt>

        <Abschnitt titel="Verbraucherstreitbeilegung">
          <p className={ABSATZ}>
            Wir sind nicht bereit und nicht verpflichtet, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
            teilzunehmen.
          </p>
        </Abschnitt>

        <Abschnitt titel="Datenschutz">
          <p className={ABSATZ}>
            Was wir mit Deinen Daten machen, steht in der{" "}
            <Link
              href="/datenschutz"
              prefetch={false}
              className={textLink()}>
              Datenschutzerklärung
            </Link>
            .
          </p>
        </Abschnitt>
      </article>
    </div>
  );
}
