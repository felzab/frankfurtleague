"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { CircleCheck } from "@gravity-ui/icons";

import { Button, Form } from "@heroui/react";

import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, BEWERBUNG_SEATS, KUERZEL_LAENGE } from "@/features/bewerbungen/constants";
import { FLPostBewerbungPayloadSchema } from "@/features/bewerbungen/schemas";
import {
  bewerbungJudgedPaths,
  bewerbungPayload,
  buildEmptyBewerbungDraft,
  KUERZEL_UNGEPRUEFT,
  KUERZEL_VERGEBEN,
  kuerzelHinweis,
} from "@/features/bewerbungen/utils";
import { formButton } from "@/shared/components/ui/formButtons";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { appToast } from "@/shared/utils/appToast";

import { FormEinwilligungSection, FormKontaktpersonenSection } from "./FormKontaktpersonenSection";
import { FormSchuleSection } from "./FormSchuleSection";
import { FormTeamSection } from "./FormTeamSection";

import type {
  BewerbungFormDraft,
  BewerbungKontakteDraft,
  BewerbungKontaktpersonDraft,
  BewerbungSchuleDraft,
  KuerzelVerdikt,
} from "@/features/bewerbungen/types";
import type { FLTrainerZugleich, FLTrikotFarbe } from "@/features/teams/schemas";
import type { FieldErrors } from "@/shared/utils/validation";
import type { ReactNode } from "react";

/** What the route answers. Always 200, so a non-2xx here is a genuine transport failure. */
type BewerbungAntwort = { success: boolean; message?: string; error?: string; fieldErrors?: FieldErrors };

/** The availability check's answer, whose `vergeben` is present only where it could be judged. */
type KuerzelAntwort = { success: boolean; vergeben?: boolean; rateLimited?: boolean };

const NICHT_ABGESCHICKT = "Deine Bewerbung wurde nicht abgeschickt. Versuche es erneut.";

/**
 * The edge's rate limit, generated **before either route handler runs**: the body is nginx's own
 * HTML rather than the always-200 envelope, so the status is the whole of what arrived.
 */
const RATE_LIMIT_STATUS = 429;
const ZU_VIELE_VERSUCHE = "Zu viele Versuche in kurzer Zeit. Warte einen Moment und schick die Bewerbung dann noch einmal ab.";
// Composed, never restated: the field is already showing the promise from `utils`, and on a rate-limited blur
// the two render together — one promise in two wordings reads as two different promises.
const KUERZEL_RATE_LIMIT = `Zu viele Anfragen in kurzer Zeit. ${KUERZEL_UNGEPRUEFT}`;

async function postBewerbung(payload: unknown): Promise<BewerbungAntwort> {
  const response = await fetch("/api/bewerbung", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.status === RATE_LIMIT_STATUS) return { success: false, error: ZU_VIELE_VERSUCHE };
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);

  return response.json() as Promise<BewerbungAntwort>;
}

/**
 * `?shorthand=` and never a path segment: nginx matches this location EXACTLY, and a longer path
 * falls through to the catch-all where the rate limit does not apply and nothing reports it.
 */
async function fetchKuerzel(shorthand: string): Promise<KuerzelAntwort> {
  const response = await fetch(`/api/bewerbung/kuerzel?shorthand=${encodeURIComponent(shorthand)}`);

  if (response.status === RATE_LIMIT_STATUS) return { success: false, rateLimited: true };
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);

  return response.json() as Promise<KuerzelAntwort>;
}

/**
 * One school's application, submitted with no session at all.
 *
 * **A `fetch` to a route handler, not a server action**: `docs/frontend/spec.md :: I7` starts every
 * action with `getAdminSession()`, and a public export there would read as that rule broken.
 */
export function BewerbungForm({
  saisonId,
  schulen,
  isSchulenLesbar,
  vergebeneFarben,
  hinweisSlot,
}: {
  saisonId: string;
  schulen: readonly { id: string; name: string }[];
  isSchulenLesbar: boolean;
  vergebeneFarben: readonly FLTrikotFarbe[];
  /**
   * The aside standing over the form and again under its receipt, handed in rather than imported:
   * the band's recipe shares a module with a server query, which no client module may reach.
   */
  hinweisSlot?: ReactNode;
}) {
  const [isPending, startTransition] = useTransition();

  const [draft, setDraft] = useState<BewerbungFormDraft>(() => buildEmptyBewerbungDraft(saisonId));
  const [isEingereicht, setIsEingereicht] = useState(false);
  /**
   * The wire has no spelling for „not answered“ — `trainer_ist_zugleich: null` is the answer „Eine
   * andere Person“ — so the picker's own state sits beside the draft, written by `pickTrainerWahl`
   * and by nothing else.
   */
  const [trainerWahl, setTrainerWahl] = useState<FLTrainerZugleich | null | undefined>(undefined);
  /** Set on the first edit and never cleared: what it guards is the browser's own unload prompt. */
  const [hasTyped, setHasTyped] = useState(false);
  /** The last blur-time answer about a Kürzel, kept WITH the value it judged (see `mergedErrors`). */
  const [kuerzelVerdikt, setKuerzelVerdikt] = useState<KuerzelVerdikt | null>(null);
  const [isKuerzelPending, setIsKuerzelPending] = useState(false);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { bewerbung: FLPostBewerbungPayloadSchema },
  });

  // Above the „eingegangen“ return, as every hook here is: the panel it renders holds no form, and a
  // hook called only on the way to it would run a different number of times per render.
  useForgiveFixed({ bewerbung: bewerbungPayload(draft) });

  // A long form, entered once, by somebody who will not have it saved anywhere else.
  useUnsavedChangesWarning(hasTyped && !isEingereicht);

  const mirroredSeat = draft.kontakte.trainer_ist_zugleich;

  const validateFields = (paths: readonly string[]) =>
    validatePaths("bewerbung", bewerbungPayload(draft), bewerbungJudgedPaths(paths, mirroredSeat));

  /** Judged with the value the event carried, because state has not committed yet. */
  const validatePicked = (paths: readonly string[], next: BewerbungFormDraft) =>
    validatePaths("bewerbung", bewerbungPayload(next), bewerbungJudgedPaths(paths, next.kontakte.trainer_ist_zugleich));

  /**
   * The blur-time verdict stands only while the value it judged is still in the box.
   *
   * Laid over the hook's map rather than written into it: `setSubmitFieldErrors` moves focus, and a
   * blur-time answer would drag the applicant back into the field they left.
   */
  const mergedErrors: FieldErrors =
    kuerzelVerdikt !== null && kuerzelVerdikt.vergeben && kuerzelVerdikt.shorthand === draft.schule.shorthand
      ? { ...fieldErrors, "schule.shorthand": KUERZEL_VERGEBEN }
      : fieldErrors;

  /** Every write to the draft goes through here, so nothing can move it without arming the warning. */
  const applyDraft = (next: BewerbungFormDraft | ((current: BewerbungFormDraft) => BewerbungFormDraft)) => {
    setHasTyped(true);
    setDraft(next);
  };

  const setKontakte = (next: BewerbungKontakteDraft) => applyDraft((current) => ({ ...current, kontakte: next }));

  const applyPerson = (seat: (typeof BEWERBUNG_SEATS)[number]["value"], person: BewerbungKontaktpersonDraft) =>
    setKontakte({ ...draft.kontakte, [seat]: person });

  /**
   * The whole of the at-most-one rule: one field holds the claim, so pointing it at a seat
   * necessarily takes it off the other. No press can put it on both.
   */
  const pickTrainerWahl = (seat: FLTrainerZugleich | null) => {
    const next: BewerbungFormDraft = { ...draft, kontakte: { ...draft.kontakte, trainer_ist_zugleich: seat } };

    setTrainerWahl(seat);
    applyDraft(next);
    // Every seat, because the mirror moves two of them at once and a verdict left on the seat it
    // stopped feeding would judge a value nobody can reach any more.
    validatePicked(
      BEWERBUNG_SEATS.flatMap(({ value }) => [
        `kontakte.${value}.vorname`,
        `kontakte.${value}.nachname`,
        `kontakte.${value}.email`,
        `kontakte.${value}.telefon`,
        `kontakte.${value}.einwilligung.erteilt`,
      ]),
      next,
    );
  };

  /**
   * One press answers for all three seats: the applicant confirms once that the three people know
   * of their entry, and the wire keeps a record per seat because each person confirms their own.
   */
  const pickEinwilligung = (erteilt: boolean) => {
    const kontakte = BEWERBUNG_SEATS.reduce<BewerbungKontakteDraft>(
      (block, { value }) => ({ ...block, [value]: { ...block[value], einwilligung: { ...block[value].einwilligung, erteilt } } }),
      draft.kontakte,
    );
    const next: BewerbungFormDraft = { ...draft, kontakte: kontakte };

    applyDraft(next);
    validatePicked(
      BEWERBUNG_SEATS.map(({ value }) => `kontakte.${value}.einwilligung.erteilt`),
      next,
    );
  };

  /**
   * A pick never clears the typed new school: `bewerbungPayload` reads it only under the sentinel,
   * so an applicant who looked through the list and came back finds their entries standing.
   */
  const pickAuswahl = (auswahl: string | null) => {
    const next: BewerbungFormDraft = { ...draft, auswahl: auswahl };

    // The blur-time verdict judged a Kürzel this pick may have taken out of the payload entirely.
    setKuerzelVerdikt(null);
    applyDraft(next);
    validatePicked(["team_id"], next);
  };

  const checkKuerzel = (shorthand: string) => {
    if (shorthand.length !== KUERZEL_LAENGE) {
      setKuerzelVerdikt(null);
      return;
    }

    setIsKuerzelPending(true);
    void fetchKuerzel(shorthand).then(
      (antwort) => {
        setIsKuerzelPending(false);
        // A check that could not be judged refuses nothing: the submit's own `REQ-BEWERBUNG-008` is
        // what stands between a taken code and a stored one, and this is a courtesy in front of it.
        setKuerzelVerdikt(antwort.success && antwort.vergeben !== undefined ? { shorthand, vergeben: antwort.vergeben } : null);

        // Said out loud only for the limit: the form goes on either way, and what it costs is that
        // the code stays unchecked until the submit judges it.
        if (antwort.rateLimited === true) appToast.warning("Kürzel noch nicht geprüft", { description: KUERZEL_RATE_LIMIT });
      },
      () => {
        setIsKuerzelPending(false);
        setKuerzelVerdikt(null);
      },
    );
  };

  const handleSubmit = () => {
    // The disabled button is not the whole guard: `Enter` in any field submits the form too, and a
    // second press mid-flight would post the application twice.
    if (isPending) return;

    const payload = bewerbungPayload(draft);
    // The block keeping an incomplete draft off the wire; it RUNS the write (`docs/frontend/spec.md :: I71`).
    guardSubmit({ bewerbung: payload }, writeAfterBlock);
  };

  const writeAfterBlock = () => {
    const payload = bewerbungPayload(draft);

    startTransition(async () => {
      let antwort: BewerbungAntwort;
      try {
        antwort = await postBewerbung(payload);
      } catch {
        // The connection alone: the request never reached a judgement, so nothing of what was typed
        // may be named here.
        appToast.danger("Bewerbung nicht abgeschickt", { description: "Prüfe Deine Verbindung und versuche es erneut." });
        return;
      }

      if (!antwort.success) {
        setSubmitFieldErrors(antwort.fieldErrors ?? {}, { bewerbung: payload });

        // A field-level rejection already speaks at the field; the toast is for a failure belonging to none.
        if (!hasFieldErrors(antwort.fieldErrors)) {
          appToast.danger("Bewerbung nicht abgeschickt", { description: antwort.error ?? NICHT_ABGESCHICKT });
        }
        return;
      }

      setSubmitFieldErrors({}, {});
      setIsEingereicht(true);
    });
  };

  const eingereichtRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (isEingereicht) eingereichtRef.current?.focus();
  }, [isEingereicht]);

  if (isEingereicht) {
    return (
      <>
        {/* The form unmounts from under the pressed button, so focus would fall to `<body>` with nothing
            announced. `role="status"` reads the panel out, and the ref takes the caret it inherits. */}
        <section
          ref={eingereichtRef}
          role="status"
          tabIndex={-1}
          className="border-success/40 bg-success/10 flex w-full flex-col items-center gap-y-3 rounded-2xl border p-8 text-center outline-none">
          <CircleCheck className="text-success-strong size-10" />
          <h2 className="fluid-lg text-foreground font-extrabold tracking-tight">Deine Bewerbung ist eingegangen</h2>
          {/* No seat is named, each holding a link of its own: the reader is the one person who can
              chase the other two, which is why the panel asks rather than reassures. */}
          <p className="muted-hint max-w-md">
            Jede Kontaktperson hat eine E-Mail mit einem eigenen Link zur Bestätigung bekommen. Vollständig ist Deine Bewerbung, sobald alle
            drei bestätigt haben; dann schauen wir sie uns an und melden uns bei allen drei Kontaktpersonen. Fehlt nach{" "}
            {String(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)} Tagen eine Bestätigung, löschen wir die Bewerbung mit allen Angaben und sagen Dir
            Bescheid. Sag den anderen am besten selbst Bescheid, dann geht es schneller.
          </p>
        </section>

        {/* Below the live region and never inside it: what the applicant pressed for is the receipt,
            and an invitation read out with it buries the answer. */}
        {hinweisSlot}
      </>
    );
  }

  return (
    <>
      {/* Outside the `<Form>`, so the aside is neither a field nor part of what a submit reads. Its
          own sibling here rather than the page's, for the reason the prop carries. */}
      {hinweisSlot}

      <Form
        ref={formRef}
        // `aria`, never `native`: missing belongs to the submit, not a blur (`docs/frontend/spec.md :: I40`, `:: I71`).
        validationBehavior="aria"
        // A create form, so its required fields carry the asterisk every other create form marks them
        // with: nearly every box here is required, and a stranger fills this in once.
        data-required-marks="on"
        validationErrors={mergedErrors}
        className="flex w-full flex-col gap-5"
        onSubmit={runOnSubmit(handleSubmit)}>
        <FormSchuleSection
          schulen={schulen}
          auswahl={draft.auswahl}
          schule={draft.schule}
          stufengroesse={draft.stufengroesse}
          onAuswahlPicked={pickAuswahl}
          onSchuleChange={(schule: BewerbungSchuleDraft) => applyDraft((current) => ({ ...current, schule: schule }))}
          onStufengroesseChange={(stufengroesse) => applyDraft((current) => ({ ...current, stufengroesse: stufengroesse }))}
          onFieldLeft={validateFields}
          onSchulformPicked={(paths, schule) => {
            const next: BewerbungFormDraft = { ...draft, schule: schule };

            applyDraft(next);
            validatePicked(paths, next);
          }}
          onKuerzelLeft={checkKuerzel}
          kuerzelHinweis={kuerzelHinweis(draft.schule.shorthand, kuerzelVerdikt, isKuerzelPending)}
          isSchulenLesbar={isSchulenLesbar}
        />

        {BEWERBUNG_SEATS.map(({ value, label }, index) => (
          <FormKontaktpersonenSection
            key={value}
            seat={value}
            label={label}
            person={draft.kontakte[value]}
            // On the first panel alone: the rule holds for all three, and a reader meets it before
            // they name anybody rather than after the third.
            zeigtAltersHinweis={index === 0}
            trainerWahl={value === "trainer" ? trainerWahl : undefined}
            onTrainerWahl={value === "trainer" ? pickTrainerWahl : undefined}
            onChange={(person) => applyPerson(value, person)}
            onFieldLeft={validateFields}
          />
        ))}

        <FormEinwilligungSection
          erteilt={draft.kontakte.ansprechperson.einwilligung.erteilt}
          onErteiltPicked={pickEinwilligung}
        />

        <FormTeamSection
          trikot={draft.trikot}
          kader={draft.kader}
          wunschgegner={draft.wunschgegner}
          // The same list the school picker reads, offered as SUGGESTIONS rather than as a closed set:
          // a school may wish to play a fellow applicant no list holds yet.
          schulen={schulen}
          vergebeneFarben={vergebeneFarben}
          onTrikotChange={(trikot) => applyDraft((current) => ({ ...current, trikot: trikot }))}
          onKaderChange={(kader) => applyDraft((current) => ({ ...current, kader: kader }))}
          onWunschgegnerChange={(wunschgegner) => applyDraft((current) => ({ ...current, wunschgegner: wunschgegner }))}
          onFieldLeft={validateFields}
          onFarbePicked={(paths, trikot) => {
            const next: BewerbungFormDraft = { ...draft, trikot: trikot };

            applyDraft(next);
            validatePicked(paths, next);
          }}
        />

        <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
          <Button
            type="submit"
            isPending={isPending}
            isDisabled={isPending}
            className={formButton({ intent: "submit", fullWidth: true })}>
            {isPending ? "Wird abgeschickt..." : "Bewerbung abschicken"}
          </Button>
        </div>
      </Form>
    </>
  );
}
