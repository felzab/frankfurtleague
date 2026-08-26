"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { describeAngesetzteSpiele } from "@/features/saisons/utils";
import { replaceSaisonTeamAction } from "@/features/teams/actions";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { RefusableSelect } from "@/shared/components/ui/RefusableSelect";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import { describePlatz, describeUebernommeneSpiele } from "./replacementOffer";

import type { SaisonReplacementContext } from "@/features/saisons/types";
import type { RefusableOption } from "@/shared/components/ui/RefusableSelect";

/** The pair's accessible name, and the sentence the disabled button points at. Both render once here. */
const PAIR_LABEL_ID = "teamwechsel-paar";
const BUTTON_HINT_ID = "teamwechsel-hinweis";

/**
 * On `POST /teams/{team_id}/saisons/{saison_id}/replace`: a season's junction row, and every fixture
 * on it, change hands. **A confirmation and no undo offer** — the schedule survives, the cleared
 * Austritt and the retired squad rows do not.
 */
export function FormTeamErsatzSection({
  saisonId,
  ersatz,
  isFinishedSaison,
}: {
  saisonId: string;
  ersatz: SaisonReplacementContext;
  /** `REQ-REPLACE-001`: a finished season's fixtures record who played, so the panel explains instead of offering. */
  isFinishedSaison: boolean;
}) {
  const router = useRouter();
  const [outgoingId, setOutgoingId] = useState<string | null>(null);
  const [incomingId, setIncomingId] = useState<string | null>(null);

  const outgoing = ersatz.rows.find((row) => row.teamId === outgoingId) ?? null;
  const incoming = ersatz.candidates.find((candidate) => candidate.id === incomingId) ?? null;

  const { isConfirming, isPending: isReplacing, press, cancel } = useTwoPressConfirm();

  // `REQ-REPLACE-002` in the form: a fixture carrying a record would be credited to the arriving
  // club, so the row it stands on cannot be handed over.
  const outgoingOptions: RefusableOption[] = ersatz.rows.map((row) => ({
    id: row.teamId,
    name: row.name,
    meta: row.gruppe === null ? "ohne Teamdaten" : `Gruppe ${row.gruppe}`,
    refusal: row.gespielteSpiele > 0 ? "hat schon gespielt" : null,
  }));

  // The outgoing club holds a row here too, so the first arm is also what keeps one club off both
  // ends of the same wechsel — the second picture behind `REQ-REPLACE-003`.
  const incomingOptions: RefusableOption[] = ersatz.candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    meta: null,
    refusal: candidate.isInSaison ? "schon in dieser Saison" : candidate.isStillgelegt ? "stillgelegt" : null,
  }));

  const hasPickableRow = outgoingOptions.some((option) => option.refusal === null);
  const hasPickableCandidate = incomingOptions.some((option) => option.refusal === null);
  const isOffered = !isFinishedSaison && ersatz.rows.length > 0 && hasPickableRow && hasPickableCandidate;

  const panel = formPanel({ tone: isOffered ? "danger" : "neutral" });

  const handleReplace = () => {
    // Ahead of `press`, so a half-made pair neither arms nor writes. Both are `const`, which is what
    // carries the narrowing into the closure below.
    if (outgoing === null || incoming === null) return;

    press(async () => {
      const res = await replaceSaisonTeamAction({ team_id: outgoing.teamId, saison_id: saisonId, incoming_team_id: incoming.id });

      if (!res.success) {
        appToast.danger("Wechsel fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
        return;
      }

      appToast.success("Team ersetzt", { description: res.message });
      setOutgoingId(null);
      setIncomingId(null);
      // The action's invalidation reaches the caches; this re-renders the page the admin stands on,
      // whose pickers now have to show the season this write produced.
      router.refresh();
    });
  };

  // Rendered only while the button is disabled for a reason a reader can act on. A write in flight
  // names nothing: the label already says so.
  const missingPickHint = outgoing === null ? "Wähle das ausscheidende und das nachrückende Team." : "Wähle noch das nachrückende Team.";
  const isMissingAPick = outgoing === null || incoming === null;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Team ersetzen
          <Hint
            mode="reveal"
            label="Hinweis zum Ersetzen"
            body={{ lead: "Ein Team gibt seinen Platz in dieser Saison an ein anderes ab." }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        {isFinishedSaison ? (
          <Callout
            severity="info"
            title="Die Saison ist abgeschlossen">
            Ihre Spiele halten fest, wer gespielt hat, und ein Wechsel würde das umschreiben. Ersetzen lässt sich ein Team nur in einer
            laufenden oder geplanten Saison.
          </Callout>
        ) : ersatz.rows.length === 0 ? (
          <Callout
            severity="info"
            title="Noch kein Team in dieser Saison">
            Ersetzen lässt sich nur ein Team, das in dieser Saison steht. Nimm die Teams über die Teamseite in die Saison auf.
          </Callout>
        ) : !hasPickableRow ? (
          <Callout
            severity="info"
            title="Die Saison ist zu weit">
            Ersetzen lässt sich nur ein Team, das in dieser Saison noch nicht gespielt hat, und das trifft auf keines mehr zu. Trage für ein
            ausscheidendes Team stattdessen unten auf seiner Teamseite einen Austritt ein.
          </Callout>
        ) : !hasPickableCandidate ? (
          <Callout
            severity="info"
            title="Kein Team zum Nachrücken">
            Nachrücken kann nur ein Team, das in dieser Saison noch nicht dabei und nicht stillgelegt ist. Lege über die Teamseite ein neues an
            oder reaktiviere ein stillgelegtes.
          </Callout>
        ) : (
          <>
            <p
              id={PAIR_LABEL_ID}
              className="muted-hint">
              Wähle das Team, das ausscheidet, und das Team, das seinen Platz übernimmt.
            </p>

            {/* One group rather than two fields, the swap's reason: the handover is one decision over
                two operands. `items-end` holds the arrow on the line the two triggers end at. */}
            <div
              role="group"
              aria-labelledby={PAIR_LABEL_ID}
              className="grid w-full grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <RefusableSelect
                label="Ausscheidendes Team"
                placeholder="Team wählen"
                value={outgoingOptions.find((option) => option.id === outgoingId) ?? null}
                options={outgoingOptions}
                onChange={(id) => {
                  setOutgoingId(id);
                  cancel();
                }}
                isDisabled={isReplacing}
              />
              {/* `aria-hidden`, because it restates the two triggers and the callout below them. */}
              <div
                aria-hidden="true"
                className="bg-muted text-foreground-muted flex h-10 shrink-0 items-center justify-center justify-self-center rounded-full px-3">
                {/* Downwards between two stacked pickers, rightwards once the grid puts them side by side. */}
                <ArrowRight
                  className="size-4 shrink-0 rotate-90 sm:rotate-0"
                  width={16}
                  height={16}
                />
              </div>
              <RefusableSelect
                label="Nachrückendes Team"
                placeholder="Team wählen"
                value={incomingOptions.find((option) => option.id === incomingId) ?? null}
                options={incomingOptions}
                onChange={(id) => {
                  setIncomingId(id);
                  cancel();
                }}
                isDisabled={isReplacing || outgoing === null}
              />
            </div>

            {outgoing?.isVerwaist === true && (
              <Callout
                severity="info"
                title="Zu diesem Team gibt es keine Daten mehr">
                Der Platz steht in der Saison, das Team dahinter ist aber nicht mehr angelegt. Der Wechsel gibt den Platz trotzdem weiter: Das
                nachrückende Team steht danach in der Gruppe, die auf dem Platz eingetragen ist.
              </Callout>
            )}

            {/* The outcome spelled out before it is caused, which is the whole value of the confirm
                step: the two names and the group are what an admin checks, and what a mis-click gets
                wrong. */}
            {outgoing !== null && incoming !== null && (
              <Callout
                severity="warning"
                title="Das passiert beim Wechsel">
                <strong>{incoming.name}</strong> übernimmt den Platz von <strong>{outgoing.name}</strong> {describePlatz(outgoing.gruppe)}.{" "}
                {describeUebernommeneSpiele(outgoing.spiele)} Die Kadereinträge von {outgoing.name} werden ausgetragen.
              </Callout>
            )}

            {isConfirming && outgoing !== null && incoming !== null && (
              <ConfirmReveal>
                <div className="flex w-full flex-col gap-y-1">
                  <h3 className={FORM_SECTION_HEADING}>Was {incoming.name} übernimmt</h3>
                  <dl className="flex w-full flex-col gap-y-1">
                    <ConfirmReadoutRow
                      label="Platz in der Saison"
                      value={outgoing.gruppe === null ? "Nicht bekannt" : `Gruppe ${outgoing.gruppe}`}
                    />
                    <ConfirmReadoutRow
                      label="Angesetzte Spiele"
                      value={describeAngesetzteSpiele(outgoing.spiele)}
                    />
                    <ConfirmReadoutRow
                      label={`Austritt von ${outgoing.name}`}
                      value={outgoing.hasAustritt ? "wird aufgehoben" : "keiner eingetragen"}
                    />
                  </dl>
                </div>

                <p className="fluid-xxs text-foreground leading-normal font-medium">
                  Der Wechsel gilt sofort und ist auf jeder Tabelle und jedem Spielplan dieser Saison zu sehen. Es gibt in der Verwaltung keinen
                  Weg zurück. Die Kadereinträge von {outgoing.name} bleiben ausgetragen, auch wenn Du die beiden Teams anschließend erneut
                  wechselst.
                </p>
              </ConfirmReveal>
            )}

            <div className="flex w-full flex-col gap-y-1.5">
              <ConfirmActionRow
                isConfirming={isConfirming}
                isPending={isReplacing}
                onCancel={cancel}>
                <Button
                  type="button"
                  variant="primary"
                  aria-describedby={!isReplacing && isMissingAPick ? BUTTON_HINT_ID : undefined}
                  isDisabled={isReplacing || isMissingAPick}
                  onPress={handleReplace}
                  className={confirmButton(isConfirming)}>
                  {!isConfirming && (
                    <ArrowRight
                      aria-hidden="true"
                      width={18}
                      height={18}
                    />
                  )}
                  {isReplacing ? "Wird ersetzt..." : isConfirming ? "Ja, Team ersetzen" : "Team ersetzen"}
                </Button>
              </ConfirmActionRow>
              {/* Adjacent to the control it describes, and pointed at by `aria-describedby` — the swap's
                  treatment for a control disabled for a reason the page already shows. */}
              {!isReplacing && isMissingAPick && (
                <Hint
                  mode="inline"
                  describes={BUTTON_HINT_ID}
                  text={missingPickHint}
                />
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
