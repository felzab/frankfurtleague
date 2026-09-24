"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import PaperPlane from "@gravity-ui/icons/PaperPlane";

import { Button } from "@heroui/react/button";

import { einwilligungFassung } from "@/core/einwilligung";
import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung";
import { einladeSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import {
  SCHIEDSRICHTER_EINLADEN_OHNE_ADRESSE,
  SCHIEDSRICHTER_EINLADEN_STILLGELEGT,
  SCHIEDSRICHTER_KORREKTUR_HINWEIS,
  SCHIEDSRICHTER_MEDIEN_LABELS,
  SCHIEDSRICHTER_UMFANG_LABELS,
} from "@/features/schiedsrichter/constants";
import { labelBadge } from "@/shared/components/ui/badges";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSchiedsrichterBestaetigung } from "@/features/schiedsrichter/schemas";
import type { FLEinwilligung } from "@/features/spieler/schemas";
import type { PillTone } from "@/shared/components/ui/badges";
import type { ReactNode } from "react";

/**
 * A rejected action says nothing of whether the write committed. A second send is safe either way,
 * which is why this one invites it — and the previous link is dead on both readings.
 */
const OHNE_ANTWORT = "Prüfe die Verbindung und sende den Link noch einmal. Ein neuer Link ersetzt einen, der schon rausging.";

/** Beside the deadline rather than in the right-hand cluster, which is about the delivery. */
const LINK_ABGELAUFEN_LABEL = "abgelaufen";
const LINK_ABGELAUFEN_TINT: PillTone = "warning";

/** Closed on a person who answered: the endpoint refuses a second link, there being no page left to open. */
const SCHON_BESTAETIGT_GRUND = "Diese Person hat ihren Eintrag schon bestätigt.";

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
 * A stored label names an `@/core/einwilligung :: LIGA_KENNTNISNAHMEN` entry, so one no entry
 * answers is a record citing words nobody can produce, and a bare key renders the two alike.
 */
function Fassung({ textVersion }: { textVersion: string | null }) {
  if (textVersion === null) return <KeinTag>Nicht erfasst</KeinTag>;

  // Beside the key rather than instead of it: whoever repairs the mismatch needs the key that
  // resolved to nothing.
  if (einwilligungFassung(textVersion) === null) {
    return (
      <>
        {textVersion} <KeinTag>Unbekannte Fassung</KeinTag>
      </>
    );
  }

  return textVersion;
}

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
        {istAbgelaufen && <span className={`${labelBadge(LINK_ABGELAUFEN_TINT)} ms-2 h-7 shrink-0`}>{LINK_ABGELAUFEN_LABEL}</span>}
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

/** The record the referee's own press wrote, read back as facts. */
function EinwilligungStand({ einwilligung, geburtsdatum }: { einwilligung: FLEinwilligung; geburtsdatum: string | null }) {
  return (
    <dl className={FIELD_PAIR_CLASSES}>
      <Angabe label="Veröffentlichung">{SCHIEDSRICHTER_UMFANG_LABELS[einwilligung.umfang]}</Angabe>
      <Angabe label="Bestätigt am">
        {einwilligung.bestaetigt_am === null ? <KeinTag>Nicht bestätigt</KeinTag> : formatSpielDatum(einwilligung.bestaetigt_am)}
      </Angabe>
      {/* The key rather than a German gloss of it, which would be a second name for one wording. */}
      <Angabe label="Fassung">
        <Fassung textVersion={einwilligung.text_version} />
      </Angabe>
      <Angabe label="Medien">{einwilligung.medien ? SCHIEDSRICHTER_MEDIEN_LABELS.erteilt : SCHIEDSRICHTER_MEDIEN_LABELS.nicht_erteilt}</Angabe>
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
  geburtsdatum,
}: {
  schiedsrichterId: string;
  /** The STORED address, never the draft's: an unsaved box is not somewhere a message can go. */
  hatAdresse: boolean;
  isRetired: boolean;
  bestaetigung: FLSchiedsrichterBestaetigung | null;
  einwilligung: FLEinwilligung | null;
  geburtsdatum: string | null;
}) {
  const router = useRouter();
  const [sendet, setSendet] = useState(false);
  const panel = formPanel();

  const istBestaetigt = einwilligung?.bestaetigt_am != null;
  const sendeLabel = bestaetigung === null ? "Bestätigungslink senden" : "Link erneut senden";

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
    setSendet(true);
    // Awaited outside a transition, so a rejected action reaches no error boundary: uncaught, it
    // leaves „Sendet...“ standing for good and reports nothing.
    const res = await einladeSchiedsrichterAction({ id: schiedsrichterId }).catch(() => null);
    setSendet(false);

    // Before the toast either way: the failure arm reports a write that may have committed, so the
    // readout beneath it is stale on exactly the press that says so.
    router.refresh();

    // Thrown, no answer came back, so this control's repair names the connection; an answer, an
    // unknown outcome among them, carries its own sentence.
    if (res === null || !res.success) {
      appToast.failure("Bestätigungslink nicht gesendet", res ?? { error: OHNE_ANTWORT, outcome: "unknown" });
      return;
    }

    appToast.success("Bestätigungslink gesendet", { description: res.message });
  };

  return (
    <section className={panel.root()}>
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
          // The missing control belongs in the same breath: this panel stands among four editable
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
              geburtsdatum={geburtsdatum}
            />
          </>
        )}

        {/* Only while the record is outstanding, because that is the one state the correction mints
            in: on a confirmed referee the save moves the address and sends nothing. */}
        {!istBestaetigt && <p className="muted-hint">{SCHIEDSRICHTER_KORREKTUR_HINWEIS}</p>}

        <div className="flex w-full flex-col items-start">
          {/* Closed rather than withheld, so the refusal can name what to repair. `sendet` is left
              out of the reason: it ends by itself. */}
          <Hint
            mode="refusal"
            reason={verweigerung}
            label={sendeLabel}>
            <Button
              type="button"
              isPending={sendet}
              isDisabled={verweigerung !== null}
              onPress={() => void sende()}
              className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
              <PaperPlane
                className="size-3.5"
                aria-hidden="true"
              />
              <span>{sendet ? "Sendet..." : sendeLabel}</span>
            </Button>
          </Hint>
        </div>
      </div>
    </section>
  );
}
