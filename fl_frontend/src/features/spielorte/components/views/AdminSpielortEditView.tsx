"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { AdminSpielortEditForm } from "@/features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { formatAddressFull } from "@/shared/utils/format";

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
 * **Retiring is not on this page.** The venue list's own dialog is the one home for it
 * (`REQ-RETIRE-003` is answered there), and a retired venue is in no list and behind no link.
 */
export function AdminSpielortEditView({ spielort }: { spielort: { id: string; name: string; address: FLAddress; default_mietpreis: number } }) {
  const router = useRouter();

  // The form's own guarded exit, registered from below — see `AdminSpielEditView`.
  const requestLeaveRef = useRef<() => void>(() => router.back());

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielortEditForm
        spielort={spielort}
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
