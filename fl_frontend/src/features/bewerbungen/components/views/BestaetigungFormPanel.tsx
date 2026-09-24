"use client";

import { startTransition, useId, useMemo, useState, useTransition } from "react";

import CircleCheck from "@gravity-ui/icons/CircleCheck";
import { parseDate } from "@internationalized/date";

import { Button } from "@heroui/react/button";
import { Label } from "@heroui/react/label";
import { Switch } from "@heroui/react/switch";

import { BESTAETIGUNG_KENNTNISNAHME } from "@/core/einwilligung";
import { buildEinwilligungAntwortPayloadSchema } from "@/features/bewerbungen/schemas";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { AppDatePicker } from "@/shared/components/ui/DateTimeFields";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_LABEL_CLASSES, FIELD_PAIR_CLASSES, FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { Hint } from "@/shared/components/ui/Hint";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { ANTWORT_UNKLAR, postPublicForm } from "@/shared/utils/publicSubmit";

import { BestaetigungHinweise, KlickBestaetigung, WhatsappHinweis, WiderspruchFolge } from "./BestaetigungHinweise";
import { BestaetigungAbschnitt } from "./BestaetigungPanels";

import type { FLBewerbungEinwilligungAntwortPayload } from "@/features/bewerbungen/schemas";
import type { LinkZustand } from "@/features/bewerbungen/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { CalendarDate } from "@internationalized/date";

/** What one press ends in, handed up to the page that swaps the form for the panel. */
export type BestaetigungAbschluss =
  { zustand: "erfolg"; geburtsdatum: string | null; whatsapp: boolean } | { zustand: "widersprochen-neu" } | { zustand: LinkZustand };

type EinwilligungAntwort =
  | { success: true; ergebnis: "bestaetigt" | "abgelehnt"; geburtsdatum: string | null; whatsapp: boolean }
  | (PublicEnvelope & { success: false; zustand?: LinkZustand });

/** A control, not a link: it arms the objection and navigates nowhere. Named in the information text too. */
const ABLEHNEN_LABEL = "Ich möchte nicht eingetragen sein";

/**
 * What the armed press sends. A constant rather than a literal in the branch: it is where
 * `docs/glossary.md` points for the word the screen calls this act.
 */
const WIDERSPRUCH_SENDEN = "Widerspruch senden";

const NICHT_GESPEICHERT = "Deine Antwort wurde nicht gespeichert. Versuche es erneut.";

// The floor is the person's rather than a seat's — one press answers for both seats of a mirrored
// pair, and the link's read hands over the higher of the two.
const geburtsdatumHinweis = (mindestalter: number): string =>
  `Für Deine Bestätigung musst Du mindestens ${String(mindestalter)} Jahre alt sein. Das Datum wird mit Deinem Eintrag gespeichert.`;

/** The date mid-entry is a string, `""` being the empty picker; the judged shape is the payload's. */
type Entwurf = { geburtsdatum: string; whatsapp: boolean };

const beurteilt = (entwurf: Entwurf) => ({
  geburtsdatum: entwurf.geburtsdatum === "" ? null : entwurf.geburtsdatum,
  whatsapp: entwurf.whatsapp,
});

/** The empty string is a date nobody has entered yet, which the picker shows as empty rather than refuses. */
function toCalendarDate(stored: string): CalendarDate | null {
  return stored === "" ? null : parseDate(stored);
}

/**
 * An objection sends no date and no consent, whatever the draft holds: an objection carrying a
 * consent switched on is a contradiction the page must not be able to send.
 */
function antwortPayload(token: string, entwurf: Entwurf, ablehnen: boolean): FLBewerbungEinwilligungAntwortPayload {
  // Stamped on an objection as well: the record has to name the words that were on screen when the
  // seat was refused, and a null there would leave the refusal citing nothing.
  const fassung = { token: token, text_version: BESTAETIGUNG_KENNTNISNAHME.textVersion };

  if (ablehnen) return { ...fassung, antwort: "abgelehnt", geburtsdatum: null, whatsapp: false };

  return { ...fassung, antwort: "erteilt", ...beurteilt(entwurf) };
}

/**
 * **Rendered in both states and only ever disabled**: withdrawing these two under the armed
 * objection is the reflow that walked the buttons out from under the pointer that had just armed
 * them.
 */
function BestaetigungAngaben({
  entwurf,
  onEntwurf,
  onGeburtsdatumVerlassen,
  isDisabled,
  hinweisId,
  mindestalter,
}: {
  entwurf: Entwurf;
  onEntwurf: (entwurf: Entwurf) => void;
  onGeburtsdatumVerlassen: () => void;
  isDisabled: boolean;
  hinweisId: string;
  mindestalter: number;
}) {
  const panel = formPanel();
  const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);

  return (
    <>
      <section className="flex flex-col gap-y-3">
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Deine Angaben</h3>

        {/* The form's own field grid, so one box on a wide page stands in a column rather than
            stretching the segments across it. */}
        <div className={FIELD_PAIR_CLASSES}>
          <div className="flex flex-col gap-y-2">
            <AppDatePicker
              isRequired
              isDisabled={isDisabled}
              name="geburtsdatum"
              label={<Label className={FIELD_LABEL_CLASSES}>Dein Geburtsdatum</Label>}
              calendarLabel="Geburtsdatum auswählen"
              value={toCalendarDate(entwurf.geburtsdatum)}
              onChange={(next) => onEntwurf({ ...entwurf, geburtsdatum: next?.toString() ?? "" })}
              onBlur={onGeburtsdatumVerlassen}
              aria-describedby={hinweisId}
              minValue={parseDate(frueheste)}
              maxValue={parseDate(spaeteste)}
            />
            {/* One wording in both states: a hint that rewrote itself on arming would move every
                control under it, which is the shift this section exists to avoid. */}
            <Hint
              mode="inline"
              describes={hinweisId}
              text={geburtsdatumHinweis(mindestalter)}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-y-3">
        <h3 className={FORM_SECTION_HEADING_CLASSES}>Freiwillig</h3>
        {/* Off on first paint and switched by nothing but a press: a pre-ticked consent records nothing. */}
        <Switch
          className="flex w-full flex-col gap-y-1"
          name="whatsapp"
          isDisabled={isDisabled}
          isSelected={entwurf.whatsapp}
          onChange={(whatsapp) => onEntwurf({ ...entwurf, whatsapp: whatsapp })}>
          <Switch.Content className={panel.switchContent()}>
            {BESTAETIGUNG_KENNTNISNAHME.schalter}
            <Switch.Control className={panel.switchControl()}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        <WhatsappHinweis />
      </section>
    </>
  );
}

/**
 * **The row's shape does not change when the objection arms**: the cancel takes the slot the
 * objection stood in, so no new control lands under a finger already on the first.
 */
function BestaetigungEntscheidung({
  isConfirming,
  isPending,
  isDeclining,
  beschreibtId,
  onWiderspruch,
  onCancel,
}: {
  isConfirming: boolean;
  /** The confirmation's own flight, which the objection's `isDeclining` is graded apart from. */
  isPending: boolean;
  isDeclining: boolean;
  beschreibtId: string;
  onWiderspruch: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-y-3">
      <ConfirmActionRow
        isConfirming={isConfirming}
        isPending={isDeclining}
        onCancel={onCancel}>
        {/* The fill grades the press on offer: the armed objection wears `destructive`, the confirmation the submit fill. */}
        <ConfirmPressButton
          isConfirming={isConfirming}
          isPending={isPending || isDeclining}
          // Nothing closes this press: both answers are legal from the moment the page opens.
          reason={null}
          resting="Eintrag bestätigen"
          armed={WIDERSPRUCH_SENDEN}
          running="Sendet..."
          icon={
            <CircleCheck
              className="size-4.5"
              aria-hidden="true"
            />
          }
          type="submit"
          describedBy={beschreibtId}
        />

        {!isConfirming && (
          <Button
            type="button"
            variant="secondary"
            isPending={isPending}
            onPress={onWiderspruch}
            className={formButton({ intent: "cancel", stacks: true })}>
            {ABLEHNEN_LABEL}
          </Button>
        )}
      </ConfirmActionRow>

      {/* Under the row rather than over it: opening the alert above the buttons is what walked them
          down the page between the two presses it takes to send. */}
      {isConfirming && (
        <ConfirmReveal>
          <p className="fluid-xxs text-foreground leading-normal font-medium">
            Ohne Deine Bestätigung kann die Bewerbung nicht vollständig werden. Deine Angaben oben brauchen wir für einen Widerspruch nicht.
          </p>
          <WiderspruchFolge />
        </ConfirmReveal>
      )}
    </div>
  );
}

/**
 * **The acknowledgement is the press, not a switch**: the four points above the button say what the
 * press records, and a required „gelesen“ switch would be a second act recording the same thing.
 */
export function BestaetigungFormPanel({
  token,
  vorname,
  schule,
  saison,
  rolle,
  mindestalter,
  onAbschluss,
}: {
  token: string;
  vorname: string;
  schule: string;
  saison: string;
  /** The seat's long label, resolved by the caller so this form renders no role table of its own. */
  rolle: string;
  /** The floor the answer will be judged by, answered by the link's own read for the seats it covers. */
  mindestalter: number;
  onAbschluss: (abschluss: BestaetigungAbschluss) => void;
}) {
  const [isPending, startSending] = useTransition();
  const [entwurf, setEntwurf] = useState<Entwurf>({ geburtsdatum: "", whatsapp: false });
  const { isConfirming, isPending: isDeclining, press, cancel } = useTwoPressConfirm();

  const geburtsdatumHinweisId = useId();
  const klickPunkteId = useId();

  // Built from the floor the link answered, never the module's own: the endpoint judges this
  // person's seats, so a schema on the league floor would let the press through at the wrong number.
  const antwortSchema = useMemo(() => buildEinwilligungAntwortPayloadSchema(mindestalter), [mindestalter]);

  // The payload the write is judged by, judging the draft too: a second schema here would be the
  // page refusing at numbers the endpoint does not, on the day the two disagree.
  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { einwilligung: antwortSchema },
    // This page's own word for the failure: the admin editors' „Änderung nicht gespeichert“ names a
    // change nobody here made, and two titles for one failure read as two failures.
    failureTitle: "Antwort nicht gespeichert",
  });

  useForgiveFixed({ einwilligung: antwortPayload(token, entwurf, isConfirming) });

  const { spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);

  // The floor's alone, never the ceiling's: a date past the ceiling is a mistyped century, and
  // sending a 190-year-old to the submitter for a replacement is the wrong repair.
  const istZuJung = fieldErrors.geburtsdatum !== undefined && entwurf.geburtsdatum !== "" && entwurf.geburtsdatum > spaeteste;

  const sende = async (payload: FLBewerbungEinwilligungAntwortPayload): Promise<void> => {
    const gesendet = await postPublicForm<EinwilligungAntwort>("/api/bestaetigung/kontakt", payload);

    if (!gesendet.answered) {
      // No one title is true across both, the edge refusing the REQUEST ruling the write out where an
      // unread answer does not (`fl_frontend/src/shared/utils/publicSubmit.ts :: PublicAnswer`).
      appToast.danger(gesendet.wroteNothing ? "Antwort nicht gespeichert" : "Unklar, ob es bei uns angekommen ist", {
        description: gesendet.error,
      });
      return;
    }

    const antwort = gesendet.body;

    // Wrapped again: both callers run this inside a transition, and React leaves an update after an
    // `await` outside it.
    startTransition(() => {
      if (!antwort.success) {
        // Titled as an unread answer is, the answer having perhaps landed: the envelope's own sentence
        // is an administrator's repair, and a reload of this page has lost its token.
        if (antwort.outcome === "unknown") {
          appToast.danger("Unklar, ob es bei uns angekommen ist", { description: ANTWORT_UNKLAR });
          return;
        }

        // The link died between the open and the press: the answer is the panel, never a toast.
        if (antwort.zustand !== undefined) {
          onAbschluss({ zustand: antwort.zustand });
          return;
        }

        // The hook owns the press's one toast: none where a field shows the refusal.
        reportSubmitFailure(
          { success: false, error: antwort.error ?? NICHT_GESPEICHERT, fieldErrors: antwort.fieldErrors, unplacedError: antwort.unplacedError },
          { einwilligung: payload },
          { raise: (shown) => appToast.failure("Antwort nicht gespeichert", shown) },
        );
        return;
      }

      setSubmitFieldErrors({}, {});
      onAbschluss(
        antwort.ergebnis === "bestaetigt"
          ? { zustand: "erfolg", geburtsdatum: antwort.geburtsdatum, whatsapp: antwort.whatsapp }
          : { zustand: "widersprochen-neu" },
      );
    });
  };

  /* Both presses of the objection hand the shared control the same write: the arming one drops it,
     and the second runs it, so the two cannot arm and send different payloads. */
  const sendeWiderspruch = () => sende(antwortPayload(token, entwurf, true));

  const handleSubmit = () => {
    // Armed, this press is the shared control's second one and is graded there — including the
    // double-click window, which a submit handler cannot see.
    if (isConfirming) {
      press(sendeWiderspruch);
      return;
    }

    const payload = antwortPayload(token, entwurf, false);
    guardSubmit({ einwilligung: payload }, () => {
      startSending(async () => {
        await sende(payload);
      });
    });
  };

  return (
    <Form
      ref={formRef}
      data-required-marks="on"
      validationErrors={fieldErrors}
      className="flex w-full flex-col gap-6"
      onSubmit={runOnSubmit(handleSubmit)}>
      <BestaetigungHinweise
        schule={schule}
        saison={saison}
        rolle={rolle}
        mindestalter={mindestalter}
        ablehnenLabel={ABLEHNEN_LABEL}
      />

      <BestaetigungAbschnitt titel="Deine Antwort">
        <KlickBestaetigung
          id={klickPunkteId}
          vorname={vorname}
          schule={schule}
          rolle={rolle}
          mindestalter={mindestalter}
        />

        <BestaetigungAngaben
          entwurf={entwurf}
          onEntwurf={setEntwurf}
          onGeburtsdatumVerlassen={() => validatePaths("einwilligung", antwortPayload(token, entwurf, false), ["geburtsdatum"])}
          isDisabled={isConfirming}
          hinweisId={geburtsdatumHinweisId}
          mindestalter={mindestalter}
        />

        {istZuJung && (
          <Callout
            severity="warning"
            isAnnounced
            title="Mit diesem Geburtsdatum kannst Du keine Kontaktperson sein.">
            Hast Du Dich vertippt? Dann korrigiere das Datum. Stimmt es, sag der Person Bescheid, die die Bewerbung eingereicht hat: Diese
            Person braucht an Deiner Stelle jemanden ab {String(mindestalter)}. Du kannst dem Eintrag auch widersprechen, dann entfernen wir
            Deine Angaben.
          </Callout>
        )}

        <BestaetigungEntscheidung
          isConfirming={isConfirming}
          isPending={isPending}
          isDeclining={isDeclining}
          beschreibtId={klickPunkteId}
          onWiderspruch={() => press(sendeWiderspruch)}
          onCancel={cancel}
        />
      </BestaetigungAbschnitt>
    </Form>
  );
}
