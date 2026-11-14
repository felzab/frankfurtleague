import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";

import { standardSaison } from "../../ownSaison";
import { SchiedsrichterOverview } from "./[saison]/page";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.areaSchiedsrichter, ROUTES.areaSchiedsrichter.path());
}

/** `/area/schiedsrichter`: the address the account menu and the sign-in lead to, drawing the standard season's Übersicht in place. */
export default function SchiedsrichterPage() {
  return <SchiedsrichterOverview saison={standardSaison("schiedsrichter")} />;
}
