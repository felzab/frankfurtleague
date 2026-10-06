"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import PaperPlane from "@gravity-ui/icons/PaperPlane";

import { Button } from "@heroui/react/button";

import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung";
import { einladeSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import {
  SCHIEDSRICHTER_ADRESSWECHSEL_HINWEIS,
  SCHIEDSRICHTER_EINLADEN_OHNE_ADRESSE,
  SCHIEDSRICHTER_EINLADEN_STILLGELEGT,
  SCHIEDSRICHTER_KORREKTUR_HINWEIS,
  SCHIEDSRICHTER_UMFANG_LABELS,
} from "@/features/schiedsrichter/constants";
import { Beleg, Fassung, KeinTag } from "@/features/spieler/components/ui/Nachweis";
import { EINWILLIGUNG_FASSUNG_FRAGE, EINWILLIGUNG_MEDIEN_FRAGE, EINWILLIGUNG_MEDIEN_LABELS } from "@/features/spieler/constants";
import { Angabe } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { LINK_ERNEUT_OHNE_ANTWORT, rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { benannt } from "@/shared/utils/benannt";
import { getGermanTodayStr } from "@/shared/utils/date";
import { DRAFT_DISCARDED, guardAgainstDraft } from "@/shared/utils/draftGuard";
import { focusAfterWrite, focusSection } from "@/shared/utils/focusAfterWrite";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSchiedsrichterBestaetigung } from "@/features/schiedsrichter/schemas";
import type { FLEinwilligung } from "@/features/spieler/schemas";
import type { PillTone } from "@/shared/components/ui/badges";

/** Beside the deadline rather than in the right-hand cluster, which is about the delivery. */
const LINK_ABGELAUFEN_LABEL = "abgelaufen";
const LINK_ABGELAUFEN_TINT: PillTone = "warning";

/** A lapsed link's mark beside its deadline, in this panel and the address change's, so one state is one word in both. */
export function LinkAbgelaufen() {
  return <span className={`${labelBadge(LINK_ABGELAUFEN_TINT)} ms-2 h-7 shrink-0`}>{LINK_ABGELAUFEN_LABEL}</span>;
}

/**
 * The re-send's accessible name, its link named for this panel as the address change's panel names its
 * own: a confirmed referee's editor can show both re-sends, each for another link.
 */
export const BESTAETIGUNG_ERNEUT = benannt("Link erneut senden", "Bestätigung");

/** Closed on a person who answered: the endpoint refuses a second link, there being no page left to open. */
const SCHON_BESTAETIGT_GRUND = "Diese Person hat ihren Eintrag schon bestätigt.";

/** What the last link reached, where one has gone out at all. */
function LinkStand({ bestaetigung, istBestaetigt }: { bestaetigung: FLSchiedsrichterBestaetigung; istBestaetigt: boolean }) {
  const zustellung = bestaetigung.zustellung === null ? null : ZUSTELLUNG_CHIP[bestaetigung.zustellung.stand];
  // A date an administrator reads as a deadline says nothing once it is past, and the answer
  // („einen neuen schicken“) is the control in this same panel.
  const istAbgelaufen = !istBestaetigt && bestaetigung.frist < getGermanTodayStr();

  return (
    <dl className={FIELD_PAIR_CLASSES}>
      <Angabe label="Link gesendet am">{formatSpielDatum(bestaetigung.verschickt_am)}</Angabe>
      <Angabe label="Gültig bis">
        {formatSpielDatum(bestaetigung.frist)}
        {istAbgelaufen && <LinkAbgelaufen />}
      </Angabe>
      {/* A state rather than a gap: nothing reminds a referee, so „Keine Erinnerung“ is the fact
          rather than a day that went missing. */}
      <Angabe label="Erinnert am">
        {bestaetigung.erinnert_am === null ? <KeinTag>Keine Erinnerung</KeinTag> : formatSpielDatum(bestaetigung.erinnert_am)}
      </Angabe>
      <Angabe label="Zustellung">
        {/* `null` covers accepted and delivered alike: the chip exists for what an administrator can
            act on, and the delivery register spells the one word for a blocked address. */}
        {zustellung === null ? (
          <KeinTag>Nichts zu melden</KeinTag>
        ) : (
          <span className={`${labelBadge(zustellung.tone)} h-7 shrink-0`}>{zustellung.label}</span>
        )}
      </Angabe>
    </dl>
  );
}

/** The referee's record read back as facts, each choice with the act that set it. */
function EinwilligungStand({
  einwilligung,
  istFassungBekannt,
  geburtsdatum,
}: {
  einwilligung: FLEinwilligung;
  istFassungBekannt: boolean | null;
  geburtsdatum: string | null;
}) {
  return (
    <dl className={FIELD_PAIR_CLASSES}>
      <Angabe label="Veröffentlichung">
        {SCHIEDSRICHTER_UMFANG_LABELS[einwilligung.umfang]}
        <Beleg
          nachweis={einwilligung.nachweis.umfang}
          bestaetigtAm={einwilligung.bestaetigt_am}
          textVersion={einwilligung.text_version}
        />
      </Angabe>
      <Angabe label={EINWILLIGUNG_MEDIEN_FRAGE}>
        {einwilligung.medien ? EINWILLIGUNG_MEDIEN_LABELS.erteilt : EINWILLIGUNG_MEDIEN_LABELS.nicht_erteilt}
        <Beleg
          nachweis={einwilligung.nachweis.medien}
          bestaetigtAm={einwilligung.bestaetigt_am}
          textVersion={einwilligung.text_version}
        />
      </Angabe>
      <Angabe label="Bestätigt am">
        {einwilligung.bestaetigt_am === null ? <KeinTag>Nicht bestätigt</KeinTag> : formatSpielDatum(einwilligung.bestaetigt_am)}
      </Angabe>
      {/* The key rather than a German gloss of it, which would be a second name for one wording. */}
      <Angabe label={EINWILLIGUNG_FASSUNG_FRAGE}>
        <Fassung
          textVersion={einwilligung.text_version}
          istBekannt={istFassungBekannt}
        />
      </Angabe>
      {/* Beside the record because the same press wrote it, and on no field of this form: the person
          enters it themselves and no admin payload carries it. */}
      <Angabe label="Geburtsdatum">{geburtsdatum === null ? <KeinTag>Nicht erfasst</KeinTag> : formatSpielDatum(geburtsdatum)}</Angabe>
    </dl>
  );
}

/**
 * **No control over the record and one over the link**: the consent is the referee's own answer, so
 * a picker here would offer an administrator a write that is not theirs, while the link is the
 * league's to send again.
 */
export function FormBestaetigungSection({
  schiedsrichterId,
  hatAdresse,
  isRetired,
  bestaetigung,
  einwilligung,
  istFassungBekannt,
  geburtsdatum,
  isDirty,
}: {
  schiedsrichterId: string;
  /** The STORED address, never the draft's: an unsaved box is not somewhere a message can go. */
  hatAdresse: boolean;
  isRetired: boolean;
  bestaetigung: FLSchiedsrichterBestaetigung | null;
  einwilligung: FLEinwilligung | null;
  /** Whether the registry holds the stored label, resolved by the page through the words read. */
  istFassungBekannt: boolean | null;
  geburtsdatum: string | null;
  /** The editor's unsaved typing, which the mint re-keys the editor over. */
  isDirty: boolean;
}) {
  const router = useRouter();
  const [sendet, setSendet] = useState(false);
  const stepUp = useStepUp();
  const panel = formPanel();

  const istBestaetigt = einwilligung?.bestaetigt_am != null;
  const sendeLabel = bestaetigung === null ? "Bestätigungslink senden" : "Link erneut senden";
  const sendeName = bestaetigung === null ? sendeLabel : BESTAETIGUNG_ERNEUT;

  // In the order the endpoint raises them, so the sentence names the first thing to repair rather
  // than the one an administrator would fix second.
  const verweigerung = isRetired
    ? SCHIEDSRICHTER_EINLADEN_STILLGELEGT
    : istBestaetigt
      ? SCHON_BESTAETIGT_GRUND
      : hatAdresse
        ? null
        : SCHIEDSRICHTER_EINLADEN_OHNE_ADRESSE;

  const sende = async () => {
    if (!guardAgainstDraft(isDirty, DRAFT_DISCARDED)) return;

    // The page re-keys on the minted link's record, drawing this control anew under its next label.
    const landing = focusAfterWrite();
    setSendet(true);
    // A new link voids the one the referee holds (`docs/frontend/spec.md :: I432`).
    if (!(await stepUp.confirm(true))) {
      setSendet(false);
      return;
    }

    // Awaited outside a transition, so a rejected action reaches no error boundary: uncaught, it
    // leaves „Sendet...“ standing for good and reports nothing.
    const res = await einladeSchiedsrichterAction({ id: schiedsrichterId }).catch(rejectedWrite(router, LINK_ERNEUT_OHNE_ANTWORT));
    setSendet(false);

    // A rejection, which no answer came back from, carries this control's repair naming the connection; an
    // answer, an unknown outcome among them, carries its own sentence.
    if (!res.success) {
      appToast.failure("Bestätigungslink nicht gesendet", res);
      return;
    }

    landing.landed();
    appToast.success("Bestätigungslink gesendet", { description: res.message });
  };

  return (
    <section
      className={panel.root()}
      {...focusSection("bestaetigung")}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Bestätigung">
          <Hint
            mode="reveal"
            label="Hinweis zur Bestätigung"
            body={{
              lead: "Was diese Person selbst über ihren Eintrag und die Veröffentlichung ihres Namens beantwortet hat, und was aus dem Link dorthin wurde.",
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {bestaetigung === null ? (
          <p className="muted-hint">Für diese Person wurde noch kein Bestätigungslink gesendet.</p>
        ) : (
          <LinkStand
            bestaetigung={bestaetigung}
            istBestaetigt={istBestaetigt}
          />
        )}

        {einwilligung === null ? (
          // The missing control belongs in the same breath: this panel stands among editable
          // ones, so a reader meeting an empty one goes looking for the way to record a consent.
          <p className="muted-hint">
            Diese Person hat ihren Eintrag noch nicht bestätigt. Bis dahin steht im Spielplan bei ihren Spielen „anonym“, und eintragen lässt
            sich die Einwilligung nicht.
          </p>
        ) : (
          <>
            <p className="muted-hint">Diese Angaben lassen sich nicht bearbeiten.</p>
            <EinwilligungStand
              einwilligung={einwilligung}
              istFassungBekannt={istFassungBekannt}
              geburtsdatum={geburtsdatum}
            />
          </>
        )}

        {/* One sentence per state, because the save mints a different link in each: a consent link
            while the record is outstanding, an address link once it is given. */}
        <p className="muted-hint">{istBestaetigt ? SCHIEDSRICHTER_ADRESSWECHSEL_HINWEIS : SCHIEDSRICHTER_KORREKTUR_HINWEIS}</p>

        <div className="flex w-full flex-col items-start">
          {/* Closed rather than withheld, so the refusal can name what to repair. `sendet` is left
              out of the reason: it ends by itself. */}
          <FocusSlot name="einladen">
            <Hint
              mode="refusal"
              reason={verweigerung}
              label={sendeName}>
              <Button
                type="button"
                isPending={sendet}
                isDisabled={verweigerung !== null}
                aria-label={sendeName}
                onPress={() => void sende()}
                className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
                <PaperPlane
                  className="size-3.5"
                  aria-hidden="true"
                />
                <span>{sendet ? stepUp.running("Sendet...") : sendeLabel}</span>
              </Button>
            </Hint>
          </FocusSlot>
          <StepUpRefused refused={stepUp.refused} />
        </div>
      </div>
    </section>
  );
}
