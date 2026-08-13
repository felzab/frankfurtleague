"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { AdminSchiedsrichterEditForm } from "@/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import type { FLKontakt } from "@/shared/schemas";

/**
 * The whole body of `/admin/schiedsrichter/[schiedsrichter_id]` — who the referee is, then the form
 * that edits them, in the match editor's shell: the header scrolls with the form's content, the
 * action bar stays pinned below it, and every exit routes through the form's own discard guard.
 *
 * **Retiring is not on this page**, unlike the squad editor's. The referee list's own dialog is the
 * one home for it (`REQ-RETIRE-004` is answered there), and a retired referee is in no list and behind
 * no link — so a control here would be the only route to a state this page can never be opened in.
 */
export function AdminSchiedsrichterEditView({
  schiedsrichter,
}: {
  schiedsrichter: { id: string; name: string; schule: string | null; kontakt: FLKontakt; default_payment: number };
}) {
  const router = useRouter();

  // The form's own guarded exit, registered from below — see `AdminSpielEditView`.
  const requestLeaveRef = useRef<() => void>(() => router.back());

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSchiedsrichterEditForm
        schiedsrichter={schiedsrichter}
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
                <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">{schiedsrichter.name}</h2>
              </div>
              <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
