import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import { COPY } from "./copy";
import { mailOrigin, OBJECTION } from "./emailShell";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";
import type { FLBanData } from "./generated/client/types";
import type { MailOrigin } from "./mailKinds";

const WORDS = SERVER_COPY.mail.ban;

export function buildBanEmail({ ban_reason, barred_until_saison_id }: FLBanData, { origin }: MailOrigin): Mail {
  return {
    kind: "notice",
    subjectLine: WORDS.subject,
    origin: mailOrigin(origin),
    paragraphs: [[WORDS.lead, WORDS.effect, WORDS.ends(barred_until_saison_id)]],
    block: { title: COPY.admin.banList.object, facts: [{ label: COPY.admin.spiel.reason, value: ban_reason }] },
    afterBlock: [
      // Art. 13: what is kept and on what basis, named because this mail is the only record its reader ever gets.
      [WORDS.stored, WORDS.account, WORDS.basis],
      [[WORDS.rights.before, { address: KONTAKT_EMAIL }, WORDS.rights.after]],
      // Art. 21 (4) asks that the right to object be brought to the reader's attention explicitly and separately at
      // the first communication, which this message is: its own paragraph, the last.
      [OBJECTION],
    ],
  };
}
