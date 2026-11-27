import { ACCOUNT_ERASED, boundBy, catalogue, PRIVACY_NOTICE, seatsText, textOf, waitWords } from "../copy";
import { formatDate, formatInstant, formatList, formatNumber } from "../format";

import type { Copy, RecordText, Wait, Words } from "../copy";
import type { FLKontaktSeat } from "../generated/client/types";

// The pending change's opening, before its new address.
const NEW_ADDRESS = "Die neue Adresse ";
const teamSeason = (team: Words, saison: Copy) => `${textOf(team)}, ${saison}`;

/** The words of a person's own Konto, at `/account`, and of the mailed pages acting on its address and its erasure. */
export const ACCOUNT_COPY = catalogue({
  address: {
    description: "Mit dieser Adresse meldest du dich an.",
    /**
     * The pending change, around its new address, which the box sets semibold: waiting on the address on file's link,
     * which confirms first, or on the new address's own, by the step's deadline.
     */
    pending: {
      previous: (address: RecordText, until: string | null) =>
        [
          NEW_ADDRESS,
          address,
          until === null
            ? " wartet auf die Bestätigung deiner bisherigen Adresse."
            : ` wartet bis ${formatInstant(until)} auf die Bestätigung deiner bisherigen Adresse.`,
        ] as const,
      new: (address: RecordText, until: string | null) =>
        [
          NEW_ADDRESS,
          address,
          until === null ? " wartet auf ihre Bestätigung." : ` wartet bis ${formatInstant(until)} auf ihre Bestätigung.`,
        ] as const,
      /** Both addresses have confirmed and the wait runs. */
      waiting: (address: RecordText, moment: string) => [NEW_ADDRESS, address, ` gilt ab ${formatInstant(moment)}.`] as const,
    },
    /** The step the change waits on lapsed; the hourly pass ends it. */
    lapsed: "Die Änderung ist abgelaufen.",
    stop: "Änderung stoppen",
    /** A holder's own change, which waits whole. */
    holderWait: (wait: Wait) => `Die neue Adresse gilt erst ${waitWords(wait).span}, nachdem beide Adressen sie bestätigt haben.`,
  },
  erasure: {
    // What outlives an erasure is the privacy notice's to list, never this sentence's.
    description: `Was bleibt, steht unter „${PRIVACY_NOTICE}“.`,
    consequence: "Den Link zum Löschen bekommst du per E-Mail.",
    done: ACCOUNT_ERASED,
  },
  passkeys: {
    description: "Ein Passkey meldet dich ohne Code an.",
    /** When a passkey was set up. */
    dates: (created: Date) => `Eingerichtet am ${formatDate(created)}`,
    /**
     * The deletion's consequence, which the question words before the passkey touch: the devices the passkey signed
     * in, and this one where the page's session was made by it. An administrator's only passkey has no deletion.
     */
    endsDevices: "Geräte, die damit angemeldet sind, werden abgemeldet.",
    endsThisDevice: "Auch dieses Gerät wird abgemeldet.",
    /** An administrator's last passkey, their only way into the administration. */
    lastKept: "Der letzte Passkey lässt sich nicht löschen.",
    /** The same, as the deletion's tooltip. */
    lastKeptLocked: "Letzter Passkey bleibt",
    /** The set-up's tooltip at the cap, which no refusal on a status line words. */
    limit: (count: number) => `Höchstens ${boundBy(formatNumber(count), "Passkeys")}`,
    /** A first passkey set up past the sign-in library's `freshAge`. */
    signInTooOld: "Deine Anmeldung liegt zu lange zurück.",
    /** A further passkey set up on an authenticator holding one of the person's already. */
    alreadyOnDevice: "Auf diesem Gerät hast du schon einen Passkey.",
  },
  devices: {
    title: "Geräte",
    description: (count: number) =>
      count === 1 ? "Du bist auf 1\u00A0Gerät angemeldet." : `Du bist auf ${boundBy(formatNumber(count), "Geräten")} angemeldet.`,
    allOthers: "Alle anderen",
    consequence: "Nur dieses Gerät bleibt angemeldet.",
  },
  /**
   * Each record an address holds, as Deine Einträge boxes it: titled by what the record is, a team's seats by the
   * team's name, the rest by `shared`'s noun or the page's, and described by what the box holds beyond its title.
   */
  entries: {
    plural: "Einträge",
    /**
     * Each entry box's one phrase, by the kind of record it holds, adding to the title what the box holds: a noun
     * phrase, so it takes no full stop.
     */
    description: {
      /** A person's own record, which the title names: a pupil's, a registration's, a referee's. */
      own: "Deine Angaben und was davon öffentlich ist",
      /** A seat on a team's season, its seats named by a fact (`COPY.team.seatsHeld`). */
      seat: "Deine Angaben im Team",
      /** A seat in an application, which stands for no team yet, its seats named the same way. */
      bewerbung: "Deine Angaben in der Bewerbung",
    },
    teamSeason,
    /** A seat entry's fact where its seats store the person typed two ways, by the seats holding this one: „Telefon als Ansprechperson“. */
    seatFact: (label: Copy, seats: readonly FLKontaktSeat[]) => `${label} als ${seatsText(seats)}`,
    /**
     * The labels the deletion's list names an address's records by, each the person's part in the record: one row per
     * label, holding the records it names.
     */
    spieler: "Als Spielerin oder Spieler",
    schiedsrichter: "Als Schiedsrichterin oder Schiedsrichter",
    /** The seats a contact person holds on one row, as one phrase in the seats' order: „Als Ansprechperson und Trainerin oder Trainer“. */
    seats: (seats: readonly FLKontaktSeat[]) => `Als ${seatsText(seats)}`,
    bewerbung: (saison: Copy) => `Bewerbung für die ${saison}`,
    /** A pupil's registration, by its team where the team still stands. */
    registrierung: (team: Words | null, saison: Copy) =>
      team === null ? `Registrierung für die ${saison}` : `Registrierung für ${teamSeason(team, saison)}`,
    /** One label's records, where an address holds several under it. */
    several: (records: readonly Words[]) => formatList(records.map(textOf)),
  },
});
