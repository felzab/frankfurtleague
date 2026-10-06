"use client";

import { startTransition, useId, useMemo, useRef, useState, useTransition } from "react";

import CircleCheck from "@gravity-ui/icons/CircleCheck";
import { parseDate } from "@internationalized/date";

import { Button } from "@heroui/react/button";
import { Label } from "@heroui/react/label";

import { ABLEHNEN_LABEL } from "@/features/bewerbungen/constants";
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
import { Switch } from "@/shared/components/ui/Switch";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { reportRefusedConfirmation } from "@/shared/utils/linkConfirmation";
import { postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";

import { BestaetigungHinweise, KlickBestaetigung, MedienHinweis, WhatsappHinweis, WiderspruchFolge } from "./BestaetigungHinweise";
import { ANTWORT_NICHT_GESPEICHERT, ANTWORT_NICHT_GESPEICHERT_SATZ, BestaetigungAbschnitt } from "./BestaetigungPanels";

import type { FLBewerbungEinwilligungAntwortPayload } from "@/features/bewerbungen/schemas";
import type { LinkZustand } from "@/features/bewerbungen/types";
import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { CalendarDate } from "@internationalized/date";
import type { KontaktFassung } from "./BestaetigungHinweise";

/** What one press ends in, handed up to the page that swaps the form for the panel. */
export type BestaetigungAbschluss =
  | { zustand: "erfolg"; geburtsdatum: string | null; whatsapp: boolean; medien: boolean }
  | { zustand: "widersprochen-neu" }
  | { zustand: LinkZustand | "saison_vorbei" };

type EinwilligungAntwort =
  | { success: true; ergebnis: "bestaetigt" | "abgelehnt"; geburtsdatum: string | null; whatsapp: boolean; medien: boolean }
  | (PublicEnvelope & { success: false; zustand?: LinkZustand | "saison_vorbei" });

/**
 * What the armed press sends. A constant rather than a literal in the branch: it is where
 * `docs/glossary.md` points for the word the screen calls this act.
 */
const WIDERSPRUCH_SENDEN = "Widerspruch senden";

// The floor is the person's rather than a seat's — one press answers for both seats of a mirrored
// pair, and the link's read hands over the higher of the two.
const geburtsdatumHinweis = (mindestalter: number): string =>
  `Für Deine Bestätigung musst Du mindestens ${String(mindestalter)} Jahre alt sein. Das Datum wird mit Deinem Eintrag gespeichert.`;

/** The date mid-entry is a string, `""` being the empty picker; the judged shape is the payload's. */
type Entwurf = { geburtsdatum: string; whatsapp: boolean; medien: boolean };

const beurteilt = (entwurf: Entwurf, medienAngeboten: boolean) => ({
  geburtsdatum: entwurf.geburtsdatum === "" ? null : entwurf.geburtsdatum,
  whatsapp: entwurf.whatsapp,
  // Never the draft's own `true` where no switch stands: one given before the date moved below the
  // media age would send a consent this page withheld.
  medien: medienAngeboten && entwurf.medien,
});

/**
 * Off the date the age check reads, at the served media age: with no date yet the age is unknown,
 * and a switch offered then would be one the write refuses for anybody under it.
 */
const bietetMedien = (geburtsdatum: string, medienMindestalter: number): boolean =>
  geburtsdatum !== "" && geburtsdatum <= geburtsdatumSpanne(getGermanTodayStr(), medienMindestalter).spaeteste;

/** The empty string is a date nobody has entered yet, which the picker shows as empty rather than refuses. */
function toCalendarDate(stored: string): CalendarDate | null {
  return stored === "" ? null : parseDate(stored);
}

/**
 * An objection sends no date and no consent, whatever the draft holds: an objection carrying a
 * consent switched on is a contradiction the page must not be able to send.
 */
function antwortPayload(
  token: string,
  textVersion: string,
  entwurf: Entwurf,
  ablehnen: boolean,
  medienAngeboten: boolean,
): FLBewerbungEinwilligungAntwortPayload {
  // Stamped on an objection as well: the record has to name the words that were on screen when the
  // seat was refused, and a null there would leave the refusal citing nothing.
  const fassung = { token: token, text_version: textVersion };

  if (ablehnen) return { ...fassung, antwort: "abgelehnt", geburtsdatum: null, whatsapp: false, medien: false };

  return { ...fassung, antwort: "erteilt", ...beurteilt(entwurf, medienAngeboten) };
}

/**
 * **Rendered in both states and only ever disabled**: withdrawing these two under the armed
 * objection is the reflow that walked the buttons out from under the pointer that had just armed
 * them.
 */
function BestaetigungAngaben({
  fassung,
  entwurf,
  onEntwurf,
  onGeburtsdatumVerlassen,
  isDisabled,
  mindestalter,
  medienMindestalter,
  medienAngeboten,
}: {
  fassung: KontaktFassung;
  entwurf: Entwurf;
  onEntwurf: (entwurf: Entwurf) => void;
  onGeburtsdatumVerlassen: () => void;
  isDisabled: boolean;
  mindestalter: number;
  medienMindestalter: number;
  /** Whether the date entered reaches `medienMindestalter`, which the switch stands from. */
  medienAngeboten: boolean;
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
          <AppDatePicker
            // Marked by hand: the consenting answer's refinement refuses a missing date, which the
            // field's own nullable schema cannot state, an objection carrying none.
            isRequired
            isDisabled={isDisabled}
            name="geburtsdatum"
            label={<Label className={FIELD_LABEL_CLASSES}>Dein Geburtsdatum</Label>}
            calendarLabel="Geburtsdatum auswählen"
            value={toCalendarDate(entwurf.geburtsdatum)}
            onChange={(next) => onEntwurf({ ...entwurf, geburtsdatum: next?.toString() ?? "" })}
            onBlur={onGeburtsdatumVerlassen}
            // One wording in both states: a hint that rewrote itself on arming would move every
            // control under it, which is the shift this section exists to avoid.
            hint={geburtsdatumHinweis(mindestalter)}
            minValue={parseDate(frueheste)}
            maxValue={parseDate(spaeteste)}
          />
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
            {fassung.schalter}
            <Switch.Control className={panel.switchControl()}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        <WhatsappHinweis absaetze={fassung.absaetze} />

        {/* The pupil's and the referee's pages ask it so: the switch from the served age, the paragraph for every age. */}
        {medienAngeboten && (
          // Off on first paint and switched by nothing but a press: a pre-ticked consent records nothing.
          <Switch
            className="flex w-full flex-col gap-y-1"
            name="medien"
            isDisabled={isDisabled}
            isSelected={entwurf.medien}
            onChange={(medien) => onEntwurf({ ...entwurf, medien: medien })}>
            <Switch.Content className={panel.switchContent()}>
              {fassung.bedienelemente.medien}
              <Switch.Control className={panel.switchControl()}>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        )}
        <MedienHinweis
          absaetze={fassung.absaetze}
          medienMindestalter={medienMindestalter}
        />
      </section>
    </>
  );
}

/**
 * **The row's shape does not change when the objection arms**: the cancel takes the slot the
 * objection stood in, so no new control lands under a finger already on the first.
 */
function BestaetigungEntscheidung({
  absaetze,
  istSaison,
  widerspruch,
  isPending,
  beschreibtId,
  onWiderspruch,
}: {
  absaetze: KontaktFassung["absaetze"];
  /** The seat sits on a team's season row, which no application stands behind. */
  istSaison: boolean;
  /** The objection's two presses, which the confirmation's own flight is graded apart from. */
  widerspruch: TwoPressConfirm;
  /** The confirmation's own flight. */
  isPending: boolean;
  beschreibtId: string;
  onWiderspruch: () => void;
}) {
  const { isConfirming } = widerspruch;
  // The objection arms the row, not the shared control beside it, so a cancel hands the focus back here.
  const widerspruchRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex w-full flex-col gap-y-3">
      <ConfirmActionRow
        confirm={widerspruch}
        armedBy={widerspruchRef}>
        {/* The fill grades the press on offer: the armed objection wears `destructive`, the confirmation the submit fill. */}
        <ConfirmPressButton
          confirm={widerspruch}
          submitting={isPending}
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
            ref={widerspruchRef}
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
          <p className="fluid-xxs leading-normal font-medium text-foreground">
            {istSaison
              ? "Ohne Deine Bestätigung bleibt Dein Eintrag unbestätigt."
              : "Ohne Deine Bestätigung kann die Bewerbung nicht vollständig werden."}{" "}
            Deine Angaben oben brauchen wir für einen Widerspruch nicht.
          </p>
          <WiderspruchFolge absaetze={absaetze} />
        </ConfirmReveal>
      )}
    </div>
  );
}

/**
 * **The acknowledgement is the press, not a switch**: the points above the button say what the
 * press records, and a required „gelesen“ switch would be a second act recording the same thing.
 */
export function BestaetigungFormPanel({
  fassung,
  token,
  vorname,
  schule,
  saison,
  rolle,
  istSaison = false,
  mindestalter,
  medienMindestalter,
  onAbschluss,
}: {
  /** The words the page shows, under the label its answer stamps. */
  fassung: KontaktFassung;
  token: string;
  vorname: string;
  schule: string;
  saison: string;
  /** The seat's long label, resolved by the caller so this form renders no role table of its own. */
  rolle: string;
  /** The seat sits on a team's season row, which no application stands behind and nobody submitted. */
  istSaison?: boolean;
  /** The floor the answer will be judged by, answered by the link's own read for the seats it covers. */
  mindestalter: number;
  /** The age the media switch is offered from, answered by the link's own read for `mindestalter`'s reason. */
  medienMindestalter: number;
  onAbschluss: (abschluss: BestaetigungAbschluss) => void;
}) {
  const [isPending, startSending] = useTransition();
  const [entwurf, setEntwurf] = useState<Entwurf>({ geburtsdatum: "", whatsapp: false, medien: false });
  const widerspruch = useTwoPressConfirm();
  const { isConfirming, press } = widerspruch;

  const klickPunkteId = useId();

  // Built from the floor the link answered, never the module's own: the endpoint judges this
  // person's seats, so a schema on the league floor would let the press through at the wrong number.
  const antwortSchema = useMemo(() => buildEinwilligungAntwortPayloadSchema(mindestalter), [mindestalter]);

  // The payload the write is judged by, judging the draft too: a second schema here would be the
  // page refusing at numbers the endpoint does not, on the day the two disagree.
  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formWiring } =
    useDraftFieldErrors({
      schemas: { einwilligung: antwortSchema },
      // This page's own word for the failure: the admin editors' „Änderung nicht gespeichert“ names a
      // change nobody here made, and two titles for one failure read as two failures.
      failureTitle: ANTWORT_NICHT_GESPEICHERT,
    });

  const medienAngeboten = bietetMedien(entwurf.geburtsdatum, medienMindestalter);

  useForgiveFixed({ einwilligung: antwortPayload(token, fassung.textVersion, entwurf, isConfirming, medienAngeboten) });

  const { spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);

  // The floor's alone, never the ceiling's: a date past the ceiling is a mistyped century, and
  // sending a 190-year-old to the submitter for a replacement is the wrong repair.
  const istZuJung = fieldErrors.geburtsdatum !== undefined && entwurf.geburtsdatum !== "" && entwurf.geburtsdatum > spaeteste;

  const sende = async (payload: FLBewerbungEinwilligungAntwortPayload): Promise<void> => {
    const gesendet = await postPublicForm<EinwilligungAntwort>("/api/bestaetigung/kontakt", payload);

    if (!gesendet.answered) {
      // No one title is true across both, the edge refusing the REQUEST ruling the write out where an
      // unread answer does not (`fl_frontend/src/shared/utils/publicSubmit.ts :: PublicAnswer`).
      appToast.danger(gesendet.wroteNothing ? ANTWORT_NICHT_GESPEICHERT : UNKLAR_TITEL, {
        description: gesendet.error,
      });
      return;
    }

    const antwort = gesendet.body;

    // Wrapped again: both callers run this inside a transition, and React leaves an update after an
    // `await` outside it.
    startTransition(() => {
      if (!antwort.success) {
        reportRefusedConfirmation(antwort, {
          onZustand: (zustand) => onAbschluss({ zustand }),
          // The hook owns the press's one toast: none where a field shows the refusal.
          onRefusal: () =>
            reportSubmitFailure(
              {
                success: false,
                error: antwort.error ?? ANTWORT_NICHT_GESPEICHERT_SATZ,
                fieldErrors: antwort.fieldErrors,
                unplacedError: antwort.unplacedError,
              },
              { einwilligung: payload },
              { raise: (shown) => appToast.failure(ANTWORT_NICHT_GESPEICHERT, shown) },
            ),
        });
        return;
      }

      setSubmitFieldErrors({}, {});
      onAbschluss(
        antwort.ergebnis === "bestaetigt"
          ? { zustand: "erfolg", geburtsdatum: antwort.geburtsdatum, whatsapp: antwort.whatsapp, medien: antwort.medien }
          : { zustand: "widersprochen-neu" },
      );
    });
  };

  /* Both presses of the objection hand the shared control the same write: the arming one drops it,
     and the second runs it, so the two cannot arm and send different payloads. */
  const sendeWiderspruch = () => sende(antwortPayload(token, fassung.textVersion, entwurf, true, medienAngeboten));

  const handleSubmit = () => {
    // Armed, this press is the shared control's second one and is graded there — including the
    // double-click window, which a submit handler cannot see.
    if (isConfirming) {
      press(sendeWiderspruch);
      return;
    }

    const payload = antwortPayload(token, fassung.textVersion, entwurf, false, medienAngeboten);
    guardSubmit({ einwilligung: payload }, () => {
      startSending(async () => {
        await sende(payload);
      });
    });
  };

  return (
    <Form
      wiring={formWiring}
      data-required-marks="on"
      className="flex w-full flex-col gap-6"
      onSubmit={handleSubmit}>
      <BestaetigungHinweise
        absaetze={fassung.absaetze}
        schule={schule}
        saison={saison}
        rolle={rolle}
        mindestalter={mindestalter}
        ablehnenLabel={ABLEHNEN_LABEL}
      />

      <BestaetigungAbschnitt titel="Deine Antwort">
        <KlickBestaetigung
          absaetze={fassung.absaetze}
          id={klickPunkteId}
          vorname={vorname}
          schule={schule}
          rolle={rolle}
          mindestalter={mindestalter}
        />

        <BestaetigungAngaben
          fassung={fassung}
          entwurf={entwurf}
          onEntwurf={setEntwurf}
          onGeburtsdatumVerlassen={() =>
            validatePaths("einwilligung", antwortPayload(token, fassung.textVersion, entwurf, false, medienAngeboten), ["geburtsdatum"])
          }
          isDisabled={isConfirming}
          mindestalter={mindestalter}
          medienMindestalter={medienMindestalter}
          medienAngeboten={medienAngeboten}
        />

        {istZuJung && (
          <Callout
            severity="warning"
            isAnnounced
            title="Mit diesem Geburtsdatum kannst Du keine Kontaktperson sein.">
            Hast Du Dich vertippt? Dann korrigiere das Datum. Stimmt es,{" "}
            {istSaison
              ? "sag der Verwaltung der Liga Bescheid: Sie braucht"
              : "sag der Person Bescheid, die die Bewerbung eingereicht hat: Diese Person braucht"}{" "}
            an Deiner Stelle jemanden ab {String(mindestalter)}. Du kannst dem Eintrag auch widersprechen, dann entfernen wir Deine Angaben.
          </Callout>
        )}

        <BestaetigungEntscheidung
          absaetze={fassung.absaetze}
          istSaison={istSaison}
          widerspruch={widerspruch}
          isPending={isPending}
          beschreibtId={klickPunkteId}
          onWiderspruch={() => press(sendeWiderspruch)}
        />
      </BestaetigungAbschnitt>
    </Form>
  );
}
