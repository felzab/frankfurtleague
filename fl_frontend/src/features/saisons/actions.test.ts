import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { withoutPythonComments } from "@/core/pythonComments.ts";
import { cacheCalls, doubleActionRequest, loggedLines } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { saisonRules } from "@/shared/testing/saisonRules.ts";

import { GRUPPEN_OFF_RULES, RECORDED_FACTS_NONE, SPIELTAGE_UNDATED } from "./constants.ts";
import { mapActivateRefusal, mapRulesRefusal, mapSaisonIdRefusal, mapSpielplanRefusal, mapSwapRefusal, mapUndrawRefusal } from "./refusals.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";
import type { FLSaisonRules } from "./schemas.ts";

/** The deletion's switch as the doubled config answers it, which a case sets: off where it sets nothing, as production. */
let loeschungSwitch: string | undefined = "off";

/* The real actions and their mutations, called: the request they run in and the backend client are the doubles. */
doubleActionRequest();
// A getter, so a case can move the switch the one loaded module reads.
registerDoubles({
  modules: {
    "core/config.ts": {
      frontend_config: {
        get LOESCHUNG_SWEEP() {
          return loeschungSwitch;
        },
      },
    },
  },
});
const { answerWith, calls } = doubleApiAnswers();
const { activateSaisonAction, generateSpielplanAction, patchSaisonAction, postSaisonAction, swapGruppenAction, undrawSpielplanAction } =
  await import("./actions.ts");
const { APIBadStatusError, APINetworkError } = await import("@/core/errors.ts");

beforeEach(() => {
  loeschungSwitch = "off";
});

const CREATE_OPERATION = "POST /saisons";
const EDIT_OPERATION = "PATCH /saisons/{saison_id}";
const ACTIVATE_OPERATION = "POST /saisons/{saison_id}/activate";
const DRAW_OPERATION = "POST /saisons/{saison_id}/spielplan";
const UNDRAW_OPERATION = "DELETE /saisons/{saison_id}/spielplan";
const SWAP_OPERATION = "POST /saisons/{saison_id}/gruppen/swap";

const SAISON_ID = "2026";

const RULES: FLSaisonRules = saisonRules();

/** A season both schemas take as it stands, so each write reaches the doubled request rather than the parse. */
const SAISON = { id: SAISON_ID, start_date: "2026-03-01", end_date: "2026-07-01", rules: RULES, bewerbung: null, registrierung: null };

/** The draw's answer on a first draw (`false`) or a replace carrying its own numbers (`true`). */
const drawAnswer = (code: string, carriedShape: boolean): string => mapSpielplanRefusal(refusedOn(DRAW_OPERATION, code), carriedShape) ?? "";

/** The editor's banner for one code, where it words one rather than seating it under a field. */
const editBanner = (code: string): string => mapRulesRefusal(refusedOn(EDIT_OPERATION, code))?.error ?? "";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/* Source text rather than an import: the write path's register is Python, and nothing on this side can load it. */
const SERVICES = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "api", "saisons", "services.py"), "utf8");

/**
 * `REQ-RULES-011`'s frozen set, read off the write path that composes it. A wrapped value runs to the
 * paren the formatter closes alone on a line.
 */
const SHAPE_RULES_FIELDS = [
  ...withoutPythonComments(/^SHAPE_RULES_FIELDS(?::[^=\n]*)? = (\(\n[\s\S]*?\n\)|.*)$/m.exec(SERVICES)?.[1] ?? "").matchAll(/"([^"]*)"/g),
].map((literal) => literal[1] ?? "");

/* One German noun phrase per frozen field. The refusal states the freeze in one sentence, so a
   further shape field would go unnamed in it while nothing here failed but the first case below. */
const GERMAN_OF: Record<string, string> = {
  number_of_groups: "Gruppen",
  teams_per_group: "Teams pro Gruppe",
  qualifiers_per_group: "Qualifikanten",
};

/**
 * Whether one phrase stands in a text as a whole word. German compounds a term into a longer word
 * meaning something else, so „Gruppenphase“ satisfies a substring search for the group COUNT.
 */
const names = (german: string, text: string): boolean => new RegExp(`(?<!\\p{L})${german}(?!\\p{L})`, "u").test(text);

const TEAM1_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const TEAM2_ID = "68c1f0a2b3c4d5e6f7a8b9c1";

/** Each write's answer as the backend sends it where the write landed. */
function landed({ endpoint, method }: ApiCall): Record<string, unknown> {
  const stored = { ...SAISON, status: "future", schedule: [], spielplan: null };
  if (endpoint === "/saisons") return { acknowledged: 1, created_id: SAISON_ID };
  if (endpoint.endsWith("/activate")) return { acknowledged: 1, updated_document: stored, deactivated: 1 };
  if (endpoint.endsWith("/gruppen/swap")) {
    return {
      acknowledged: 1,
      saison_id: SAISON_ID,
      team1_id: TEAM1_ID,
      team1_gruppe: "B",
      team2_id: TEAM2_ID,
      team2_gruppe: "A",
      rewritten_spiele: 0,
    };
  }
  if (endpoint.endsWith("/spielplan")) {
    const counts = { acknowledged: 1, saison_id: SAISON_ID, spieltage: 3, spiele: 12 };
    return method === "DELETE"
      ? { ...counts, watermark_cleared: true }
      : { ...counts, generiert_am: "2026-03-01", removed_spieltage: 3, removed_spiele: 12 };
  }
  return { acknowledged: 1, updated_document: stored };
}

describe("the season's writes", () => {
  it("reach each published path and method, the id in the path and the fields alone in the body", async () => {
    answerWith((call) => Promise.resolve(landed(call)));

    await postSaisonAction(SAISON);
    await patchSaisonAction(SAISON);
    await activateSaisonAction({ id: SAISON_ID });
    await generateSpielplanAction({ id: SAISON_ID, replace: true });
    await undrawSpielplanAction({ id: SAISON_ID });
    await swapGruppenAction({ saison_id: SAISON_ID, team1_id: TEAM1_ID, team2_id: TEAM2_ID });

    const { id, ...fields } = SAISON;
    assert.deepEqual(requestsOf(calls), [
      { endpoint: "/saisons", method: "POST", body: SAISON },
      { endpoint: `/saisons/${id}`, method: "PATCH", body: fields },
      { endpoint: `/saisons/${id}/activate`, method: "POST", body: undefined },
      { endpoint: `/saisons/${id}/spielplan`, method: "POST", body: { replace: true } },
      { endpoint: `/saisons/${id}/spielplan`, method: "DELETE", body: undefined },
      { endpoint: `/saisons/${id}/gruppen/swap`, method: "POST", body: { team1_id: TEAM1_ID, team2_id: TEAM2_ID } },
    ]);
  });
});

describe("the saison actions against the codes their endpoints publish", () => {
  /* The create answers its own set alone, though `POST /saisons` prefixes two other operations. The
     rules come first: a rule reported as a taken id names a field that cannot repair it. */
  it("answers every refusal the create publishes, the rules before the taken id", async () => {
    assert.deepEqual(
      publishedRefusals(CREATE_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-DATE-005", "REQ-RULES-001", "REQ-RULES-007", "REQ-RULES-008", "REQ-RULES-010", "REQ-RULES-013"],
    );
    await assertEachAnswered({
      operation: CREATE_OPERATION,
      refuseWith: answerWith,
      act: () => postSaisonAction(SAISON),
      mapped: (refusal) => mapRulesRefusal(refusal) ?? mapSaisonIdRefusal(refusal),
    });
  });

  /* `DB-COMMON-002` is the unique index refusing a duplicate `_id`, which names no rule: the rules
     mapper leaves it to the create's own fallback on the id box, and an arm added there would swallow it. */
  it("leaves a duplicate season id to the create's own fallback", () => {
    assert.equal(
      mapRulesRefusal(refusedOn(CREATE_OPERATION, DUPLICATE_KEY)),
      null,
      "the mapper claims the duplicate id and the fallback never runs",
    );

    const taken = mapSaisonIdRefusal(refusedOn(CREATE_OPERATION, DUPLICATE_KEY));
    assert.match(taken?.error ?? "", /Diese Saison-ID ist schon vergeben/);
    assert.deepEqual(taken?.fieldErrors, { id: taken?.error }, "the taken-id message no longer reaches the id field the admin has to change");
  });

  /* The same mapper serves the edit, so a code missing from it is rethrown as the generic conflict
     message rather than reaching the panel that still holds the wrong value. */
  it("answers every refusal the edit publishes", async () => {
    assert.deepEqual(publishedRefusals(EDIT_OPERATION), [
      "REQ-DATE-004",
      "REQ-DATE-005",
      "REQ-RULES-001",
      "REQ-RULES-002",
      "REQ-RULES-003",
      "REQ-RULES-004",
      "REQ-RULES-005",
      "REQ-RULES-006",
      "REQ-RULES-007",
      "REQ-RULES-008",
      "REQ-RULES-009",
      "REQ-RULES-010",
      "REQ-RULES-011",
      "REQ-RULES-012",
      "REQ-RULES-013",
    ]);
    for (const code of publishedRefusals(EDIT_OPERATION)) {
      assert.notEqual(answerShown(EDIT_OPERATION, code, mapRulesRefusal), null, `${code} reaches the admin as a generic conflict`);
    }
    await assertEachAnswered({
      operation: EDIT_OPERATION,
      refuseWith: answerWith,
      act: () => patchSaisonAction(SAISON),
      mapped: mapRulesRefusal,
    });
  });

  it("answers every refusal the rollover publishes", async () => {
    assert.deepEqual(
      publishedRefusals(ACTIVATE_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-ACTIVATE-001", "REQ-ACTIVATE-002", "REQ-ACTIVATE-003", "REQ-ACTIVATE-004"],
    );
    for (const code of publishedRefusals(ACTIVATE_OPERATION)) {
      assert.notEqual(answerShown(ACTIVATE_OPERATION, code, mapActivateRefusal), null, `${code} reaches the admin as a generic failure`);
    }
    await assertEachAnswered({
      operation: ACTIVATE_OPERATION,
      refuseWith: answerWith,
      act: () => activateSaisonAction({ id: SAISON_ID }),
      mapped: mapActivateRefusal,
    });
  });

  it("answers every refusal the group swap publishes", async () => {
    for (const code of publishedRefusals(SWAP_OPERATION)) {
      assert.notEqual(answerShown(SWAP_OPERATION, code, mapSwapRefusal), null, `${code} reaches the admin as a generic failure`);
    }
    await assertEachAnswered({
      operation: SWAP_OPERATION,
      refuseWith: answerWith,
      act: () => swapGruppenAction({ saison_id: SAISON_ID, team1_id: "68c1f0a2b3c4d5e6f7a8b9c0", team2_id: "68c1f0a2b3c4d5e6f7a8b9c1" }),
      mapped: mapSwapRefusal,
    });
  });

  /* One club named on both sides has a code of its own, which only a stale picker sends: it is worded
     as a pair standing in one group is, with the same reload. */
  it("words one club named on both sides as the pair gone stale", () => {
    assert.equal(mapSwapRefusal(refusedOn(SWAP_OPERATION, "REQ-SWAP-007")), mapSwapRefusal(refusedOn(SWAP_OPERATION, "REQ-SWAP-001")));
    assert.notEqual(mapSwapRefusal(refusedOn(SWAP_OPERATION, "REQ-SWAP-007")), null);
  });

  it("answers every refusal the draw publishes, the shared rules faults included", async () => {
    assert.deepEqual(
      publishedRefusals(DRAW_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      [
        // The draw is a second writer of `rules`, so a shape it stores can imply more matchdays than
        // the season has days. It measures the span for that, as the create and the edit do.
        "REQ-DATE-009",
        // A shape this request carried; the three below from `-014` are the same rules over the
        // stored numbers, and each code's answer names its own panel.
        "REQ-RULES-001",
        "REQ-RULES-007",
        "REQ-RULES-013",
        "REQ-RULES-014",
        "REQ-RULES-015",
        "REQ-RULES-016",
        "REQ-RULES-017",
        "REQ-RULES-018",
        "REQ-SPIELPLAN-001",
        "REQ-SPIELPLAN-002",
        "REQ-SPIELPLAN-003",
        "REQ-SPIELPLAN-004",
        "REQ-SPIELPLAN-005",
      ],
    );
    for (const code of publishedRefusals(DRAW_OPERATION)) {
      for (const carriedShape of [false, true]) {
        const answered = answerShown(DRAW_OPERATION, code, (error) => mapSpielplanRefusal(error, carriedShape));
        assert.notEqual(answered, null, `${code} reaches the admin as a generic failure`);
      }
    }
  });

  /* Which panel the answer sends the admin to follows the request: a first draw carries no numbers,
     a replace carries its own, and the action reads that off what it sent. */
  it("answers the draw's refusals for the panel the request took its numbers from", async () => {
    const { number_of_groups, teams_per_group, qualifiers_per_group } = RULES;

    for (const [payload, carriedShape] of [
      [{ id: SAISON_ID }, false],
      [{ id: SAISON_ID, replace: true, shape: { number_of_groups, teams_per_group, qualifiers_per_group } }, true],
    ] as const) {
      await assertEachAnswered({
        operation: DRAW_OPERATION,
        refuseWith: answerWith,
        act: () => generateSpielplanAction(payload),
        mapped: (refusal) => mapSpielplanRefusal(refusal, carriedShape),
      });
    }
  });

  /* One code, and none of the draw's: the two share a path and a summary word, so a document read
     that leaked either way would leave a real refusal answered by the generic failure message. */
  it("answers every refusal the undraw publishes", async () => {
    assert.deepEqual(publishedRefusals(UNDRAW_OPERATION), ["REQ-SPIELPLAN-006"]);
    for (const code of publishedRefusals(UNDRAW_OPERATION)) {
      assert.notEqual(answerShown(UNDRAW_OPERATION, code, mapUndrawRefusal), null, `${code} reaches the admin as a generic failure`);
    }
    await assertEachAnswered({
      operation: UNDRAW_OPERATION,
      refuseWith: answerWith,
      act: () => undrawSpielplanAction({ id: SAISON_ID }),
      mapped: mapUndrawRefusal,
    });
  });
});

describe("the undraw action", () => {
  /* The removal takes away exactly what the draw wrote, so anything the draw's write invalidated
     answers differently after this too. A narrower set leaves a cached season holding fixtures. */
  it("clears the draw's own tag set", async () => {
    /** Every invalidation the last press made, in its order. */
    const cleared = (): typeof cacheCalls => cacheCalls.splice(0);

    answerWith(() =>
      Promise.resolve({
        acknowledged: 1,
        saison_id: SAISON_ID,
        spieltage: 3,
        spiele: 12,
        generiert_am: "2026-03-01",
        removed_spieltage: 0,
        removed_spiele: 0,
      }),
    );
    assert.equal((await generateSpielplanAction({ id: SAISON_ID })).success, true, "the draw never landed, so its tags are judged on nothing");
    // Spelled out rather than taken from the draw, so a set both presses lose, the refresh among it, fails.
    const DRAWN = [
      { name: "updateTag", args: ["saisons"] },
      { name: "updateTag", args: ["spieltage"] },
      { name: "updateTag", args: ["spiele"] },
      { name: "updateTag", args: [`spiele:saison_id:${SAISON_ID}`] },
      { name: "updateTag", args: ["teams"] },
      { name: "updateTag", args: [`teams:saison_id:${SAISON_ID}`] },
      { name: "refresh", args: [] },
    ];
    assert.deepEqual(cleared(), DRAWN, "the draw clears a set other than the reads it moves");

    answerWith(() => Promise.resolve({ acknowledged: 1, saison_id: SAISON_ID, spieltage: 3, spiele: 12, watermark_cleared: true }));
    assert.equal((await undrawSpielplanAction({ id: SAISON_ID })).success, true, "the undraw never landed, so its tags are judged on nothing");

    assert.deepEqual(cleared(), DRAWN, "the undraw clears a set other than the draw's");
    assert.deepEqual(requestsOf(calls), [
      { endpoint: `/saisons/${SAISON_ID}/spielplan`, method: "POST", body: {} },
      { endpoint: `/saisons/${SAISON_ID}/spielplan`, method: "DELETE", body: undefined },
    ]);
  });

  /* One sentence over the counts would report a watermark-only season as nothing done: it answers
     with two zeroes and `watermark_cleared`. */
  it("reports the three outcomes a 200 can carry apart", async () => {
    const undrawn = async (spieltage: number, spiele: number, watermark_cleared: boolean) => {
      answerWith(() => Promise.resolve({ acknowledged: 1, saison_id: SAISON_ID, spieltage, spiele, watermark_cleared }));
      const result = await undrawSpielplanAction({ id: SAISON_ID });
      assert.equal(result.success, true, result.success ? "" : result.error);
      return result.success ? (result.message ?? "") : "";
    };

    const messages = [await undrawn(3, 12, true), await undrawn(0, 0, true), await undrawn(0, 0, false)];

    assert.equal(new Set(messages).size, 3, "two of the outcomes read alike");
    assert.match(messages[0] ?? "", /Gelöscht wurden/);
    assert.match(messages[1] ?? "", /hielt weder Spieltage noch Spiele/);
    assert.match(messages[2] ?? "", /hatte keinen Spielplan mehr/);
  });

  /* This press is the half of `REQ-RULES-011`'s repair loop that reopens the three shape rules, so
     the message reporting it says where they and the clubs are changed before the redraw. */
  it("names where the reopened numbers and the clubs are changed", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 1, saison_id: SAISON_ID, spieltage: 3, spiele: 12, watermark_cleared: true }));

    const result = await undrawSpielplanAction({ id: SAISON_ID });

    assert.match(result.success ? (result.message ?? "") : result.error, /im Abschnitt Regeln ändern, die Teams über die Teamseite/);
  });

  /* The panel closes the control for both halves of `REQ-SPIELPLAN-006`, so the code can only arrive
     on a page that went stale. The reloaded panel names any way out, so a repair spelled here too
     could describe a state the season has already left. */
  it("tells a stale page to reload rather than naming a repair", () => {
    const message = mapUndrawRefusal(refusedOn(UNDRAW_OPERATION, "REQ-SPIELPLAN-006")) ?? "";

    assert.match(message, /geplante Saison/);
    assert.match(message, /Lade die Seite neu/);
    // The shared sentence rather than a copy: `fl_frontend/src/features/saisons/utils.test.ts` pins the
    // categories against their backend mirror, and a second spelling here could name a different set.
    assert.ok(message.includes(RECORDED_FACTS_NONE), "the refusal spells the recorded facts itself");
  });
});

describe("the German the shape freeze renders", () => {
  /* The authority is `SHAPE_RULES_FIELDS` and not the table above, so a fourth shape field fails here
     rather than leaving the case below looping over a set the write path has grown past. */
  it("names a phrase for exactly the fields the refusal freezes", () => {
    assert.ok(SHAPE_RULES_FIELDS.length > 0, "no shape field was read off the write path, so the cases below compare nothing");
    assert.deepEqual(Object.keys(GERMAN_OF).sort(), [...SHAPE_RULES_FIELDS].sort());
    assert.equal(new Set(Object.values(GERMAN_OF)).size, Object.keys(GERMAN_OF).length, "two fields share one phrase");
  });

  it("reads a phrase inside a longer German word as naming no field", () => {
    assert.ok(names("Gruppen", "Für Gruppen und Teams pro Gruppe"));
    assert.ok(!names("Gruppen", "Die Gruppenphase ist gesperrt"));
    assert.ok(!names("Qualifikant", "Die Qualifikanten pro Gruppe"));
  });

  /* A sentence naming some of the frozen fields reads as complete and is not: the admin reloads to a
     panel holding a field the sentence never said was closed. */
  it("names every field the refusal freezes", () => {
    const message = editBanner("REQ-RULES-011");

    for (const [field, german] of Object.entries(GERMAN_OF)) {
      assert.ok(names(german, message), `REQ-RULES-011 freezes ${field} and its message never names ${german}`);
    }
  });
});

describe("the German each widened refusal renders", () => {
  /* `REQ-DATE-005` refuses the season's SPAN against the matchdays its rules imply. The fallback an
     unmapped code falls through to blames the season id, which is neither the fault nor a repair. */
  it("names the span and its repairs for the schedule refusal, never the season id", () => {
    const message = editBanner("REQ-DATE-005");

    assert.match(message, /Zeitraum/);
    assert.match(message, /Enddatum/);
    assert.match(message, /Startdatum/);
    assert.doesNotMatch(message, /Saison-ID/);
  });

  /* The editor's `REQ-DATE-005` and the draw's `REQ-DATE-009` are one rule, so a sentence written
     twice could tell two admins two different things about it. Each path adds its own tail and shares
     the opening. */
  it("opens the schedule refusal with one sentence on both paths", () => {
    const opening = (message: string): string => message.split(". ")[0] ?? "";
    const editor = editBanner("REQ-DATE-005");

    assert.notEqual(opening(editor), "", "the editor words no opening for the schedule refusal");
    for (const carriedShape of [false, true]) {
      assert.equal(
        opening(drawAnswer("REQ-DATE-009", carriedShape)),
        opening(editor),
        "the draw opens the schedule refusal apart from the editor",
      );
    }
  });

  /* A bare `error`, like the two freezes: several fields could repair it and none of them is at
     fault, so a `fieldErrors` key would seat the sentence under a value that is not the problem. */
  it("seats the schedule refusal under no field", () => {
    assert.equal(mapRulesRefusal(refusedOn(EDIT_OPERATION, "REQ-DATE-005"))?.fieldErrors, undefined);
  });

  /* Neither rules field repairs this in every state: `REQ-RULES-005` freezes `qualifiers_per_group`
     on a past season, and `fl_backend/app/api/saisons/schedule.py :: group_matchdays` is flat from an
     even `teams_per_group` down to the odd one. */
  it("offers no rules field as a repair for the schedule refusal", () => {
    for (const text of [editBanner("REQ-DATE-005"), drawAnswer("REQ-DATE-009", false), drawAnswer("REQ-DATE-009", true)]) {
      assert.doesNotMatch(text, /Qualifikanten/);
      assert.doesNotMatch(text, /Teams pro Gruppe/);
    }
  });

  /* The draw carries its own three numbers on a replace and none on a first draw, so the panel the
     second repair names moves with the request. Hardcode either and half the admins are misdirected. */
  it("sends the draw's schedule refusal to the panel that holds the numbers it was judged on", () => {
    assert.match(drawAnswer("REQ-DATE-009", true), /Abschnitt Spielplan/);
    assert.match(drawAnswer("REQ-DATE-009", false), /Abschnitt Regeln/);
    // Neither tail sends the admin to change a number: the dates are the repair that works whatever
    // the numbers are.
    for (const carriedShape of [false, true]) assert.doesNotMatch(drawAnswer("REQ-DATE-009", carriedShape), /Ändere die Zahlen/);
  });

  /* The backend answers a carried shape and the stored rules under different codes, so the code alone
     names the panel holding the numbers it judged, whatever the action read off its request. */
  it("sends each shape fault to the panel holding the numbers its code judged", () => {
    for (const [carried, stored] of [
      ["REQ-RULES-001", "REQ-RULES-014"],
      ["REQ-RULES-007", "REQ-RULES-015"],
      ["REQ-RULES-013", "REQ-RULES-018"],
    ] as const) {
      for (const carriedShape of [false, true]) {
        assert.match(drawAnswer(carried, carriedShape), /Abschnitt Spielplan/, `${carried} sends the admin away from the numbers it judged`);
        assert.match(drawAnswer(stored, carriedShape), /Abschnitt Regeln/, `${stored} sends the admin away from the numbers it judged`);
      }
    }
  });

  /* A draw never carries the points or the forfeit, so its twins of the editor's two faults state the
     editor's own rule and send the admin to the panel holding it. */
  it("states the editor's points and forfeit rules on the draw, repaired in the rules panel", () => {
    for (const [edit, draw, field] of [
      ["REQ-RULES-008", "REQ-RULES-016", "rules.draw_points"],
      ["REQ-RULES-010", "REQ-RULES-017", "rules.forfeit_ergebnis.sieger_tore"],
    ] as const) {
      const rule = mapRulesRefusal(refusedOn(EDIT_OPERATION, edit))?.fieldErrors?.[field] ?? "";

      assert.notEqual(rule, "", `the editor seats no rule for ${edit}, so ${draw} is compared with nothing`);
      for (const carriedShape of [false, true]) {
        assert.ok(drawAnswer(draw, carriedShape).startsWith(rule), `${draw} words its rule apart from ${edit}`);
        assert.match(drawAnswer(draw, carriedShape), /Abschnitt Regeln/);
      }
    }
  });

  /* `REQ-SPIELPLAN-003` refuses `past` alone, so the message may not send the admin looking for a
     season that is still merely geplant. */
  it("names a finished season for the draw's status refusal, never a planned one", () => {
    const message = drawAnswer("REQ-SPIELPLAN-003", false);

    assert.match(message, /abgeschlossen/);
    assert.doesNotMatch(message, /geplant/);
  });

  /* `REQ-SPIELPLAN-004` refuses a group off its size in EITHER direction, and a club standing in a
     group the season does not offer. A message naming only the short direction misdirects both. */
  it("covers all three shapes of the draw's group refusal", () => {
    assert.match(GRUPPEN_OFF_RULES, /genau so viele Teams/);
    assert.match(GRUPPEN_OFF_RULES, /nicht anbietet/);
  });

  /* Spelled a second time and the closed press, which reads the declaration, says something the
     refusal does not. */
  it("answers the draw's group refusal with the declaration the closed press reads", () => {
    for (const carriedShape of [false, true]) assert.equal(drawAnswer("REQ-SPIELPLAN-004", carriedShape), GRUPPEN_OFF_RULES);
  });

  /* `REQ-ACTIVATE-003` is the one activation refusal with a remedy the admin can act on here. */
  it("names the draw as the remedy for a rollover onto an undrawn season", () => {
    assert.match(mapActivateRefusal(refusedOn(ACTIVATE_OPERATION, "REQ-ACTIVATE-003")) ?? "", /Spielplan/);
  });

  /* The pre-flight's own case compares the same declaration by calling. */
  it("answers the undated-matchday refusal with the declaration the closed press reads", () => {
    assert.equal(mapActivateRefusal(refusedOn(ACTIVATE_OPERATION, "REQ-ACTIVATE-004")), SPIELTAGE_UNDATED);
  });
});

const LAUF = "/identitaet/loeschung/lauf";

/** The activation's own message where it closed one season, as `landed` answers it. */
const AKTIVIERT = `Saison ${SAISON_ID} ist jetzt aktiv. Die vorherige Saison ist abgeschlossen.`;

/** One call of the deletion: whom it erased, and who is still due after it. */
const gelaufen = (spieler: number, verbleibend: number, seit: string | null = "2025") => ({
  acknowledged: 1,
  abgeschlossene_saison_id: seit,
  spieler: spieler,
  saison_spieler: spieler * 2,
  registrierungen: 0,
  uebersprungen: 0,
  fehlgeschlagen: 0,
  verbleibend: verbleibend,
});

/** The activation landing, then each deletion call answered by the next of `laeufe`, the last repeating. */
function aktivierungUndLaeufe(...laeufe: (() => Promise<unknown>)[]): void {
  let lauf = 0;
  answerWith((call) => {
    if (call.endpoint !== LAUF) return Promise.resolve(landed(call));
    const antwort = laeufe[Math.min(lauf, laeufe.length - 1)] ?? (() => Promise.resolve(gelaufen(0, 0)));
    lauf += 1;
    return antwort();
  });
}

const laeufe = (): number => calls.filter(({ endpoint }) => endpoint === LAUF).length;

/** The message of a press the action answered as saved, or a failure naming what it answered instead. */
async function umgestellt(): Promise<string> {
  const result = await activateSaisonAction({ id: SAISON_ID });
  assert.equal(result.success, true, `the activation answered ${JSON.stringify(result)}`);
  return result.success ? (result.message ?? "") : "";
}

describe("the deletion the activation runs", () => {
  beforeEach(() => {
    loeschungSwitch = "on";
  });

  /* The spine drops the tags once the body settles: a run behind the answer lands after the drop, and a squad page
     names deleted pupils for days. One list reads the order rather than assuming it. */
  it("runs after the activation until nobody is due, every tag dropped after the last run's answer", async () => {
    const order: string[] = [];
    let gelesen = 0;
    const nachtragen = (): void => {
      for (const { name, args } of cacheCalls.slice(gelesen)) order.push(`${name}(${args.join(", ")})`);
      gelesen = cacheCalls.length;
    };
    const laeufeAntworten = [gelaufen(2, 1), gelaufen(1, 0)];
    answerWith(async (call) => {
      nachtragen();
      if (call.endpoint !== LAUF) {
        order.push(`${call.method ?? "GET"} ${call.endpoint}`);
        return landed(call);
      }
      const antwort = laeufeAntworten.shift() ?? gelaufen(0, 0);
      // A turn of the event loop before the answer lands, so a drop that does not wait on it runs first.
      await new Promise((resolve) => setImmediate(resolve));
      order.push(`answered ${call.endpoint}`);
      return antwort;
    });

    const message = await umgestellt();
    nachtragen();

    assert.deepEqual(order, [
      `POST /saisons/${SAISON_ID}/activate`,
      `answered ${LAUF}`,
      `answered ${LAUF}`,
      "updateTag(saisons)",
      "updateTag(spiele)",
      "updateTag(spieltage)",
      "updateTag(teams)",
      "updateTag(spieler)",
      "refresh()",
    ]);
    assert.equal(message, `${AKTIVIERT} 3 Spielerinnen und Spieler ohne Kadereintrag seit Saison 2025 wurden gelöscht.`);
  });

  it("calls nothing more and answers as before where the switch is off", async () => {
    loeschungSwitch = "off";
    aktivierungUndLaeufe(() => Promise.resolve(gelaufen(2, 0)));

    assert.equal(await umgestellt(), AKTIVIERT);
    assert.equal(laeufe(), 0, "the switch reads off and the press deleted");
  });

  it("deletes nobody where the activation was refused or not acknowledged", async () => {
    answerWith((call) =>
      call.endpoint === LAUF ? Promise.resolve(gelaufen(1, 0)) : Promise.reject(refusedOn(ACTIVATE_OPERATION, "REQ-ACTIVATE-001")),
    );
    assert.equal((await activateSaisonAction({ id: SAISON_ID })).success, false);

    answerWith((call) => Promise.resolve(call.endpoint === LAUF ? gelaufen(1, 0) : { ...landed(call), acknowledged: 0 }));
    assert.equal((await activateSaisonAction({ id: SAISON_ID })).success, false);

    assert.equal(laeufe(), 0, "a season that did not turn active had its pupils deleted");
  });

  /* The activation is saved and stays so: answered as failed, the administrator presses again and a stale page
     refuses, or answers a rollover nobody repeated. */
  for (const [fall, fehler] of [
    [
      "a run the backend answers 500",
      () =>
        new APIBadStatusError({
          message: "API returned a bad status.",
          url: "http://backend:8000",
          statusCode: 500,
          serverErrorCode: "DB-FAIL-001",
          endpoint: LAUF,
          method: "POST",
          readOnly: false,
          traceId: "t".repeat(32),
        }),
    ],
    [
      "a run the network broke off",
      () =>
        new APINetworkError({
          message: "Request failed.",
          url: "http://backend:8000",
          method: "POST",
          readOnly: false,
          traceId: "t".repeat(32),
          isTimeout: false,
        }),
    ],
  ] as const) {
    it(`answers the activation saved after ${fall}, says what the hourly pass finishes, and still drops the tags`, async () => {
      aktivierungUndLaeufe(
        () => Promise.resolve(gelaufen(1, 4)),
        () => Promise.reject(fehler()),
      );

      const message = await umgestellt();

      assert.equal(
        message,
        `${AKTIVIERT} Eine Spielerin oder ein Spieler ohne Kadereintrag seit Saison 2025 wurde gelöscht. ` +
          "Die Löschung ist nicht vollständig durchgelaufen. Was noch aussteht, löscht der nächste stündliche Durchlauf.",
      );
      assert.ok(
        cacheCalls.some(({ name, args }) => name === "updateTag" && args[0] === "spieler"),
        "the deletion that did land left the squad pages naming its pupils",
      );
      assert.deepEqual(
        loggedLines.filter(({ message: line }) => line === "loeschung.umstellung_failed"),
        [{ level: "error", message: "loeschung.umstellung_failed", meta: { error_code: "FE-SWEEP-001", name: fehler().name } }],
      );
    });
  }

  /* A person whose erasure fails stays due, and every call meets them again: the run ends on the call erasing
     nobody. The answers bound the run, so a loop on `verbleibend` alone fails here rather than hanging. */
  it("ends the run on a call that erased nobody, and says what remains", async () => {
    aktivierungUndLaeufe(
      () => Promise.resolve(gelaufen(2, 3)),
      () => Promise.resolve(gelaufen(0, 3)),
      () => Promise.resolve(gelaufen(0, 3)),
      () => Promise.resolve(gelaufen(0, 0)),
    );

    const message = await umgestellt();

    assert.equal(laeufe(), 2, "the run went on past a call that erased nobody");
    assert.equal(
      message,
      `${AKTIVIERT} 2 Spielerinnen und Spieler ohne Kadereintrag seit Saison 2025 wurden gelöscht. 3 weitere Löschungen stehen noch aus.`,
    );
  });

  it("words one deleted pupil and one remaining in the singular", async () => {
    aktivierungUndLaeufe(
      () => Promise.resolve(gelaufen(1, 1)),
      () => Promise.resolve(gelaufen(0, 1)),
    );

    assert.equal(
      await umgestellt(),
      `${AKTIVIERT} Eine Spielerin oder ein Spieler ohne Kadereintrag seit Saison 2025 wurde gelöscht. Eine weitere Löschung steht noch aus.`,
    );
  });

  /* No season `past`, as on the league's first activation: nobody is due, and a sentence counting zero reads as a
     deletion that went wrong. */
  it("adds nothing to the message where nobody was due", async () => {
    aktivierungUndLaeufe(() => Promise.resolve(gelaufen(0, 0, null)));

    assert.equal(await umgestellt(), AKTIVIERT);
    assert.equal(laeufe(), 1);
  });
});
