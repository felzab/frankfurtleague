"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@heroui/react/button";

import { deleteSaisonSpielerAction, reactivateSaisonSpielerAction } from "@/features/spieler/actions";
import { REACTIVATION_NEEDS_A_TEAM_IN_SAISON, REACTIVATION_NEEDS_ROOM_IN_SQUAD } from "@/features/spieler/constants";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { DRAFT_DISCARDED, guardAgainstDraft } from "@/shared/utils/draftGuard";
import { focusAfterWrite, focusSection } from "@/shared/utils/focusAfterWrite";

import type { RowReturn } from "@/features/spieler/types";
import type { ActionResult } from "@/shared/types/types";
import type { SpielerBanner } from "./banners";

/** The editor's words for a refused return, each pointing at a repair made on this page or in the season's rules. */
const RETURN_REFUSAL: Record<RowReturn, string | null> = {
  open: null,
  clubLeft: REACTIVATION_NEEDS_A_TEAM_IN_SAISON,
  squadFull: REACTIVATION_NEEDS_ROOM_IN_SQUAD,
};

/** The place the removal and the return share: each write's refresh draws the other in its stead. */
const KADEREINTRAG_PLACE = "kadereintrag";

/**
 * Takes a player out of ONE season's squad, writing to `saison_spieler` and nothing else. Retiring
 * the PERSON is a different control with a different endpoint, offered on the player list.
 */
export function FormAustragenSection({
  spielerId,
  saisonId,
  rowInactiveSince,
  rowReturn,
  banners,
  isDirty,
}: {
  spielerId: string;
  saisonId: string;
  /** The day the ROW was retired, or null — which of the two controls this panel offers. */
  rowInactiveSince: string | null;
  /** Judged on the row's STORED club rather than the draft's: the reactivate returns the row to the club it names. */
  rowReturn: RowReturn;
  banners: readonly SpielerBanner[];
  /** The editor's unsaved typing, which either write re-keys the editor over. */
  isDirty: boolean;
}) {
  const styles = formPanel({ tone: "danger" });
  const [isPending, startWriting] = useTransition();
  const router = useRouter();

  const isAusgetragen = rowInactiveSince !== null;
  const blockedReason = RETURN_REFUSAL[rowReturn];

  const run = (write: () => Promise<ActionResult>, savedHeading: string, failureHeading: string) => {
    if (!guardAgainstDraft(isDirty, DRAFT_DISCARDED)) return;

    // Read by keys at the press: the page keys the editor on the stored row, so the refresh draws this panel anew.
    const landing = focusAfterWrite();
    startWriting(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await write().catch(rejectedWrite(router));
      // A detail written here would be this panel's guess at what the write cost: the action sends
      // that sentence, and `docs/frontend/spec.md` §1.12 leaves a server's message alone.
      if (res.success) {
        landing.landed();
        appToast.success(savedHeading, { description: res.message });
      } else {
        appToast.failure(failureHeading, res);
      }
    });
  };

  return (
    <section
      className={styles.root()}
      {...focusSection(KADEREINTRAG_PLACE)}>
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
            <FocusSlot name={KADEREINTRAG_PLACE}>
              <Hint
                mode="refusal"
                reason={isPending ? null : blockedReason}
                label="Kadereintrag reaktivieren"
                className="w-fit">
                <Button
                  type="button"
                  variant="primary"
                  isPending={isPending}
                  isDisabled={!isPending && blockedReason !== null}
                  onPress={() =>
                    run(
                      () => reactivateSaisonSpielerAction({ spieler_id: spielerId, saison_id: saisonId }),
                      "Kadereintrag reaktiviert",
                      "Kadereintrag nicht reaktiviert",
                    )
                  }
                  className={formButton({ intent: "submit" })}>
                  {isPending ? "Stellt wieder her..." : "Kadereintrag reaktivieren"}
                </Button>
              </Hint>
            </FocusSlot>
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
            <FocusSlot name={KADEREINTRAG_PLACE}>
              <Button
                type="button"
                variant="secondary"
                isPending={isPending}
                onPress={() =>
                  run(
                    () => deleteSaisonSpielerAction({ spieler_id: spielerId, saison_id: saisonId }),
                    "Kadereintrag ausgetragen",
                    "Kadereintrag nicht ausgetragen",
                  )
                }
                className="flex h-10 w-fit items-center rounded-lg border border-danger/40 bg-surface px-4 fluid-sm font-bold text-danger-strong shadow-sm transition-colors data-hovered:bg-hover-danger">
                {isPending ? "Trägt aus..." : `Aus Kader ${saisonId} austragen`}
              </Button>
            </FocusSlot>
          </>
        )}
      </div>
    </section>
  );
}
