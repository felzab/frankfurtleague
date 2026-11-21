import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";

import { standardSaison } from "../../ownSaison";
import { SchiedsrichterOverview } from "./SchiedsrichterOverview";

export const metadata = pageMetadata(ROUTES.areaSchiedsrichter);

/** `/area/schiedsrichter`: the address the account menu and the sign-in lead to, drawing the standard season's Übersicht in place. */
export default function SchiedsrichterPage() {
  return <SchiedsrichterOverview saison={standardSaison("schiedsrichter")} />;
}
