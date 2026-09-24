import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { mapEinladungRefusal } from "./refusals.ts";

const MINT_OPERATION = "POST /teams/{team_id}/saisons/{saison_id}/einladung";
const VERSAND_OPERATION = "POST /saisons/{saison_id}/einladungen/versand";
const REVOKE_OPERATION = "DELETE /teams/{team_id}/saisons/{saison_id}/einladung";
/** S9's flow raises it; this slice calls neither endpoint it is published on. */
const REGISTRIERUNG_OPERATION = "POST /registrierungen";

describe("the invite's refusals against the codes its endpoints publish", () => {
  it("maps every code the mint publishes", () => {
    const published = publishedRefusals(MINT_OPERATION);

    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      ["REQ-EINLADUNG-001", "REQ-EINLADUNG-002"],
    );
    for (const code of published) {
      assert.notEqual(
        answerShown(MINT_OPERATION, code, mapEinladungRefusal),
        null,
        `${code} is published on the mint and reaches the admin unmapped`,
      );
    }
  });

  it("maps every code the season-wide send publishes", () => {
    const published = publishedRefusals(VERSAND_OPERATION);

    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      ["REQ-EINLADUNG-002"],
    );
    for (const code of published) {
      assert.notEqual(
        answerShown(VERSAND_OPERATION, code, mapEinladungRefusal),
        null,
        `${code} is published on the send and reaches the admin unmapped`,
      );
    }
  });

  /* The revoke asks the same mapper, which leaves the unique index's code to the shared reader. */
  it("maps every code the revoke publishes", () => {
    for (const code of publishedRefusals(REVOKE_OPERATION)) {
      assert.notEqual(
        answerShown(REVOKE_OPERATION, code, mapEinladungRefusal),
        null,
        `${code} is published on the revoke and reaches the admin unmapped`,
      );
    }
  });

  /* Mapped here it would be German nobody can reach: the code is raised on the registration
     endpoints, and a stranger opening a dead link meets S9's page rather than an admin's toast. */
  it("leaves the link-opens-nothing refusal to the flow that raises it", () => {
    assert.ok(
      publishedRefusals(REGISTRIERUNG_OPERATION).includes("REQ-EINLADUNG-003"),
      "the document moved the code off the registration write",
    );
    assert.equal(
      mapEinladungRefusal(refusedOn(REGISTRIERUNG_OPERATION, "REQ-EINLADUNG-003")),
      null,
      "this slice words a refusal none of its own calls can answer",
    );
  });
});
