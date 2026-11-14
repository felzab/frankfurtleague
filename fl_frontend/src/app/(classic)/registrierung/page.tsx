import { cache } from "react";

import { ConsentLine } from "@/kit/ConsentLine";
import { mailedMetadata } from "@/kit/mailedLinkState";
import { MailedPage } from "@/kit/MailedPage";

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

import { endOf, readInvitation, REPLAY_FIELD, TO_HOME } from "./invitation";
import { RegistrierungFields } from "./RegistrierungFields";
import { submitRegistrierung } from "./submitRegistrierung";

import type { ConsentLine as Line } from "@/core/consentWordings";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata, ResolvingMetadata } from "next";
import type { RegistrierungRules } from "./RegistrierungFields";

/** A row no crawler fetches, titled by the link's state. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return mailedMetadata(parent, ROUTES.registrierung, readState());
}

const WORDS = SERVER_COPY.registrierung;

const SUBMIT = COPY.shared.withObject(COPY.page.registrierung, "submit");

const INVALID: MailedState = { state: "invalid", next: TO_HOME };

/** The notice's id, which describes the send: the page holds one form. */
const NOTICE_ID = "registrierung-notice";

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

/** The two lines of the form: the Art. 21 objection around the league's address, and the sentence beside the send. */
const LINES: { objection: Line; notice: Line } = {
  objection: [WORDS.objection.before, { href: KONTAKT_MAILTO, label: KONTAKT_EMAIL }, WORDS.objection.after],
  notice: [
    COPY.registrierung.notice.before,
    { href: ROUTES.privacyNotice.path(), label: COPY.page.privacyNotice },
    COPY.registrierung.notice.after,
  ],
};

/**
 * `/registrierung`, the page a team's registration link opens, which the proxy hands its token in this page's cookie
 * (`MAILED_LINK_PAGES`), since the form loads Turnstile: the form, in one box, sent once through the one-shot submit, its
 * outcome replacing it. Where no form stands, the page is its status card: the
 * window shut or the season over, the club out of the season, the squad full, and the link no longer valid. The link is
 * the team's, opened by every pupil, so it has no state of having been answered.
 */
export default function RegistrierungPage() {
  return <MailedPage page={readState()} />;
}

// `cache` memoizes per render pass, for the tab's title and the page. Never `"use cache"`, which keys on the
// arguments rather than the caller.
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
    // The sentence the send rests on, beside it in the footer, and read with the send's name.
    note: (
      <ConsentLine
        id={NOTICE_ID}
        line={LINES.notice}
      />
    ),
    describedBy: NOTICE_ID,
    children: (
      <RegistrierungFields
        rules={RULES}
        stufen={orderStufen(view.allowed_stufen)}
        objection={LINES.objection}
      />
    ),
  };
});
