import { ACCOUNT_ERASED, boundBy, catalogue, PASSKEY_WITHOUT_CODE, PRIVACY_NOTICE, seatsText, textOf, waitWords } from "../copy";
import { formatDate, formatInstant, formatList, formatNumber } from "../format";

import type { Copy, Wait, Words } from "../copy";
import type { FLKontaktSeat } from "../generated/client/types";

const teamSeason = (team: Words, saison: Copy) => `${textOf(team)}, ${saison}`;

/** The words of a person's own Konto, at `/account`, and of the mailed pages acting on its address and its erasure. */
export const ACCOUNT_COPY = catalogue({
  address: {
    description: "Mit dieser Adresse meldest du dich an.",
    /**
     * The pending change, in the two parts around its new address, which the box sets semibold between them: waiting
     * on the address on file's link, which confirms first, or on the new address's own, by the step's deadline.
     */
    pending: {
      before: "Die neue Adresse",
      previous: (until: string | null) =>
        until === null
          ? "wartet auf die Bestätigung deiner bisherigen Adresse."
          : `wartet ${boundBy("bis", formatInstant(until))} auf die Bestätigung deiner bisherigen Adresse.`,
      new: (until: string | null) =>
        until === null ? "wartet auf ihre Bestätigung." : `wartet ${boundBy("bis", formatInstant(until))} auf ihre Bestätigung.`,
      /** Both addresses have confirmed and the wait runs. */
      waiting: (moment: string) => `gilt ${boundBy("ab", formatInstant(moment))}.`,
    },
    /** The step the change waits on lapsed; the hourly pass ends it. */
    lapsed: "Die Änderung ist abgelaufen.",
    stop: "Änderung stoppen",
    /** A holder's own change, which waits whole. */
    holderWait: (wait: Wait) => `Die neue Adresse gilt erst ${waitWords(wait).span}, nachdem beide Adressen sie bestätigt haben.`,
  },
  erasure: {
    // What outlives an erasure is the privacy notice's to list, never this sentence's.
    description: `Dein Konto und deine Angaben werden gelöscht, bis auf das, was unter „${PRIVACY_NOTICE}“ steht.`,
    consequence: "Den Link zum Löschen bekommst du per E-Mail.",
    done: ACCOUNT_ERASED,
  },
  passkeys: {
    description: PASSKEY_WITHOUT_CODE,
    /** When a passkey was set up, and when it last signed in where it has. */
    dates: (created: Date, lastUsed: Date | null) =>
      lastUsed === null
        ? `Eingerichtet ${boundBy("am", formatDate(created))}`
        : `Eingerichtet ${boundBy("am", formatDate(created))} · Zuletzt verwendet ${boundBy("am", formatDate(lastUsed))}`,
    /**
     * The deletion's consequence, which the question words before the passkey touch: the devices the passkey signed
     * in, and this one where the page's session was made by it or it is the person's only passkey, which the touch
     * then has to be.
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
    /** The same, as the set-up's tooltip. */
    signInTooOldLocked: "Erst nach neuer Anmeldung",
    /** A further passkey set up on an authenticator holding one of the person's already. */
    alreadyOnDevice: "Auf diesem Gerät hast du schon einen Passkey.",
  },
  devices: {
    title: "Geräte",
    description: (count: number) =>
      count === 1 ? "Du bist auf\u00A01\u00A0Gerät angemeldet." : `Du bist ${boundBy("auf", formatNumber(count), "Geräten")} angemeldet.`,
    allOthers: "Alle anderen",
    consequence: "Nur dieses Gerät bleibt angemeldet.",
  },
  appearance: {
    /** The theme's three choices in the order its control shows them, the third in `COPY.template.theme`'s words. */
    description: "Dunkel, hell oder wie dein Gerät.",
  },
  /**
   * „Funktion wechseln“'s entries: a team by its name, with this line under it naming the season and the seats held
   * there in the seats' order; a pupil's and a referee's by `shared`'s nouns, the administration's by its role.
   */
  role: {
    seats: (saison: Copy, seats: readonly FLKontaktSeat[]) => `${saison} · ${seatsText(seats)}`,
  },
  /**
   * Each record an address holds, as Deine Einträge boxes it: titled by what the record is, a team's seats by the
   * team's name, the rest by `shared`'s noun or the page's, and described by the person's part in it.
   */
  entries: {
    plural: "Einträge",
    /** Each entry box's one sentence, by the kind of record it holds, naming the role the person holds in it. */
    description: {
      spieler: "Dein Eintrag als Spielerin oder Spieler im Kader und was davon öffentlich ist.",
      registrierung: "Deine Registrierung als Spielerin oder Spieler und was davon öffentlich ist.",
      schiedsrichter: "Dein Eintrag als Schiedsrichterin oder Schiedsrichter und was davon öffentlich ist.",
      /** A seat on a team's season and a seat in an application alike, by the seats held, in the seats' order. */
      seat: (seats: readonly FLKontaktSeat[]) => `Dein Eintrag ${boundBy("als", seatsText(seats))} und wie wir dich erreichen.`,
    },
    teamSeason,
    /** A seat entry's fact where its seats store the person typed two ways, by the seats holding this one: „Telefon als Ansprechperson“. */
    seatFact: (label: Copy, seats: readonly FLKontaktSeat[]) => `${label} ${boundBy("als", seatsText(seats))}`,
    /**
     * The labels the deletion's list names an address's records by, each the person's part in the record: one row per
     * label, holding the records it names.
     */
    spieler: "Als Spielerin oder Spieler",
    schiedsrichter: "Als Schiedsrichterin oder Schiedsrichter",
    /** The seats a contact person holds on one row, as one phrase in the seats' order: „Als Ansprechperson und Trainerin oder Trainer“. */
    seats: (seats: readonly FLKontaktSeat[]) => boundBy("Als", seatsText(seats)),
    bewerbung: (saison: Copy) => `Bewerbung ${boundBy("für", "die", saison)}`,
    /** A pupil's registration, by its team where the team still stands. */
    registrierung: (team: Words | null, saison: Copy) =>
      team === null ? `Registrierung ${boundBy("für", "die", saison)}` : `Registrierung ${boundBy("für", teamSeason(team, saison))}`,
    /** One label's records, where an address holds several under it. */
    several: (records: readonly Words[]) => formatList(records.map(textOf)),
  },
});
