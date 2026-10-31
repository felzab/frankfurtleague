import { assert, describe, expect, it } from "vitest";

import { toFieldErrors } from "@/shared/utils/validation.ts";

const { FLSpielberichtPayloadSchema, spielberichtFormSchema } = await import("./schemas.ts");

const SPIELER = "68c1f0a2b3c4d5e6f7a8b9f1";

const bericht = (ergebnis: { team1_tore: number | null; team2_tore: number | null }, torschuetzen: unknown[], karten: unknown[] = []) => ({
  bericht: { ergebnis_vorschlag: { ...ergebnis, elfmeterschiessen: null, sonderereignis: null }, torschuetzen, karten, bemerkungen: null },
  bericht_stand: null,
});

const fehler = (payload: unknown) => {
  const parsed = FLSpielberichtPayloadSchema.safeParse(payload);
  return parsed.success ? {} : toFieldErrors(parsed.error);
};

describe("what a report's mirror refuses before the backend does", () => {
  /* The case a check counting by `seite` alone passes: an own goal by team 2's player is team 1's goal. */
  it("credits an own goal to the other side", () => {
    const eigentor = { seite: "team2", spieler_id: SPIELER, minute: "12", eigentor: true };

    expect(fehler(bericht({ team1_tore: 1, team2_tore: 0 }, [eigentor]))).toStrictEqual({});
    assert.ok(
      fehler(bericht({ team1_tore: 0, team2_tore: 1 }, [eigentor]))["bericht.torschuetzen"],
      "an own goal counted for the scorer's side",
    );
  });

  /* Every goal has an entry, „unbekannt“ being one: a 3:1 with two entries is short, with a nameless third it is whole. */
  it("refuses a goal without an entry and takes one naming nobody", () => {
    const tor = { seite: "team1", spieler_id: SPIELER, minute: "5", eigentor: false };
    const gegentor = { seite: "team2", spieler_id: SPIELER, minute: "50", eigentor: false };

    assert.ok(fehler(bericht({ team1_tore: 2, team2_tore: 1 }, [tor, gegentor]))["bericht.torschuetzen"]);
    expect(fehler(bericht({ team1_tore: 2, team2_tore: 1 }, [tor, gegentor, { ...tor, spieler_id: null, minute: "90+3" }]))).toStrictEqual({});
  });

  /* The form's own rule, the backend judging the wire against the stored report (`bericht_grund_missing`): the strip once
     the season after the match ends takes every reason, and a correction after it resends those cautions without one. */
  it("asks a new yellow for its reason, and neither a red nor a caution stored stripped of it", () => {
    const karte = { seite: "team1", spieler_id: SPIELER, minute: "30", farbe: "gelb", grund: null };
    const formFehler = (bestand: (typeof karte)[], karten: unknown[]) => {
      const parsed = spielberichtFormSchema(bestand).safeParse(bericht({ team1_tore: 0, team2_tore: 0 }, [], karten));
      return parsed.success ? {} : toFieldErrors(parsed.error);
    };

    expect(formFehler([], [karte])["bericht.karten.0.grund"]).toBe("Bei Gelb und Gelb-Rot gehört ein Grund dazu.");
    expect(formFehler([], [{ ...karte, farbe: "rot" }])).toStrictEqual({});
    expect(formFehler([karte], [{ ...karte, minute: "31" }]), "a stripped caution owes its reason again").toStrictEqual({});
    assert.ok(formFehler([karte], [{ ...karte, farbe: "gelb_rot" }])["bericht.karten.0.grund"], "another colour is a new card");
  });

  /* Counted as the backend counts: one stored card excuses one caution, so the second equal one owes its reason, and a
     reason on the first leaves the stored card to the second. */
  it("lets one stripped caution excuse one equal caution and no more", () => {
    const karte = { seite: "team1", spieler_id: SPIELER, minute: "30", farbe: "gelb", grund: null };
    const formFehler = (karten: unknown[]) => {
      const parsed = spielberichtFormSchema([karte]).safeParse(bericht({ team1_tore: 0, team2_tore: 0 }, [], karten));
      return parsed.success ? {} : toFieldErrors(parsed.error);
    };

    expect(formFehler([karte, { ...karte, minute: "70" }])).toStrictEqual({
      "bericht.karten.1.grund": "Bei Gelb und Gelb-Rot gehört ein Grund dazu.",
    });
    expect(
      formFehler([
        { ...karte, grund: "foulspiel" },
        { ...karte, minute: "70" },
      ]),
    ).toStrictEqual({});
    // Judged over the list, yet beside another card's untouched picker: both faults show at the one press.
    expect(
      Object.keys(
        formFehler([
          { ...karte, spieler_id: "", grund: "foulspiel" },
          { ...karte, seite: "team2" },
        ]),
      ).sort(),
    ).toStrictEqual(["bericht.karten.0.spieler_id", "bericht.karten.1.grund"]);
  });

  it("refuses a minute outside the report's vocabulary", () => {
    const tor = { seite: "team1", spieler_id: SPIELER, minute: "45 + 2", eigentor: false };

    assert.ok(fehler(bericht({ team1_tore: 1, team2_tore: 0 }, [tor]))["bericht.torschuetzen.0.minute"]);
  });
});
