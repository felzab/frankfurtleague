"use client";

import { useTransition } from "react";

import { Button } from "@heroui/react";

import { deleteSaisonSpielerAction, reactivateSaisonSpielerAction } from "@/features/spieler/actions";
import { REACTIVATION_NEEDS_A_TEAM_IN_SAISON, REACTIVATION_NEEDS_ROOM_IN_SQUAD } from "@/features/spieler/constants";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { appToast } from "@/shared/utils/appToast";

import type { ActionResult } from "@/shared/types/types";
import type { SpielerBanner } from "./banners";

/**
 * Takes a player out of ONE season's squad, writing to `saison_spieler` and nothing else. Retiring
 * the PERSON is a different control with a different endpoint, offered on the player list.
 */
export function FormAustragenSection({
  spielerId,
  saisonId,
  rowInactiveSince,
  isRowTeamInSaison,
  isRowSquadFull,
  banners,
}: {
  spielerId: string;
  saisonId: string;
  /** The day the ROW was retired, or null — which of the two controls this panel offers. */
  rowInactiveSince: string | null;
  /** `REQ-SQUAD-001`'s condition, judged on the row's STORED club: whether the reactivate can land. */
  isRowTeamInSaison: boolean;
  /** `REQ-SQUAD-003`'s condition, judged on that same stored club rather than on the draft's. */
  isRowSquadFull: boolean;
  banners: readonly SpielerBanner[];
}) {
  const styles = formPanel({ tone: "danger" });
  const [isPending, startWriting] = useTransition();

  const isAusgetragen = rowInactiveSince !== null;
  // Inverted like the erasure's gate, so a reason stands exactly where the endpoint would refuse.
  const clubReason = isRowTeamInSaison ? null : REACTIVATION_NEEDS_A_TEAM_IN_SAISON;
  const squadFullReason = isRowSquadFull ? REACTIVATION_NEEDS_ROOM_IN_SQUAD : null;
  // The club's answer first, the order the endpoint asks the two in: a full squad is not a fact worth
  // reporting about a club the season does not hold.
  const blockedReason = clubReason ?? squadFullReason;

  const run = (write: () => Promise<ActionResult>, failureHeading: string, savedDetail: string) => {
    startWriting(async () => {
      const res = await write();
      // The press's own detail rather than the action's sentence: this panel saves two opposite
      // things and the shared title names neither (`docs/frontend/spec.md :: I42`).
      if (res.success) appToast.success("Gespeichert", { description: savedDetail });
      else appToast.danger(failureHeading, { description: res.error });
    });
  };

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <PanelHeading
          className={styles.heading()}
          title="Kadereintrag">
          <Hint
            mode="reveal"
            label="Hinweis zum Austragen"
            body={{
              lead: "Der Weg aus dem Kader einer Saison.",
              points: [{ term: "Jede andere Saison", text: "behält den Spieler." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={styles.body()}>
        {isAusgetragen ? (
          <>
            <InlineBanners
              banners={banners}
              spot="austragen"
            />
            {/* The reason is said on the control as well as in the banner above it, the erasure's
                treatment. `isPending` is left out: it ends by itself. */}
            <Hint
              mode="refusal"
              reason={isPending ? null : blockedReason}
              className="w-fit">
              <Button
                type="button"
                variant="primary"
                isDisabled={isPending || blockedReason !== null}
                onPress={() =>
                  run(
                    () => reactivateSaisonSpielerAction({ spieler_id: spielerId, saison_id: saisonId }),
                    "Reaktivieren fehlgeschlagen",
                    "Nummer, Position und Stufe sind wiederhergestellt.",
                  )
                }
                className={formButton({ intent: "submit" })}>
                {isPending ? "Speichert..." : "Kadereintrag reaktivieren"}
              </Button>
            </Hint>
          </>
        ) : (
          <>
            {/* The condition is named rather than promised away: a club replacement takes the row's
                team out of the season, and `REQ-SQUAD-001` then refuses the return offered here. */}
            <p className="muted-hint">
              Der Spieler verschwindet aus dem Kader der Saison {saisonId}. Der Kadereintrag bleibt gespeichert und lässt sich reaktivieren,
              solange sein Team in der Saison dabei ist.
            </p>
            {/* A button, not a draft field: one fact with nothing to fill in, and `reactivate` restores
                it. Its own shape, so it does not read as the page's primary action. */}
            <Button
              type="button"
              variant="secondary"
              isDisabled={isPending}
              onPress={() =>
                run(
                  () => deleteSaisonSpielerAction({ spieler_id: spielerId, saison_id: saisonId }),
                  "Austragen fehlgeschlagen",
                  "Der Spieler steht nicht mehr im Kader dieser Saison.",
                )
              }
              className="border-danger/40 bg-surface text-danger-strong data-hovered:bg-hover-danger fluid-sm flex h-10 w-fit items-center rounded-lg border px-4 font-bold shadow-sm transition-colors">
              {isPending ? "Speichert..." : `Aus Kader ${saisonId} austragen`}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
