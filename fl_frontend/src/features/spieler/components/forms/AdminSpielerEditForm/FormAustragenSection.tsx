"use client";

import { useTransition } from "react";

import { Button } from "@heroui/react";

import { deleteSaisonSpielerAction, reactivateSaisonSpielerAction } from "@/features/spieler/actions";
import { REACTIVATION_NEEDS_A_TEAM_IN_SAISON } from "@/features/spieler/constants";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

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
  banners,
}: {
  spielerId: string;
  saisonId: string;
  /** The day the ROW was retired, or null — which of the two controls this panel offers. */
  rowInactiveSince: string | null;
  /** `REQ-SQUAD-001`'s condition, judged on the row's STORED club: whether the reactivate can land. */
  isRowTeamInSaison: boolean;
  banners: readonly SpielerBanner[];
}) {
  const styles = formPanel({ tone: "danger" });
  const [isPending, startWriting] = useTransition();

  const isAusgetragen = rowInactiveSince !== null;
  // Inverted like the erasure's gate, so the press is live exactly where the endpoint would take it.
  const blockedReason = isRowTeamInSaison ? null : REACTIVATION_NEEDS_A_TEAM_IN_SAISON;

  const run = (write: () => Promise<{ success: boolean; message?: string; error?: string }>, failureHeading: string) => {
    startWriting(async () => {
      const res = await write();
      if (res.success) appToast.success(res.message ?? "Gespeichert");
      else appToast.danger(failureHeading, { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Kadereintrag
          <Hint
            mode="reveal"
            label="Hinweis zum Austragen"
            body={{
              lead: "Der Weg aus dem Kader einer Saison.",
              points: [{ term: "Jede andere Saison", text: "behält den Spieler." }],
            }}
          />
        </h2>
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
                  run(() => reactivateSaisonSpielerAction({ spieler_id: spielerId, saison_id: saisonId }), "Reaktivieren fehlgeschlagen")
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
              Der Spieler verschwindet aus dem Kader der Saison {saisonId}. Sein Eintrag bleibt gespeichert und lässt sich reaktivieren, solange
              sein Team in der Saison dabei ist.
            </p>
            {/* A button, not a draft field: one fact with nothing to fill in, and `reactivate` restores
                it. Its own shape, so it does not read as the page's primary action. */}
            <Button
              type="button"
              variant="secondary"
              isDisabled={isPending}
              onPress={() => run(() => deleteSaisonSpielerAction({ spieler_id: spielerId, saison_id: saisonId }), "Austragen fehlgeschlagen")}
              className="border-danger/40 bg-surface text-danger data-hovered:bg-hover-danger data-hovered:text-danger-strong fluid-sm flex h-10 w-fit items-center rounded-lg border px-4 font-bold shadow-sm transition-colors">
              {isPending ? "Speichert..." : `Aus Kader ${saisonId} austragen`}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
