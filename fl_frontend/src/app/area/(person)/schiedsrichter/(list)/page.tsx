import { StatusPage } from "@/kit/StatusPage";

import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";

import { standardSaisonCard } from "../../ownSaison";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.areaSchiedsrichter, ROUTES.areaSchiedsrichter.path());
}

/** `/area/schiedsrichter`: the address the account menu and the sign-in lead to, which leads on to a season's Übersicht. */
export default function SchiedsrichterPage() {
  return (
    <StatusPage
      scope="area"
      title={{ route: "areaSchiedsrichter" }}
      card={standardSaisonCard("schiedsrichter")}
    />
  );
}
