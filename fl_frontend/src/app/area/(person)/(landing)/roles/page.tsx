import { redirect } from "next/navigation";

import { ROUTES } from "@/core/routes";
import { requireSubjectSession } from "@/features/roles/resolvers";
import { owesSignInStep, placeOf, placesOf } from "@/features/roles/utils";
import { CardLink } from "@/kit/Card";
import { CardGrid } from "@/kit/CardGrid";
import { RailPage } from "@/kit/RailFrame";
import { pageMetadata } from "@/shared/utils/metadata";

import type { CardLinkProps } from "@/kit/Card";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.areaRoles, ROUTES.areaRoles.path());
}

/**
 * Every place the person holds, each a card's link: a team by its name over the seats held on it in any season, the
 * rest by their area.
 */
async function readChoices(): Promise<ReadonlyArray<CardLinkProps>> {
  const subject = await requireSubjectSession(ROUTES.areaRoles.path());
  if (owesSignInStep(subject)) redirect(ROUTES.signInLanding.path());
  return placesOf(subject).map((target) => {
    const { href, name, seats } = placeOf(target);
    return { href, title: name, ...(seats === undefined ? {} : { line: seats }) };
  });
}

/** The role chooser's places, each a card linking it, the page arriving whole with them. */
async function RoleChoices({ choices }: { choices: Promise<ReadonlyArray<CardLinkProps>> }) {
  return (
    <CardGrid across={3}>
      {(await choices).map((choice) => (
        <CardLink
          key={choice.href}
          {...choice}
        />
      ))}
    </CardGrid>
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
      <RoleChoices choices={readChoices()} />
    </RailPage>
  );
}
