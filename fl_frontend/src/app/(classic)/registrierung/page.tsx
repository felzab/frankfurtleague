import { cache } from "react";

import { MAILED_PAGE_METADATA, MailedPage, mailedTitle } from "@/kit/MailedPage";

import { requires } from "@/core/action";
import { KONTAKT_EMAIL, KONTAKT_MAILTO } from "@/core/brand";
import { frontend_config } from "@/core/config";
import { COPY } from "@/core/copy";
import {
  RegistrierungenPostRegistrierungBody,
  registrierungenPostRegistrierungBodyEmailMax,
  registrierungenPostRegistrierungBodyFirstNameMax,
  registrierungenPostRegistrierungBodyLastNameMax,
} from "@/core/generated/zod/inputs";
import { mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { orderStufen } from "@/features/spieler/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import { endOf, readInvitation, REPLAY_FIELD, TO_HOME } from "./invitation";
import { RegistrierungFields } from "./RegistrierungFields";
import { submitRegistrierung } from "./submitRegistrierung";

import type { ConsentLine } from "@/core/consentWordings";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";
import type { RegistrierungRules } from "./RegistrierungFields";

/** A row no crawler fetches, under the mailed pages' referrer. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.registrierung;
  const title = mailedTitle(await readState());
  return { ...(await pageMetadata(parent, row, row.path(), { title })), ...MAILED_PAGE_METADATA };
}

const WORDS = SERVER_COPY.registrierung;

const SUBMIT = COPY.shared.withObject(COPY.page.registrierung, "submit");

const INVALID: MailedState = { state: "invalid", next: TO_HOME };

const { shape } = RegistrierungenPostRegistrierungBody;

/**
 * What the write asks of the typed boxes, an untouched one posting "". The address is required as written: its published
 * rule holds its length alone, and the write refuses an empty one.
 */
const RULES: RegistrierungRules = {
  required: { firstName: requires(shape.first_name, ""), lastName: requires(shape.last_name, ""), email: true },
  maxLength: {
    firstName: registrierungenPostRegistrierungBodyFirstNameMax,
    lastName: registrierungenPostRegistrierungBodyLastNameMax,
    email: registrierungenPostRegistrierungBodyEmailMax,
  },
};

/** The Art. 21 objection around the league's address, read before anything is typed. */
const OBJECTION: ConsentLine = [WORDS.objection.before, { href: KONTAKT_MAILTO, label: KONTAKT_EMAIL }, WORDS.objection.after];

/**
 * `/registrierung`, the page a team's registration link opens, which the proxy hands its token in this page's cookie
 * (`fl_frontend/src/core/mailedLink.ts :: MAILED_LINK_PAGES`), since the form loads Turnstile: the form, in one box, sent
 * once through the one-shot submit, its outcome replacing it. Where no form stands, the page is its status card: the
 * window shut or the season over, the club out of the season, the squad full, and the link no longer valid. The link is
 * the team's, opened by every pupil, so it has no state of having been answered.
 */
export default function RegistrierungPage() {
  return (
    <MailedPage
      page={readState()}
      facts={3}
      act={SUBMIT}
    />
  );
}

// `cache` memoizes per RENDER PASS, for the tab's title and the page, never `"use cache"`: the token is never a key.
const readState = cache(async (): Promise<MailedState> => {
  const token = await mailedLinkToken();
  if (token === null) return INVALID;

  const view = await runWithIncomingTrace(() => readInvitation(token));
  if (view === null) return INVALID;

  const end = endOf(view);
  if (end !== null) return { state: "end", ...end };

  return {
    state: "question",
    title: COPY.page.registrierung,
    facts: [
      { label: COPY.shared.facts.team, value: { record: view.team } },
      { label: COPY.shared.facts.school, value: { record: view.schule } },
      { label: COPY.shared.saison, value: COPY.shared.saisonName(view.saison_id) },
    ],
    // Said before anything is typed: the season has begun, so the entry stands outside the squad's cap.
    ...(view.nachnominierung ? { sentence: WORDS.nominee } : {}),
    action: submitRegistrierung,
    acts: { primary: SUBMIT },
    carry: { token },
    replayField: REPLAY_FIELD,
    // Off the request's settings, past the read above: a prerendered shell would carry the build's, which is none.
    botCheck: { siteKey: frontend_config.TURNSTILE_SITE_KEY },
    boxes: true,
    children: (
      <RegistrierungFields
        rules={RULES}
        stufen={orderStufen(view.allowed_stufen)}
        objection={OBJECTION}
      />
    ),
  };
});
