"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import SealCheck from "@gravity-ui/icons/SealCheck";

import { annehmenBewerbungAction } from "@/features/bewerbungen/actions";
import { GruppeSelect } from "@/features/teams/components/forms/GruppeSelect";
import { TrikotFarbeSelect } from "@/features/teams/components/forms/TrikotFarbeSelect";
import { trikotFarbeLabel } from "@/features/teams/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FIELD_PAIR_CLASSES, FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { DRAFT_DISCARDED, guardAgainstDraft } from "@/shared/utils/draftGuard";

import type { FLGruppenNames, FLTrikotFarbe } from "@/features/teams/schemas";
import type { GruppeOffer } from "@/features/teams/types";

/** What the readout reads where no colour has been assigned — the season's row accepts that answer. */
const KEINE_FARBE = "Keine Angabe";

/**
 * The acceptance, on `POST /bewerbungen/{bewerbung_id}/annehmen`. **A confirmation step and no
 * undo**: `saison_teams` has no DELETE, so a club entered in error leaves only through an
 * `austritt`, a public record carrying a stated reason.
 */
export function AdminBewerbungAnnehmenSection({
  bewerbungId,
  teamName,
  createsTeam,
  saisonId,
  saisonStatus,
  gruppeOffer,
  hindernis,
  isDirty,
}: {
  bewerbungId: string;
  /** The club this acceptance would enter, or `null` where the application names none. */
  teamName: string | null;
  /** Whether the club is created by this press, which is the difference the readout states. */
  createsTeam: boolean;
  saisonId: string;
  /** The season's own state, or `null` where no season carries this application's id. */
  saisonStatus: "past" | "active" | "future" | null;
  /** The season's groups with occupancy, from `buildGruppeOffer` — what the picker may offer. */
  gruppeOffer: readonly GruppeOffer[];
  /**
   * Why the write would be refused, or `null`. The panel stays and closes its own control on it: a
   * section that vanishes leaves the reader hunting a decision the page still holds (my rule,
   * 2026-09-04).
   */
  hindernis: string | null;
  /** Whether the decline holds a typed reason, which this write re-keys the page over. */
  isDirty: boolean;
}) {
  const twoPress = useTwoPressConfirm(() => guardAgainstDraft(isDirty, DRAFT_DISCARDED));
  const router = useRouter();
  const { isConfirming, press, cancel } = twoPress;

  const [gruppe, setGruppe] = useState<FLGruppenNames | null>(null);
  const [trikotFarbe, setTrikotFarbe] = useState<FLTrikotFarbe | null>(null);
  /**
   * Held here rather than in a form's error map: this panel is not inside a `<Form>`, and the
   * refusal it carries is about the group that was refused rather than about the draft.
   */
  const [gruppeError, setGruppeError] = useState<string | null>(null);

  const panel = formPanel();

  // Why the control is closed, in the order the endpoint judges them: what the page already knows is
  // refused first, and the group is the one thing left for the administrator to supply.
  const grund = hindernis ?? (gruppe === null ? "Wähle zuerst eine Gruppe." : null);

  const handleAccept = () => {
    // Ahead of `press`, so an unchosen group neither arms nor writes.
    const chosen = gruppe;
    if (chosen === null || hindernis !== null) return;

    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await annehmenBewerbungAction({ id: bewerbungId, gruppe: chosen, trikot_farbe: trikotFarbe }).catch(rejectedWrite(router));

      // Wrapped again: the press runs this inside its transition, and React leaves an update after an
      // `await` outside it.
      startTransition(() => {
        if (!res.success) {
          const fieldError = res.fieldErrors?.gruppe ?? null;
          setGruppeError(fieldError);

          // Suppressed where the picker carries the message, so a refusal about the chosen group is
          // not also said in a toast that names no field.
          if (fieldError === null) appToast.failure("Bewerbung nicht angenommen", res);
          return;
        }

        setGruppeError(null);
        appToast.success("Bewerbung angenommen", { description: res.message });
      });
    });
  };

  // The object stays in the label: „Ja, endgültig aufnehmen“ alone would not say what is taken into what.
  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Zusage">
          <Hint
            mode="reveal"
            label="Hinweis zur Zusage"
            body={{
              lead: "Die Zusage nimmt das Team in die Saison auf.",
              points: [
                { term: "Die Kontaktpersonen", text: "der Bewerbung bekommen die Zusage per E-Mail." },
                { term: "Zurücknehmen", text: "lässt sich eine Aufnahme nur über einen Austritt mit Begründung." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {/* The whole-control closures, in the endpoint's own order: each refuses every group alike,
            so none of them belongs on the picker. */}
        {saisonStatus === null ? (
          <Callout
            severity="warning"
            title={`Zur Saison ${saisonId} gibt es keinen Eintrag`}>
            Ohne die Regeln der Saison steht nicht fest, welche Gruppen sie überhaupt hat. Lege die Saison an oder lehne die Bewerbung ab.
          </Callout>
        ) : saisonStatus !== "future" ? (
          <Callout
            severity="info"
            title={`Die Saison ${saisonId} ist nicht mehr in Planung`}>
            Ein Team wird nur in eine geplante Saison aufgenommen. Diese Bewerbung lässt sich nur noch ablehnen.
          </Callout>
        ) : (
          <>
            {/* Absent where the application names no club: this sentence is built around that name,
                and „wer aufgenommen würde“ is exactly what such a row leaves open. */}
            {teamName !== null && (
              <p className="muted-hint">
                {createsTeam ? (
                  <>
                    Mit der Zusage wird <strong>{teamName}</strong> als Team angelegt und in die Saison {saisonId} aufgenommen.
                  </>
                ) : (
                  <>
                    Mit der Zusage wird <strong>{teamName}</strong> in die Saison {saisonId} aufgenommen.
                  </>
                )}
              </p>
            )}

            <div className={FIELD_PAIR_CLASSES}>
              <GruppeSelect
                value={gruppe}
                onChange={(next) => {
                  // Retracted on the pick, not on the next attempt: the message is about the group
                  // that was refused, and it stops describing the picker the moment that one moves.
                  setGruppeError(null);
                  setGruppe(next);
                  cancel();
                }}
                offer={gruppeOffer}
                error={gruppeError ?? undefined}
              />

              <TrikotFarbeSelect
                value={trikotFarbe}
                onChange={(next) => {
                  setTrikotFarbe(next);
                  cancel();
                }}
              />
            </div>

            {isConfirming && gruppe !== null && teamName !== null && (
              <ConfirmReveal>
                <div className="flex w-full flex-col gap-y-1">
                  <h3 className={FORM_SECTION_HEADING_CLASSES}>{createsTeam ? "Was dabei angelegt wird" : "Was dabei eingetragen wird"}</h3>
                  <dl className="flex w-full flex-col gap-y-1">
                    <ConfirmReadoutRow
                      label={createsTeam ? "Neues Team" : "Team"}
                      value={teamName}
                    />
                    <ConfirmReadoutRow
                      label="Gruppe"
                      value={`Gruppe ${gruppe} der Saison ${saisonId}`}
                    />
                    <ConfirmReadoutRow
                      label="Trikotfarbe"
                      value={trikotFarbe === null ? KEINE_FARBE : trikotFarbeLabel(trikotFarbe)}
                    />
                  </dl>
                </div>

                {/* Only where the press creates the club: this is the moment the address the school
                    typed becomes public, and no other arm publishes anything (`docs/datenschutz.md` §4). */}
                {createsTeam && (
                  <p className="fluid-xxs text-foreground leading-normal font-medium">
                    Die Adresse der Schule steht danach öffentlich auf der Teamseite.
                  </p>
                )}

                {/* No undo is named on purpose: no endpoint takes an entry back, and the message to
                    the school goes out with the press. */}
                <p className="fluid-xxs text-foreground leading-normal font-medium">
                  Es gibt in der Verwaltung keinen Weg zurück. Aus der Saison kommt das Team danach nur noch über einen Austritt, der öffentlich
                  mit Begründung steht. Die Zusage geht sofort an die Kontaktpersonen raus.
                </p>
              </ConfirmReveal>
            )}

            <div className="flex w-full flex-col gap-y-2">
              <ConfirmActionRow confirm={twoPress}>
                {/* On the control, never a sentence beside it that a pick would unmount
                    (`docs/frontend/spec.md` §1.14). */}
                <ConfirmPressButton
                  confirm={twoPress}
                  reason={grund}
                  resting="Bewerbung annehmen"
                  armed="Ja, Team verbindlich aufnehmen"
                  running="Nimmt auf..."
                  icon={
                    <SealCheck
                      className="size-4.5"
                      aria-hidden="true"
                    />
                  }
                  onPress={handleAccept}
                />
              </ConfirmActionRow>

              {/* A plain sentence, not an inline hint needing a control to point at it: the wrapper covers
                  the control (`docs/frontend/spec.md` §1.14). It stands beside the press because the
                  page's own read raises it, and no pick here does. */}
              {hindernis !== null && <p className="muted-hint">{hindernis}</p>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
