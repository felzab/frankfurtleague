"use client";

import { useId, useState, useTransition } from "react";

import { parseDate } from "@internationalized/date";

import { Button, Calendar, DateField, DatePicker, FieldError, Form, Label, Switch } from "@heroui/react";

import { BESTAETIGUNG_ABSAETZE, BESTAETIGUNG_EINWILLIGUNG, fuelleFassung } from "@/core/einwilligung";
import { BEWERBUNG_MIN_ALTER } from "@/features/bewerbungen/constants";
import { FLBewerbungEinwilligungAntwortPayloadSchema } from "@/features/bewerbungen/schemas";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_LABEL,
  FORM_SECTION_HEADING,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { textLink } from "@/shared/components/ui/textLink";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";

import { BestaetigungHinweise, KlickBestaetigung, WhatsappHinweis } from "./BestaetigungHinweise";

import type { FLBewerbungEinwilligungAntwortPayload } from "@/features/bewerbungen/schemas";
import type { LinkZustand } from "@/features/bewerbungen/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { CalendarDate } from "@internationalized/date";

/** What one press ends in, handed up to the page that swaps the form for the panel. */
export type BestaetigungAbschluss =
  { zustand: "erfolg"; geburtsdatum: string | null; whatsapp: boolean } | { zustand: "abgelehnt-neu" } | { zustand: LinkZustand };

/** What the route answers. Always 200, so a non-2xx here is a genuine transport failure. */
type EinwilligungAntwort =
  | { success: true; ergebnis: "bestaetigt" | "abgelehnt"; geburtsdatum: string | null; whatsapp: boolean }
  | { success: false; error?: string; fieldErrors?: FieldErrors; zustand?: LinkZustand };

/** A control, not a link: it arms the decline and navigates nowhere. Named in the information text too. */
export const ABLEHNEN_LABEL = "Ich möchte nicht eingetragen sein";

const VERBINDUNG = "Prüfe Deine Verbindung und versuche es erneut.";
const NICHT_GESPEICHERT = "Deine Antwort wurde nicht gespeichert. Versuche es erneut.";

/**
 * The edge's rate limit, generated before the route handler runs: the body is nginx's own HTML
 * rather than the always-200 envelope, so the status is the whole of what arrived.
 */
const RATE_LIMIT_STATUS = 429;
const ZU_VIELE_VERSUCHE = "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann noch einmal.";

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
 * A decline sends no date and no consent, whatever the draft holds: a decline carrying a consent
 * switched on is a contradiction the page must not be able to send.
 */
function antwortPayload(token: string, entwurf: Entwurf, ablehnen: boolean): FLBewerbungEinwilligungAntwortPayload {
  // Stamped on a decline as well: the record has to name the words that were on screen when the
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
 * **The acknowledgement is the press, not a switch**: the sentence above the button says what the
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
  const panel = formPanel();
  const [isPending, startTransition] = useTransition();
  const [entwurf, setEntwurf] = useState<Entwurf>({ geburtsdatum: "", whatsapp: false });
  /** Armed by the first press and sent by the second, the shape the admin decline already uses. */
  const [isAblehnen, setIsAblehnen] = useState(false);

  const geburtsdatumHinweisId = useId();
  const bestaetigungSatzId = useId();

  // The payload the write is judged by, judging the draft too: a second schema here would be the
  // page refusing at numbers the endpoint does not, on the day the two disagree.
  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { einwilligung: FLBewerbungEinwilligungAntwortPayloadSchema },
  });

  useForgiveFixed({ einwilligung: antwortPayload(token, entwurf, isAblehnen) });

  const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr());

  // The floor's alone, never the ceiling's: a date past the ceiling is a mistyped century, and
  // sending a 190-year-old to the submitter for a replacement is the wrong repair.
  const istZuJung = fieldErrors.geburtsdatum !== undefined && entwurf.geburtsdatum !== "" && entwurf.geburtsdatum > spaeteste;

  const handleSubmit = () => {
    // The disabled button is not the whole guard: `Enter` in the date field submits too, and a
    // second press mid-flight would spend a token the first press is already spending.
    if (isPending) return;

    const payload = antwortPayload(token, entwurf, isAblehnen);

    guardSubmit({ einwilligung: payload }, () => write(payload));
  };

  const write = (payload: FLBewerbungEinwilligungAntwortPayload) => {
    startTransition(async () => {
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

        setSubmitFieldErrors(antwort.fieldErrors ?? {}, { einwilligung: antwortPayload(token, entwurf, isAblehnen) });

        // A field-level refusal already speaks at the field; the toast is for a failure belonging to none.
        if (!hasFieldErrors(antwort.fieldErrors)) {
          appToast.danger("Speichern fehlgeschlagen", { description: antwort.error ?? NICHT_GESPEICHERT });
        }
        return;
      }

      setSubmitFieldErrors({}, {});
      onAbschluss(
        antwort.ergebnis === "bestaetigt"
          ? { zustand: "erfolg", geburtsdatum: antwort.geburtsdatum, whatsapp: antwort.whatsapp }
          : { zustand: "abgelehnt-neu" },
      );
    });
  };

  return (
    <Form
      ref={formRef}
      // `aria`, never `native`: missing belongs to the submit, not a blur (`docs/frontend/spec.md :: I40`, `:: I71`).
      validationBehavior="aria"
      data-required-marks="on"
      validationErrors={fieldErrors}
      className="flex w-full flex-col gap-y-6"
      onSubmit={runOnSubmit(handleSubmit)}>
      <div className="flex flex-col gap-y-1">
        <p className="fluid-sm text-foreground font-bold">Hallo {vorname},</p>
        {/* „die Schule {schule}“ rather than an article: the name's own gender is unknown. */}
        <p className="fluid-sm text-foreground leading-relaxed font-medium text-pretty">
          für die Schule <strong className="font-bold">{schule}</strong> wurde eine Bewerbung zur Saison {saison} der Frankfurt League
          eingereicht. Darin bist Du als <strong className="font-bold">{rolle}</strong> eingetragen. Bitte bestätige, dass das stimmt und dass
          diese E-Mail-Adresse Deine ist.
        </p>
      </div>

      <dl className="bg-background border-border fluid-sm grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border px-4 py-3">
        <dt className="text-foreground-muted font-medium">Schule</dt>
        <dd className="text-foreground font-bold">{schule}</dd>
        <dt className="text-foreground-muted font-medium">Saison</dt>
        <dd className="text-brand font-bold">{saison}</dd>
        <dt className="text-foreground-muted font-medium">Deine Rolle</dt>
        <dd className="text-foreground font-bold">{rolle}</dd>
      </dl>

      <BestaetigungHinweise
        schule={schule}
        saison={saison}
        rolle={rolle}
        ablehnenLabel={ABLEHNEN_LABEL}
      />

      {/* Both hidden while declining: a decline asks for no date, and a consent beside a refusal is
          a contradiction the page must not be able to send. */}
      {!isAblehnen && (
        <>
          <section className="flex flex-col gap-y-3">
            <h2 className={FORM_SECTION_HEADING}>Freiwillig</h2>
            {/* Off on first paint and switched by nothing but a press: a pre-ticked consent records nothing. */}
            <Switch
              className="flex w-full flex-col gap-y-1"
              name="whatsapp"
              isSelected={entwurf.whatsapp}
              onChange={(whatsapp) => setEntwurf({ ...entwurf, whatsapp: whatsapp })}>
              <Switch.Content className={panel.switchContent()}>
                {BESTAETIGUNG_EINWILLIGUNG.schalter}
                <Switch.Control className={panel.switchControl()}>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            <WhatsappHinweis />
          </section>

          <div className="flex flex-col gap-y-2">
            <DatePicker
              isRequired
              name="geburtsdatum"
              value={toCalendarDate(entwurf.geburtsdatum)}
              onChange={(next) => setEntwurf({ ...entwurf, geburtsdatum: next?.toString() ?? "" })}
              onBlur={() => validatePaths("einwilligung", antwortPayload(token, entwurf, isAblehnen), ["geburtsdatum"])}
              aria-describedby={geburtsdatumHinweisId}
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
            <Hint
              mode="inline"
              describes={geburtsdatumHinweisId}
              text={`Kontaktperson kann sein, wer mindestens ${String(BEWERBUNG_MIN_ALTER)} ist. Das Datum wird mit Deinem Eintrag gespeichert.`}
            />
          </div>

          {istZuJung && (
            <Callout
              severity="warning"
              isAnnounced
              title="Mit diesem Geburtsdatum kannst Du keine Kontaktperson sein.">
              Hast Du Dich vertippt? Dann korrigiere das Datum. Stimmt es, sag der Person Bescheid, die die Bewerbung eingereicht hat: Sie
              braucht jemanden ab {String(BEWERBUNG_MIN_ALTER)} in Deiner Rolle. Du kannst den Eintrag auch ablehnen, dann entfernen wir Deine
              Angaben.
            </Callout>
          )}

          <KlickBestaetigung
            vorname={vorname}
            schule={schule}
            rolle={rolle}
          />
        </>
      )}

      {isAblehnen && (
        <Callout
          severity="warning"
          isAnnounced
          title="Ohne Deine Bestätigung kann die Bewerbung nicht vollständig werden.">
          Wir entfernen Deine Angaben sofort aus der Bewerbung und sagen der Person Bescheid, die sie eingereicht hat.
        </Callout>
      )}

      <div className="flex flex-col items-stretch gap-y-3">
        {!isAblehnen && (
          <p
            id={bestaetigungSatzId}
            className="muted-meta text-pretty">
            {fuelleFassung(BESTAETIGUNG_ABSAETZE.klickSatz, { vorname: vorname, rolle: rolle })}
          </p>
        )}

        {/* The fill grades the press on offer: the armed decline wears `destructive`, the confirmation the submit fill. */}
        <Button
          type="submit"
          isPending={isPending}
          isDisabled={isPending}
          aria-describedby={isAblehnen ? undefined : bestaetigungSatzId}
          className={formButton({ intent: isAblehnen ? "destructive" : "submit", fullWidth: true })}>
          {isAblehnen ? (isPending ? "Wird gesendet..." : "Ablehnung senden") : isPending ? "Wird gespeichert..." : "Eintrag bestätigen"}
        </Button>

        {/* Dressed as the text link it reads as (`docs/frontend/spec.md :: I78`), though it is a control that navigates nowhere. */}
        <Button
          type="button"
          variant="ghost"
          isDisabled={isPending}
          onPress={() => setIsAblehnen(!isAblehnen)}
          className={`${textLink({ tone: "muted" })} fluid-xs cursor-pointer self-center font-bold`}>
          {isAblehnen ? "Doch bestätigen" : ABLEHNEN_LABEL}
        </Button>
      </div>
    </Form>
  );
}
