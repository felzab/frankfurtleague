"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { reactivateSpielortAction } from "@/features/spielorte/actions";
import { AdminSpielortEditForm } from "@/features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatAddressFull, formatSpielDatum } from "@/shared/utils/format";

import type { FLAddress } from "@/shared/schemas";

/**
 * The whole body of `/admin/spielorte/[spielort_id]` — where the venue is, then the form that edits
 * it, in the match editor's shell: the header scrolls with the form's content, the action bar stays
 * pinned below it, and every exit routes through the form's own discard guard.
 *
 * **The header shows the STORED address rather than the draft's.** It is the identity the admin
 * navigated to, and a subtitle that moved under the fields being typed would leave the page with no
 * fixed point to compare against — the Geändert markers in the form are what report the difference.
 *
 * **Retiring is not on this page**, and reactivating is. The venue list's own dialog is the one home
 * for the retirement (`REQ-RETIRE-003` is answered there), while the way back has no refusal to
 * report and belongs wherever a retired venue is standing — the club editor's arrangement.
 *
 * The one header-level control is reactivation, because a retired venue's state is a fact about the
 * row rather than a value the save bar commits, and it writes immediately through its own
 * endpoint.
 */
export function AdminSpielortEditView({
  spielort,
  inactiveSince,
}: {
  spielort: { id: string; name: string; address: FLAddress; default_mietpreis: number };
  /** The day this venue was retired, or `null` while it is in use — on no field of the form. */
  inactiveSince: string | null;
}) {
  const router = useRouter();
  const [isReactivating, startReactivating] = useTransition();

  const isRetired = inactiveSince !== null;

  // The form's own guarded exit, registered from below — see `AdminSpielEditView`.
  const requestLeaveRef = useRef<() => void>(() => router.back());

  const handleReactivate = () => {
    startReactivating(async () => {
      const res = await reactivateSpielortAction({ id: spielort.id });
      if (res.success) appToast.success(res.message ?? "Spielort reaktiviert.");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
    });
  };

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielortEditForm
        spielort={spielort}
        isRetired={isRetired}
        registerRequestLeave={(requestLeave) => {
          requestLeaveRef.current = requestLeave;
        }}
        pageHeader={
          <>
            <Button
              onPress={() => requestLeaveRef.current()}
              className="bg-surface border-border text-foreground data-hovered:bg-hover fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
              <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
              <span>Zurück</span>
            </Button>

            <header className="mb-6 flex w-full flex-col gap-y-2">
              <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">{spielort.name}</h2>
                {isRetired && (
                  <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt seit {formatSpielDatum(inactiveSince)}</span>
                )}
                {isRetired && (
                  <Button
                    onPress={handleReactivate}
                    isDisabled={isReactivating}
                    className="border-border bg-surface text-foreground data-hovered:bg-hover fluid-xs flex h-8 w-fit items-center rounded-lg border px-3 font-bold shadow-sm transition-colors">
                    {isReactivating ? "Reaktiviert..." : "Reaktivieren"}
                  </Button>
                )}
              </div>
              <p className="fluid-sm text-foreground-muted font-medium">{formatAddressFull(spielort.address)}</p>
              <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
