import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";
import { toFieldErrors } from "@/shared/utils/validation.ts";

const { FLSpielberichtAdminResponseSchema, FLSpielberichtPayloadSchema, FLSpielberichtSchiedsrichterResponseSchema } =
  await import("./schemas.ts");

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

    assert.deepEqual(fehler(bericht({ team1_tore: 1, team2_tore: 0 }, [eigentor])), {});
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
    assert.deepEqual(fehler(bericht({ team1_tore: 2, team2_tore: 1 }, [tor, gegentor, { ...tor, spieler_id: null, minute: "90+3" }])), {});
  });

  it("asks a yellow for its reason and leaves a red's optional", () => {
    const karte = { seite: "team1", spieler_id: SPIELER, minute: "30", farbe: "gelb", grund: null };

    assert.equal(
      fehler(bericht({ team1_tore: 0, team2_tore: 0 }, [], [karte]))["bericht.karten.0.grund"],
      "Bei Gelb und Gelb-Rot gehört ein Grund dazu.",
    );
    assert.deepEqual(fehler(bericht({ team1_tore: 0, team2_tore: 0 }, [], [{ ...karte, farbe: "rot" }])), {});
  });

  /* The season's end strips every card's reason and the remarks: the rule is a write's, so the read of a stripped report
     opens on both readers' pages where a caution without its reason would otherwise fail the parse. */
  it("reads a report the season's end stripped, on the referee's form and on the administrator's panel", () => {
    const gelesen = spielberichtReadFixture();
    const gestrippt = {
      ...gelesen,
      bericht: { ...gelesen.bericht, bemerkungen: null, karten: gelesen.bericht.karten.map((karte) => ({ ...karte, grund: null })) },
    };

    assert.ok(FLSpielberichtSchiedsrichterResponseSchema.safeParse(gestrippt).success, "the referee's form fails a stripped report");
    assert.ok(FLSpielberichtAdminResponseSchema.safeParse(gestrippt).success, "the administrator's panel fails a stripped report");
  });

  it("refuses a minute outside the report's vocabulary", () => {
    const tor = { seite: "team1", spieler_id: SPIELER, minute: "45 + 2", eigentor: false };

    assert.ok(fehler(bericht({ team1_tore: 1, team2_tore: 0 }, [tor]))["bericht.torschuetzen.0.minute"]);
  });
});
