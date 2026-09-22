import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import { istDauerhaftUnzustellbar } from "./zustellung";

import type { KontaktRolle } from "@/features/teams/constants";
import type { FLBewerbung, FLBewerbungZustellung } from "./schemas";

/** Narrowed to the two blocks a confirmation moves, so a caller holding a queue row rather than a whole application still reads its seats. */
type BewerbungSitze = Pick<FLBewerbung, "bestaetigungen" | "kontakte">;

/** What one seat's confirmation has reached. A seat that has answered carries the day it answered on. */
type Stand =
  | { art: "bestaetigt"; am: string }
  | { art: "abgelehnt"; am: string }
  // No day: an erasure takes the seat's block with the person it belonged to, and the day it
  // happened on is stored nowhere the application can be read from.
  | { art: "geloescht" }
  // Never answered, on an application already decided: its link opens nothing
  // (`fl_backend/app/api/bewerbungen/services.py :: link_is_over`), so nothing is outstanding.
  | { art: "unbeantwortet" }
  | { art: "ausstehend"; verschicktAm: string; erinnertAm: string | null };

export type SitzBestaetigung = {
  rolle: KontaktRolle;
  label: string;
  /** Null where a decline or an erasure emptied the slot; an erasure clears the seat's block beside it. */
  name: string | null;
  /** The person in the seat, or how it came to be empty — the two ways differ in what the league did. */
  nameSatz: string;
  /** The address the seat's links go to, and the one field of a submitted application an administrator may correct. */
  email: string | null;
  zugleichTrainer: boolean;
  stand: Stand;
  /**
   * What became of the last message to this seat, `null` while nothing is known. **Beside `stand`
   * and never inside it**: a seat can be `bestaetigt` and have had an earlier link bounce.
   */
  zustellung: FLBewerbungZustellung | null;
  /** Rendered here rather than by each surface: the strip and the fact panel say one thing about one seat. */
  satz: string;
};

/**
 * `null` where the application predates the workflow. An absent block is what keeps such an
 * application acceptable, so it answers "no such state" rather than three outstanding seats, which
 * would close the Zusage on every queued application.
 */
export function bestaetigungsStand(bewerbung: BewerbungSitze & Pick<FLBewerbung, "status">): SitzBestaetigung[] | null {
  const { bestaetigungen, kontakte, status } = bewerbung;

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
            : // The decided half of `link_is_over` alone. Past the deadline a still-open application
              // keeps `ausstehend`: a re-send restarts the deadline, so the seat waits on a control the
              // strip still offers.
              status !== "eingereicht"
              ? { art: "unbeantwortet" }
              : { art: "ausstehend", verschicktAm: verlauf.verschickt_am, erinnertAm: verlauf.erinnert_am };

    const name = person === null ? null : `${person.vorname} ${person.nachname}`;

    return {
      rolle: value,
      label: label,
      name: name,
      nameSatz: name ?? leerSatz(stand),
      // The empty string is what the form stores where nobody typed one, and a row cannot offer to
      // correct or re-send against it: both surfaces read `null` as "no address at all".
      email: person === null || person.email === "" ? null : person.email,
      zugleichTrainer: kontakte.trainer_ist_zugleich === value,
      stand: stand,
      zustellung: verlauf?.zustellung ?? null,
      satz: standSatz(stand),
    };
  });
}

/** A seat the acceptance is still waiting on. A decline blocks it too: the emptied slot carries no confirmation. */
export function istOffen({ stand }: SitzBestaetigung): boolean {
  return stand.art !== "bestaetigt";
}

/**
 * A seat nothing puts anybody back into. The erasure alone: it is the league's own act on the
 * person's request, where a Widerspruch leaves a slot an administrator seats somebody else in.
 */
function istEndgueltig({ stand }: SitzBestaetigung): boolean {
  return stand.art === "geloescht";
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
  // One sentence for both, because it is one fact: neither seat can be confirmed. A second wording
  // would read as a third terminal state beside the Widerspruch.
  if (stand.art === "geloescht" || stand.art === "unbeantwortet") return "Keine Bestätigung mehr möglich";

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
 * The seats another person may be put in. A Widerspruch alone, never an erasure: the two leave the
 * same empty slot, and `fl_backend/app/api/bewerbungen/services.py :: seat_awaits_a_replacement`
 * parts them by the day the decline left behind.
 */
export function sitzAngebot(staende: readonly SitzBestaetigung[]): ReadonlySet<KontaktRolle> {
  const ausgestiegen = new Set(staende.filter((sitz) => sitz.stand.art === "abgelehnt").map((sitz) => sitz.rolle));
  const spiegel = staende.find((sitz) => sitz.zugleichTrainer)?.rolle ?? null;

  if (spiegel !== null) {
    // NOT `linkAngebot`'s pairing: the re-send sends to whichever seat of a pair still stands, where
    // this write refuses unless both stepped out (`:: find_reseat_refusal`), so a control on one
    // half alone is a press refused.
    const beide = ausgestiegen.has("trainer") && ausgestiegen.has(spiegel);
    ausgestiegen.delete(spiegel);
    if (!beide) ausgestiegen.delete("trainer");
  }

  return ausgestiegen;
}

/**
 * Whether two seats are one person, read off the claim `trainer_ist_zugleich` records. The one
 * exception the submission's duplicate-address rule makes, and so the one this side must make too.
 */
function sindEinePerson(a: SitzBestaetigung, b: SitzBestaetigung): boolean {
  return (a.rolle === "trainer" && b.zugleichTrainer) || (b.rolle === "trainer" && a.zugleichTrainer);
}

/** Every address the correction on `sitz` may not take: another person's, never its own mirror's. */
export function adressenAndererPersonen(staende: readonly SitzBestaetigung[], sitz: SitzBestaetigung): string[] {
  return staende
    .filter((andere) => andere.rolle !== sitz.rolle && !sindEinePerson(andere, sitz))
    .map((andere) => andere.email)
    .filter((adresse) => adresse !== null);
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
 * under the closed control is the one the write would answer with. Four sentences, because each
 * names a different way out — and an erasure is the only one with none.
 */
export function zusageHindernis(staende: readonly SitzBestaetigung[] | null, teamName: string | null): string | null {
  if (teamName === null) {
    return "Ohne eine neue Schule und ohne ein bestehendes Team steht nicht fest, wer aufgenommen würde. Bleibt nur die Absage.";
  }

  // `null` where the application predates the workflow, which is what keeps it acceptable.
  const offen = staende === null ? [] : staende.filter(istOffen);

  if (offen.length === 0) return null;

  // FIRST: a row carrying both an erasure and a Widerspruch can still only be declined, so the
  // sentence naming the reseat would send the administrator to a dead end.
  if (offen.some(istEndgueltig)) {
    // „löschen lassen“ rather than „gelöscht“, the erasure being the league's act on the person's request.
    return "Eine Kontaktperson hat ihren Eintrag löschen lassen. Diese Bewerbung kann nur noch abgelehnt werden.";
  }

  // The repair beside the refusal: the control it sends the administrator to is `sitzAngebot`'s, so
  // both have to select the declined seat or this points at a row carrying no such control.
  if (offen.some((sitz) => sitz.stand.art === "abgelehnt")) {
    return "Eine Kontaktperson hat widersprochen. Besetze ihre Rolle mit einer anderen Person oder lehne die Bewerbung ab.";
  }

  // The rule rather than who is outstanding today: the strip above names every seat and its state,
  // so a second list here is the same fact from the other side (my wording, 2026-09-04 and
  // 2026-09-08).
  return "Eine Zusage ist ohne alle Bestätigungen nicht möglich.";
}

/**
 * What becomes of an incomplete application at its deadline, or `null` where the deletion clock does
 * not reach it. Mirrors `fl_backend/app/api/bewerbungen/services.py :: deletion_is_due`, whose sweep
 * reads `eingereicht` alone.
 */
export function loeschungsSatz({
  staende,
  frist,
  eingereicht,
  heute,
}: {
  staende: readonly SitzBestaetigung[];
  frist: string | null;
  eingereicht: boolean;
  /** The Europe/Berlin day, which is the one the backend's clock compares against. */
  heute: string;
}): string | null {
  if (!eingereicht || frist === null || !staende.some(istOffen)) return null;

  const tag = formatSpielDatum(frist);
  // `announcement_is_undeliverable`: the sweep holds an application whose notice the provider would
  // refuse, so a promised deletion is false for exactly the row an administrator can still repair.
  const gehalten = istDauerhaftUnzustellbar(staende.find((sitz) => sitz.rolle === "ansprechperson")?.zustellung ?? null);

  // The deadline's own day still reads as ahead: the link answers on it, and the sweep deletes the day after.
  if (frist >= heute) {
    // „Die Frist für die Bestätigungen“ is the deletion notice's own phrase, so the administrator reads
    // what the school is sent (`fl_frontend/src/core/bewerbungEmail.ts`).
    return gehalten
      ? `Die Frist für die Bestätigungen läuft bis zum ${tag}. Gelöscht wird die Bewerbung danach nicht, solange die Ansprechperson per E-Mail nicht erreichbar ist.`
      : `Bleibt eine Bestätigung bis zum ${tag} aus, wird die Bewerbung gelöscht.`;
  }

  return gehalten
    ? `Die Frist für die Bestätigungen ist am ${tag} abgelaufen. Gelöscht wird die Bewerbung nicht, solange die Ansprechperson per E-Mail nicht erreichbar ist.`
    : // The sweep's own cadence (`fl_frontend/src/features/bewerbungen/sweep.ts :: armBewerbungSweep`).
      // The local stack arms no sweep, so there the row outlives this sentence.
      `Die Frist für die Bestätigungen ist am ${tag} abgelaufen. Die Bewerbung wird bei der nächsten stündlichen Prüfung gelöscht.`;
}
