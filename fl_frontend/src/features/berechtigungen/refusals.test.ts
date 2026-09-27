import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { mapEntziehenRefusal, mapErteilenRefusal } from "./refusals.ts";

const GRANT = "POST /berechtigungen";
const REVOKE = "DELETE /berechtigungen/{berechtigung_id}";

describe("the grant's refusals", () => {
  /* Both spellings of one grant: the rule refuses a second, and the unique index refuses it again where
     two administrators press together, so which answers is a race. */
  it("lands both spellings of an address already granted on the address box", () => {
    const onTheBox = { fieldErrors: { email: "Diese Adresse hat bereits Zugang zur Verwaltung." } };

    assert.deepEqual(mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-001", 409)), onTheBox);
    assert.deepEqual(mapErteilenRefusal(refusedOn(GRANT, DUPLICATE_KEY, 409)), onTheBox);
  });

  it("lands a barred address on the address box, with the ban to lift first", () => {
    assert.deepEqual(mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-003", 409)), {
      fieldErrors: { email: "Diese Adresse ist gesperrt. Hebe zuerst die Sperre auf, wenn sie Zugang zur Verwaltung erhalten soll." },
    });
  });

  /* The acting administrator's own grant went while the page stood: no box repairs that. */
  it("answers a grant from an administrator whose own access went with a banner and no box", () => {
    assert.deepEqual(mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-006", 403)), {
      error: "Dein Zugang zur Verwaltung besteht nicht mehr.",
    });
  });

  it("answers every refusal the grant publishes", () => {
    for (const code of publishedRefusals(GRANT)) {
      assert.notEqual(answerShown(GRANT, code, mapErteilenRefusal), null, `${code} reaches the admin as an unhandled refusal`);
    }
  });
});

describe("the revoke's refusals", () => {
  it("names each reason a revoke is refused in its own sentence", () => {
    assert.deepEqual(mapEntziehenRefusal(refusedOn(REVOKE, "REQ-BERECHTIGUNG-005", 403)), {
      error: "Den Zugang entziehen kann nur der Inhaber.",
    });
    assert.deepEqual(mapEntziehenRefusal(refusedOn(REVOKE, "REQ-BERECHTIGUNG-002", 409)), {
      error: "Der Zugang des Inhabers lässt sich hier nicht ändern.",
    });
    assert.deepEqual(mapEntziehenRefusal(refusedOn(REVOKE, "REQ-BERECHTIGUNG-004", 409)), {
      error: "Die Verwaltung braucht mindestens zwei Personen mit Zugang. Füge zuerst eine weitere hinzu.",
    });
  });

  /* A grant another administrator has already revoked is a reload, which the shared reader words. */
  it("leaves a revoke of a grant already gone to the shared reader", () => {
    assert.equal(mapEntziehenRefusal(refusedOn(REVOKE, "DB-COMMON-001", 404)), null);
  });

  it("answers every refusal the revoke publishes", () => {
    for (const code of publishedRefusals(REVOKE)) {
      assert.notEqual(answerShown(REVOKE, code, mapEntziehenRefusal), null, `${code} reaches the admin as an unhandled refusal`);
    }
  });
});

describe("what neither mapper answers", () => {
  it("reads the code and never the status", () => {
    assert.deepEqual(
      mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-001", 422)),
      mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-001", 409)),
    );
  });

  it("leaves an error that never came from the API alone", () => {
    assert.equal(mapErteilenRefusal(new Error("the network went away")), null);
    assert.equal(mapEntziehenRefusal(null), null);
  });
});
