import Link from "next/link";

import { KONTAKT_EMAIL } from "@/core/brand";
import { BESTAETIGUNG_ABSAETZE, fuelleFassung } from "@/core/einwilligung";
import { BEWERBUNG_MIN_ALTER } from "@/features/bewerbungen/constants";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { textLink } from "@/shared/components/ui/textLink";

import { ABSATZ, BestaetigungAbschnitt } from "./BestaetigungPanels";

const LISTE = `${ABSATZ} flex list-disc flex-col gap-y-1 pl-5`;
const ABSCHNITT = "flex flex-col gap-y-2";

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
 * Rendered in the order a reader meets it rather than the legal draft's order: the WhatsApp
 * paragraph sits at its switch, the four points at the button. **One column**: two give a page two
 * places to have stopped in.
 */
export function BestaetigungHinweise({
  schule,
  saison,
  rolle,
  /** The objection control's own label, named in the text so a reader finds the control it describes. */
  ablehnenLabel,
}: {
  schule: string;
  saison: string;
  rolle: string;
  ablehnenLabel: string;
}) {
  const werte = { ...KONSTANTEN, schule: schule, saison: saison, rolle: rolle, ablehnen: ablehnenLabel };

  return (
    <BestaetigungAbschnitt titel="Was das bedeutet">
      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Worum es geht</h3>
        <p className={ABSATZ}>{absatz("worum", werte)}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Was gespeichert ist und wozu</h3>
        <p className={ABSATZ}>{absatz("gespeichert", werte)}</p>
        <p className={ABSATZ}>{absatz("geburtsdatum", werte)}</p>
        <p className={ABSATZ}>{absatz("rechtsgrundlage", werte)}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Was nicht passiert</h3>
        <p className={ABSATZ}>{absatz("nichtOeffentlich", werte)}</p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Wie lange wir sie behalten</h3>
        <ul className={LISTE}>
          <li>{absatz("fristAbgelehnt", werte)}</li>
          <li>{absatz("fristAngenommen", werte)}</li>
          <li>{absatz("fristUnvollstaendig", werte)}</li>
        </ul>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Wenn Du nicht einverstanden bist</h3>
        <p className={ABSATZ}>{absatz("ablehnen", werte)}</p>
        <WiderrufAbsatz werte={werte} />
      </section>
    </BestaetigungAbschnitt>
  );
}

/**
 * What an objection does, inside the armed control's own reveal. Its own component rather than a
 * paragraph in the form, so the stamped text is rendered from one place whichever screen shows it.
 */
export function WiderspruchFolge() {
  // The reveal's body scale rather than `ABSATZ`: this paragraph is read inside an escalation panel
  // and beside the rest of that panel's copy.
  return <p className="fluid-xxs text-foreground leading-normal font-medium">{absatz("ablehnenFolge", KONSTANTEN)}</p>;
}

/** Rendered whole under the switch it belongs to: the withdrawal sentence has to stand beside the consent it withdraws. */
export function WhatsappHinweis() {
  return <p className={ABSATZ}>{absatz("whatsapp", KONSTANTEN)}</p>;
}

/**
 * **The one wording of the four points**: the button describes itself by this block's `id` rather
 * than by a summary sentence beside it, which is how a reader met the same promise twice.
 */
export function KlickBestaetigung({
  id,
  vorname,
  schule,
  rolle,
}: {
  /** Published for the submit button's `aria-describedby`, so the points reach a reader who cannot see them. */
  id: string;
  vorname: string;
  schule: string;
  rolle: string;
}) {
  const werte = { ...KONSTANTEN, vorname: vorname, schule: schule, rolle: rolle };

  return (
    <div
      id={id}
      className="flex flex-col gap-y-3">
      <h3 className={FORM_SECTION_HEADING}>Was Du mit dem Klick bestätigst</h3>
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
