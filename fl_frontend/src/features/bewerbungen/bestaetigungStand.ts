import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import type { KontaktRolle } from "@/features/teams/constants";
import type { FLBewerbung } from "./schemas";

/** Narrowed to the two blocks a confirmation moves, so a caller holding a queue row rather than a whole application still reads its seats. */
type BewerbungSitze = Pick<FLBewerbung, "bestaetigungen" | "kontakte">;

/** What one seat's confirmation has reached. A seat that has answered carries the day it answered on. */
type Stand =
  | { art: "bestaetigt"; am: string }
  | { art: "abgelehnt"; am: string }
  // No day: an erasure takes the seat's block with the person it belonged to, and the day it
  // happened on is stored nowhere the application can be read from.
  | { art: "geloescht" }
  | { art: "ausstehend"; verschicktAm: string; erinnertAm: string | null };

export type SitzBestaetigung = {
  rolle: KontaktRolle;
  label: string;
  /** Null where a decline or an erasure emptied the slot; an erasure clears the seat's block beside it. */
  name: string | null;
  /** The person in the seat, or how it came to be empty — the two ways differ in what the league did. */
  nameSatz: string;
  zugleichTrainer: boolean;
  stand: Stand;
  /** Rendered here rather than by each surface: the strip and the fact panel say one thing about one seat. */
  satz: string;
};

/**
 * `null` where the application predates the workflow. An absent block is what keeps such an
 * application acceptable, so it answers "no such state" rather than three outstanding seats, which
 * would close the Zusage on every queued application.
 */
export function bestaetigungsStand(bewerbung: BewerbungSitze): SitzBestaetigung[] | null {
  const { bestaetigungen, kontakte } = bewerbung;

  if (bestaetigungen === null) return null;

  // `KONTAKT_ROLLEN` and never a list of this file's own: the seat order is the label table's
  // (`.claude/rules/frontend.md` **admin**).
  return KONTAKT_ROLLEN.map(({ value, label }) => {
    const person = kontakte[value];
    const verlauf = bestaetigungen[value];
    const bestaetigtAm = person?.einwilligung.bestaetigt_am ?? null;
    const abgelehntAm = verlauf?.abgelehnt_am ?? null;

    // The stamp on the record wins over the block: a seat confirms once, and the block goes on
    // carrying the day its link went out.
    const stand: Stand =
      bestaetigtAm !== null
        ? { art: "bestaetigt", am: bestaetigtAm }
        : abgelehntAm !== null
          ? { art: "abgelehnt", am: abgelehntAm }
          : // Either half missing is terminal, and `ausstehend` is left holding only the seats a link
            // can still reach: the endpoint refuses to mint against a null entry, and a null slot
            // names nobody who could answer one.
            person === null || verlauf === null
            ? { art: "geloescht" }
            : { art: "ausstehend", verschicktAm: verlauf.verschickt_am, erinnertAm: verlauf.erinnert_am };

    const name = person === null ? null : `${person.vorname} ${person.nachname}`;

    return {
      rolle: value,
      label: label,
      name: name,
      nameSatz: name ?? leerSatz(stand),
      zugleichTrainer: kontakte.trainer_ist_zugleich === value,
      stand: stand,
      satz: standSatz(stand),
    };
  });
}

/** A seat the acceptance is still waiting on. A decline blocks it too: the emptied slot carries no confirmation. */
export function istOffen({ stand }: SitzBestaetigung): boolean {
  return stand.art !== "bestaetigt";
}

/** A seat nothing can still move: nobody stands in it, and no answer puts anybody back. */
function istEndgueltig({ stand }: SitzBestaetigung): boolean {
  return stand.art === "abgelehnt" || stand.art === "geloescht";
}

/**
 * A decline leads a deletion where a row carries both: it is the state an administrator resolves,
 * an erasure being one the league made and cannot take back.
 */
export function endstand(staende: readonly SitzBestaetigung[]): string | null {
  if (staende.some((sitz) => sitz.stand.art === "abgelehnt")) return "Widerspruch";

  return staende.some((sitz) => sitz.stand.art === "geloescht") ? "Eintrag gelöscht" : null;
}

/**
 * What stands where a name would. The two ways a seat empties read differently because the league
 * did different things: a person declined their own entry, or asked to be forgotten
 * (`fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktErasure.tsx`).
 */
function leerSatz(stand: Stand): string {
  return stand.art === "geloescht" ? "Auf eigenen Wunsch gelöscht" : "Niemand mehr in der Bewerbung";
}

/** One seat's state as a sentence. A reminded seat names the reminder: that is the day the person last heard from the league. */
function standSatz(stand: Stand): string {
  if (stand.art === "bestaetigt") return `Bestätigt am ${formatSpielDatum(stand.am)}`;
  // The queue's badge word in its participle: „Abgelehnt“ is the APPLICATION's own status, and one
  // root for a seat's refusal and the league's decision puts two facts about one row under one word.
  if (stand.art === "abgelehnt") return `Widersprochen am ${formatSpielDatum(stand.am)}`;
  if (stand.art === "geloescht") return "Keine Bestätigung mehr möglich";

  if (stand.erinnertAm !== null) return `Ausstehend, erinnert am ${formatSpielDatum(stand.erinnertAm)}`;

  return `Ausstehend, Link gesendet am ${formatSpielDatum(stand.verschicktAm)}`;
}

/**
 * The seats a re-send is offered on. One person holding two of them gets ONE control: a single
 * answer covers both (`fl_backend/app/api/bewerbungen/einwilligung_router.py`), so a second control
 * would put a second message in one mailbox over one decision.
 */
export function linkAngebot(staende: readonly SitzBestaetigung[]): ReadonlySet<KontaktRolle> {
  const wartend = staende.filter((sitz) => sitz.stand.art === "ausstehend");
  // Only where the Trainer's own row carries a control: a claimed pair whose Trainer seat has been
  // answered or emptied would otherwise be left with no way to send a link at all.
  const gepaart = wartend.some((sitz) => sitz.rolle === "trainer");

  return new Set(wartend.filter((sitz) => !(gepaart && sitz.zugleichTrainer)).map((sitz) => sitz.rolle));
}

/**
 * Every seat one re-sent link answers for, in the label table's order. Mirrors
 * `fl_backend/app/api/bewerbungen/services.py :: paired_seat`, whose `seat_stands` half is why a
 * seat missing either of its two blocks drops out of the pair.
 */
export function gepaarteSitze(bewerbung: BewerbungSitze, rolle: KontaktRolle): KontaktRolle[] {
  const { bestaetigungen, kontakte } = bewerbung;
  const zugleich = kontakte.trainer_ist_zugleich;

  const andere = zugleich === null ? null : rolle === "trainer" ? zugleich : rolle === zugleich ? "trainer" : null;

  if (bestaetigungen === null || andere === null || kontakte[andere] === null || bestaetigungen[andere] === null) return [rolle];

  return KONTAKT_ROLLEN.map(({ value }) => value).filter((value) => value === rolle || value === andere);
}

/**
 * In `annehmen_bewerbung`'s own order, `REQ-BEWERBUNG-002` before `REQ-BEWERBUNG-013`: the reason
 * under the closed control is the one the write would answer with. Three sentences, because a seat
 * merely unanswered is waited out where the other two leave only the Absage.
 */
export function zusageHindernis(staende: readonly SitzBestaetigung[] | null, teamName: string | null): string | null {
  if (teamName === null) {
    return "Ohne eine neue Schule und ohne ein bestehendes Team steht nicht fest, wer aufgenommen würde. Bleibt nur die Absage.";
  }

  // `null` where the application predates the workflow, which is what keeps it acceptable.
  const offen = staende === null ? [] : staende.filter(istOffen);

  if (offen.length === 0) return null;

  // The cause in the words the seat's own row uses, then the one decision left: „löschen lassen“
  // rather than „gelöscht“, because the erasure is the league's act on the person's request.
  if (offen.some(istEndgueltig)) {
    return "Eine Kontaktperson hat widersprochen oder ihren Eintrag löschen lassen. Diese Bewerbung kann nur noch abgelehnt werden.";
  }

  // The rule rather than who is outstanding today: the strip above names every seat and its state,
  // so a second list here is the same fact from the other side (my wording, 2026-09-04).
  return "Eine Zusage ist ohne alle Einwilligungen nicht möglich.";
}
