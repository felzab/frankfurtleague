import { redirect } from "next/navigation";

import { ROUTES } from "@/core/routes";
import { requireSubjectSession } from "@/features/roles/resolvers";
import { owesSignInStep, placeOf, placesOf } from "@/features/roles/utils";
import { CardLink } from "@/kit/Card";
import { CardGrid } from "@/kit/CardGrid";
import { ListPage } from "@/kit/ListPage";
import { pageMetadata } from "@/shared/utils/metadata";

export const metadata = pageMetadata(ROUTES.areaRoles);

/**
 * Every place the person holds, each a card linking it: a team by its name over the seats held on it in any season,
 * the rest by their area.
 */
async function readChoices() {
  const subject = await requireSubjectSession(ROUTES.areaRoles.path());
  if (owesSignInStep(subject)) redirect(ROUTES.signInLanding.path());
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

/**
 * `/area/roles`, the chooser `/area` sends a person holding several Funktionen to: their places as cards, read with the
 * page while the strip stands titled.
 */
export default function RolesPage() {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "areaRoles" } }}
      list={{ kind: "drawn", content: readChoices() }}
    />
  );
}
