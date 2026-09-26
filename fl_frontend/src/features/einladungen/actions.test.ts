import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { mapEinladungRefusal } from "./refusals.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

const KEY = { team_id: "6890a1b2c3d4e5f607182932", saison_id: "2026" };
const EINLADUNG_ID = "b".repeat(24);

/** Each write's answer as the backend sends it where the write landed: the season-wide send mailing nobody. */
function landed({ endpoint, method }: ApiCall): Record<string, unknown> {
  if (endpoint.endsWith("/versand")) return { acknowledged: 1, saison_id: KEY.saison_id, zeilen: [] };
  if (method === "DELETE") return { acknowledged: 1, ...KEY, einladung_id: EINLADUNG_ID };
  return { acknowledged: 1, ...KEY, einladung_id: EINLADUNG_ID, token: "t", erstellt_am: "2026-09-01", erstellt_von: "vorstand@example.org" };
}

/* The real actions and their mutations, called: the request they run in and the backend client are the doubles. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers((call) => Promise.resolve(landed(call)));
const { deleteEinladungAction, postEinladungAction, postEinladungVersandAction } = await import("./actions.ts");

const MINT_OPERATION = "POST /teams/{team_id}/saisons/{saison_id}/einladung";
const VERSAND_OPERATION = "POST /saisons/{saison_id}/einladungen/versand";
const REVOKE_OPERATION = "DELETE /teams/{team_id}/saisons/{saison_id}/einladung";
/** S9's flow raises it; this slice calls neither endpoint it is published on. */
const REGISTRIERUNG_OPERATION = "POST /registrierungen";

describe("the invite's writes", () => {
  it("address the mint and the revoke by both ids in the path, and the send by its season", async () => {
    await postEinladungAction(KEY);
    await deleteEinladungAction(KEY);
    await postEinladungVersandAction({ id: KEY.saison_id, erneut: true });

    const einladung = `/teams/${KEY.team_id}/saisons/${KEY.saison_id}/einladung`;
    assert.deepEqual(requestsOf(calls), [
      { endpoint: einladung, method: "POST", body: undefined },
      { endpoint: einladung, method: "DELETE", body: undefined },
      { endpoint: `/saisons/${KEY.saison_id}/einladungen/versand`, method: "POST", body: { erneut: true } },
    ]);
  });
});

describe("the invite's refusals against the codes its endpoints publish", () => {
  it("answers every code the mint publishes through the mapper", async () => {
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
    await assertEachAnswered({
      operation: MINT_OPERATION,
      refuseWith: answerWith,
      act: () => postEinladungAction(KEY),
      mapped: mapEinladungRefusal,
    });
  });

  it("answers every code the season-wide send publishes through the mapper", async () => {
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
    await assertEachAnswered({
      operation: VERSAND_OPERATION,
      refuseWith: answerWith,
      act: () => postEinladungVersandAction({ id: KEY.saison_id, erneut: false }),
      mapped: mapEinladungRefusal,
    });
  });

  /* The revoke publishes the unique index's code alone, which this slice leaves to the shared reader,
     so the revoke asks no mapper at all. */
  it("answers every code the revoke publishes in the shared reader's words", async () => {
    await assertEachAnswered({
      operation: REVOKE_OPERATION,
      refuseWith: answerWith,
      act: () => deleteEinladungAction(KEY),
      mapped: () => null,
    });
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
