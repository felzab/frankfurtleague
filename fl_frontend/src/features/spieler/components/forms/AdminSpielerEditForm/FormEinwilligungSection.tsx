"use client";

import { Beleg, Fassung } from "@/features/spieler/components/ui/Nachweis";
import {
  EINWILLIGUNG_FASSUNG_FRAGE,
  EINWILLIGUNG_MEDIEN_FRAGE,
  EINWILLIGUNG_MEDIEN_LABELS,
  EINWILLIGUNG_UMFANG_LABELS,
  EINWILLIGUNG_VEROEFFENTLICHUNG_HINWEIS,
} from "@/features/spieler/constants";
import { bestaetigungOf } from "@/features/spieler/nachweis";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLEinwilligung } from "@/features/spieler/schemas";

/**
 * **No control and no draft field**: `fl_backend/app/api/spieler/schemas.py :: FLPatchSpielerPayload` carries no
 * consent, which only the person's own writes grant, so a picker here would offer a write no payload carries.
 */
export function FormEinwilligungSection({
  einwilligung,
  istFassungBekannt,
}: {
  einwilligung: FLEinwilligung;
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
        <p className="muted-hint">Diese Angaben lassen sich nicht bearbeiten.</p>

        <dl className={FIELD_PAIR_CLASSES}>
          <Angabe label="Umfang">
            {EINWILLIGUNG_UMFANG_LABELS[einwilligung.umfang]}
            <Beleg
              nachweis={einwilligung.nachweis.umfang}
              bestaetigung={bestaetigungOf(einwilligung)}
            />
          </Angabe>
          {/* A word and never a switch: this panel reads a record back, and a control here would
                offer an administrator the answer that is the person's alone. */}
          <Angabe label={EINWILLIGUNG_MEDIEN_FRAGE}>
            {einwilligung.medien ? EINWILLIGUNG_MEDIEN_LABELS.erteilt : EINWILLIGUNG_MEDIEN_LABELS.nicht_erteilt}
            <Beleg
              nachweis={einwilligung.nachweis.medien}
              bestaetigung={bestaetigungOf(einwilligung)}
            />
          </Angabe>
          <Angabe label="Erteilt am">{formatSpielDatum(einwilligung.datum)}</Angabe>
          <Angabe label="Bestätigt am">
            {einwilligung.bestaetigt_am === null ? <Leer>Nicht bestätigt</Leer> : formatSpielDatum(einwilligung.bestaetigt_am)}
          </Angabe>
          {/* The key rather than a German gloss of it, which would be a second name for one
                wording. */}
          <Angabe label={EINWILLIGUNG_FASSUNG_FRAGE}>
            <Fassung
              textVersion={einwilligung.text_version}
              istBekannt={istFassungBekannt}
            />
          </Angabe>
        </dl>

        <p className="muted-hint">{EINWILLIGUNG_VEROEFFENTLICHUNG_HINWEIS}</p>
      </div>
    </section>
  );
}
