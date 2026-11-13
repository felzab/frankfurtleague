import { connection } from "next/server";

import { MailedPage } from "@/kit/MailedPage";

import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { readLanding } from "../landing";
import { TO_HOME } from "./[saison]/ends";
import { formStateOf, readForm } from "./[saison]/form";

import type { FLLandingResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";

const WORDS = SERVER_COPY.bewerbung.end;

/**
 * The landing's read, on a request, which names the season whose window runs today and the day the next one opens: the
 * build reaches no backend.
 */
async function readOnRequest(): Promise<FLLandingResponse> {
  await connection();
  return readLanding();
}

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.bewerbungRoot;
  // The seasoned address's title while a season's form stands here, the footer's word while none does.
  return metadataFor(readOnRequest(), ({ bewerbung_window: window }) =>
    pageMetadata(parent, row, row.path(), { title: window === null ? COPY.template.bewerbung : row.title(window.saison_id) }),
  );
}

async function readState(): Promise<MailedState> {
  const { bewerbung_window: window, bewerbung_opens_on: opensOn } = await readOnRequest();
  // The season's own read judges its window, so a window the cached landing still names as running reads as it stands.
  const form = window === null ? null : await readForm(window.saison_id);
  if (window !== null && form !== null) return formStateOf(window.saison_id, form);
  // An upcoming window's card and a closed one's, in the words the season's address and the landing's band use.
  return { state: "end", tone: "info", title: opensOn === null ? WORDS.closed : WORDS.opensOn(dayOf(opensOn)), next: TO_HOME };
}

/**
 * `/bewerbung`, the application's address naming no season, which the footer links to: the form of the season whose
 * window runs today, drawn in place as `/bewerbung/<saison>` draws it, and the closed card while none runs.
 */
export default function BewerbungRootPage() {
  return <MailedPage page={readState()} />;
}
