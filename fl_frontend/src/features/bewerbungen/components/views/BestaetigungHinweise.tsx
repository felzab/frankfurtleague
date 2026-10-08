import { ABSATZ_CLASSES, FESTE_WERTE, Gefuellt } from "@/features/bewerbungen/components/ui/Gefuellt";
import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";

import { BestaetigungAbschnitt } from "./BestaetigungPanels";

import type { GekeyteFassung, KontaktAbsatzSchluessel, KontaktBedienSchluessel } from "@/core/einwilligungSeiten";
import type { Slots } from "@/shared/utils/stampedSlots";

/** The contact page's words, keyed as the page places them, under the label its answer stamps. */
export type KontaktFassung = GekeyteFassung<KontaktAbsatzSchluessel, KontaktBedienSchluessel>;

type KontaktAbsaetze = KontaktFassung["absaetze"];

const LISTE_CLASSES = `${ABSATZ_CLASSES} flex list-disc flex-col gap-y-1 pl-5`;
const ABSCHNITT_CLASSES = "flex flex-col gap-y-2";

/**
 * The slots a record fills from the person who opened the link
 * (`fl_frontend/src/features/bewerbungen/components/ui/Gefuellt.tsx :: Gefuellt`).
 */
const EIGENE_SLOTS = new Set(["vorname", "schule", "saison", "rolle"]);

/** A stamped paragraph, whichever key it stands under, filled as this page fills it wherever else it is quoted. */
export function Absatz({ text, werte }: { text: string; werte: Slots }) {
  return (
    <Gefuellt
      text={text}
      werte={werte}
      eigene={EIGENE_SLOTS}
    />
  );
}

/**
 * Rendered in the order a reader meets it rather than the legal draft's order: the WhatsApp
 * paragraph sits at its switch, the points at the button. **One column**: two give a page two
 * places to have stopped in.
 */
export function BestaetigungHinweise({
  absaetze,
  schule,
  saison,
  rolle,
  /** The floor the link's own read answered, which the standing text names in two paragraphs. */
  mindestalter,
  /** The objection control's own label, named in the text so a reader finds the control it describes. */
  ablehnenLabel,
}: {
  absaetze: KontaktAbsaetze;
  schule: string;
  saison: string;
  rolle: string;
  mindestalter: number;
  ablehnenLabel: string;
}) {
  const werte = { ...FESTE_WERTE, minAlter: String(mindestalter), schule: schule, saison: saison, rolle: rolle, ablehnen: ablehnenLabel };

  return (
    <BestaetigungAbschnitt titel="Was das bedeutet">
      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Worum es geht</h3>
        <p className={ABSATZ_CLASSES}>
          <Absatz
            text={absaetze.worum}
            werte={werte}
          />
        </p>
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Was gespeichert ist und wozu</h3>
        <p className={ABSATZ_CLASSES}>
          <Absatz
            text={absaetze.gespeichert}
            werte={werte}
          />
        </p>
        <p className={ABSATZ_CLASSES}>
          <Absatz
            text={absaetze.geburtsdatum}
            werte={werte}
          />
        </p>
        <p className={ABSATZ_CLASSES}>
          <Absatz
            text={absaetze.rechtsgrundlage}
            werte={werte}
          />
        </p>
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Was nicht passiert</h3>
        <p className={ABSATZ_CLASSES}>
          <Absatz
            text={absaetze.nichtOeffentlich}
            werte={werte}
          />
        </p>
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Wie lange wir sie behalten</h3>
        <ul className={LISTE_CLASSES}>
          <li>
            <Absatz
              text={absaetze.fristAbgelehnt}
              werte={werte}
            />
          </li>
          <li>
            <Absatz
              text={absaetze.fristAngenommen}
              werte={werte}
            />
          </li>
          <li>
            <Absatz
              text={absaetze.fristUnvollstaendig}
              werte={werte}
            />
          </li>
          <li>
            <Absatz
              text={absaetze.fristOhneEntscheidung}
              werte={werte}
            />
          </li>
        </ul>
      </section>

      <section className={ABSCHNITT_CLASSES}>
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Wenn Du nicht einverstanden bist</h3>
        <p className={ABSATZ_CLASSES}>
          <Absatz
            text={absaetze.ablehnen}
            werte={werte}
          />
        </p>
        <p className={ABSATZ_CLASSES}>
          <Absatz
            text={absaetze.widerruf}
            werte={werte}
          />
        </p>
        <p className={ABSATZ_CLASSES}>
          <Absatz
            text={absaetze.art21}
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
export function WiderspruchFolge({ absaetze }: { absaetze: KontaktAbsaetze }) {
  // The reveal's body scale rather than `ABSATZ_CLASSES`: this paragraph is read inside an escalation panel
  // and beside the rest of that panel's copy.
  return (
    <p className="fluid-xxs leading-normal font-medium text-foreground">
      <Absatz
        text={absaetze.ablehnenFolge}
        werte={FESTE_WERTE}
      />
    </p>
  );
}

/** Rendered whole under the switch it belongs to: the withdrawal sentence has to stand beside the consent it withdraws. */
export function WhatsappHinweis({ absaetze }: { absaetze: KontaktAbsaetze }) {
  return (
    <p className={ABSATZ_CLASSES}>
      <Absatz
        text={absaetze.whatsapp}
        werte={FESTE_WERTE}
      />
    </p>
  );
}

/**
 * Rendered whole under the media switch, and for every age: the switch alone goes below the served
 * age, so a record's label reproduces the screen whichever of the two its person was shown.
 */
export function MedienHinweis({ absaetze, medienMindestalter }: { absaetze: KontaktAbsaetze; medienMindestalter: number }) {
  return (
    <p className={ABSATZ_CLASSES}>
      <Absatz
        text={absaetze.medien}
        werte={{ ...FESTE_WERTE, medienMinAlter: String(medienMindestalter) }}
      />
    </p>
  );
}

/**
 * **The one wording of the points**: the button describes itself by this block's `id` rather
 * than by a summary sentence beside it, which is how a reader met the same promise twice.
 */
export function KlickBestaetigung({
  absaetze,
  id,
  vorname,
  schule,
  rolle,
  mindestalter,
}: {
  absaetze: KontaktAbsaetze;
  /** Published for the submit button's `aria-describedby`, so the points reach a reader who cannot see them. */
  id: string;
  vorname: string;
  schule: string;
  rolle: string;
  mindestalter: number;
}) {
  const werte = { ...FESTE_WERTE, minAlter: String(mindestalter), vorname: vorname, schule: schule, rolle: rolle };

  return (
    <div
      id={id}
      className="flex flex-col gap-y-3">
      <h3 className={FORM_SECTION_HEADING_CLASSES}>Was Du mit dem Klick bestätigst</h3>
      <ul className={LISTE_CLASSES}>
        <li>
          <Absatz
            text={absaetze.klickIdentitaet}
            werte={werte}
          />
        </li>
        <li>
          <Absatz
            text={absaetze.klickEintrag}
            werte={werte}
          />
        </li>
        <li>
          <Absatz
            text={absaetze.klickAlter}
            werte={werte}
          />
        </li>
        <li>
          <Absatz
            text={absaetze.klickHinweise}
            werte={werte}
          />
        </li>
      </ul>
      <p className={ABSATZ_CLASSES}>
        <Absatz
          text={absaetze.keineEinwilligung}
          werte={werte}
        />
      </p>
    </div>
  );
}
