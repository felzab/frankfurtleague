import { cache } from "react";

import { ConsentLine } from "@/kit/ConsentLine";

import { frontend_config } from "@/core/config";
import { COPY } from "@/core/copy";
import { orMissing } from "@/core/errors";
import { bewerbungenGetForm } from "@/core/generated/client/sdk";
import { ROUTES } from "@/core/routes";
import { runWithIncomingTrace } from "@/core/traceScope";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";

import { REPLAY_FIELD } from "./application";
import { BewerbungFields } from "./BewerbungFields";
import { BEWERBUNG_RULES } from "./bewerbungRules";
import { endOf } from "./ends";
import { submitBewerbung } from "./submitBewerbung";

import type { FLBewerbungFormResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";

const SUBMIT = COPY.shared.withObject(COPY.bewerbung.object, "submit");

/** The notice's id, which describes the send: the page holds one form. */
const NOTICE_ID = "bewerbung-notice";

/**
 * A season's form read, `null` for an id naming no season. `cache`, never `"use cache"`: the metadata and the body read
 * it once between them, and a stored copy would go on saying a window runs after it shut. A failed read reaches the
 * frame's error card.
 */
export const readForm = cache(async (saison: string): Promise<FLBewerbungFormResponse | null> => {
  if (saison.length !== SAISON_ID_LENGTH) return null;
  return runWithIncomingTrace(() => orMissing(bewerbungenGetForm(saison)));
});

/** What a season's form page shows: the form while its window runs, else the card standing in its place. */
export function formStateOf(saison: string, form: FLBewerbungFormResponse): MailedState {
  const end = endOf(form.window);
  if (end !== null) return { state: "end", ...end };

  return {
    state: "question",
    title: COPY.page.bewerbung(saison),
    action: submitBewerbung,
    acts: { primary: SUBMIT },
    carry: { saison_id: saison },
    replayField: REPLAY_FIELD,
    // Off the request's settings, past the form's read that hands `form` in: a prerendered shell would carry the
    // build's, which is none.
    botCheck: { siteKey: frontend_config.TURNSTILE_SITE_KEY },
    boxes: true,
    // The sentence the send rests on, beside it in the footer, and read with the send's name.
    note: (
      <ConsentLine
        id={NOTICE_ID}
        line={[
          COPY.bewerbung.notice.before,
          { href: ROUTES.privacyNotice.path(), label: COPY.page.privacyNotice },
          COPY.bewerbung.notice.after,
        ]}
      />
    ),
    describedBy: NOTICE_ID,
    children: (
      <BewerbungFields
        schulen={form.schulen}
        taken={form.taken}
        rules={BEWERBUNG_RULES}
      />
    ),
  };
}
