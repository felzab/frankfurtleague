import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { ERASED_ACTOR_MARKER } from "@/core/erasedActor";
import { formatInstantShort } from "@/core/format";
import { FLActorRole } from "@/core/generated/client/types";
import { ownKeyOf } from "@/core/ownKeyOf";
import { SERVER_COPY } from "@/core/serverCopy";

import { actorWords } from "./filters";

import type { Words } from "@/core/copy";
import type { FLAction, FLActionLogEntry } from "@/core/generated/client/types";
import type { TableRow } from "@/kit/Table";

const WORDS = ADMIN_COPY.actionLog;

const isPass = (action: FLAction) => ownKeyOf(WORDS.passNoun, action);

/**
 * What the act was about: a pass's count of what it took, an admission's of the other pending registrations it deleted
 * where it deleted any, the season and the fixture by the names every other screen gives them, or the stored label,
 * whose address an erasure may have replaced.
 */
function aboutOf({ action, saison_id, spiel_nr, label, count }: FLActionLogEntry): Words | null {
  if (isPass(action) && count !== null) return WORDS.passCount(WORDS.passNoun[action], count);
  if (action === "registrierung.admitted" && count !== null && count > 0) return WORDS.admittedOthers(count);
  if (saison_id !== null) {
    const saison = COPY.shared.saisonName(saison_id);
    // A fixture's number repeats each season, so the row keeps the season beside it.
    return spiel_nr === null ? saison : SERVER_COPY.season.labelled(saison, ADMIN_COPY.spiel.number(spiel_nr));
  }
  if (label === null) return null;
  return label === ERASED_ACTOR_MARKER ? ADMIN_COPY.erasedActor : { record: label };
}

/** A contact person is named by role and team, and never by name. A fixture's answer may stand with no team. */
function whoOf({ by, team }: FLActionLogEntry): Words {
  if (by !== FLActorRole.kontakt) return actorWords(by);
  return team === null ? WORDS.actor.contactNoTeam : WORDS.actor.contact({ record: team });
}

export function rowOf(entry: FLActionLogEntry): TableRow {
  const word = WORDS.action[entry.action];
  const about = aboutOf(entry);
  return {
    id: entry.id,
    name: about === null ? word : SERVER_COPY.season.labelled(word, about),
    cells: { who: whoOf(entry), when: { record: formatInstantShort(entry.at) } },
  };
}
