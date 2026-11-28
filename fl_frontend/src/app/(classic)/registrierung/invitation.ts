import "server-only";

import { refusedAs } from "@/core/errors";
import { registrierungenPostInvitationView } from "@/core/generated/client/sdk";
import { SERVER_COPY } from "@/core/serverCopy";
import { TO_HOME } from "@/kit/mailedLinkState";

import type { Code, FLInvitationViewResponse } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.registrierung.end;

/**
 * A token no live invite holds or whose club left the season, one whose season or club record is gone, and one the
 * backend will not parse: a dead link each way.
 */
const DEAD: ReadonlySet<Code> = new Set<Code>(["link_invalid", "document_not_found", "payload_refused"]);

/**
 * What the team's link opens, or `null` for a link that opens no live invite, a club that left the season or a token the
 * backend will not parse, a dead link either way. Any other failure reaches the frame's error card, which logs it.
 */
export async function readInvitation(token: string): Promise<FLInvitationViewResponse | null> {
  return registrierungenPostInvitationView({ token }).catch((error: unknown) => {
    if (refusedAs(error, DEAD)) return null;
    throw error;
  });
}

/**
 * The card standing in the form's place, or `null` where the link opens the form: the view's verdicts in the order a
 * reader can act on them. A shut window outranks the rest, an ended season saying so; a club the season does not hold is
 * the team's to repair; a full squad takes a pupil again once a place falls free.
 */
export function endOf(view: FLInvitationViewResponse): EndState | null {
  if (!view.running) {
    return view.saison_status === "past"
      ? { tone: "warn", title: SERVER_COPY.bewerbung.end.over, next: TO_HOME }
      : { tone: "info", title: WORDS.closed, next: TO_HOME };
  }
  if (!view.team_entered) return { tone: "info", title: WORDS.teamNotEntered, next: TO_HOME };
  if (!view.kader_free) return { tone: "info", title: WORDS.kaderFull, next: TO_HOME };
  return null;
}
