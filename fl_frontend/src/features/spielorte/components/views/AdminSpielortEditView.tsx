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
 * The header shows the STORED address, not the draft's: a moving subtitle would leave no fixed
 * point to compare against. Retiring is the list's dialog; reactivating is here, a fact about the
 * row rather than a value the save bar commits.
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
              <p className="muted-hint">{formatAddressFull(spielort.address)}</p>
              <p className="muted-hint">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
