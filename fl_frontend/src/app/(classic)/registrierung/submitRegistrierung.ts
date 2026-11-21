"use server";

import { redirect } from "next/navigation";

import { z } from "zod";

import { action, blankIsNull } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { refusedAs } from "@/core/errors";
import { registrierungenPostRegistrierung } from "@/core/generated/client/sdk";
import { RegistrierungenPostRegistrierungBody } from "@/core/generated/zod/inputs";
import { IDEMPOTENCY_KEY_FIELD, IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { forgetMailedLink } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";

import { LINK_INVALID } from "../confirm/ends";
import { endOf, readInvitation } from "./invitation";

import type { Code } from "@/core/generated/client/types";

const { shape } = RegistrierungenPostRegistrierungBody;
const { exampleDigits, exampleFirstName, exampleLastName } = COPY.shared.field;

/** What the form posts, each box held to the write's own rule for it: an optional box left empty is no answer. */
const Registration = z.object({
  token: shape.token,
  first_name: shape.first_name,
  last_name: shape.last_name,
  email: shape.email,
  nummer: blankIsNull(shape.nummer),
  position: blankIsNull(shape.position),
  stufe: blankIsNull(shape.stufe),
  [IDEMPOTENCY_KEY_FIELD]: z.uuid(),
});

/**
 * The refusals saying what the link opens has moved since the page was read: revoked or its club departed, the
 * season's or the club's record gone, the window shut, the club out of the season, the squad full, the Stufen narrowed.
 */
const MOVED: ReadonlySet<Code> = new Set<Code>([
  "link_invalid",
  "document_not_found",
  "registrierung_closed",
  "kader_full",
  "registrierung_stufe_not_allowed",
]);

const moved = (error: unknown) => refusedAs(error, MOVED);

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
  boxes: ["email"],
  examples: { first_name: exampleFirstName, last_name: exampleLastName, nummer: exampleDigits },
  run: async ({ [IDEMPOTENCY_KEY_FIELD]: key, ...registration }) => {
    try {
      await registrierungenPostRegistrierung(registration, { headers: { [IDEMPOTENCY_KEY_HEADER]: key } });
    } catch (error) {
      if (!moved(error)) throw error;
      const view = await readInvitation(registration.token);
      const end = view === null ? LINK_INVALID : endOf(view);
      return end === null ? { ok: false, reason: COPY.shared.failure.stale } : { ok: true, value: end };
    }
    await forgetMailedLink(ROUTES.registrierung.path());
    redirect(ROUTES.registrierungDone.path());
  },
});
