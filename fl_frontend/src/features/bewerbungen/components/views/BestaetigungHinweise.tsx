import Link from "next/link";

import { KONTAKT_EMAIL } from "@/core/brand";
import { BESTAETIGUNG_ABSAETZE, fuelleFassung } from "@/core/einwilligung";
import { BEWERBUNG_MIN_ALTER } from "@/features/bewerbungen/constants";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { textLink } from "@/shared/components/ui/textLink";

// One step larger than the form's copy of its consent text: here the words are the page's subject
// rather than a footnote under a switch.
const ABSATZ = "fluid-sm text-foreground leading-relaxed font-medium text-pretty";
const LISTE = `${ABSATZ} flex list-disc flex-col gap-y-1 pl-5`;
const ABSCHNITT = "flex flex-col gap-y-2";
const ABSCHNITT_TITEL = "fluid-xs text-foreground font-bold";

/** What fills a slot for every reader alike; the rest come off the record the page was opened with. */
const KONSTANTEN = { minAlter: String(BEWERBUNG_MIN_ALTER), kontakt: KONTAKT_EMAIL } as const;

/** The `{datenschutz}` slot's value, so the stored sentence and the rendered one read the same. */
const DATENSCHUTZ_TEXT = "Datenschutzerklärung";

type Slots = Readonly<Record<string, string>>;

const absatz = (schluessel: keyof typeof BESTAETIGUNG_ABSAETZE, werte: Slots): string =>
  fuelleFassung(BESTAETIGUNG_ABSAETZE[schluessel], werte);

function DatenschutzLink() {
  return (
    <Link
      href="/datenschutz"
      prefetch={false}
      className={textLink()}>
      {DATENSCHUTZ_TEXT}
    </Link>
  );
}

/** Split at the slot rather than at the filled words: the link has to keep its place inside the stored sentence. */
function WiderrufAbsatz({ werte }: { werte: Slots }) {
  const [vor = "", nach = ""] = BESTAETIGUNG_ABSAETZE.widerruf.split("{datenschutz}");

  return (
    <p className={ABSATZ}>
      {fuelleFassung(vor, werte)}
      <DatenschutzLink />
      {fuelleFassung(nach, werte)}
    </p>
  );
}

/**
 * The information text, rendered in the order a reader meets it rather than the order the legal
 * draft declares it in: the WhatsApp paragraph sits at its switch and the four points at the button.
 */
export function BestaetigungHinweise({
  schule,
  saison,
  rolle,
  /** The decline control's own label, named in the text so a reader finds the control it describes. */
  ablehnenLabel,
}: {
  schule: string;
  saison: string;
  rolle: string;
  ablehnenLabel: string;
}) {
  const werte = { ...KONSTANTEN, schule: schule, saison: saison, rolle: rolle, ablehnen: ablehnenLabel };

  return (
    <div className="flex flex-col gap-y-5">
      <h2 className={FORM_SECTION_HEADING}>Was das bedeutet</h2>

      <section className={ABSCHNITT}>
        <h3 className={ABSCHNITT_TITEL}>Worum es geht</h3>
        <p className={ABSATZ}>{absatz("worum", werte)}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={ABSCHNITT_TITEL}>Was gespeichert ist und wozu</h3>
        <p className={ABSATZ}>{absatz("gespeichert", werte)}</p>
        <p className={ABSATZ}>{absatz("geburtsdatum", werte)}</p>
        <p className={ABSATZ}>{absatz("rechtsgrundlage", werte)}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={ABSCHNITT_TITEL}>Was nicht passiert</h3>
        <p className={ABSATZ}>{absatz("nichtOeffentlich", werte)}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={ABSCHNITT_TITEL}>Wie lange wir sie behalten</h3>
        <ul className={LISTE}>
          <li>{absatz("fristAbgelehnt", werte)}</li>
          <li>{absatz("fristAngenommen", werte)}</li>
          <li>{absatz("fristUnvollstaendig", werte)}</li>
        </ul>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={ABSCHNITT_TITEL}>Wenn Du nicht einverstanden bist</h3>
        <p className={ABSATZ}>{absatz("ablehnen", werte)}</p>
        <WiderrufAbsatz werte={werte} />
      </section>
    </div>
  );
}

/** Rendered whole under the switch it belongs to: the withdrawal sentence has to stand beside the consent it withdraws. */
export function WhatsappHinweis() {
  return <p className={ABSATZ}>{absatz("whatsapp", KONSTANTEN)}</p>;
}

/** The four points directly above the button whose press records them, so the list and the act are one screen apart at most. */
export function KlickBestaetigung({ vorname, schule, rolle }: { vorname: string; schule: string; rolle: string }) {
  const werte = { ...KONSTANTEN, vorname: vorname, schule: schule, rolle: rolle };

  return (
    <div className="flex flex-col gap-y-3">
      <h2 className={FORM_SECTION_HEADING}>Was Du mit dem Klick bestätigst</h2>
      <ul className={LISTE}>
        <li>{absatz("klickIdentitaet", werte)}</li>
        <li>{absatz("klickEintrag", werte)}</li>
        <li>{absatz("klickAlter", werte)}</li>
        <li>{absatz("klickHinweise", werte)}</li>
      </ul>
      <p className={ABSATZ}>{absatz("keineEinwilligung", werte)}</p>
    </div>
  );
}
