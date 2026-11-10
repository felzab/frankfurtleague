import "server-only";

import { redirect } from "next/navigation";

import { COPY } from "@/core/copy";
import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { requireSubjectSession } from "@/features/roles/resolvers";
import { landingTargetOf, targetsOf } from "@/features/roles/utils";

import type { RoleTarget } from "@/features/roles/utils";
import type { CardLinkProps } from "@/kit/Card";
import type { Route } from "next";

/** One place as the chooser's card names it: a team by its name over its season and seats, the rest by their area. */
function choiceOf(target: RoleTarget): CardLinkProps {
  const [first] = target.roles;
  // An address built from the person's own records, which no literal can spell.
  const href = target.href as Route;
  switch (first.kind) {
    case "kontakt": {
      // Every seat at one address shares its team and season, so the first names both.
      const rollen = target.roles.flatMap((role) => (role.kind === "kontakt" ? [role.rolle] : []));
      return { href, title: { record: first.team_name }, line: COPY.account.role.seats(COPY.shared.saisonName(first.saison_id), rollen) };
    }
    case "spieler":
      return { href, title: COPY.shared.spieler };
    case "schiedsrichter":
      return { href, title: COPY.shared.schiedsrichter };
    case "administration":
      return { href, title: COPY.admin.role };
  }
}

/**
 * The landing's read, off the session alone: a redirect to the one place the person holds, or to Konto's list where
 * they hold none, or the places they hold, listed. The sign-in's continue route asks the same rule
 * (`fl_frontend/src/features/roles/utils.ts :: landingTargetOf`), so both land alike.
 */
export async function readChoices(): Promise<{ choices: CardLinkProps[] }> {
  const subject = await requireSubjectSession(ROUTES.area.path());

  // An address holding a grant, past the administrator's window or short of the passkey, owes a fresh sign-in or its
  // passkey step, which the sign-in's landing sends it on to, not a person's landing.
  if (!subject.isAdmin && subject.records.admin_tier !== null) redirect(ROUTES.signInLanding.path());

  const targets = targetsOf(rolesOf(subject).roles);
  const target = landingTargetOf(targets);
  if (target !== null) redirect(target);
  return { choices: targets.map(choiceOf) };
}
