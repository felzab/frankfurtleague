"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import CircleCheck from "@gravity-ui/icons/CircleCheck";

import { Button } from "@heroui/react/button";

import { ergebnisPanel } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, BEWERBUNG_SEATS } from "@/features/bewerbungen/constants";
import { FLPostBewerbungPayloadSchema } from "@/features/bewerbungen/schemas";
import { bewerbungJudgedPaths, bewerbungPayload } from "@/features/bewerbungen/utils";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useTurnstile } from "@/shared/hooks/useTurnstile";
import { appToast } from "@/shared/utils/appToast";
import { postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";

import { FormEinwilligungSection, FormKontaktpersonenSection } from "./FormKontaktpersonenSection";
import { FormSchuleSection } from "./FormSchuleSection";
import { FormTeamSection } from "./FormTeamSection";
import { useBewerbungDraft } from "./useBewerbungDraft";

import type { FLTrainerAlso, FLTrikotFarbe } from "@/core/generated/client/types";
import type {
  BewerbungFormDraft,
  BewerbungKontakteDraft,
  BewerbungKontaktpersonDraft,
  BewerbungSchuleDraft,
} from "@/features/bewerbungen/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { ReactNode } from "react";

type BewerbungAntwort = PublicEnvelope & { message?: string };

const NICHT_ABGESCHICKT = `Deine Bewerbung wurde nicht abgeschickt. ${VERSUCHE_ES_ERNEUT_SATZ}`;

/**
 * A second press is safe from this page alone, which holds the key the first one carried;
 * unchanged, because other details under that key are refused.
 */
const BEWERBUNG_UNKLAR = "Schick die Bewerbung hier unverändert erneut ab: Doppelt ankommen kann sie so nicht.";

/**
 * One school's application, submitted with no session at all.
 *
 * **A route handler and not a server action**,
 * and reached through `fl_frontend/src/shared/utils/publicSubmit.ts :: postPublicForm` for it.
 */
export function BewerbungForm({
  saisonId,
  schulen,
  isSchulenLesbar,
  vergebeneFarben,
  siteKey,
  hinweisSlot,
}: {
  saisonId: string;
  schulen: readonly { id: string; name: string }[];
  isSchulenLesbar: boolean;
  vergebeneFarben: readonly FLTrikotFarbe[];
  siteKey: string;
  /**
   * The aside standing over the form and again under its receipt, handed in rather than imported:
   * the band's recipe shares a module with a server query, which no client module may reach.
   */
  hinweisSlot?: ReactNode;
}) {
  const [isPending, startSending] = useTransition();
  const humanCheck = useTurnstile(siteKey);

  const [isEingereicht, setIsEingereicht] = useState(false);
  const [draft, applyDraft] = useBewerbungDraft(saisonId, isEingereicht);
  /** One per attempt rather than per press: kept until a box carries a refusal, so the next press replays it. */
  const [schluessel, setSchluessel] = useState(() => crypto.randomUUID());
  /**
   * The wire has no spelling for „not answered“ — `trainer_is_also: null` is the answer „Eine
   * andere Person“ — so the picker's own state sits beside the draft, written by `pickTrainerWahl`
   * and by nothing else.
   */
  const [trainerWahl, setTrainerWahl] = useState<FLTrainerAlso | null | undefined>(undefined);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formWiring } =
    useDraftFieldErrors({
      schemas: { bewerbung: FLPostBewerbungPayloadSchema },
      // This page's own word for the failure: „Änderung nicht gespeichert“ names a change nobody here
      // made, and two titles for one failure read as two failures.
      failureTitle: "Bewerbung nicht abgeschickt",
    });

  // Above the „eingegangen“ return, as every hook here is: the panel it renders holds no form, and a
  // hook called only on the way to it would run a different number of times per render.
  useForgiveFixed({ bewerbung: bewerbungPayload(draft) });

  const mirroredSeat = draft.kontakte.trainer_is_also;

  const validateFields = (paths: readonly string[]) =>
    validatePaths("bewerbung", bewerbungPayload(draft), bewerbungJudgedPaths(paths, mirroredSeat));

  /** Judged with the value the event carried, because state has not committed yet. */
  const validatePicked = (paths: readonly string[], next: BewerbungFormDraft) =>
    validatePaths("bewerbung", bewerbungPayload(next), bewerbungJudgedPaths(paths, next.kontakte.trainer_is_also));

  const setKontakte = (next: BewerbungKontakteDraft) => applyDraft((current) => ({ ...current, kontakte: next }));

  const applyPerson = (seat: (typeof BEWERBUNG_SEATS)[number]["value"], person: BewerbungKontaktpersonDraft) =>
    setKontakte({ ...draft.kontakte, [seat]: person });

  /**
   * The whole of the at-most-one rule: one field holds the claim, so pointing it at a seat
   * necessarily takes it off the other. No press can put it on both.
   */
  const pickTrainerWahl = (seat: FLTrainerAlso | null) => {
    const next: BewerbungFormDraft = { ...draft, kontakte: { ...draft.kontakte, trainer_is_also: seat } };

    setTrainerWahl(seat);
    applyDraft(next);
    // Every seat, because the mirror moves two of them at once and a verdict left on the seat it
    // stopped feeding would judge a value nobody can reach any more.
    validatePicked(
      BEWERBUNG_SEATS.flatMap(({ value }) => [
        `kontakte.${value}.first_name`,
        `kontakte.${value}.last_name`,
        `kontakte.${value}.email`,
        `kontakte.${value}.phone`,
        `kontakte.${value}.einwilligung.erteilt`,
      ]),
      next,
    );
  };

  /**
   * One press answers for all three seats: the applicant confirms once that the three people know
   * of their entry, and the wire keeps a record per seat because each person confirms their own.
   */
  const pickEinwilligung = (given: boolean) => {
    const kontakte = BEWERBUNG_SEATS.reduce<BewerbungKontakteDraft>(
      (block, { value }) => ({ ...block, [value]: { ...block[value], einwilligung: { ...block[value].einwilligung, given } } }),
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

    applyDraft(next);
    validatePicked(["team_id"], next);
  };

  const handleSubmit = () => {
    const payload = bewerbungPayload(draft);
    // The block keeping an incomplete draft off the wire; it RUNS the write.
    guardSubmit({ bewerbung: payload }, writeAfterBlock);
  };

  const writeAfterBlock = () => {
    const payload = bewerbungPayload(draft);

    startSending(async () => {
      const anfrage = await humanCheck.takeToken();
      if ("sentence" in anfrage) {
        appToast.danger("Bewerbung nicht abgeschickt", { description: anfrage.sentence });
        return;
      }

      const gesendet = await postPublicForm<BewerbungAntwort>("/api/bewerbung", payload, {
        idempotencyKey: schluessel,
        turnstileToken: anfrage.token,
      });

      if (!gesendet.answered) {
        // No one title is true across both, the edge refusing the REQUEST ruling the write out where
        // an unread answer does not (`fl_frontend/src/shared/utils/publicSubmit.ts :: PublicAnswer`).
        appToast.danger(gesendet.wroteNothing ? "Bewerbung nicht abgeschickt" : UNKLAR_TITEL, {
          // Every arm that may have landed gives the one step the outcome-unknown answer gives.
          description: gesendet.wroteNothing ? gesendet.error : BEWERBUNG_UNKLAR,
        });
        return;
      }

      const antwort = gesendet.body;

      // Wrapped again: React leaves an update after an `await` outside the transition that awaited,
      // so bare it commits before the pending state lifts.
      startSending(() => {
        if (!antwort.success) {
          // Titled as an unread answer is: the envelope's own sentence is an administrator's repair.
          if (antwort.outcome === "unknown") {
            appToast.danger(UNKLAR_TITEL, { description: BEWERBUNG_UNKLAR });
            return;
          }

          // Renewed only where a box carries the judgement: a sentence alone may be an answer that judged
          // nothing, or the refusal saying the first details stand, and either keeps its replay.
          if (antwort.fieldErrors !== undefined || antwort.unplacedError !== undefined) setSchluessel(crypto.randomUUID());

          // The hook owns the press's one toast: none where a field shows the refusal.
          reportSubmitFailure(
            {
              success: false,
              error: antwort.error ?? NICHT_ABGESCHICKT,
              fieldErrors: antwort.fieldErrors,
              unplacedError: antwort.unplacedError,
            },
            { bewerbung: payload },
            {
              raise: (shown) =>
                appToast.failure(antwort.schonAngekommen === true ? "Bewerbung schon angekommen" : "Bewerbung nicht abgeschickt", shown),
            },
          );
          return;
        }

        setSubmitFieldErrors({}, {});
        setIsEingereicht(true);
      });
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
          className={ergebnisPanel({ tone: "erfolg" })}>
          <CircleCheck
            aria-hidden="true"
            className="size-10 text-success-strong"
          />
          <h2 className="fluid-lg font-extrabold tracking-tight text-foreground">Deine Bewerbung ist eingegangen</h2>
          {/* No seat is named, each holding a link of its own: the reader is the one person who can
              chase the other two, which is why the panel asks rather than reassures. */}
          <p className="max-w-md muted-hint">
            Jede Kontaktperson hat eine E-Mail mit einem eigenen Link zur Bestätigung bekommen. Vollständig ist Deine Bewerbung, sobald alle
            drei bestätigt haben. Dann schauen wir sie uns an und melden uns bei allen drei Kontaktpersonen. Fehlt nach{" "}
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
        wiring={{ ...formWiring, validationErrors: fieldErrors }}
        // A create form, so its required fields carry the asterisk every other create form marks them
        // with: nearly every box here is required, and a stranger fills this in once.
        data-required-marks="on"
        className="flex w-full flex-col gap-6"
        onSubmit={handleSubmit}>
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
          given={draft.kontakte.ansprechperson.einwilligung.given}
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

        {/* One item of the form's gap with the submit: a widget Cloudflare shows nothing in leaves no gap of its own. */}
        <div className="flex flex-col">
          {humanCheck.widget}
          <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
            <Button
              type="submit"
              isPending={isPending}
              className={formButton({ intent: "submit", fullWidth: true })}>
              {isPending ? "Schickt ab..." : "Bewerbung abschicken"}
            </Button>
          </div>
        </div>
      </Form>
    </>
  );
}
