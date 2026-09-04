import { Fragment } from "react";
import Link from "next/link";

import { KONTAKT_EMAIL } from "@/core/brand";
import { BESTAETIGUNG_ABSAETZE } from "@/core/einwilligung";
import { BEWERBUNG_MIN_ALTER } from "@/features/bewerbungen/constants";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { textLink } from "@/shared/components/ui/textLink";

import { ABSATZ, BestaetigungAbschnitt, Wert } from "./BestaetigungPanels";

import type { ReactNode } from "react";

const LISTE = `${ABSATZ} flex list-disc flex-col gap-y-1 pl-5`;
const ABSCHNITT = "flex flex-col gap-y-2";

/** What fills a slot for every reader alike; the rest come off the record the page was opened with. */
const KONSTANTEN = { minAlter: String(BEWERBUNG_MIN_ALTER), kontakt: KONTAKT_EMAIL } as const;

/** The `{datenschutz}` slot's value, so the stored sentence and the rendered one read the same. */
const DATENSCHUTZ_TEXT = "Datenschutzerklärung";
const DATENSCHUTZ_SLOT = "datenschutz";

/**
 * The slots a record fills from the person who opened the link. **Emphasis is presentation**, so it
 * is decided here rather than in the stored sentence, whose words and digest do not move for it.
 */
const EIGENE_SLOTS = new Set(["vorname", "schule", "saison", "rolle"]);

type Slots = Readonly<Record<string, string>>;

/** Split on the slots themselves, so the capture group keeps each one as a piece of its own. */
const SLOT_TEILER = /(\{\w+\})/;

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

/** One piece of a split sentence: a slot in whatever its kind earns, or the words as they stand. */
function stueckInhalt(stueck: string, werte: Slots): ReactNode {
  const name = /^\{(\w+)\}$/.exec(stueck)?.[1];

  if (name === undefined) return stueck;
  // Ahead of the record, which holds no value for it: this slot's words are the link's own.
  if (name === DATENSCHUTZ_SLOT) return <DatenschutzLink />;

  const wert = werte[name];

  // A slot no record filled stands as written, which is `fuelleFassung`'s rule at the string end.
  if (wert === undefined) return stueck;

  return EIGENE_SLOTS.has(name) ? <Wert>{wert}</Wert> : wert;
}

/**
 * A stored sentence with its slots filled here rather than by `fuelleFassung`, which answers a
 * string: a string cannot carry the mark a reader's own name has to wear, nor the privacy link.
 */
function Gefuellt({ text, werte }: { text: string; werte: Slots }) {
  return (
    <>
      {text.split(SLOT_TEILER).map((stueck, index) => (
        <Fragment key={`${String(index)}-${stueck}`}>{stueckInhalt(stueck, werte)}</Fragment>
      ))}
    </>
  );
}

/** A stamped paragraph, whichever key it stands under. */
function Absatz({ schluessel, werte }: { schluessel: keyof typeof BESTAETIGUNG_ABSAETZE; werte: Slots }) {
  return (
    <Gefuellt
      text={BESTAETIGUNG_ABSAETZE[schluessel]}
      werte={werte}
    />
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
        <p className={ABSATZ}>
          <Absatz
            schluessel="worum"
            werte={werte}
          />
        </p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Was gespeichert ist und wozu</h3>
        <p className={ABSATZ}>
          <Absatz
            schluessel="gespeichert"
            werte={werte}
          />
        </p>
        <p className={ABSATZ}>
          <Absatz
            schluessel="geburtsdatum"
            werte={werte}
          />
        </p>
        <p className={ABSATZ}>
          <Absatz
            schluessel="rechtsgrundlage"
            werte={werte}
          />
        </p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Was nicht passiert</h3>
        <p className={ABSATZ}>
          <Absatz
            schluessel="nichtOeffentlich"
            werte={werte}
          />
        </p>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Wie lange wir sie behalten</h3>
        <ul className={LISTE}>
          <li>
            <Absatz
              schluessel="fristAbgelehnt"
              werte={werte}
            />
          </li>
          <li>
            <Absatz
              schluessel="fristAngenommen"
              werte={werte}
            />
          </li>
          <li>
            <Absatz
              schluessel="fristUnvollstaendig"
              werte={werte}
            />
          </li>
        </ul>
      </section>

      <section className={ABSCHNITT}>
        <h3 className={FORM_SECTION_HEADING}>Wenn Du nicht einverstanden bist</h3>
        <p className={ABSATZ}>
          <Absatz
            schluessel="ablehnen"
            werte={werte}
          />
        </p>
        <p className={ABSATZ}>
          <Absatz
            schluessel="widerruf"
            werte={werte}
          />
        </p>
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
  return (
    <p className="fluid-xxs text-foreground leading-normal font-medium">
      <Absatz
        schluessel="ablehnenFolge"
        werte={KONSTANTEN}
      />
    </p>
  );
}

/** Rendered whole under the switch it belongs to: the withdrawal sentence has to stand beside the consent it withdraws. */
export function WhatsappHinweis() {
  return (
    <p className={ABSATZ}>
      <Absatz
        schluessel="whatsapp"
        werte={KONSTANTEN}
      />
    </p>
  );
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
        <li>
          <Absatz
            schluessel="klickIdentitaet"
            werte={werte}
          />
        </li>
        <li>
          <Absatz
            schluessel="klickEintrag"
            werte={werte}
          />
        </li>
        <li>
          <Absatz
            schluessel="klickAlter"
            werte={werte}
          />
        </li>
        <li>
          <Absatz
            schluessel="klickHinweise"
            werte={werte}
          />
        </li>
      </ul>
      <p className={ABSATZ}>
        <Absatz
          schluessel="keineEinwilligung"
          werte={werte}
        />
      </p>
    </div>
  );
}
