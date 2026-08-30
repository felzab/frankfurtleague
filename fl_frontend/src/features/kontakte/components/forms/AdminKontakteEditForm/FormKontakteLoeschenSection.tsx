"use client";

import { useRouter } from "next/navigation";

import { TrashBin } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { patchSaisonTeamKontakteAction } from "@/features/kontakte/actions";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { guardAgainstDraft } from "@/shared/utils/draftGuard";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

const DRAFT_IN_THE_WAY = "Das Löschen liest die Seite neu und verwirft die nicht gespeicherten Änderungen.";

/**
 * Clearing THIS team-season's contact block, on the season's own junction row.
 *
 * **Not a person's erasure**, which is keyed on an ADDRESS. The page stays: the row is the team
 * BEING IN the season, so clearing its contacts cannot remove it.
 */
export function FormKontakteLoeschenSection({
  teamId,
  saisonId,
  hasStored,
  isDirty,
}: {
  teamId: string;
  saisonId: string;
  /** Nothing stored means nothing to clear, and a control offering it would refuse itself. */
  hasStored: boolean;
  isDirty: boolean;
}) {
  const router = useRouter();
  const { isConfirming, isPending, press, cancel } = useTwoPressConfirm();

  // Graded only where there is something to take: a red panel over an empty row spends the grade on
  // a page where nothing is at stake.
  const panel = formPanel({ tone: hasStored ? "danger" : "neutral" });

  const handleClear = () => {
    if (!guardAgainstDraft(isDirty, DRAFT_IN_THE_WAY)) return;

    press(async () => {
      const res = await patchSaisonTeamKontakteAction({ team_id: teamId, saison_id: saisonId, kontakte: null });

      if (!res.success) {
        appToast.danger("Kontakte nicht gelöscht", { description: res.error ?? UNKNOWN_REFUSAL });
        return;
      }

      appToast.success("Kontakte gelöscht", { description: "Für diese Saison sind jetzt keine Kontaktpersonen hinterlegt." });
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Kontakte dieser Saison löschen">
          <Hint
            mode="reveal"
            label="Hinweis zum Löschen der Kontakte"
            body={{
              lead: "Leert alle drei Kontaktpersonen dieser Saison-Zugehörigkeit.",
              points: [
                { term: "Andere Saisons", text: "behalten ihre eigenen Kontaktpersonen, die hier nicht berührt werden." },
                { term: "Eine Person überall entfernen", text: "geht über „Person löschen“ in deren eigenem Abschnitt." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {!hasStored ? (
          <p className="muted-hint">Für diese Saison sind keine Kontakte gespeichert.</p>
        ) : (
          <p className="muted-hint">
            Leert die drei Kontaktpersonen dieser Saison-Zugehörigkeit. Die Personen selbst bleiben in jeder anderen Saison stehen.
          </p>
        )}

        {isConfirming && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING}>Was dabei geleert wird</h3>
              <dl className="flex w-full flex-col gap-y-1">
                <ConfirmReadoutRow
                  label="Saison"
                  value={saisonId}
                />
                <ConfirmReadoutRow
                  label="Kontaktpersonen"
                  value="alle drei Plätze dieser Saison"
                />
                <ConfirmReadoutRow
                  label="Andere Saisons"
                  value="bleiben unberührt"
                />
              </dl>
            </div>

            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Danach ist für die Saison {saisonId} niemand mehr hinterlegt. Die Zugehörigkeit des Teams zur Saison bleibt bestehen, und die
              Personen bleiben in jeder anderen Saison stehen.
            </p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow
          isConfirming={isConfirming}
          isPending={isPending}
          onCancel={cancel}>
          <Button
            type="button"
            variant="primary"
            isDisabled={isPending || !hasStored}
            onPress={handleClear}
            className={confirmButton(isConfirming)}>
            {/* Dropped while armed, as every two-press control here drops it: the glyph announces the
                press, and step two is already announcing itself in words. */}
            {!isConfirming && (
              <TrashBin
                aria-hidden="true"
                width={18}
                height={18}
              />
            )}
            {/* The object stays in the label: „Ja, endgültig löschen“ under a trash icon reads as the
                team going, which is the one thing this control does not touch. */}
            {isPending ? "Löscht..." : isConfirming ? "Ja, Kontakte dieser Saison endgültig löschen" : "Kontakte löschen"}
          </Button>
        </ConfirmActionRow>
      </div>
    </section>
  );
}
