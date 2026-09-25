import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { withoutPythonComments } from "@/core/pythonComments.ts";
import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { GRUPPEN_OFF_RULES, RECORDED_FACTS_NONE, SPIELTAGE_UNDATED } from "./constants.ts";
import { mapActivateRefusal, mapRulesRefusal, mapSaisonIdRefusal, mapSpielplanRefusal, mapSwapRefusal, mapUndrawRefusal } from "./refusals.ts";

import type { FLSaisonRules } from "./schemas.ts";

/* The real actions and their mutations, called: the request they run in and the backend client are the doubles. */
doubleActionRequest();
const { answerWith } = doubleApiAnswers();
const { activateSaisonAction, generateSpielplanAction, patchSaisonAction, postSaisonAction, swapGruppenAction, undrawSpielplanAction } =
  await import("./actions.ts");

const CREATE_OPERATION = "POST /saisons";
const EDIT_OPERATION = "PATCH /saisons/{saison_id}";
const ACTIVATE_OPERATION = "POST /saisons/{saison_id}/activate";
const DRAW_OPERATION = "POST /saisons/{saison_id}/spielplan";
const UNDRAW_OPERATION = "DELETE /saisons/{saison_id}/spielplan";
const SWAP_OPERATION = "POST /saisons/{saison_id}/gruppen/swap";

const SAISON_ID = "2026";

const RULES: FLSaisonRules = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  max_kadergroesse: 18,
  tiebreak_order: "tordifferenz",
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "Q1"],
};

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
    assert.deepEqual(
      publishedRefusals(EDIT_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      [
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
      ],
    );
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
        // the season has days. It measures the span for that, exactly as the create and the edit do.
        "REQ-DATE-005",
        "REQ-RULES-001",
        "REQ-RULES-007",
        "REQ-RULES-008",
        "REQ-RULES-010",
        "REQ-RULES-013",
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
    assert.deepEqual(
      publishedRefusals(UNDRAW_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-SPIELPLAN-006"],
    );
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
      Promise.resolve({ acknowledged: 1, saison_id: SAISON_ID, spieltage: 3, spiele: 12, removed_spieltage: 0, removed_spiele: 0 }),
    );
    assert.equal((await generateSpielplanAction({ id: SAISON_ID })).success, true, "the draw never landed, so its tags are judged on nothing");
    const drawn = cleared();

    answerWith(() => Promise.resolve({ acknowledged: 1, saison_id: SAISON_ID, spieltage: 3, spiele: 12, watermark_cleared: true }));
    assert.equal((await undrawSpielplanAction({ id: SAISON_ID })).success, true, "the undraw never landed, so its tags are judged on nothing");

    assert.ok(
      drawn.some(({ name }) => name === "updateTag"),
      "the draw cleared no tag, so the two are compared over nothing",
    );
    assert.deepEqual(cleared(), drawn);
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

  /* Several endpoints refuse on this code, so a sentence written twice could tell two admins two
     different things about one rule. Each path adds its own tail and shares the opening. */
  it("opens the schedule refusal with one sentence on both paths", () => {
    const opening = (message: string): string => message.split(". ")[0] ?? "";
    const editor = editBanner("REQ-DATE-005");

    assert.notEqual(opening(editor), "", "the editor words no opening for the schedule refusal");
    for (const carriedShape of [false, true]) {
      assert.equal(
        opening(drawAnswer("REQ-DATE-005", carriedShape)),
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
    for (const text of [editBanner("REQ-DATE-005"), drawAnswer("REQ-DATE-005", false), drawAnswer("REQ-DATE-005", true)]) {
      assert.doesNotMatch(text, /Qualifikanten/);
      assert.doesNotMatch(text, /Teams pro Gruppe/);
    }
  });

  /* The draw carries its own three numbers on a replace and none on a first draw, so the panel the
     second repair names moves with the request. Hardcode either and half the admins are misdirected. */
  it("sends the draw's schedule refusal to the panel that holds the numbers it was judged on", () => {
    assert.match(drawAnswer("REQ-DATE-005", true), /Abschnitt Spielplan/);
    assert.match(drawAnswer("REQ-DATE-005", false), /Abschnitt Regeln/);
    // Neither tail sends the admin to change a number: the dates are the repair that works whatever
    // the numbers are.
    for (const carriedShape of [false, true]) assert.doesNotMatch(drawAnswer("REQ-DATE-005", carriedShape), /Ändere die Zahlen/);
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
