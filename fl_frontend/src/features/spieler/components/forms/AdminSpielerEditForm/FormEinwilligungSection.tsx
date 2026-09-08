"use client";

import { EINWILLIGUNG_HERKUNFT_LABELS, EINWILLIGUNG_UMFANG_LABELS } from "@/features/spieler/constants";
import { FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
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
      <dt className="fluid-xxs text-foreground-muted font-bold">{label}</dt>
      <dd className="fluid-sm text-foreground min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

/** Its own grade, so a day the record does not carry never reads as one somebody wrote down. */
function KeinTag({ children }: { children: ReactNode }) {
  return <span className="text-foreground-muted italic">{children}</span>;
}

/**
 * **No control and no draft field**: `fl_backend/app/core/domain.py` declares this field immutable,
 * so a picker here would offer a write no payload carries.
 */
export function FormEinwilligungSection({ einwilligung }: { einwilligung: FLEinwilligung | null }) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Einwilligung">
          {/* Which of the two consents this is: the contact seat's block of the same name says only
              that details may be held, and nothing on screen tells them apart. */}
          <Hint
            mode="reveal"
            label="Hinweis zur Einwilligung"
            body={{ lead: "Was diese Spielerin oder dieser Spieler für die Veröffentlichung zugesagt hat." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {einwilligung === null ? (
          // The missing control belongs in the same breath: this panel stands among four editable
          // ones, so a reader meeting an empty one goes looking for the way to record a consent.
          <p className="muted-hint">
            Für diese Spielerin oder diesen Spieler ist keine Einwilligung festgehalten. Eintragen lässt sie sich nicht.
          </p>
        ) : (
          <>
            <p className="muted-hint">Diese Angaben lassen sich nicht bearbeiten.</p>

            <dl className={FIELD_PAIR}>
              <Angabe label="Umfang">{EINWILLIGUNG_UMFANG_LABELS[einwilligung.umfang]}</Angabe>
              <Angabe label="Herkunft">{EINWILLIGUNG_HERKUNFT_LABELS[einwilligung.erteilt_von]}</Angabe>
              {/* Never `fl_frontend/src/shared/utils/format.ts :: PLACEHOLDER`'s „TBD“: it promises a
                  day that is coming, and nobody was asked for this one. */}
              <Angabe label="Erteilt am">
                {einwilligung.datum === null ? <KeinTag>Kein Datum</KeinTag> : formatSpielDatum(einwilligung.datum)}
              </Angabe>
              {/* A state rather than a gap: an unconfirmed record is not one whose day went missing. */}
              <Angabe label="Bestätigt am">
                {einwilligung.bestaetigt_am === null ? <KeinTag>Nicht bestätigt</KeinTag> : formatSpielDatum(einwilligung.bestaetigt_am)}
              </Angabe>
            </dl>
          </>
        )}

        {/* On both branches, because the record gates nothing either way: an administrator reading
            „Nur innerhalb der Liga“ would otherwise take this player off the public squad list. */}
        <p className="muted-hint">
          Der Eintrag steuert die Veröffentlichung nicht: Im öffentlichen Kader stehen Vorname und erster Buchstabe des Nachnamens jeder
          Spielerin und jedes Spielers.
        </p>
      </div>
    </section>
  );
}
