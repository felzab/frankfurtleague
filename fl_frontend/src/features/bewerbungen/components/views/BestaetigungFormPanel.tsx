"use client";

import { useId, useState, useTransition } from "react";

import { CircleCheck } from "@gravity-ui/icons";
import { parseDate } from "@internationalized/date";

import { Button, Calendar, DateField, DatePicker, FieldError, Form, Label, Switch } from "@heroui/react";

import { BESTAETIGUNG_EINWILLIGUNG } from "@/core/einwilligung";
import { BEWERBUNG_MIN_ALTER } from "@/features/bewerbungen/constants";
import { FLBewerbungEinwilligungAntwortPayloadSchema } from "@/features/bewerbungen/schemas";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { confirmButton, formButton } from "@/shared/components/ui/formButtons";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_LABEL,
  FIELD_PAIR,
  FORM_SECTION_HEADING,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";

import { BestaetigungHinweise, KlickBestaetigung, WhatsappHinweis, WiderspruchFolge } from "./BestaetigungHinweise";
import { BestaetigungAbschnitt } from "./BestaetigungPanels";

import type { FLBewerbungEinwilligungAntwortPayload } from "@/features/bewerbungen/schemas";
import type { LinkZustand } from "@/features/bewerbungen/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { CalendarDate } from "@internationalized/date";

/** What one press ends in, handed up to the page that swaps the form for the panel. */
export type BestaetigungAbschluss =
  { zustand: "erfolg"; geburtsdatum: string | null; whatsapp: boolean } | { zustand: "widersprochen-neu" } | { zustand: LinkZustand };

/** What the route answers. Always 200, so a non-2xx here is a genuine transport failure. */
type EinwilligungAntwort =
  | { success: true; ergebnis: "bestaetigt" | "abgelehnt"; geburtsdatum: string | null; whatsapp: boolean }
  | { success: false; error?: string; fieldErrors?: FieldErrors; zustand?: LinkZustand };

/** A control, not a link: it arms the objection and navigates nowhere. Named in the information text too. */
export const ABLEHNEN_LABEL = "Ich möchte nicht eingetragen sein";

/**
 * What the armed press sends. A constant rather than a literal in the branch: the armed state is
 * reached by a press, so this word is the one a test can hold without a browser to press in.
 */
export const WIDERSPRUCH_SENDEN = "Widerspruch senden";

// Every path this form renders a control for. `fl_frontend/src/core/refusalPaths.test.ts :: EXEMPT`
// carries why the payload's remaining paths render none, and a refusal naming one of those has no
// field to speak at.
export const BESTAETIGUNG_FELDER: readonly string[] = ["geburtsdatum", "whatsapp"];

const VERBINDUNG = "Prüfe Deine Verbindung und versuche es erneut.";
const NICHT_GESPEICHERT = "Deine Antwort wurde nicht gespeichert. Versuche es erneut.";

/**
 * The edge's rate limit, generated before the route handler runs: the body is nginx's own HTML
 * rather than the always-200 envelope, so the status is the whole of what arrived.
 */
const RATE_LIMIT_STATUS = 429;
const ZU_VIELE_VERSUCHE = "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann noch einmal.";

const GEBURTSDATUM_HINWEIS = `Kontaktperson kann sein, wer mindestens ${String(BEWERBUNG_MIN_ALTER)} ist. Das Datum wird mit Deinem Eintrag gespeichert.`;

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

/** Whether a refusal reached a control at all; one naming only unrendered paths would show nothing. */
function sprichtAmFeld(fieldErrors: FieldErrors | undefined): boolean {
  return Object.keys(fieldErrors ?? {}).some((pfad) => BESTAETIGUNG_FELDER.includes(pfad));
}

/**
 * An objection sends no date and no consent, whatever the draft holds: an objection carrying a
 * consent switched on is a contradiction the page must not be able to send.
 */
function antwortPayload(token: string, entwurf: Entwurf, ablehnen: boolean): FLBewerbungEinwilligungAntwortPayload {
  // Stamped on an objection as well: the record has to name the words that were on screen when the
  // seat was refused, and a null there would leave the refusal citing nothing.
  const fassung = { token: token, text_version: BESTAETIGUNG_EINWILLIGUNG.textVersion };

  if (ablehnen) return { ...fassung, antwort: "abgelehnt", geburtsdatum: null, whatsapp: false };

  return { ...fassung, antwort: "erteilt", ...beurteilt(entwurf) };
}

async function sendeAntwort(payload: FLBewerbungEinwilligungAntwortPayload): Promise<EinwilligungAntwort> {
  const response = await fetch("/api/bestaetigung", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.status === RATE_LIMIT_STATUS) return { success: false, error: ZU_VIELE_VERSUCHE };
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);

  return response.json() as Promise<EinwilligungAntwort>;
}

/**
 * **Rendered in both states and only ever disabled**: withdrawing these two under the armed
 * objection is the reflow that walked the buttons out from under the pointer that had just armed
 * them.
 */
export function BestaetigungAngaben({
  entwurf,
  onEntwurf,
  onGeburtsdatumVerlassen,
  isDisabled,
  hinweisId,
}: {
  entwurf: Entwurf;
  onEntwurf: (entwurf: Entwurf) => void;
  onGeburtsdatumVerlassen: () => void;
  isDisabled: boolean;
  hinweisId: string;
}) {
  const panel = formPanel();
  const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr());

  return (
    <>
      <section className="flex flex-col gap-y-3">
        <h3 className={FORM_SECTION_HEADING}>Deine Angaben</h3>

        {/* The form's own field grid, so one box on a wide page stands in a column rather than
            stretching the segments across it. */}
        <div className={FIELD_PAIR}>
          <div className="flex flex-col gap-y-2">
            <DatePicker
              isRequired
              isDisabled={isDisabled}
              name="geburtsdatum"
              value={toCalendarDate(entwurf.geburtsdatum)}
              onChange={(next) => onEntwurf({ ...entwurf, geburtsdatum: next?.toString() ?? "" })}
              onBlur={onGeburtsdatumVerlassen}
              aria-describedby={hinweisId}
              className="w-full">
              <Label className={FIELD_LABEL}>Dein Geburtsdatum</Label>
              <DateField.Group
                fullWidth
                className={FIELD_GROUP}>
                <DateField.Input className="fluid-sm">
                  {(segment) => (
                    <DateField.Segment
                      segment={segment}
                      className="data-[type=literal]:text-foreground-muted"
                    />
                  )}
                </DateField.Input>
                <DateField.Suffix>
                  <DatePicker.Trigger>
                    <DatePicker.TriggerIndicator />
                  </DatePicker.Trigger>
                </DateField.Suffix>
              </DateField.Group>
              <FieldError className={FIELD_ERROR} />
              <DatePicker.Popover
                className={DATE_PICKER_POPOVER}
                placement={DATE_PICKER_PLACEMENT}>
                {/* The span greys days out where dates are OFFERED, never on the field, which judges: a
                    bound there paints a message on each keystroke of a half-typed year. */}
                <Calendar
                  aria-label="Geburtsdatum auswählen"
                  minValue={parseDate(frueheste)}
                  maxValue={parseDate(spaeteste)}
                  className={`${overlayPanel()} ${DATE_PICKER_CALENDAR}`}>
                  <Calendar.Header className="bg-transparent">
                    <Calendar.YearPickerTrigger>
                      <Calendar.YearPickerTriggerHeading />
                      <Calendar.YearPickerTriggerIndicator />
                    </Calendar.YearPickerTrigger>
                    <Calendar.NavButton slot="previous" />
                    <Calendar.NavButton slot="next" />
                  </Calendar.Header>
                  <Calendar.Grid>
                    <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
                    <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
                  </Calendar.Grid>
                  <Calendar.YearPickerGrid>
                    <Calendar.YearPickerGridBody>{({ year }) => <Calendar.YearPickerCell year={year} />}</Calendar.YearPickerGridBody>
                  </Calendar.YearPickerGrid>
                </Calendar>
              </DatePicker.Popover>
            </DatePicker>
            {/* One wording in both states: a hint that rewrote itself on arming would move every
                control under it, which is the shift this section exists to avoid. */}
            <Hint
              mode="inline"
              describes={hinweisId}
              text={GEBURTSDATUM_HINWEIS}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-y-3">
        <h3 className={FORM_SECTION_HEADING}>Freiwillig</h3>
        {/* Off on first paint and switched by nothing but a press: a pre-ticked consent records nothing. */}
        <Switch
          className="flex w-full flex-col gap-y-1"
          name="whatsapp"
          isDisabled={isDisabled}
          isSelected={entwurf.whatsapp}
          onChange={(whatsapp) => onEntwurf({ ...entwurf, whatsapp: whatsapp })}>
          <Switch.Content className={panel.switchContent()}>
            {BESTAETIGUNG_EINWILLIGUNG.schalter}
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
export function BestaetigungEntscheidung({
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
        <Button
          type="submit"
          isPending={isPending || isDeclining}
          isDisabled={isPending || isDeclining}
          aria-describedby={isConfirming ? undefined : beschreibtId}
          className={confirmButton(isConfirming)}>
          {!isConfirming && (
            <CircleCheck
              aria-hidden="true"
              width={18}
              height={18}
            />
          )}
          {isConfirming ? (isDeclining ? "Wird gesendet..." : WIDERSPRUCH_SENDEN) : isPending ? "Wird gespeichert..." : "Eintrag bestätigen"}
        </Button>

        {!isConfirming && (
          <Button
            type="button"
            variant="secondary"
            isDisabled={isPending}
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
  onAbschluss,
}: {
  token: string;
  vorname: string;
  schule: string;
  saison: string;
  /** The seat's long label, resolved by the caller so this form renders no role table of its own. */
  rolle: string;
  onAbschluss: (abschluss: BestaetigungAbschluss) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [entwurf, setEntwurf] = useState<Entwurf>({ geburtsdatum: "", whatsapp: false });
  const { isConfirming, isPending: isDeclining, press, cancel } = useTwoPressConfirm();

  const geburtsdatumHinweisId = useId();
  const klickPunkteId = useId();

  // The payload the write is judged by, judging the draft too: a second schema here would be the
  // page refusing at numbers the endpoint does not, on the day the two disagree.
  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { einwilligung: FLBewerbungEinwilligungAntwortPayloadSchema },
  });

  useForgiveFixed({ einwilligung: antwortPayload(token, entwurf, isConfirming) });

  const { spaeteste } = geburtsdatumSpanne(getGermanTodayStr());

  // The floor's alone, never the ceiling's: a date past the ceiling is a mistyped century, and
  // sending a 190-year-old to the submitter for a replacement is the wrong repair.
  const istZuJung = fieldErrors.geburtsdatum !== undefined && entwurf.geburtsdatum !== "" && entwurf.geburtsdatum > spaeteste;

  const sende = async (payload: FLBewerbungEinwilligungAntwortPayload): Promise<void> => {
    let antwort: EinwilligungAntwort;
    try {
      antwort = await sendeAntwort(payload);
    } catch {
      // The connection alone: the request never reached a judgement, so nothing typed is named.
      appToast.danger("Speichern fehlgeschlagen", { description: VERBINDUNG });
      return;
    }

    if (!antwort.success) {
      // The link died between the open and the press: the answer is the panel, never a toast.
      if (antwort.zustand !== undefined) {
        onAbschluss({ zustand: antwort.zustand });
        return;
      }

      setSubmitFieldErrors(antwort.fieldErrors ?? {}, { einwilligung: payload });

      // A refusal on a path this form renders already speaks at its field. One naming only paths the
      // form renders no control for would otherwise be shown nowhere at all.
      if (!sprichtAmFeld(antwort.fieldErrors)) {
        appToast.danger("Speichern fehlgeschlagen", { description: antwort.error ?? NICHT_GESPEICHERT });
      }
      return;
    }

    setSubmitFieldErrors({}, {});
    onAbschluss(
      antwort.ergebnis === "bestaetigt"
        ? { zustand: "erfolg", geburtsdatum: antwort.geburtsdatum, whatsapp: antwort.whatsapp }
        : { zustand: "widersprochen-neu" },
    );
  };

  /* Both presses of the objection hand the shared control the same write: the arming one drops it,
     and the second runs it, so the two cannot arm and send different payloads. */
  const sendeWiderspruch = () => sende(antwortPayload(token, entwurf, true));

  const handleSubmit = () => {
    // The disabled button is not the whole guard: `Enter` in the date field submits too, and a
    // second press mid-flight would spend a token the first press is already spending.
    if (isPending || isDeclining) return;

    // Armed, this press is the shared control's second one and is graded there — including the
    // double-click window, which a submit handler cannot see.
    if (isConfirming) {
      press(sendeWiderspruch);
      return;
    }

    const payload = antwortPayload(token, entwurf, false);
    guardSubmit({ einwilligung: payload }, () => {
      startTransition(async () => {
        await sende(payload);
      });
    });
  };

  return (
    <Form
      ref={formRef}
      // `aria`, never `native`: missing belongs to the submit, not a blur (`docs/frontend/spec.md :: I40`, `:: I71`).
      validationBehavior="aria"
      data-required-marks="on"
      validationErrors={fieldErrors}
      className="flex w-full flex-col gap-5"
      onSubmit={runOnSubmit(handleSubmit)}>
      <BestaetigungHinweise
        schule={schule}
        saison={saison}
        rolle={rolle}
        ablehnenLabel={ABLEHNEN_LABEL}
      />

      <BestaetigungAbschnitt titel="Deine Antwort">
        <KlickBestaetigung
          id={klickPunkteId}
          vorname={vorname}
          schule={schule}
          rolle={rolle}
        />

        <BestaetigungAngaben
          entwurf={entwurf}
          onEntwurf={setEntwurf}
          onGeburtsdatumVerlassen={() => validatePaths("einwilligung", antwortPayload(token, entwurf, false), ["geburtsdatum"])}
          isDisabled={isConfirming}
          hinweisId={geburtsdatumHinweisId}
        />

        {istZuJung && (
          <Callout
            severity="warning"
            isAnnounced
            title="Mit diesem Geburtsdatum kannst Du keine Kontaktperson sein.">
            Hast Du Dich vertippt? Dann korrigiere das Datum. Stimmt es, sag der Person Bescheid, die die Bewerbung eingereicht hat: Diese
            Person braucht jemanden ab {String(BEWERBUNG_MIN_ALTER)} in Deiner Rolle. Du kannst dem Eintrag auch widersprechen, dann entfernen
            wir Deine Angaben.
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
