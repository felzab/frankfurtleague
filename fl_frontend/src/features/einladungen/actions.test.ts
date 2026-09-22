import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { declaredCodes, sliceBetween } from "@/shared/testing/refusalRegister.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const APP_DIR = path.resolve(import.meta.dirname, "..", "..", "app");

const MINT_OPERATION = "POST /teams/{team_id}/saisons/{saison_id}/einladung";
const VERSAND_OPERATION = "POST /saisons/{saison_id}/einladungen/versand";
const REVOKE_OPERATION = "DELETE /teams/{team_id}/saisons/{saison_id}/einladung";
const VORSCHAU_OPERATION = "GET /saisons/{saison_id}/einladungen/versand/vorschau";
/** S9's flow raises it; this slice calls neither endpoint it is declared against. */
const REGISTRIERUNG_OPERATION = "POST /registrierungen";

const MAPPER = sliceBetween(ACTIONS, "function mapEinladungRefusal", "export async function postEinladungAction");

/** Every code the panel's mapper words in German, read off the mapper's own arms. */
const mappedCodes = [...MAPPER.matchAll(/case "([A-Z-]+\d+)":/g)].map(([, code]) => code ?? "");

describe("the invite's refusals against the backend's register", () => {
  /* Before every comparison below: a case looping over an empty declared list maps nothing and stays
     green. An empty list here is the harness failing rather than the source. */
  it("finds rules declared against both of this slice's endpoints", () => {
    assert.ok(declaredCodes(MINT_OPERATION).length > 0, `no rule is declared against ${MINT_OPERATION}`);
    assert.ok(declaredCodes(VERSAND_OPERATION).length > 0, `no rule is declared against ${VERSAND_OPERATION}`);
    assert.ok(mappedCodes.length > 0, "no refusal code could be read out of the mapper at all");
  });

  it("maps every code the mint declares", () => {
    const declared = declaredCodes(MINT_OPERATION);

    assert.deepEqual(declared, ["REQ-EINLADUNG-001", "REQ-EINLADUNG-002"]);
    for (const code of declared) {
      assert.ok(mappedCodes.includes(code), `${code} is declared against the mint and reaches the admin unmapped`);
    }
  });

  it("maps every code the season-wide send declares", () => {
    const declared = declaredCodes(VERSAND_OPERATION);

    assert.deepEqual(declared, ["REQ-EINLADUNG-002"]);
    for (const code of declared) {
      assert.ok(mappedCodes.includes(code), `${code} is declared against the send and reaches the admin unmapped`);
    }
  });

  /* One mapper serves four call sites across four operations, and a rule declared against either of
     these two would reach the administrator through the 409 fallback in
     `fl_frontend/src/shared/utils/actionError.ts`, which tells them an equivalent entry exists. */
  it("leaves the revoke and the preview with no declared rule to map", () => {
    for (const operation of [REVOKE_OPERATION, VORSCHAU_OPERATION]) {
      assert.deepEqual(declaredCodes(operation), [], `${operation} declares a refusal no mapper answers`);
    }
  });

  /* Mapped here it would be German nobody can reach: the code is raised on the registration
     endpoints, and a stranger opening a dead link meets S9's page rather than an admin's toast. */
  it("leaves the link-opens-nothing refusal to the flow that raises it", () => {
    assert.ok(declaredCodes(REGISTRIERUNG_OPERATION).includes("REQ-EINLADUNG-003"), "the register moved the code off the registration write");
    assert.equal(mappedCodes.includes("REQ-EINLADUNG-003"), false, "this slice words a refusal none of its own calls can answer");
  });

  /* The undo lane words a replayed endpoint's refusals a second time in its own `REPLAY_REFUSALS`
     (`.claude/rules/cross-surface.md`). Nothing replays these two, so this slice owes none — and
     this case is what fails the day something does. */
  it("is replayed by no undo route, so its German lives at one site", () => {
    const routes = filesUnder(APP_DIR, (name) => name === "route.ts", 12).filter((file) => !isTestFile(file));

    assert.ok(routes.length > 0, "the walk found no route handlers at all, so this case compares nothing");
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      assert.equal(
        source.includes("REQ-EINLADUNG"),
        false,
        `${path.basename(path.dirname(file))} replays an invite endpoint and words its refusals`,
      );
    }
  });
});
