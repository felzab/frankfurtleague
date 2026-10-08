"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@heroui/react/button";

import { kaderAustragenHinweis } from "@/features/spieler/constants";
import { deleteKaderZeileAction } from "@/features/spieler/personActions";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { DRAFT_DISCARDED, guardAgainstDraft } from "@/shared/utils/draftGuard";
import { focusAfterWrite, focusSection } from "@/shared/utils/focusAfterWrite";

/**
 * The place the austragen and the read-only row share: the write's refresh draws the row read-only in
 * the panel's stead, whose heading then takes the focus.
 */
export const KADERZEILE_PLACE = "kadereintrag";

/**
 * Takes the row out of the season's squad, a write the seat holder cannot take back: only the
 * administrator's reactivate does, which the panel says before the press.
 */
export function FormKaderZeileAustragenSection({
  teamId,
  saisonId,
  spielerId,
  isDirty,
}: {
  teamId: string;
  saisonId: string;
  spielerId: string;
  /** The editor's unsaved typing, which the write's refresh draws the page over. */
  isDirty: boolean;
}) {
  const styles = formPanel({ tone: "danger" });
  const [isPending, startWriting] = useTransition();
  const router = useRouter();

  const austragen = () => {
    if (!guardAgainstDraft(isDirty, DRAFT_DISCARDED)) return;

    // Read at the press: the refresh draws this page anew with the row read-only (`docs/frontend/spec.md :: I536`).
    const landing = focusAfterWrite();
    startWriting(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await deleteKaderZeileAction({ team_id: teamId, saison_id: saisonId, spieler_id: spielerId }).catch(rejectedWrite(router));
      if (res.success) {
        landing.landed();
        appToast.success("Kadereintrag ausgetragen", { description: res.message });
      } else {
        appToast.failure("Kadereintrag nicht ausgetragen", res);
      }
    });
  };

  return (
    <section
      className={styles.root()}
      {...focusSection(KADERZEILE_PLACE)}>
      <div className={styles.header()}>
        <PanelHeading
          className={styles.heading()}
          title="Austragen"
        />
      </div>

      <div className={styles.body()}>
        <p className="muted-hint">{kaderAustragenHinweis(saisonId)}</p>
        <FocusSlot name={KADERZEILE_PLACE}>
          {/* The admin editor's austragen control, so the one act reads alike on both panels. */}
          <Button
            type="button"
            variant="secondary"
            isPending={isPending}
            onPress={austragen}
            className="flex h-10 w-fit items-center rounded-lg border border-danger/40 bg-surface px-4 fluid-sm font-bold text-danger-strong shadow-sm transition-colors data-hovered:bg-hover-danger">
            {isPending ? "Trägt aus..." : `Aus Kader ${saisonId} austragen`}
          </Button>
        </FocusSlot>
      </div>
    </section>
  );
}
