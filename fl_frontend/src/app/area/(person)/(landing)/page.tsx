import { StatusPage } from "@/kit/StatusPage";

import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";

import { readChoices } from "./readChoices";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.area, ROUTES.area.path());
}

/**
 * `/area`, where a signed-in person lands: on to the one place they hold, to Konto's list where they hold none, or
 * the places they hold as cards. A page that sends its reader on, as `/admin`'s entry is, so most people see its wait
 * alone, the redirect reaching the browser inside the stream.
 */
export default function AreaPage() {
  return (
    <StatusPage
      scope="area"
      title={{ route: "area" }}
      card={readChoices()}
    />
  );
}
