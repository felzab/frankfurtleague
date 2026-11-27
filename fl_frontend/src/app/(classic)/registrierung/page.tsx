import { cache } from "react";

import { requires } from "@/core/action";
import { KONTAKT_EMAIL, KONTAKT_MAILTO } from "@/core/brand";
import { frontend_config } from "@/core/config";
import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";
import {
  RegistrierungenPostRegistrierungBody,
  registrierungenPostRegistrierungBodyEmailMax,
  registrierungenPostRegistrierungBodyFirstNameMax,
  registrierungenPostRegistrierungBodyFirstNameRegExp,
  registrierungenPostRegistrierungBodyLastNameMax,
  registrierungenPostRegistrierungBodyLastNameRegExp,
  registrierungenPostRegistrierungBodyNummerOneMax,
} from "@/core/generated/zod/inputs";
import { mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runWithIncomingTrace } from "@/core/traceScope";
import { orderStufen } from "@/features/spieler/constants";
import { ConsentLine } from "@/kit/ConsentLine";
import { mailedMetadata } from "@/kit/mailedMetadata";
import { MailedPage } from "@/kit/MailedPage";

import { LINK_INVALID } from "../confirm/ends";
import { endOf, readInvitation } from "./invitation";
import { RegistrierungFields } from "./RegistrierungFields";
import { submitRegistrierung } from "./submitRegistrierung";

import type { ConsentLine as Line } from "@/core/consentWordings";
import type { MailedState } from "@/kit/MailedPage";
import type { Metadata } from "next";
import type { RegistrierungRules } from "./RegistrierungFields";

export async function generateMetadata(): Promise<Metadata> {
  return mailedMetadata(ROUTES.registrierung, readState());
}

const WORDS = SERVER_COPY.registrierung;

const SUBMIT = COPY.shared.withObject(COPY.page.registrierung, "submit");

const INVALID: MailedState = { state: "end", ...LINK_INVALID };

/** The notice's id, which describes the send: the page holds one form. */
const NOTICE_ID = "registrierung-notice";

const { shape } = RegistrierungenPostRegistrierungBody;

/**
 * What the write asks of the typed boxes, an untouched one posting "". The address is required as written: its published
 * rule holds its length alone, and the write refuses an empty one.
 */
const RULES: RegistrierungRules = {
  required: { firstName: requires(shape.first_name, ""), lastName: requires(shape.last_name, ""), email: true },
  max: {
    firstName: registrierungenPostRegistrierungBodyFirstNameMax,
    lastName: registrierungenPostRegistrierungBodyLastNameMax,
    email: registrierungenPostRegistrierungBodyEmailMax,
    nummer: registrierungenPostRegistrierungBodyNummerOneMax,
  },
  pattern: {
    firstName: registrierungenPostRegistrierungBodyFirstNameRegExp.source,
    lastName: registrierungenPostRegistrierungBodyLastNameRegExp.source,
  },
};

/** The two lines of the form: the Art. 21 objection around the league's address, and the sentence beside the send. */
const LINES: { objection: Line; notice: Line } = {
  objection: WORDS.objection({ href: KONTAKT_MAILTO, label: KONTAKT_EMAIL }),
  notice: PUBLIC_COPY.registrierung.notice({ href: ROUTES.privacyNotice.path(), label: COPY.page.privacyNotice }),
};

/**
 * `/registrierung`, the page a team's registration link opens, which the proxy hands its token in this page's cookie
 * (`MAILED_LINK_PAGES`): the form, in one box, sent once through the one-shot submit, its
 * outcome replacing it. Where no form stands, the page is its status card: the window shut or the season over, the club
 * out of the season, the squad full, and the link no longer valid. The link is the team's, opened by every pupil, so it
 * has no state of having been answered.
 */
export default function RegistrierungPage() {
  return <MailedPage page={readState()} />;
}

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
    run: submitRegistrierung,
    acts: { primary: SUBMIT },
    carry: { token },
    replays: true,
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
