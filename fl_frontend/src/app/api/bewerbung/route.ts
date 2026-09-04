import { buildBewerbungBestaetigungEmail, buildBewerbungEingangOffenEmail } from "@/core/bewerbungEmail";
import { SITE_URL } from "@/core/brand";
import { BEWERBUNG_SEATS } from "@/features/bewerbungen/constants";
import { postBewerbung } from "@/features/bewerbungen/mutations";
import {
  collectBewerbungEingangEmpfaenger,
  seatsByMailbox,
  sendBewerbungLinkMail,
  sendBewerbungMail,
} from "@/features/bewerbungen/notifications";
import { getBewerbungSchulen } from "@/features/bewerbungen/queries";
import { FLPostBewerbungPayloadSchema } from "@/features/bewerbungen/schemas";
import { mapBewerbungSubmitRefusal } from "@/features/bewerbungen/utils";
import { VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { formatSpielDatum } from "@/shared/utils/format";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import type { BewerbungSeat } from "@/core/bewerbungEmail";
import type { NextRequest } from "next/server";

/** The record's own id stays off the page. */
const EINGEGANGEN = "Deine Bewerbung ist bei uns eingegangen.";

/**
 * The one place a link is spelled. The parameter is `token` because that is what
 * `nginx/prod.conf`'s `map $request_uri $credential_free_uri` strips from the access line and the
 * referer, and a second spelling would be a credential the edge does not redact.
 */
const bestaetigungsLink = (token: string): string => `${SITE_URL}/bestaetigung?token=${token}`;

/**
 * One school's application, submitted by a visitor with no session.
 *
 * A route handler and not a server action, for the reason `docs/frontend/spec.md` §1.3 gives.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postBewerbung",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);
      const parsed = FLPostBewerbungPayloadSchema.safeParse(body);

      if (!parsed.success) {
        return { success: false as const, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(parsed.error) };
      }

      let eingang;
      try {
        eingang = await postBewerbung(parsed.data);
      } catch (error) {
        // The refusal belongs under the field that caused it, not on the error page.
        const refusal = mapBewerbungSubmitRefusal(error);
        if (refusal) return { success: false as const, ...refusal };
        throw error;
      }

      if (!eingang.acknowledged) {
        return {
          success: false as const,
          error: buildRefusal({ reason: "Die Bewerbung wurde nicht gespeichert", repair: "Versuche es erneut" }),
        };
      }

      // No cache to move: no public read holds an application, and both triage reads are uncached
      // (`docs/frontend/spec.md :: I14` leaves the undo handlers the only route-handler invalidators).

      const { kontakte } = parsed.data;
      const fristText = formatSpielDatum(eingang.bestaetigungsfrist);
      const seats = eingang.bestaetigungen;

      // Read rather than taken from the payload, which names a picked club by id alone. Empty on a
      // failed read: a message naming no school still beats no message at all.
      const schule =
        parsed.data.schule?.team_name ??
        (await getBewerbungSchulen()
          .then(({ schulen }) => schulen.find((option) => option.id === parsed.data.team_id)?.name ?? "")
          .catch(() => ""));

      // Every seat but the submitter's, whose own link travels in the message below instead: one
      // mailbox sent both would be asked twice for the same press.
      const { ansprechperson: _eigener, ...andere } = seats;
      const verlinkt = seatsByMailbox(
        kontakte,
        Object.fromEntries(Object.entries(andere).map(([rolle, token]) => [rolle, bestaetigungsLink(token)])),
      );

      // After the write and never before it, and settled per address, so nobody's refusal costs the
      // others theirs. The raw token reaches these two calls and no log line.
      await sendBewerbungLinkMail({
        operation: "postBewerbung",
        recipients: verlinkt,
        buildMail: (seats) =>
          buildBewerbungBestaetigungEmail({
            saisonId: eingang.saison_id,
            schule: schule,
            seats: seats,
            fristText: fristText,
          }),
      });

      const ausstehend: BewerbungSeat[] = BEWERBUNG_SEATS.filter((seat) => seat.value !== "ansprechperson").map((seat) => ({
        vorname: kontakte[seat.value].vorname,
        rolleText: seat.label,
      }));

      await sendBewerbungMail({
        operation: "postBewerbung",
        // The Ansprechperson alone: this message names the other two seats, and the submitter is the
        // one person who can ask a colleague in the corridor.
        recipients: collectBewerbungEingangEmpfaenger(kontakte),
        buildMail: (rollenText) =>
          buildBewerbungEingangOffenEmail({
            saisonId: eingang.saison_id,
            rollenText: rollenText,
            ausstehend: ausstehend,
            fristText: fristText,
            link: bestaetigungsLink(seats.ansprechperson),
          }),
      });

      return { success: true as const, message: EINGEGANGEN };
    },
  });
}
