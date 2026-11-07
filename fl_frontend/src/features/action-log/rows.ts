import { COPY } from "@/core/copy";
import { ERASED_ACTOR_MARKER } from "@/core/erasedActor";
import { formatInstantShort } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";

import { actorWords } from "./filters";

import type { Words } from "@/core/copy";
import type { FLAction, FLActionLogEntry } from "@/core/generated/client/types";
import type { TableRow } from "@/kit/Table";

const WORDS = COPY.admin.actionLog;

const isPass = (action: FLAction): action is keyof typeof WORDS.passNoun => Object.hasOwn(WORDS.passNoun, action);

/** What the act was about: a pass's count of what it took, or the stored label, whose address an erasure may have replaced. */
function aboutOf({ action, label, count }: FLActionLogEntry): Words | null {
  if (isPass(action) && count !== null) return WORDS.passCount(WORDS.passNoun[action], count);
  if (label === null) return null;
  return label === ERASED_ACTOR_MARKER ? COPY.admin.erasedActor : { record: label };
}

/** A contact person is named by role and team, and never by name. */
const whoOf = ({ by, team }: FLActionLogEntry): Words =>
  by === "kontakt" && team !== null ? WORDS.actor.contact({ record: team }) : actorWords(by);

/** One recorded act: what, about what, who and when. */
export function rowOf(entry: FLActionLogEntry): TableRow {
  const word = WORDS.action[entry.action];
  const about = aboutOf(entry);
  return {
    id: entry.id,
    name: about === null ? word : SERVER_COPY.season.labelled(word, about),
    cells: { who: whoOf(entry), when: { record: formatInstantShort(entry.at) } },
  };
}
