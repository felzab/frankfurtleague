import { redirect } from "next/navigation";

import { RoleChoices } from "@/kit/CardGrid";
import { RailPage } from "@/kit/RailFrame";

import { ROUTES } from "@/core/routes";
import { requireSubjectSession } from "@/features/roles/resolvers";
import { owesSignInStep, placeOf, placesOf } from "@/features/roles/utils";
import { pageMetadata } from "@/shared/utils/metadata";

import type { CardLinkProps } from "@/kit/Card";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.areaRoles, ROUTES.areaRoles.path());
}

/** Every place the person holds, each a card's link: a team by its name over its season and seats, the rest by their area. */
async function readChoices(): Promise<ReadonlyArray<CardLinkProps>> {
  const subject = await requireSubjectSession(ROUTES.areaRoles.path());
  if (owesSignInStep(subject)) redirect(ROUTES.signInLanding.path());
  return placesOf(subject).map((target) => {
    const { href, name, seats } = placeOf(target);
    return { href, title: name, ...(seats === undefined ? {} : { line: seats }) };
  });
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
