"use client";

import { useRef, useState, useTransition } from "react";

import { ConfirmDiscardModal } from "@/shared/components/ui/ConfirmDiscardModal";
import { DraftRail } from "@/shared/components/ui/DraftRail";
import { DraftStatusProvider } from "@/shared/components/ui/DraftStatusContext";
import { EditFormLayout } from "@/shared/components/ui/EditFormLayout";
import { Form } from "@/shared/components/ui/Form";
import { FormActionBar } from "@/shared/components/ui/FormActionBar";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useEditorExit } from "@/shared/hooks/useEditorExit";
import { useSaveShortcut } from "@/shared/hooks/useSaveShortcut";
import { useStepUp } from "@/shared/hooks/useStepUp";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { patchAdminSpielberichtAction } from "../../../actions";
import { putSpielberichtAction } from "../../../personActions";
import { spielberichtFormSchema } from "../../../schemas";
import { FormBemerkungenSection } from "./FormBemerkungenSection";
import { FormKartenSection } from "./FormKartenSection";
import { FormTorschuetzenSection } from "./FormTorschuetzenSection";
import { FormVorschlagSection } from "./FormVorschlagSection";
import { deriveSpielberichtDraftStatus, eroeffnungOf, formPayloadOf, wirePayloadOf } from "./spielberichtDraft";

import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { RailBanner } from "@/shared/components/ui/railBanner";
import type { FLSpielberichtBericht } from "../../../schemas";
import type { SpielberichtLeser } from "../../../utils";
import type { SpielberichtDraft, SpielberichtKontext } from "./spielberichtDraft";

/** The block as the form edits it, and its counter, which the write names as the version it was composed on. */
type GespeicherterBericht = Pick<FLSpielberichtBericht, "ergebnis_vorschlag" | "torschuetzen" | "karten" | "bemerkungen" | "version">;

/** The report about other clubs than the fixture fields now, which a save moves to them (`seiten_geaendert`). */
const TEAMS_GEAENDERT: RailBanner = {
  id: "spielbericht.teams-geaendert",
  severity: "warning",
  raisedBy: "state",
  title: "Im Spiel stehen inzwischen andere Teams",
  body: "Personen der Teams, die nicht mehr spielen, sind aus ihren Einträgen genommen. Wähle sie neu und speichere den Bericht für die Teams, die jetzt spielen.",
  inline: null,
};

/**
 * The whole report, one editor for both readers: the booked referee's PUT and the administrator's step-up PATCH
 * take one body. No undo is offered: neither lane has a replay route.
 */
export function SpielberichtForm({
  leser,
  spielId,
  kontext,
  stored,
  header,
  zurueckHref,
}: {
  leser: SpielberichtLeser;
  spielId: string;
  kontext: SpielberichtKontext;
  stored: GespeicherterBericht | null;
  header: EditPageHeaderContent;
  /** Where the exit lands where the browser holds no page to go back to. */
  zurueckHref: string;
}) {
  const [isPending, startSaving] = useTransition();
  const stepUp = useStepUp();

  const eroeffnung = eroeffnungOf(stored, kontext);
  const { gespeichert } = eroeffnung;
  const [draft, setDraft] = useState<SpielberichtDraft>(eroeffnung.entwurf);
  const [hasSaved, setHasSaved] = useState(false);
  // Past every stored entry's key, so an added entry never reuses one React still holds.
  const nextKey = useRef(Math.max(gespeichert.torschuetzen.length, gespeichert.karten.length));

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef, formWiring } =
    // The success's own words negated, per reader: the referee sends a report, the administrator saves a correction.
    useDraftFieldErrors({
      schemas: { spielbericht: spielberichtFormSchema(stored?.karten ?? []) },
      failureTitle: leser === "admin" ? "Spielbericht nicht gespeichert" : "Spielbericht nicht gesendet",
    });

  const status = deriveSpielberichtDraftStatus({ kontext, stored: gespeichert, draft, fieldErrors });
  const isDirty = status.isDirty && !hasSaved;

  // The latch's job ends when the refreshed report arrives and the two agree.
  if (hasSaved && !status.isDirty) setHasSaved(false);

  useUnsavedChangesWarning(isDirty);
  useForgiveFixed({ spielbericht: formPayloadOf(draft) });

  const validateFields = (paths: readonly string[]) => validatePaths("spielbericht", formPayloadOf(draft), paths);
  const change = (next: Partial<SpielberichtDraft>) => setDraft((current) => ({ ...current, ...next }));
  const neuerKey = () => {
    nextKey.current += 1;
    return nextKey.current;
  };

  const resetDraftToStored = () => {
    setDraft(gespeichert);
    setSubmitFieldErrors({}, {});
  };

  const { isLeaving, leavePage, isConfirmingDiscard, closeDiscard, hasLeftViaDiscard, requestLeave, discardAndLeave } = useEditorExit({
    fallbackHref: zurueckHref,
    isDirty,
    resetDraftToStored,
  });

  useSaveShortcut(formRef, !isPending && !isConfirmingDiscard && isDirty);

  const write = () => {
    // The administrator's correction is a step-up write; the referee's lane holds no step-up page, so it never prompts.
    stepUp.confirmThen(leser === "admin", () =>
      startSaving(async () => {
        const payload = wirePayloadOf(draft, stored?.version ?? null);
        // A rejected action may still have saved, and uncaught here it takes the editor down with it.
        const res = await (leser === "admin" ? patchAdminSpielberichtAction(spielId, payload) : putSpielberichtAction(spielId, payload)).catch(
          unansweredAction,
        );
        // Wrapped again: React leaves an update after an `await` outside the transition that awaited.
        startSaving(() => {
          if (!res.success) {
            reportSubmitFailure(res, { spielbericht: formPayloadOf(draft) });
            return;
          }

          setSubmitFieldErrors({}, {});
          setHasSaved(true);
          appToast.success(res.message ?? "Spielbericht gesendet");
          resetDraftToStored();
          leavePage();
        });
      }),
    );
  };

  return (
    <div className={`${PAGE_RISE_CLASSES} flex min-h-0 w-full flex-1 flex-col`}>
      <DraftStatusProvider status={status}>
        <Form
          wiring={formWiring}
          className="flex min-h-0 w-full flex-1 flex-col"
          onSubmit={() => guardSubmit({ spielbericht: formPayloadOf(draft) }, write)}>
          <EditFormLayout
            header={header}
            onLeave={requestLeave}
            isLeaving={isLeaving}
            isDirty={isDirty}
            rail={
              <DraftRail
                banners={kontext.seitenGeaendert.size === 0 ? [] : [TEAMS_GEAENDERT]}
                nomen="Spielbericht"
              />
            }>
            <FormVorschlagSection
              kontext={kontext}
              draft={draft}
              onChange={change}
              onValidateFields={validateFields}
            />

            <FormTorschuetzenSection
              kontext={kontext}
              eintraege={draft.torschuetzen}
              onChange={(torschuetzen) => change({ torschuetzen })}
              onAdd={() =>
                change({ torschuetzen: [...draft.torschuetzen, { key: neuerKey(), seite: null, spieler: "", minute: "", eigentor: false }] })
              }
              fieldErrors={fieldErrors}
              onValidateFields={validateFields}
              geleert={eroeffnung.geleert.torschuetzen}
              istNichtantreten={draft.sonderereignis === "nichtantreten_team1" || draft.sonderereignis === "nichtantreten_team2"}
            />

            <FormKartenSection
              kontext={kontext}
              eintraege={draft.karten}
              onChange={(karten) => change({ karten })}
              onAdd={() =>
                change({ karten: [...draft.karten, { key: neuerKey(), seite: null, spieler: "", minute: "", farbe: null, grund: null }] })
              }
              fieldErrors={fieldErrors}
              onValidateFields={validateFields}
              geleert={eroeffnung.geleert.karten}
              bestand={stored?.karten ?? []}
            />

            <FormBemerkungenSection
              bemerkungen={draft.bemerkungen}
              onChange={(bemerkungen) => change({ bemerkungen })}
              onValidateFields={validateFields}
            />
          </EditFormLayout>

          <FormActionBar
            isPending={isPending || stepUp.isPrompting}
            stepUp={stepUp}
            isLeaving={isLeaving}
            onCancel={requestLeave}
          />
        </Form>

        {!hasLeftViaDiscard && (
          <ConfirmDiscardModal
            isOpen={isConfirmingDiscard}
            onClose={closeDiscard}
            onDiscard={discardAndLeave}
            changeCount={status.changed.length}
          />
        )}
      </DraftStatusProvider>
    </div>
  );
}
