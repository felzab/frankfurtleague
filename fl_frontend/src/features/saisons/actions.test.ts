import { cacheCalls, doubleActionRequest, loggedLines } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, refusalCodes, refused } from "@/test-support/refusals.ts";
import { saisonRules } from "@/test-support/saisonRules.ts";
import { assert, describe, expect, it } from "vitest";

import { SITE_CACHE_TAG } from "@/core/siteCache.ts";
import { TEAMS_EINTRAG } from "@/features/admin/constants.ts";

import { GRUPPEN_OFF_RULES, RECORDED_FACTS_NONE, REGELN_ABSCHNITT, SPIELTAGE_UNDATED } from "./constants.ts";
import { mapActivateRefusal, mapRulesRefusal, mapSaisonIdRefusal, mapSpielplanRefusal, mapSwapRefusal, mapUndrawRefusal } from "./refusals.ts";

import type { Code, FLSaisonRules } from "@/core/generated/client/types.ts";
import type { ApiCall } from "@/test-support/apiClientDouble.ts";

/* The real actions and their mutations, called: the request they run in and the backend client are the doubles. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers();
const { activateSaisonAction, generateSpielplanAction, patchSaisonAction, postSaisonAction, swapGruppenAction, undrawSpielplanAction } =
  await import("./actions.ts");
const { APIBadStatusError, APINetworkError } = await import("@/core/errors.ts");

const SAISON_ID = "2026";

const RULES: FLSaisonRules = saisonRules();

/** A season both schemas take as it stands, so each write reaches the doubled request rather than the parse. */
const SAISON = { id: SAISON_ID, start_date: "2026-03-01", end_date: "2026-07-01", rules: RULES, bewerbung: null, registrierung: null };

/** The draw's answer on a first draw (`false`) or a replace carrying its own numbers (`true`). */
const drawAnswer = (code: Code, carriedShape: boolean): string => mapSpielplanRefusal(refused(code), carriedShape) ?? "";

/** The editor's banner for one code, where it words one rather than seating it under a field. */
const editBanner = (code: Code): string => mapRulesRefusal(refused(code))?.error ?? "";

/* One German noun phrase per frozen field. The refusal states the freeze in one sentence, so a
   further shape field the write path adds and this table leaves out goes unnamed and fails nothing here. */
const GERMAN_OF: Record<string, string> = {
  number_of_gruppen: "Gruppen",
  teams_per_gruppe: "Teams pro Gruppe",
  qualifiers_per_gruppe: "Qualifikanten",
};

/**
 * Whether one phrase stands in a text as a whole word. German compounds a term into a longer word
 * meaning something else, so „Gruppenphase“ satisfies a substring search for the group COUNT.
 */
const names = (german: string, text: string): boolean => new RegExp(`(?<!\\p{L})${german}(?!\\p{L})`, "u").test(text);

const TEAM1_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const TEAM2_ID = "68c1f0a2b3c4d5e6f7a8b9c1";

/** Each write's answer as the backend sends it where the write landed. */
function landed({ endpoint, method }: ApiCall): Record<string, unknown> | null {
  if (endpoint === "/saisons") return { created_id: SAISON_ID };
  if (endpoint.endsWith("/activate")) return { deactivated: 1 };
  if (endpoint.endsWith("/gruppen/swap")) {
    return {
      saison_id: SAISON_ID,
      team1_id: TEAM1_ID,
      team1_gruppe: "B",
      team2_id: TEAM2_ID,
      team2_gruppe: "A",
      rewritten_spiele: 0,
    };
  }
  if (endpoint.endsWith("/spielplan")) {
    const counts = { saison_id: SAISON_ID, spieltage: 3, spiele: 12 };
    return method === "DELETE"
      ? { ...counts, watermark_cleared: true }
      : { ...counts, generiert_am: "2026-03-01", removed_spieltage: 3, removed_spiele: 12 };
  }
  // The rules' save, which answers 204 and no body.
  return null;
}

describe("the season's writes", () => {
  it("reach each published path and method, the id in the path and the fields alone in the body", async () => {
    // The activation runs the pupils' deletion after it, which this case answers as having deleted nobody.
    answerWith((call) => Promise.resolve(call.endpoint === LAUF ? gelaufen(0, 0) : landed(call)));

    await postSaisonAction(SAISON);
    await patchSaisonAction(SAISON);
    await activateSaisonAction({ id: SAISON_ID });
    await generateSpielplanAction({ id: SAISON_ID, replace: true });
    await undrawSpielplanAction({ id: SAISON_ID });
    await swapGruppenAction({ saison_id: SAISON_ID, team1_id: TEAM1_ID, team2_id: TEAM2_ID });

    const { id, ...fields } = SAISON;
    expect(requestsOf(calls)).toStrictEqual([
      { endpoint: "/saisons", method: "POST", body: SAISON },
      { endpoint: `/saisons/${id}`, method: "PATCH", body: fields },
      { endpoint: `/saisons/${id}/activate`, method: "POST", body: undefined },
      { endpoint: LAUF, method: "POST", body: undefined },
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
    await assertEachAnswered({
      codes: refusalCodes(
        "duplicate_key",
        "saison_span_below_spielplan",
        "rules_bracket_impossible",
        "rules_qualifiers_above_gruppe",
        "rules_unentschieden_outvalues_win",
        "rules_forfeit_unentschieden_in_a_knockout",
        "rules_spiele_over_one_read",
      ),
      refuseWith: answerWith,
      act: () => postSaisonAction(SAISON),
      mapped: (refusal) => mapRulesRefusal(refusal) ?? mapSaisonIdRefusal(refusal),
    });
  });

  /* `duplicate_key` is the unique index refusing a duplicate `_id`, which names no rule: the rules
     mapper leaves it to the create's own fallback on the id box, and an arm added there would swallow it. */
  it("leaves a duplicate season id to the create's own fallback", () => {
    expect(mapRulesRefusal(refused(DUPLICATE_KEY)), "the mapper claims the duplicate id and the fallback never runs").toBe(null);

    const taken = mapSaisonIdRefusal(refused(DUPLICATE_KEY));
    expect(taken?.error ?? "").toMatch(/Diese Saison-ID ist schon vergeben/);
    expect(taken?.fieldErrors, "the taken-id message no longer reaches the id field the admin has to change").toStrictEqual({
      id: taken?.error,
    });
  });

  /* The same mapper serves the edit, so a code missing from it is rethrown as the generic conflict
     message rather than reaching the panel that still holds the wrong value. */
  it("answers every refusal the edit publishes", async () => {
    for (const code of refusalCodes(
      "saison_span_below_spieltage",
      "saison_span_below_spielplan",
      "rules_bracket_impossible",
      "rules_gruppen_in_use",
      "rules_capacity_below_use",
      "rules_qualifiers_below_wiring",
      "rules_saison_started",
      "rules_spieltag_over_its_phase",
      "rules_qualifiers_above_gruppe",
      "rules_unentschieden_outvalues_win",
      "rules_kader_below_use",
      "rules_forfeit_unentschieden_in_a_knockout",
      "rules_shape_after_spielplan",
      "rules_spiele_over_one_read",
    )) {
      expect(answerShown(code, mapRulesRefusal), `${code} reaches the admin as a generic conflict`).not.toBe(null);
    }
    await assertEachAnswered({
      codes: refusalCodes(
        "saison_span_below_spieltage",
        "saison_span_below_spielplan",
        "rules_bracket_impossible",
        "rules_gruppen_in_use",
        "rules_capacity_below_use",
        "rules_qualifiers_below_wiring",
        "rules_saison_started",
        "rules_spieltag_over_its_phase",
        "rules_qualifiers_above_gruppe",
        "rules_unentschieden_outvalues_win",
        "rules_kader_below_use",
        "rules_forfeit_unentschieden_in_a_knockout",
        "rules_shape_after_spielplan",
        "rules_spiele_over_one_read",
      ),
      refuseWith: answerWith,
      act: () => patchSaisonAction(SAISON),
      mapped: mapRulesRefusal,
    });
  });

  it("answers every refusal the rollover publishes", async () => {
    for (const code of refusalCodes(
      "duplicate_key",
      "activate_saison_unfinished",
      "saison_past",
      "activate_target_undrawn",
      "activate_spieltage_undated",
    )) {
      expect(answerShown(code, mapActivateRefusal), `${code} reaches the admin as a generic failure`).not.toBe(null);
    }
    await assertEachAnswered({
      codes: refusalCodes(
        "duplicate_key",
        "activate_saison_unfinished",
        "saison_past",
        "activate_target_undrawn",
        "activate_spieltage_undated",
      ),
      refuseWith: answerWith,
      act: () => activateSaisonAction({ id: SAISON_ID }),
      mapped: mapActivateRefusal,
    });
  });

  it("answers every refusal the group swap publishes", async () => {
    for (const code of refusalCodes(
      "swap_not_a_swap",
      "swap_saison_started",
      "saison_past",
      "swap_spieltag_clash",
      "swap_fields_disqualified",
    )) {
      expect(answerShown(code, mapSwapRefusal), `${code} reaches the admin as a generic failure`).not.toBe(null);
    }
    await assertEachAnswered({
      codes: refusalCodes("swap_not_a_swap", "swap_saison_started", "saison_past", "swap_spieltag_clash", "swap_fields_disqualified"),
      refuseWith: answerWith,
      act: () => swapGruppenAction({ saison_id: SAISON_ID, team1_id: "68c1f0a2b3c4d5e6f7a8b9c0", team2_id: "68c1f0a2b3c4d5e6f7a8b9c1" }),
      mapped: mapSwapRefusal,
    });
  });

  it("answers every refusal the draw publishes, the shared rules faults included", async () => {
    for (const code of refusalCodes(
      "duplicate_key",
      "saison_span_below_spielplan_as_stored",
      "rules_bracket_impossible",
      "rules_qualifiers_above_gruppe",
      "rules_spiele_over_one_read",
      "rules_forfeit_unentschieden_in_a_knockout_as_stored",
      "spielplan_already_drawn",
      "spielplan_spieltage_held",
      "saison_past",
      "spielplan_gruppen_off_rules",
      "spielplan_replace_outside_its_window",
      "spielplan_berichte_submitted",
    )) {
      for (const carriedShape of [false, true]) {
        const answered = answerShown(code, (error) => mapSpielplanRefusal(error, carriedShape));
        expect(answered, `${code} reaches the admin as a generic failure`).not.toBe(null);
      }
    }
  });

  /* Which panel the answer sends the admin to follows the request: a first draw carries no numbers,
     a replace carries its own, and the action reads that off what it sent. */
  it("answers the draw's refusals for the panel the request took its numbers from", async () => {
    const { number_of_gruppen: number_of_gruppen, teams_per_gruppe: teams_per_gruppe, qualifiers_per_gruppe: qualifiers_per_gruppe } = RULES;

    for (const [payload, carriedShape] of [
      [{ id: SAISON_ID }, false],
      [{ id: SAISON_ID, replace: true, shape: { number_of_gruppen, teams_per_gruppe, qualifiers_per_gruppe } }, true],
    ] as const) {
      await assertEachAnswered({
        codes: refusalCodes(
          "duplicate_key",
          "saison_span_below_spielplan_as_stored",
          "rules_bracket_impossible",
          "rules_qualifiers_above_gruppe",
          "rules_spiele_over_one_read",
          "rules_forfeit_unentschieden_in_a_knockout_as_stored",
          "spielplan_already_drawn",
          "spielplan_spieltage_held",
          "saison_past",
          "spielplan_gruppen_off_rules",
          "spielplan_replace_outside_its_window",
          "spielplan_berichte_submitted",
        ),
        refuseWith: answerWith,
        act: () => generateSpielplanAction(payload),
        mapped: (refusal) => mapSpielplanRefusal(refusal, carriedShape),
      });
    }
  });

  /* Its own two codes, none of the draw's: the two share a path and a summary word, so a document read leaking either
     way would leave a real refusal answered by the generic failure message. */
  it("answers every refusal the undraw publishes", async () => {
    for (const code of refusalCodes("spielplan_undraw_outside_its_window", "spielplan_berichte_submitted")) {
      expect(answerShown(code, mapUndrawRefusal), `${code} reaches the admin as a generic failure`).not.toBe(null);
    }
    await assertEachAnswered({
      codes: refusalCodes("spielplan_undraw_outside_its_window", "spielplan_berichte_submitted"),
      refuseWith: answerWith,
      act: () => undrawSpielplanAction({ id: SAISON_ID }),
      mapped: mapUndrawRefusal,
    });
  });
});

describe("the undraw action", () => {
  /* One sentence over the counts would report a watermark-only season as nothing done: it answers
     with two zeroes and `watermark_cleared`. */
  it("reports the three outcomes a 200 can carry apart", async () => {
    const undrawn = async (spieltage: number, spiele: number, watermark_cleared: boolean) => {
      answerWith(() => Promise.resolve({ saison_id: SAISON_ID, spieltage, spiele, watermark_cleared }));
      const result = await undrawSpielplanAction({ id: SAISON_ID });
      expect(result.success, result.success ? "" : result.error).toBe(true);
      return result.success ? (result.message ?? "") : "";
    };

    const messages = [await undrawn(3, 12, true), await undrawn(0, 0, true), await undrawn(0, 0, false)];

    expect(new Set(messages).size, "two of the outcomes read alike").toBe(3);
    expect(messages[0] ?? "").toMatch(/Gelöscht wurden/);
    expect(messages[1] ?? "").toMatch(/hielt weder Spieltage noch Spiele/);
    expect(messages[2] ?? "").toMatch(/hatte keinen Spielplan mehr/);
  });

  /* This press is the half of `rules_shape_after_spielplan`'s repair loop that reopens the three shape rules, so
     the message reporting it says where they and the clubs are changed before the redraw. */
  it("names where the reopened numbers and the clubs are changed", async () => {
    answerWith(() => Promise.resolve({ saison_id: SAISON_ID, spieltage: 3, spiele: 12, watermark_cleared: true }));

    const result = await undrawSpielplanAction({ id: SAISON_ID });

    const text = result.success ? (result.message ?? "") : result.error;
    assert.ok(text.includes(`im Abschnitt ${REGELN_ABSCHNITT} ändern, die Teams unter „${TEAMS_EINTRAG.label}“.`), text);
  });

  /* The panel closes the control for both halves of `spielplan_undraw_outside_its_window`, so the code can only arrive
     on a page that went stale. The reloaded panel names any way out, so a repair spelled here too
     could describe a state the season has already left. */
  it("tells a stale page to reload rather than naming a repair", () => {
    const message = mapUndrawRefusal(refused("spielplan_undraw_outside_its_window")) ?? "";

    expect(message).toMatch(/geplante Saison/);
    expect(message).toMatch(/Lade die Seite neu/);
    // The shared sentence rather than a copy: `fl_frontend/src/features/saisons/utils.test.ts` pins the
    // categories the endpoint counts, and a second spelling here could name a different set.
    assert.ok(message.includes(RECORDED_FACTS_NONE), "the refusal spells the recorded facts itself");
  });
});

describe("the German the shape freeze renders", () => {
  it("reads a phrase inside a longer German word as naming no field", () => {
    assert.ok(names("Gruppen", "Für Gruppen und Teams pro Gruppe"));
    assert.ok(!names("Gruppen", "Die Gruppenphase ist gesperrt"));
    assert.ok(!names("Qualifikant", "Die Qualifikanten pro Gruppe"));
  });

  /* A sentence naming some of the frozen fields reads as complete and is not: the admin reloads to a
     panel holding a field the sentence never said was closed. */
  it("names every field the refusal freezes", () => {
    const message = editBanner("rules_shape_after_spielplan");

    for (const [field, german] of Object.entries(GERMAN_OF)) {
      assert.ok(names(german, message), `rules_shape_after_spielplan freezes ${field} and its message never names ${german}`);
    }
  });
});

describe("the German each widened refusal renders", () => {
  /* `saison_span_below_spielplan` refuses the season's SPAN against the matchdays its rules imply. The fallback an
     unmapped code falls through to blames the season id, which is neither the fault nor a repair. */
  it("names the span and its repairs for the schedule refusal, never the season id", () => {
    const message = editBanner("saison_span_below_spielplan");

    expect(message).toMatch(/Zeitraum/);
    expect(message).toMatch(/Enddatum/);
    expect(message).toMatch(/Startdatum/);
    expect(message).not.toMatch(/Saison-ID/);
  });

  /* The editor's `saison_span_below_spielplan` and the draw's `saison_span_below_spielplan_as_stored` are one rule, so a sentence written
     twice could tell two admins two different things about it. Each path adds its own tail and shares
     the opening. */
  it("opens the schedule refusal with one sentence on both paths", () => {
    const opening = (message: string): string => message.split(". ")[0] ?? "";
    const editor = editBanner("saison_span_below_spielplan");

    expect(opening(editor), "the editor words no opening for the schedule refusal").not.toBe("");
    for (const carriedShape of [false, true]) {
      expect(
        opening(drawAnswer("saison_span_below_spielplan_as_stored", carriedShape)),
        "the draw opens the schedule refusal apart from the editor",
      ).toBe(opening(editor));
    }
  });

  /* A bare `error`, like the two freezes: several fields could repair it and none of them is at
     fault, so a `fieldErrors` key would seat the sentence under a value that is not the problem. */
  it("seats the schedule refusal under no field", () => {
    expect(mapRulesRefusal(refused("saison_span_below_spielplan"))?.fieldErrors).toBe(undefined);
  });

  /* Neither rules field repairs this in every state: `rules_saison_started` freezes `qualifiers_per_gruppe`
     on a past season, and `fl_backend/app/api/saisons/schedule.py :: group_matchdays` is flat from an
     even `teams_per_gruppe` down to the odd one. */
  it("offers no rules field as a repair for the schedule refusal", () => {
    for (const text of [
      editBanner("saison_span_below_spielplan"),
      drawAnswer("saison_span_below_spielplan_as_stored", false),
      drawAnswer("saison_span_below_spielplan_as_stored", true),
    ]) {
      expect(text).not.toMatch(/Qualifikanten/);
      expect(text).not.toMatch(/Teams pro Gruppe/);
    }
  });

  /* The draw carries its own three numbers on a replace and none on a first draw, so the panel the
     second repair names moves with the request. Hardcode either and half the admins are misdirected. */
  it("sends the draw's schedule refusal to the panel that holds the numbers it was judged on", () => {
    expect(drawAnswer("saison_span_below_spielplan_as_stored", true)).toMatch(/Abschnitt Spielplan/);
    expect(drawAnswer("saison_span_below_spielplan_as_stored", false)).toMatch(/Abschnitt Regeln/);
    // Neither tail sends the admin to change a number: the dates are the repair that works whatever
    // the numbers are.
    for (const carriedShape of [false, true])
      expect(drawAnswer("saison_span_below_spielplan_as_stored", carriedShape)).not.toMatch(/Ändere die Zahlen/);
  });

  /* These three read the shape alone, so each sends the admin to the panel holding the shape, whatever the
     action read off its request. */
  it("sends each shape fault to the panel holding the shape", () => {
    for (const code of ["rules_bracket_impossible", "rules_qualifiers_above_gruppe", "rules_spiele_over_one_read"] as const) {
      for (const carriedShape of [false, true]) {
        expect(drawAnswer(code, carriedShape), `${code} sends the admin away from the numbers it judged`).toMatch(/Abschnitt Spielplan/);
      }
    }
  });

  /* A draw never carries the forfeit, so its twin of the editor's fault states the editor's own rule and
     sends the admin to the panel holding it. */
  it("states the editor's forfeit rule on the draw, repaired in the rules panel", () => {
    const rule =
      mapRulesRefusal(refused("rules_forfeit_unentschieden_in_a_knockout"))?.fieldErrors?.["rules.forfeit_ergebnis.sieger_tore"] ?? "";

    expect(rule, "the editor seats no forfeit rule, so the draw's twin is compared with nothing").not.toBe("");
    for (const carriedShape of [false, true]) {
      assert.ok(
        drawAnswer("rules_forfeit_unentschieden_in_a_knockout_as_stored", carriedShape).startsWith(rule),
        "the draw words its rule apart from the editor",
      );
      expect(drawAnswer("rules_forfeit_unentschieden_in_a_knockout_as_stored", carriedShape)).toMatch(/Abschnitt Regeln/);
    }
  });

  /* `saison_past` refuses `past` alone, so the message may not send the admin looking for a
     season that is still merely geplant. */
  it("names a finished season for the draw's status refusal, never a planned one", () => {
    const message = drawAnswer("saison_past", false);

    expect(message).toMatch(/abgeschlossen/);
    expect(message).not.toMatch(/geplant/);
  });

  /* `spielplan_gruppen_off_rules` refuses a group off its size in EITHER direction, and a club standing in a
     group the season does not offer. A message naming only the short direction misdirects both. */
  it("covers all three shapes of the draw's group refusal", () => {
    expect(GRUPPEN_OFF_RULES).toMatch(/genau so viele Teams/);
    expect(GRUPPEN_OFF_RULES).toMatch(/nicht anbietet/);
  });

  /* Spelled a second time and the closed press, which reads the declaration, says something the
     refusal does not. */
  it("answers the draw's group refusal with the declaration the closed press reads", () => {
    for (const carriedShape of [false, true]) expect(drawAnswer("spielplan_gruppen_off_rules", carriedShape)).toBe(GRUPPEN_OFF_RULES);
  });

  /* `activate_target_undrawn` is the one activation refusal with a remedy the admin can act on here. */
  it("names the draw as the remedy for a rollover onto an undrawn season", () => {
    expect(mapActivateRefusal(refused("activate_target_undrawn")) ?? "").toMatch(/Spielplan/);
  });

  /* The pre-flight's own case compares the same declaration by calling. */
  it("answers the undated-matchday refusal with the declaration the closed press reads", () => {
    expect(mapActivateRefusal(refused("activate_spieltage_undated"))).toBe(SPIELTAGE_UNDATED);
  });
});

const LAUF = "/identity/erasure/sweep";

/** A deletion call: the generated call carries its `nach` in the endpoint's query. */
const isLauf = ({ endpoint }: ApiCall): boolean => endpoint.split("?")[0] === LAUF;

/** The query one call carried, as the backend reads it. */
const queryOf = ({ endpoint }: ApiCall): Record<string, string> => Object.fromEntries(new URL(endpoint, "http://backend").searchParams);

/** The activation's own message where it closed one season, as `landed` answers it. */
const AKTIVIERT = `Saison ${SAISON_ID} ist jetzt aktiv. Die vorherige Saison ist abgeschlossen.`;

/** Places in the `_id` order, as the mirror demands them. */
const ORT = `${"d".repeat(23)}4`;
const VORNE = `${"e".repeat(23)}5`;

/** One call of the deletion: whom it erased, who is still due after it, and where the pass goes on. */
const gelaufen = (spieler: number, verbleibend: number, nach: string | null = null, seit: string | null = "2025") => ({
  abgeschlossene_saison_id: seit,
  spieler: spieler,
  saison_spieler: spieler * 2,
  registrierungen: 0,
  uebersprungen: 0,
  fehlgeschlagen: 0,
  verbleibend: verbleibend,
  nach: nach,
});

/**
 * The activation landing, then each deletion call answered by the next of `laeufe` and every later one with the
 * pass's end: a loop that ignores the end then fails on what it says rather than hanging the file.
 */
function aktivierungUndLaeufe(...laeufe: (() => Promise<unknown>)[]): void {
  let lauf = 0;
  answerWith((call) => {
    if (!isLauf(call)) return Promise.resolve(landed(call));
    const antwort = laeufe[lauf] ?? (() => Promise.resolve(gelaufen(0, 0)));
    lauf += 1;
    return antwort();
  });
}

const laeufe = (): number => calls.filter(isLauf).length;

/** The message of a press the action answered as saved, or a failure naming what it answered instead. */
async function umgestellt(): Promise<string> {
  const result = await activateSaisonAction({ id: SAISON_ID });
  expect(result.success, `the activation answered ${JSON.stringify(result)}`).toBe(true);
  return result.success ? (result.message ?? "") : "";
}

describe("the deletion the activation runs", () => {
  /* The spine clears the tag once the body settles: a run behind the answer lands after the clear, and a squad page
     names deleted pupils until the lifetime passes. One list reads the order rather than assuming it. */
  it("runs the pass to its end after the activation, the tag cleared after the last call's answer", async () => {
    const order: string[] = [];
    let gelesen = 0;
    const nachtragen = (): void => {
      for (const { name, args } of cacheCalls.slice(gelesen)) order.push(`${name}(${args.join(", ")})`);
      gelesen = cacheCalls.length;
    };
    const laeufeAntworten = [gelaufen(2, 1, ORT), gelaufen(1, 0)];
    answerWith(async (call) => {
      nachtragen();
      if (!isLauf(call)) {
        order.push(`${call.method ?? "GET"} ${call.endpoint}`);
        return landed(call);
      }
      const antwort = laeufeAntworten.shift() ?? gelaufen(0, 0);
      // A turn of the event loop before the answer lands, so a drop that does not wait on it runs first.
      await new Promise((resolve) => setImmediate(resolve));
      order.push(`answered ${LAUF}`);
      return antwort;
    });

    const message = await umgestellt();
    nachtragen();

    expect(order).toStrictEqual([
      `POST /saisons/${SAISON_ID}/activate`,
      `answered ${LAUF}`,
      `answered ${LAUF}`,
      `updateTag(${SITE_CACHE_TAG})`,
      "refresh()",
    ]);
    expect(message).toBe(`${AKTIVIERT} 3 Spielerinnen und Spieler ohne Kadereintrag seit Saison 2025 wurden gelöscht.`);
  });

  it("deletes nobody where the activation was refused", async () => {
    answerWith((call) => (isLauf(call) ? Promise.resolve(gelaufen(1, 0)) : Promise.reject(refused("activate_saison_unfinished"))));
    expect((await activateSaisonAction({ id: SAISON_ID })).success).toBe(false);

    expect(laeufe(), "a season that did not turn active had its pupils deleted").toBe(0);
  });

  /* The activation is saved and stays so: answered as failed, the administrator presses again and a stale page
     refuses, or answers a rollover nobody repeated. The line carries what the call says of its request, as the
     hourly pass's does. */
  for (const [fall, fehler, anfrage] of [
    [
      "a run the backend answers 500",
      () =>
        new APIBadStatusError({
          message: "API returned a bad status.",
          url: "http://backend:8000",
          statusCode: 500,
          serverErrorCode: "database_failed",
          endpoint: LAUF,
          method: "POST",
          readOnly: false,
          traceId: "t".repeat(32),
        }),
      { status: 500, server_error_code: "database_failed", trace_id: "t".repeat(32) },
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
      { trace_id: "t".repeat(32) },
    ],
    // Its own bound and not the press's deadline: a backend answering slower than its own deadline is a fault, and
    // a warning keyed on the timeout alone would hide it (`fl_frontend/src/features/saisons/deadline.test.ts`).
    [
      "a run that outlasted its own bound",
      () =>
        new APINetworkError({
          message: "Request failed.",
          url: "http://backend:8000",
          method: "POST",
          readOnly: false,
          traceId: "t".repeat(32),
          isTimeout: true,
        }),
      { trace_id: "t".repeat(32) },
    ],
  ] as const) {
    it(`answers the activation saved after ${fall}, and says what the hourly pass finishes`, async () => {
      aktivierungUndLaeufe(
        () => Promise.resolve(gelaufen(1, 4, ORT)),
        () => Promise.reject(fehler()),
      );

      const message = await umgestellt();

      expect(message).toBe(
        `${AKTIVIERT} Eine Spielerin oder ein Spieler ohne Kadereintrag seit Saison 2025 wurde gelöscht. ` +
          "Die Löschung ist nicht vollständig durchgelaufen. Was noch aussteht, löscht der nächste stündliche Durchlauf.",
      );
      expect(loggedLines.filter(({ message: line }) => line === "loeschung.umstellung_failed")).toStrictEqual([
        { level: "error", message: "loeschung.umstellung_failed", meta: { name: fehler().name, ...anfrage } },
      ]);
    });
  }

  /* Ten failing pupils fill the front of the `_id` order, so the call reaching them erases nobody while a due pupil
     waits behind. The front's answer is bounded, so a loop dropping the place fails here rather than hanging. */
  it("hands each call the place the last answer named, past a call that erased nobody, until one names none", async () => {
    let vorne = 0;
    answerWith((call) => {
      if (!isLauf(call)) return Promise.resolve(landed(call));
      const { nach } = queryOf(call);
      if (nach === VORNE) return Promise.resolve(gelaufen(1, 10));
      return Promise.resolve(++vorne <= 3 ? { ...gelaufen(0, 11, VORNE), fehlgeschlagen: 10 } : gelaufen(0, 11));
    });

    const message = await umgestellt();

    // A first call carrying no `nach` at all, never a null one: present, the server reads it as an id.
    expect(calls.filter(isLauf).map(queryOf)).toStrictEqual([{}, { nach: VORNE }]);
    expect(message).toBe(
      `${AKTIVIERT} Eine Spielerin oder ein Spieler ohne Kadereintrag seit Saison 2025 wurde gelöscht. 10 weitere Löschungen stehen noch aus.`,
    );
  });

  it("words one deleted pupil and one remaining in the singular", async () => {
    aktivierungUndLaeufe(() => Promise.resolve(gelaufen(1, 1)));

    expect(await umgestellt()).toBe(
      `${AKTIVIERT} Eine Spielerin oder ein Spieler ohne Kadereintrag seit Saison 2025 wurde gelöscht. Eine weitere Löschung steht noch aus.`,
    );
  });

  /* No season `past`, as on the league's first activation: nobody is due, and a sentence counting zero reads as a
     deletion that went wrong. */
  it("adds nothing to the message where nobody was due", async () => {
    aktivierungUndLaeufe(() => Promise.resolve(gelaufen(0, 0, null, null)));

    expect(await umgestellt()).toBe(AKTIVIERT);
    expect(laeufe()).toBe(1);
  });
});
