"use client";

import {
  EINWILLIGUNG_HERKUNFT_LABELS,
  EINWILLIGUNG_MEDIEN_LABELS,
  EINWILLIGUNG_UMFANG_LABELS,
  EINWILLIGUNG_VEROEFFENTLICHUNG_HINWEIS,
} from "@/features/spieler/constants";
import { beschreibeNachweis } from "@/features/spieler/nachweis";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLEinwilligung } from "@/features/spieler/schemas";
import type { ReactNode } from "react";

/** One stored fact. A `<dl>` is its only valid parent: the pair is what makes the value a fact about the label. */
function Angabe({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <dt className="fluid-xxs font-bold text-foreground-muted">{label}</dt>
      <dd className="min-w-0 fluid-sm font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}

/** The act a choice stands on, under its value: the confirmation's day and label are another act's. */
function Beleg({ children }: { children: ReactNode }) {
  return <span className="block muted-meta">{children}</span>;
}

/** Its own grade, so a day the record does not carry never reads as one somebody wrote down. */
function KeinTag({ children }: { children: ReactNode }) {
  return <span className="text-foreground-muted italic">{children}</span>;
}

/**
 * A stored label names a label of the backend's registry, so one the registry does not hold is a
 * record citing words nobody can produce, and a bare key renders the two alike.
 */
function Fassung({ textVersion, istBekannt }: { textVersion: string | null; istBekannt: boolean | null }) {
  if (textVersion === null) return <KeinTag>Nicht erfasst</KeinTag>;

  // `null` where the registry's read failed: the key stands, and the check says it was not made.
  if (istBekannt === null) {
    return (
      <>
        {textVersion} <KeinTag>Nicht geprüft</KeinTag>
      </>
    );
  }

  // Beside the key rather than instead of it: whoever repairs the mismatch needs the key that
  // resolved to nothing.
  if (!istBekannt) {
    return (
      <>
        {textVersion} <KeinTag>Unbekannte Fassung</KeinTag>
      </>
    );
  }

  return textVersion;
}

/**
 * **No control and no draft field**: `fl_backend/app/core/domain.py` declares this field immutable,
 * so a picker here would offer a write no payload carries.
 */
export function FormEinwilligungSection({
  einwilligung,
  istFassungBekannt,
}: {
  einwilligung: FLEinwilligung | null;
  /** Whether the registry holds the stored label, resolved by the page through the words read. */
  istFassungBekannt: boolean | null;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Einwilligung">
          {/* Which of the two blocks stored under `einwilligung` this is: a pupil's consent to
              publication, where a contact seat's is a Kenntnisnahme that details may be held. */}
          <Hint
            mode="reveal"
            label="Hinweis zur Einwilligung"
            body={{ lead: "Was diese Spielerin oder dieser Spieler für die Veröffentlichung zugesagt hat." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {einwilligung === null ? (
          // The missing control belongs in the same breath: this panel stands among editable
          // ones, so a reader meeting an empty one goes looking for the way to record a consent.
          <p className="muted-hint">
            Für diese Spielerin oder diesen Spieler ist keine Einwilligung festgehalten. Eintragen lässt sie sich nicht.
          </p>
        ) : (
          <>
            <p className="muted-hint">Diese Angaben lassen sich nicht bearbeiten.</p>

            <dl className={FIELD_PAIR_CLASSES}>
              <Angabe label="Umfang">
                {EINWILLIGUNG_UMFANG_LABELS[einwilligung.umfang]}
                <Beleg>{beschreibeNachweis(einwilligung.nachweis.umfang, einwilligung.bestaetigt_am, einwilligung.text_version)}</Beleg>
              </Angabe>
              {/* A word and never a switch: this panel reads a record back, and a control here would
                  offer an administrator the answer that is the person's alone. */}
              <Angabe label="Medien">
                {einwilligung.medien ? EINWILLIGUNG_MEDIEN_LABELS.erteilt : EINWILLIGUNG_MEDIEN_LABELS.nicht_erteilt}
                <Beleg>{beschreibeNachweis(einwilligung.nachweis.medien, einwilligung.bestaetigt_am, einwilligung.text_version)}</Beleg>
              </Angabe>
              {/* A stored record's alone: nothing names who answered since, the person being the only one who may. */}
              {einwilligung.erteilt_von !== null && <Angabe label="Herkunft">{EINWILLIGUNG_HERKUNFT_LABELS[einwilligung.erteilt_von]}</Angabe>}
              {/* Never `fl_frontend/src/shared/utils/format.ts :: PLACEHOLDER`'s „Termin offen“: it promises a
                  day that is coming, and nobody was asked for this one. */}
              <Angabe label="Erteilt am">
                {einwilligung.datum === null ? <KeinTag>Kein Datum</KeinTag> : formatSpielDatum(einwilligung.datum)}
              </Angabe>
              {/* A state rather than a gap: an unconfirmed record is not one whose day went missing. */}
              <Angabe label="Bestätigt am">
                {einwilligung.bestaetigt_am === null ? <KeinTag>Nicht bestätigt</KeinTag> : formatSpielDatum(einwilligung.bestaetigt_am)}
              </Angabe>
              {/* The key rather than a German gloss of it, which would be a second name for one
                  wording. */}
              <Angabe label="Fassung der Bestätigung">
                <Fassung
                  textVersion={einwilligung.text_version}
                  istBekannt={istFassungBekannt}
                />
              </Angabe>
            </dl>
          </>
        )}

        {/* On both branches, because what the record answers is what the squad page serves: an
            administrator meeting an empty panel would otherwise read the list as the whole story. */}
        <p className="muted-hint">{EINWILLIGUNG_VEROEFFENTLICHUNG_HINWEIS}</p>
      </div>
    </section>
  );
}
