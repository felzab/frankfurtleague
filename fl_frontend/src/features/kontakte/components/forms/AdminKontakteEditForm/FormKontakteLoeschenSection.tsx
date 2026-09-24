"use client";

import { useRouter } from "next/navigation";

import TrashBin from "@gravity-ui/icons/TrashBin";

import { patchSaisonTeamKontakteAction } from "@/features/kontakte/actions";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { guardAgainstDraft } from "@/shared/utils/draftGuard";

import { DRAFT_IN_THE_WAY } from "./banners";

/** Said in the body and on the closed control alike, so the two cannot describe the empty row differently. */
const KEINE_KONTAKTE = "Für diese Saison sind keine Kontakte gespeichert.";

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
  stand,
  isDirty,
}: {
  teamId: string;
  saisonId: string;
  /** Somebody is on file. Three empty seats are nothing stored: clearing them would take no person. */
  hasStored: boolean;
  /** The token the page's own read served: this clearing is a save like any other and is judged against it. */
  stand: string;
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
      const res = await patchSaisonTeamKontakteAction({ team_id: teamId, saison_id: saisonId, kontakte: null, kontakte_stand: stand });

      if (!res.success) {
        appToast.failure("Kontakte nicht gelöscht", res);
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
                { term: "Eine Person überall entfernen", text: "geht über „Kontaktperson löschen“ in deren eigenem Abschnitt." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {!hasStored ? (
          <p className="muted-hint">{KEINE_KONTAKTE}</p>
        ) : (
          <p className="muted-hint">
            Leert die drei Kontaktpersonen dieser Saison-Zugehörigkeit. Die Personen selbst bleiben in jeder anderen Saison stehen.
          </p>
        )}

        {isConfirming && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING_CLASSES}>Was dabei geleert wird</h3>
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
          {/* On the control as well as in the body, the treatment `docs/frontend/spec.md` §1.14 gives a
              standing closure. */}
          <ConfirmPressButton
            isConfirming={isConfirming}
            isPending={isPending}
            reason={hasStored ? null : KEINE_KONTAKTE}
            resting="Kontakte löschen"
            // The object stays in the label: „Ja, endgültig löschen“ under a trash icon reads as the
            // team going, which is the one thing this control does not touch.
            armed="Ja, Kontakte dieser Saison endgültig löschen"
            running="Löscht..."
            icon={
              <TrashBin
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={handleClear}
          />
        </ConfirmActionRow>
      </div>
    </section>
  );
}
