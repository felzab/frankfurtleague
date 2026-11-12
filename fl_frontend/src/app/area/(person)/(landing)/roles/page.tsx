import { redirect } from "next/navigation";

import { CardLink, CardPlaceholder } from "@/kit/Card";
import { CardGrid } from "@/kit/CardGrid";
import { PageWait } from "@/kit/PageFade";
import { RailPage } from "@/kit/RailFrame";
import { Waiting } from "@/kit/Skeleton";

import { ROUTES } from "@/core/routes";
import { requireSubjectSession } from "@/features/roles/resolvers";
import { placeOf, placesOf } from "@/features/roles/utils";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.areaRoles, ROUTES.areaRoles.path());
}

/**
 * Every place the person holds, each a card linking it: a team by its name over its season and seats, the rest by
 * their area.
 */
async function Choices() {
  const subject = await requireSubjectSession(ROUTES.areaRoles.path());
  // An address holding a grant, past the administrator's window or short of the passkey, owes a fresh sign-in or its
  // passkey step, which the sign-in's landing sends it on to, not a person's places.
  if (!subject.isAdmin && subject.records.admin_tier !== null) redirect(ROUTES.signInLanding.path());
  return (
    <CardGrid across={3}>
      {placesOf(subject).map((target) => {
        const { href, name, seats } = placeOf(target);
        return (
          <CardLink
            key={href}
            href={href}
            title={name}
            {...(seats === undefined ? {} : { line: seats })}
          />
        );
      })}
    </CardGrid>
  );
}

/** Two cards, the fewest a person reaching the chooser holds, each its title's bar over its line's. */
function ChoicesPlaceholder() {
  return (
    <Waiting>
      <CardGrid across={3}>
        <CardPlaceholder line />
        <CardPlaceholder line />
      </CardGrid>
    </Waiting>
  );
}

/**
 * `/area/roles`, the chooser `/area` sends a person holding several Funktionen to: their places as cards, read with the
 * page while the strip stands titled.
 */
export default function RolesPage() {
  return (
    <RailPage
      scope="area"
      title={{ route: "areaRoles" }}>
      <PageWait fallback={<ChoicesPlaceholder />}>
        <Choices />
      </PageWait>
    </RailPage>
  );
}
