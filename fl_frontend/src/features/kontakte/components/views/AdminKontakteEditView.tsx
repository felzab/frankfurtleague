"use client";

import { AdminKontakteEditForm } from "@/features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";

import type { TeamSaisonMembership } from "@/features/teams/types";

/**
 * Every exit routes through the form's discard guard. The header states which club is open and
 * nothing live: retirement is a club-level fact, so the way back from it is the club's own page and
 * no control here repeats it.
 */
export function AdminKontakteEditView({
  team,
  saison,
}: {
  team: { id: string; name: string; shorthand: string; inactive_since: string | null };
  saison: TeamSaisonMembership;
}) {
  const isRetired = team.inactive_since !== null;

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminKontakteEditForm
        teamId={team.id}
        saison={saison}
        pageHeader={{
          title: team.name,
          // Retirement outranks the Kürzel, as it does on the club's own editor: the Kürzel is a
          // field of a form elsewhere, the day is nowhere else.
          chip: isRetired ? (
            <RetiredBadge since={team.inactive_since} />
          ) : (
            // The TeamCard's chip, so the Kürzel wears one colour everywhere.
            <span className="bg-brand-solid text-brand-solid-foreground flex h-10 w-10 items-center justify-center rounded-xl font-extrabold shadow-sm">
              {team.shorthand}
            </span>
          ),
        }}
      />
    </div>
  );
}
