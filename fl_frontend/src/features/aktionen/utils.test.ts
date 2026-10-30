import { assert, describe, expect, it } from "vitest";

import { GELOESCHT_ACTOR_MARKER } from "@/core/geloeschtActor.ts";
import { FLAktorPersonFunktion } from "@/core/generated/client/types.ts";
import { GELOESCHTE_PERSON } from "@/features/berechtigungen/constants.ts";

import { AKTION_HERKUNFT_LABELS, AKTOR_FUNKTION_LABELS, AKTOR_HERKUNFT } from "./constants.ts";
import { describeAktionDatensatz, formatAktionZeitpunkt, herkunftOfAktor, labelForCollection, personAkteurLabel } from "./utils.ts";

import type { FLAktion } from "@/core/generated/client/types.ts";

describe("formatAktionZeitpunkt", () => {
  it("renders a stored UTC instant in German local time", () => {
    expect(formatAktionZeitpunkt("2026-08-20T14:23:05+00:00")).toStrictEqual({ datum: "20.08.2026", uhrzeit: "16:23" });
  });

  // The offset can carry the write into the next day, which is the whole reason the zone is pinned.
  it("applies the winter offset and the day it moves the instant to", () => {
    expect(formatAktionZeitpunkt("2026-01-05T23:30:00+00:00")).toStrictEqual({ datum: "06.01.2026", uhrzeit: "00:30" });
  });

  it("passes an unreadable value through instead of throwing", () => {
    expect(formatAktionZeitpunkt("irgendwann")).toStrictEqual({ datum: "irgendwann", uhrzeit: null });
  });
});

describe("labelForCollection", () => {
  it("names a junction collection in words", () => {
    expect(labelForCollection("saison_teams")).toBe("Team in Saison");
  });

  it("falls back to a name it does not know", () => {
    expect(labelForCollection("pokale")).toBe("pokale");
  });

  it("falls back for a name that is a prototype key, which `??` would let through", () => {
    // A prototype key selects a FUNCTION, which is not nullish, so `??` keeps it and the cell renders
    // `function Object() { [native code] }` where a collection name belongs.
    expect(labelForCollection("constructor")).toBe("constructor");
  });
});

describe("describeAktionDatensatz", () => {
  it("names a single document by its id", () => {
    expect(describeAktionDatensatz({ document_id: "68c1f0a2b3c4d5e6f7a8b9c0", db_filter: null, modified_count: null })).toStrictEqual({
      kind: "dokument",
      id: "68c1f0a2b3c4d5e6f7a8b9c0",
    });
  });

  it("carries a fan-out's filter beside its count", () => {
    expect(describeAktionDatensatz({ document_id: null, db_filter: { saison_id: "2026" }, modified_count: 12 })).toStrictEqual({
      kind: "menge",
      filterPaare: [["saison_id", "2026"]],
      betroffen: 12,
    });
  });

  // Every Spielplan draw writes two of these, and the count is the whole of what the row has to say.
  it("keeps a bulk create's count, which carries no id and no filter", () => {
    expect(describeAktionDatensatz({ document_id: null, db_filter: null, modified_count: 42 })).toStrictEqual({
      kind: "menge",
      filterPaare: [],
      betroffen: 42,
    });
  });

  it("reports nothing named only where the row names nothing", () => {
    expect(describeAktionDatensatz({ document_id: null, db_filter: null, modified_count: null })).toStrictEqual({ kind: "ohne" });
  });
});

/** Every kind the origin map places, which its type holds to every kind the read model accepts. */
const AKTOR_KINDS = Object.keys(AKTOR_HERKUNFT) as FLAktion["actor"]["kind"][];

/** A pseudonym as the log read serves one: already cut to the start a row shows. */
const PSEUDONYM = "3f9a07c2";

/** A valid actor of each kind: a signed-in person carries a pseudonym and a Funktion where every other kind carries `email`. */
function actorOf(kind: FLAktion["actor"]["kind"]): FLAktion["actor"] {
  return kind === "person_session"
    ? { kind: kind, pseudonym: PSEUDONYM, funktion: "spieler" }
    : { kind: kind, email: "SENTINEL", email_gesperrt: false };
}

describe("herkunftOfAktor", () => {
  /* First: an empty list of kinds would leave every sweep below iterating nothing and passing. */
  it("reads every kind off the origin map", () => {
    expect([...AKTOR_KINDS].sort()).toStrictEqual(["admin_session", "person_session", "public", "system"]);
  });

  /* The binary this replaced filed anything that was not `system` under the signed-in people. A kind
     nobody places would render as a person named by a sentinel and filter as one. */
  it("files every kind the read model accepts under a labelled origin", () => {
    for (const kind of AKTOR_KINDS) {
      const herkunft = herkunftOfAktor(actorOf(kind));

      expect(herkunft, `\`${kind}\` is read as something other than the origin it is filed under`).toBe(AKTOR_HERKUNFT[kind]);
      assert.ok(AKTION_HERKUNFT_LABELS[herkunft], `\`${kind}\` is filed under \`${herkunft}\`, which nothing names`);
    }
  });

  /* Its own value and not the people's: nobody signed in for a public submission, and nobody is named
     by the `PUBLIC` its `email` holds. */
  it("keeps a public submission off both of the origins it is not", () => {
    expect(herkunftOfAktor({ kind: "public", email: "PUBLIC", email_gesperrt: false })).toBe("public");
    expect(herkunftOfAktor({ kind: "public", email: "PUBLIC", email_gesperrt: false })).not.toBe(
      herkunftOfAktor({ kind: "admin_session", email: "a@b.de", email_gesperrt: false }),
    );
    expect(herkunftOfAktor({ kind: "public", email: "PUBLIC", email_gesperrt: false })).not.toBe(
      herkunftOfAktor({ kind: "system", email: "SYSTEM", email_gesperrt: false }),
    );
  });

  /* An origin is a category and a label is what a reader sees, so two origins sharing one wording would
     leave the filter offering the same word twice. */
  it("names each origin in its own words", () => {
    const labels = Object.values(AKTION_HERKUNFT_LABELS);

    expect(new Set(labels).size, "two origins are offered under one wording").toBe(labels.length);
    for (const label of labels) assert.ok(!/^[A-Z]+$/.test(label), `\`${label}\` is a stored sentinel rather than a wording`);
  });
});

describe("personAkteurLabel", () => {
  it("names the Funktion and the start of the pseudonym", () => {
    expect(personAkteurLabel({ kind: "person_session", pseudonym: PSEUDONYM, funktion: "spieler" })).toBe("Spieler · 3f9a07c2");
  });

  /* Every Funktion the contract lists, so two sharing one word fail here rather than reading alike on a row. */
  it("names every Funktion in its own word", () => {
    const labels = Object.values(FLAktorPersonFunktion).map((funktion) =>
      personAkteurLabel({ kind: "person_session", pseudonym: PSEUDONYM, funktion: funktion }),
    );

    expect(labels).toStrictEqual(["Kontakt · 3f9a07c2", "Spieler · 3f9a07c2", "Schiedsrichter · 3f9a07c2"]);
    expect(new Set(Object.values(AKTOR_FUNKTION_LABELS)).size).toBe(Object.values(FLAktorPersonFunktion).length);
  });

  /* The redacted actor of a person erased since: the marker read as a pseudonym's start would name somebody. */
  it("names a person erased since in the admin cards' words, keeping the Funktion", () => {
    expect(personAkteurLabel({ kind: "person_session", pseudonym: GELOESCHT_ACTOR_MARKER, funktion: "spieler" })).toBe(
      `Spieler · ${GELOESCHTE_PERSON}`,
    );
  });
});
