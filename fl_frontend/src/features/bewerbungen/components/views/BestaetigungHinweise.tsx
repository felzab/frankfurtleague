import { KONTAKT_EMAIL } from "@/core/brand";
import { BESTAETIGUNG_ABSAETZE } from "@/core/einwilligung";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";

import { ABSATZ, BestaetigungAbschnitt, Gefuellt } from "./BestaetigungPanels";

import type { Slots } from "./BestaetigungPanels";

const LISTE = `${ABSATZ} flex list-disc flex-col gap-y-1 pl-5`;
const ABSCHNITT = "flex flex-col gap-y-2";

// No `{minAlter}` here: two of the three seats answer it differently, so a constant would put a
// number on the page that the press is not judged by.
/** What fills a slot for every reader alike; the rest come off the record the page was opened with. */
const KONSTANTEN = { kontakt: KONTAKT_EMAIL } as const;

/** The slots a record fills from the person who opened the link (`BestaetigungPanels.tsx :: Gefuellt`). */
const EIGENE_SLOTS = new Set(["vorname", "schule", "saison", "rolle"]);

/** A stamped paragraph, whichever key it stands under, filled as this page fills it wherever else it is quoted. */
export function Absatz({ schluessel, werte }: { schluessel: keyof typeof BESTAETIGUNG_ABSAETZE; werte: Slots }) {
  return (
    <Gefuellt
      text={BESTAETIGUNG_ABSAETZE[schluessel]}
      werte={werte}
      eigene={EIGENE_SLOTS}
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
  /** The floor the link's own read answered, which the standing text names in two paragraphs. */
  mindestalter,
  /** The objection control's own label, named in the text so a reader finds the control it describes. */
  ablehnenLabel,
}: {
  schule: string;
  saison: string;
  rolle: string;
  mindestalter: number;
  ablehnenLabel: string;
}) {
  const werte = { ...KONSTANTEN, minAlter: String(mindestalter), schule: schule, saison: saison, rolle: rolle, ablehnen: ablehnenLabel };

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
          <li>
            <Absatz
              schluessel="fristOhneEntscheidung"
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
        <p className={ABSATZ}>
          <Absatz
            schluessel="art21"
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
  mindestalter,
}: {
  /** Published for the submit button's `aria-describedby`, so the points reach a reader who cannot see them. */
  id: string;
  vorname: string;
  schule: string;
  rolle: string;
  mindestalter: number;
}) {
  const werte = { ...KONSTANTEN, minAlter: String(mindestalter), vorname: vorname, schule: schule, rolle: rolle };

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
