"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft, Calendar } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { AdminSaisonEditForm } from "@/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { SaisonDraftFields, SaisonRolloverContext } from "@/features/saisons/types";

/** The season's own state, said in one badge — `FormKaderSection`'s badge over a season's status. */
function SaisonStatusBadge({ status }: { status: FLSaisonStatus }) {
  if (status === "active") return <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>;
  if (status === "future") return <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Geplant</span>;
  return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Abgeschlossen</span>;
}

/**
 * The whole body of `/admin/saisons/[saison_id]` — which season this is, then the form that edits it, in
 * the match editor's shell: the header scrolls with the form's content, the action bar stays pinned below
 * it, and every exit routes through the form's own discard guard.
 *
 * **The header carries no control.** On the club and player editors it owns the retirement, because a
 * person or a club can be retired; a season cannot be — one that is over is `past`, and the only thing
 * that writes `status` is the rollover, which is a whole panel rather than a button (ADR-0033). So the
 * header states the season and links to its matchdays, and every write on this page is below it.
 */
export function AdminSaisonEditView({
  saison,
  rollover,
  spieltageCount,
}: {
  saison: { id: string; status: FLSaisonStatus } & SaisonDraftFields;
  rollover: SaisonRolloverContext;
  /** How many matchdays this season has, so the link to them says whether there is anything there. */
  spieltageCount: number;
}) {
  const router = useRouter();

  // The form's own guarded exit, registered from below — see `AdminSpielEditView`.
  const requestLeaveRef = useRef<() => void>(() => router.back());

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSaisonEditForm
        saison={saison}
        rollover={rollover}
        registerRequestLeave={(requestLeave) => {
          requestLeaveRef.current = requestLeave;
        }}
        pageHeader={
          <>
            <Button
              onPress={() => requestLeaveRef.current()}
              className="bg-surface border-border text-foreground hover:bg-muted fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
              <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
              <span>Zurück</span>
            </Button>

            <header className="mb-6 flex w-full flex-col gap-y-2">
              <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">Saison {saison.id}</h2>
                <SaisonStatusBadge status={saison.status} />
                <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>
                  {formatSpielDatum(saison.start_date)} bis {formatSpielDatum(saison.end_date)}
                </span>

                {/* A link rather than a panel: matchdays are their own surface with their own ordering,
                    and the count is what tells the admin whether this season has a schedule yet. */}
                <Link
                  href={`/admin/spieltage?saison_id=${encodeURIComponent(saison.id)}`}
                  className="border-border bg-surface text-foreground hover:bg-muted fluid-xs flex h-8 w-fit items-center gap-x-2 rounded-lg border px-3 font-bold shadow-sm transition-colors">
                  <Calendar
                    aria-hidden="true"
                    width={16}
                    height={16}
                  />
                  {spieltageCount === 0 ? "Noch keine Spieltage" : spieltageCount === 1 ? "1 Spieltag" : `${String(spieltageCount)} Spieltage`}
                </Link>
              </div>
              <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
