"use server";

import { redirect } from "next/navigation";

import { z } from "zod";

import { action, blankIsNull } from "@/core/action";
import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { registrierungenPostRegistrierung } from "@/core/generated/client/sdk";
import { RegistrierungenPostRegistrierungBody } from "@/core/generated/zod/inputs";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { forgetMailedLink, mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";

import { endOf, LINK_INVALID, readInvitation, REPLAY_FIELD } from "./invitation";

import type { Code } from "@/core/generated/client/types";

const { shape } = RegistrierungenPostRegistrierungBody;
const { exampleDigits, exampleFirstName, exampleLastName } = COPY.shared.field;

/**
 * What the form posts, each box held to the write's own rule for it: an optional box left empty is no answer. The link's
 * token is no box: it stands in the page's cookie, where the proxy moved it out of the address, so the page's markup
 * never carries it.
 */
const Registration = z.object({
  first_name: shape.first_name,
  last_name: shape.last_name,
  email: shape.email,
  nummer: blankIsNull(shape.nummer),
  position: blankIsNull(shape.position),
  stufe: blankIsNull(shape.stufe),
  [REPLAY_FIELD]: z.uuid(),
});

/**
 * The refusals saying what the link opens has moved since the page was read: revoked or its club gone, the window shut,
 * the club out of the season, the squad full, the Stufen narrowed.
 */
const MOVED: ReadonlySet<Code> = new Set<Code>([
  "document_not_found",
  "registrierung_closed",
  "registrierung_kader_full",
  "registrierung_stufe_not_allowed",
]);

const moved = (error: unknown) => error instanceof APIBadStatusError && error.serverErrorCode !== undefined && MOVED.has(error.serverErrorCode);

/**
 * One pupil's registration through their team's link, sent with no session. The link is a team's, handed round a class,
 * so the bot check answers before anything is read: this write mails the address its sender types.
 *
 * Done, the page forgets the link, as the privacy notice says of a mailed link once it is used, and leads on to the
 * registration's done page, as a deletion leads on to its own: the form's page, rendered again on the forgotten link,
 * would title the tab and a reload as a link no longer valid. A refusal saying the link has moved ends on the card
 * the page opened again would show, read again here, since one code covers both a shut window and a club out of the
 * season; one whose link still opens the form, a Stufe the season stopped offering, says the page is stale.
 */
export const submitRegistrierung = action({
  lane: "public",
  botCheck: true,
  name: "submitRegistrierung",
  input: Registration,
  ownWords: ["email_not_accepted"],
  paths: { email: "email" },
  examples: { first_name: exampleFirstName, last_name: exampleLastName, nummer: exampleDigits },
  run: async ({ [REPLAY_FIELD]: key, ...boxes }) => {
    const token = await mailedLinkToken();
    // No cookie, forgotten by a registration sent from another tab or never set, is the link the page calls invalid.
    if (token === null) return { ok: true, value: LINK_INVALID };
    try {
      await registrierungenPostRegistrierung({ token, ...boxes }, { headers: { [IDEMPOTENCY_KEY_HEADER]: key } });
    } catch (error) {
      if (!moved(error)) throw error;
      const view = await readInvitation(token);
      const end = view === null ? LINK_INVALID : endOf(view);
      return end === null ? { ok: false, reason: COPY.shared.failure.stale } : { ok: true, value: end };
    }
    await forgetMailedLink(ROUTES.registrierung.path());
    redirect(ROUTES.registrierungDone.path());
  },
});
