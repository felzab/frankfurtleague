import "../testing/dom.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, mock } from "node:test";

import { act, createElement, startTransition, Suspense, use, useState } from "react";

import { render } from "@testing-library/react";
import ts from "typescript";
import { z } from "zod";

import { filesUnder, isTestFile } from "../../core/treeWalk.ts";
import { appToast } from "../utils/appToast.ts";
// Relative imports: this file's siblings resolve either way, and a mixed file reads as a decision.
import {
  applyVerdicts,
  BLOCKED_SUBMIT_TITLE,
  blockedSubmitDetail,
  differsFromSubmitted,
  forgivenVerdicts,
  markedFieldCount,
  mergeFieldVerdicts,
  missingVerdicts,
  settledVerdicts,
  submitDecision,
  submitRefusals,
  useDraftFieldErrors,
  verdictMessage,
} from "./useDraftFieldErrors.ts";
import { UNHANDLED_FIELD_REFUSAL } from "./useServerFieldErrors.ts";

import type { BlockingBanners, RailBanner } from "../components/ui/railBanner.ts";
import type { FieldErrors } from "../utils/validation.ts";
import type { FieldVerdicts } from "./useDraftFieldErrors.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

/** The German sentence a Spieltag occupancy refusal puts on a side — a rule only the server holds. */
const SERVER_REFUSAL = "Dieses Team spielt am selben Spieltag schon in einem anderen Spiel.";

/** What a payload schema says about an emptied count, which is all a client verdict can ever know. */
const CLIENT_MESSAGE = "Bitte gib die Treffer von Team 1 ein.";

/** What the club schema says about a one-character Kürzel. */
const CLIENT_SHORTHAND = "Das Kürzel besteht aus genau 2 Zeichen.";

/** A verdict about a value the submit already judged. */
const onSameValue = (message: string | null) => ({ message, differs: false });

/** A verdict about a value that has moved since the submit judged it. */
const onMovedValue = (message: string | null) => ({ message, differs: true });

describe("differsFromSubmitted", () => {
  it("calls a path differing when no submit has been recorded for the schema", () => {
    // Nothing has been said about the draft, so there is no verdict to be superseded by.
    assert.equal(differsFromSubmitted(undefined, { datum: "2026-08-19" }, ["datum"]), true);
  });

  it("calls a blur that changed nothing the same value", () => {
    const submitted = { datum: "2026-08-19", ort: { mietpreis: 50 } };

    assert.equal(differsFromSubmitted(submitted, { datum: "2026-08-19", ort: { mietpreis: 50 } }, ["datum"]), false);
  });

  it("resolves a dotted path into the draft", () => {
    const submitted = { ort: { spielort_id: "a", mietpreis: 50 } };

    assert.equal(differsFromSubmitted(submitted, { ort: { spielort_id: "a", mietpreis: null } }, ["ort.mietpreis"]), true);
  });

  it("calls the whole call differing when any one of its paths moved", () => {
    // The cross-field case: the level-shoot-out refine reports on `team2` whichever count was edited,
    // so editing `team1` has to unlock the verdict sitting on `team2`.
    const submitted = { elfmeterschiessen: { team1: 3, team2: 3 } };
    const draft = { elfmeterschiessen: { team1: 4, team2: 3 } };

    assert.equal(differsFromSubmitted(submitted, draft, ["elfmeterschiessen.team1", "elfmeterschiessen.team2"]), true);
  });

  it("compares structurally rather than by identity", () => {
    const submitted = { team1: { team_id: "a", tore: null } };

    assert.equal(differsFromSubmitted(submitted, { team1: { team_id: "a", tore: null } }, ["team1"]), false);
  });

  it("reads a path through a null as absent rather than throwing", () => {
    assert.equal(differsFromSubmitted({ ort: null }, { ort: null }, ["ort.mietpreis"]), false);
  });
});

/** What a schema reports for a whole draft, keyed the way `toFieldErrors` keys it. */
const FOUND = {
  strasse: "Bitte gib eine Straße ein.",
  shorthand: "Das Kürzel besteht aus genau 2 Zeichen.",
  telefon: "Bitte gib eine gültige Telefonnummer ein.",
  schulform: "Bitte wähle eine Schulform.",
  "rules.erlaubte_stufen": "Bitte wähle mindestens eine Stufe.",
  "einwilligung.erteilt": "Bitte stimme der Verarbeitung zu.",
  "kader.groesse": "Ein Kader hat mindestens einen Spieler.",
  "kontakte.trainer.erteilt": "Bitte stimme der Verarbeitung zu.",
  "kontakte.ansprechperson.erteilt": "Bitte stimme der Verarbeitung zu.",
  "kontakte.stellvertretung.erteilt": "Bitte stimme der Verarbeitung zu.",
  "austritt.datum": "Bitte gib ein gültiges Datum ein.",
};

describe("verdictMessage", () => {
  it("publishes the schema's message for a value that is there and wrong", () => {
    // Two characters are required, one was typed.
    assert.equal(verdictMessage(FOUND, { shorthand: "A" }, "shorthand"), "Das Kürzel besteht aus genau 2 Zeichen.");
  });

  it("says nothing about an empty field before send has been pressed", () => {
    // Focusing a field and leaving it must never paint it, and neither must clearing one.
    assert.equal(verdictMessage(FOUND, { strasse: "" }, "strasse"), null);
  });

  it("says nothing about a consent switch left off, which is missing rather than wrong", () => {
    // An unchecked required box is `valueMissing` to the browser, so `false` is an absence.
    assert.equal(verdictMessage(FOUND, { einwilligung: { erteilt: false } }, "einwilligung.erteilt"), null);
  });

  it("names the missing value once send has been pressed", () => {
    // `aria` validation refuses nothing natively, so this message is the field's only voice.
    assert.equal(verdictMessage(FOUND, { strasse: "" }, "strasse", { afterSubmit: true }), "Bitte gib eine Straße ein.");
  });

  it("still judges a zero, which is a number somebody typed rather than an absence", () => {
    assert.equal(verdictMessage(FOUND, { kader: { groesse: 0 } }, "kader.groesse"), "Ein Kader hat mindestens einen Spieler.");
  });

  it("still judges an empty array, which is a made choice rather than an absence", () => {
    assert.equal(verdictMessage(FOUND, { rules: { erlaubte_stufen: [] } }, "rules.erlaubte_stufen"), "Bitte wähle mindestens eine Stufe.");
  });

  it("is what the hook publishes through, and not a routine standing beside it", async () => {
    // The cases above grade the decision; this one drives the hook that has to consult it. Without it,
    // a blur publishing the schema's map directly leaves every case above passing.
    const latest: { hook: GateHook | null } = { hook: null };
    render(
      createElement(GateProbe, {
        names: ["shorthand", "full_name"],
        onRender: (hook) => {
          latest.hook = hook;
        },
      }),
    );
    const blur = (draft: unknown) =>
      act(async () => {
        latest.hook?.validatePaths("team", draft, ["shorthand"]);
      });

    await blur({ shorthand: "", full_name: "" });
    assert.deepEqual(latest.hook?.fieldErrors, {}, "a blur on an emptied field names it missing before send was pressed");

    await blur({ shorthand: "A", full_name: "" });
    assert.deepEqual(latest.hook?.fieldErrors, { shorthand: CLIENT_SHORTHAND }, "a blur on a wrong value publishes nothing");

    // A press the gate lets through, which is what records that send was pressed.
    await act(async () => {
      latest.hook?.guardSubmit({ team: { shorthand: "AB", full_name: "FC Beispiel" } }, () => {});
    });
    await blur({ shorthand: "", full_name: "FC Beispiel" });
    assert.deepEqual(latest.hook?.fieldErrors, { shorthand: CLIENT_SHORTHAND }, "a blur after send was pressed still hides a missing value");
  });
});

describe("mergeFieldVerdicts", () => {
  it("keeps a submit's message when the blur that followed changed nothing", () => {
    // The whole bug. `focusFirstRefusal` moves focus INTO the refused field, so the admin's next Tab
    // records a `null` on it — newer than the refusal, and about the very value it refused.
    const verdicts: FieldVerdicts = { datum: onSameValue(null) };

    assert.deepEqual(mergeFieldVerdicts({ datum: SERVER_REFUSAL }, verdicts), { datum: SERVER_REFUSAL });
  });

  it("lets a verdict on a changed value retract the submit's message", () => {
    // The behaviour the retraction exists for: the admin picked another team, so the refusal is stale.
    const verdicts: FieldVerdicts = { "team1.team_id": onMovedValue(null) };

    assert.deepEqual(mergeFieldVerdicts({ "team1.team_id": SERVER_REFUSAL }, verdicts), {});
  });

  it("refuses a same-value non-null verdict the same way it refuses a same-value null", () => {
    // The symmetry: overwriting the server's reason with a browser guess loses as much as deleting it.
    const verdicts: FieldVerdicts = { "elfmeterschiessen.team1": onSameValue(CLIENT_MESSAGE) };

    assert.deepEqual(mergeFieldVerdicts({ "elfmeterschiessen.team1": SERVER_REFUSAL }, verdicts), {
      "elfmeterschiessen.team1": SERVER_REFUSAL,
    });
  });

  it("lets a verdict on a changed value overwrite the submit's message", () => {
    const verdicts: FieldVerdicts = { "elfmeterschiessen.team1": onMovedValue(CLIENT_MESSAGE) };

    assert.deepEqual(mergeFieldVerdicts({ "elfmeterschiessen.team1": SERVER_REFUSAL }, verdicts), {
      "elfmeterschiessen.team1": CLIENT_MESSAGE,
    });
  });

  it("unlocks every path of a call where a sibling path moved", () => {
    // `differs` is decided per CALL, so the shoot-out's two counts carry the same answer — which is
    // what lets an edit to `team1` clear the level-shoot-out message the schema puts on `team2`.
    const verdicts: FieldVerdicts = {
      "elfmeterschiessen.team1": onMovedValue(null),
      "elfmeterschiessen.team2": onMovedValue(null),
    };

    assert.deepEqual(mergeFieldVerdicts({ "elfmeterschiessen.team2": SERVER_REFUSAL }, verdicts), {});
  });

  it("shows a verdict on a path the submit did not name", () => {
    // Nothing is being rewritten there, so eager validation survives a failed submit on other fields.
    const verdicts: FieldVerdicts = { "ort.mietpreis": onSameValue(CLIENT_MESSAGE) };

    assert.deepEqual(mergeFieldVerdicts({ "team1.team_id": SERVER_REFUSAL }, verdicts), {
      "team1.team_id": SERVER_REFUSAL,
      "ort.mietpreis": CLIENT_MESSAGE,
    });
  });

  it("drops a null verdict on a path the submit did not name", () => {
    assert.deepEqual(mergeFieldVerdicts({}, { "ort.mietpreis": onSameValue(null) }), {});
  });

  it("grades each schema's paths against that schema's own submitted payload", () => {
    // The two-schema editors: the person half and the season half publish into one verdict store, and
    // each verdict carries the answer its own schema's payload produced.
    const verdicts: FieldVerdicts = {
      vorname: onSameValue(null),
      "membership.nummer": onMovedValue(null),
    };

    assert.deepEqual(mergeFieldVerdicts({ vorname: SERVER_REFUSAL, "membership.nummer": SERVER_REFUSAL }, verdicts), {
      vorname: SERVER_REFUSAL,
    });
  });

  it("leaves the submit's map untouched", () => {
    // The merge is read while rendering, and mutating either store from there would make a verdict
    // write into the map that moves focus (`docs/frontend/spec.md` I19).
    const submitErrors = { "team1.team_id": SERVER_REFUSAL };
    mergeFieldVerdicts(submitErrors, { "team1.team_id": onMovedValue(null) });

    assert.deepEqual(submitErrors, { "team1.team_id": SERVER_REFUSAL });
  });
});

/** The club half of the team editor, which is where the Kürzel refusal lands. */
const TEAM_SCHEMA = z.object({
  shorthand: z.string().length(2, { error: "Das Kürzel besteht aus genau 2 Zeichen." }),
  full_name: z.string().nonempty({ error: "Bitte gib den vollständigen Namen ein." }),
});

const forgive = (shown: Record<string, string>, payload: unknown, submitted?: unknown) =>
  forgivenVerdicts({
    shown,
    payloads: { team: payload },
    schemas: { team: TEAM_SCHEMA },
    submitted: submitted === undefined ? {} : { team: submitted },
    afterSubmit: false,
  });

describe("forgivenVerdicts", () => {
  it("retracts a client message the moment the value becomes valid", () => {
    // The forgiving half: "A" was refused on blur, and "AB" must clear it without waiting for another.
    assert.deepEqual(forgive({ shorthand: CLIENT_SHORTHAND }, { shorthand: "AB", full_name: "FC Beispiel" }), {
      shorthand: { message: null, differs: true },
    });
  });

  it("leaves a message that is still wrong exactly as it stands", () => {
    // Never an overwrite: replacing one message with another mid-word is a message APPEARING between
    // keystrokes, which `.claude/rules/frontend.md` forbids. Only the retraction is allowed here.
    assert.equal(forgive({ shorthand: CLIENT_SHORTHAND }, { shorthand: "A", full_name: "FC Beispiel" }), null);
  });

  it("never speaks about a path showing nothing, however wrong that path is", () => {
    // The whole asymmetry. `shorthand` is refused by the schema here and still says nothing, because a
    // half-typed value has not earned its first message.
    assert.equal(forgive({}, { shorthand: "A", full_name: "" }), null);
  });

  it("marks a retraction on an UNTOUCHED path as not differing, so a server refusal survives", () => {
    // The Kürzel refusal: the admin is typing in `full_name`, and uniqueness is a rule only the server
    // holds — the schema is happy with "FC", so without `differs` this would delete the refusal.
    const submitted = { shorthand: "FC", full_name: "FC Beispiel" };
    const retracted = forgive({ shorthand: SERVER_REFUSAL }, { shorthand: "FC", full_name: "FC Beispiel eV" }, submitted);

    assert.deepEqual(retracted, { shorthand: { message: null, differs: false } });
    // And the merge is what acts on it: the refusal stands because the value beneath it never moved.
    assert.deepEqual(mergeFieldVerdicts({ shorthand: SERVER_REFUSAL }, retracted ?? {}), { shorthand: SERVER_REFUSAL });
  });

  it("grades each shown path against ITS OWN value, not against whether anything moved", () => {
    // The discriminator a single-path case cannot draw: with `differs` per CALL, the retyped `full_name`
    // marks the untouched `shorthand` moved too and deletes a refusal nobody answered.
    const submitted = { shorthand: "FC", full_name: "FC Beispiel" };
    const shown = { shorthand: SERVER_REFUSAL, full_name: "Dieser Name ist vergeben." };
    const retracted = forgive(shown, { shorthand: "FC", full_name: "FC Beispiel eV" }, submitted);

    assert.deepEqual(retracted, {
      shorthand: { message: null, differs: false },
      full_name: { message: null, differs: true },
    });
    assert.deepEqual(mergeFieldVerdicts(shown, retracted ?? {}), { shorthand: SERVER_REFUSAL });
  });

  it("retracts a server refusal once the refused value itself is retyped", () => {
    // The other direction, and the one that must NOT be blocked: the refusal was about "FC".
    const submitted = { shorthand: "FC", full_name: "FC Beispiel" };
    const retracted = forgive({ shorthand: SERVER_REFUSAL }, { shorthand: "FD", full_name: "FC Beispiel" }, submitted);

    assert.deepEqual(retracted, { shorthand: { message: null, differs: true } });
    assert.deepEqual(mergeFieldVerdicts({ shorthand: SERVER_REFUSAL }, retracted ?? {}), {});
  });

  it("lets only a schema whose payload spells the path answer for it", () => {
    // A two-schema editor: the club payload says nothing about `gruppe`, so its silence must not be
    // mistaken for approval of the season half's message.
    const retracted = forgivenVerdicts({
      shown: { gruppe: "Bitte wähle eine Gruppe." },
      payloads: { team: { shorthand: "FC", full_name: "FC Beispiel" } },
      schemas: { team: TEAM_SCHEMA },
      submitted: {},
      afterSubmit: false,
    });

    assert.equal(retracted, null);
  });
});

/** A schema with one required date and one required text field, which is the whole of the exception's shape. */
const AUSTRITT_SCHEMA = z.object({
  grund: z.string().nonempty({ error: "Bitte gib einen Grund ein." }),
  datum: z.string().nonempty({ error: "Bitte gib ein gültiges Datum ein." }),
});

const sweep = (payload: unknown, submitted?: unknown) =>
  missingVerdicts({
    payloads: { austritt: payload },
    schemas: { austritt: AUSTRITT_SCHEMA },
    submitted: submitted === undefined ? {} : { austritt: submitted },
  });

describe("missingVerdicts", () => {
  it("names every missing field, whatever kind of control holds it", () => {
    // `aria` validation refuses nothing, so a date and a text field are owed the same sentence.
    assert.deepEqual(sweep({ grund: "", datum: "" }), {
      grund: { message: "Bitte gib einen Grund ein.", differs: true },
      datum: { message: "Bitte gib ein gültiges Datum ein.", differs: true },
    });
  });

  it("says nothing at all once every field is filled in", () => {
    assert.equal(sweep({ grund: "Rückzug", datum: "2026-08-19" }), null);
  });

  it("never speaks for a value that is present and wrong", () => {
    // That message reaches the field through `validatePaths`. Publishing it here too would put one on
    // every field at once, which is the sea of red this all started with.
    const wrong = z.object({ datum: z.string().length(10, { error: "Bitte gib ein gültiges Datum ein." }) });
    const out = missingVerdicts({ payloads: { austritt: { datum: "x" } }, schemas: { austritt: wrong }, submitted: {} });

    assert.equal(out, null);
  });

  it("marks an unmoved value as not differing, so a server refusal on it still stands", () => {
    const submitted = { grund: "", datum: "" };

    assert.deepEqual(sweep({ grund: "", datum: "" }, submitted), {
      grund: { message: "Bitte gib einen Grund ein.", differs: false },
      datum: { message: "Bitte gib ein gültiges Datum ein.", differs: false },
    });
  });
});

describe("what a blocked submit announces", () => {
  it("says how many fields are marked, spelled per count", () => {
    // A `FieldError` is a plain span in no live region, so without a toast the press is silent to a reader.
    assert.match(blockedSubmitDetail(1), /^Ein Feld/);
    assert.match(blockedSubmitDetail(4), /^4 Felder/);
  });

  it("calls no refused field a missing answer, the same press refusing wrong and taken values", () => {
    for (const marked of [1, 4]) {
      assert.doesNotMatch(blockedSubmitDetail(marked), /Angabe|fehlt/, "a duplicate e-mail address is told it is missing");
    }
  });

  it("points at the marks rather than restating them", () => {
    assert.match(blockedSubmitDetail(2), /markiert/);
  });

  it("sends the reader in no direction, on either count", () => {
    // Every editor on the site shares this sentence, and on the public application form the marked field
    // stands above the button that raised it. `focusFirstRefusal` moves the caret to the mark regardless.
    const richtung = /\bunten\b|\boben\b|darunter|darüber/i;
    const gesagt = "the toast names a place only some of the forms sharing it put the mark";

    assert.doesNotMatch(blockedSubmitDetail(1), richtung, gesagt);
    assert.doesNotMatch(blockedSubmitDetail(4), richtung, gesagt);
  });

  it("says the save did not happen, in a title distinct from every other refusal", () => {
    assert.equal(BLOCKED_SUBMIT_TITLE, "Noch nicht abgeschickt");
  });
});

describe("submitRefusals", () => {
  it("says nothing about a draft every schema accepts", () => {
    const clean = submitRefusals({ payloads: { team: { shorthand: "FC", full_name: "FC Beispiel" } }, schemas: { team: TEAM_SCHEMA } });

    assert.deepEqual(clean, {});
  });

  it("names an empty required field, which is what the browser stopped doing under `aria`", () => {
    const refusals = submitRefusals({ payloads: { team: { shorthand: "", full_name: "" } }, schemas: { team: TEAM_SCHEMA } });

    assert.deepEqual(refusals, {
      shorthand: "Das Kürzel besteht aus genau 2 Zeichen.",
      full_name: "Bitte gib den vollständigen Namen ein.",
    });
  });

  it("merges the halves a two-schema press writes", () => {
    const refusals = submitRefusals({
      payloads: { team: { shorthand: "", full_name: "FC Beispiel" }, austritt: { grund: "", datum: "" } },
      schemas: { team: TEAM_SCHEMA, austritt: AUSTRITT_SCHEMA },
    });

    assert.deepEqual(Object.keys(refusals).sort(), ["datum", "grund", "shorthand"]);
  });

  it("blocks on a single refusal, which is the boundary a `> 1` slip would move", () => {
    // M17's shape, as a PROPERTY rather than a pinned literal: one refused field is already a blocked
    // submit, so an off-by-one in the emptiness test changes this answer rather than only this text.
    const one = submitDecision({ payloads: { team: { shorthand: "AB", full_name: "" } }, schemas: { team: TEAM_SCHEMA } });

    assert.deepEqual(one, { blocked: true, refusals: { full_name: "Bitte gib den vollständigen Namen ein." } });
  });

  it("lets a clean draft through, naming no case the caller has to interpret", () => {
    const clean = submitDecision({ payloads: { team: { shorthand: "FC", full_name: "FC Beispiel" } }, schemas: { team: TEAM_SCHEMA } });

    assert.deepEqual(clean, { blocked: false });
  });
});

/** A consequence the draft itself causes, which is what raises `ConfirmSaveModal`. */
const CONSEQUENCE: RailBanner = {
  id: "probe.fan-out",
  severity: "warning",
  raisedBy: "change",
  title: "Jedes Spiel an diesem Ort ändert sich mit",
  inline: null,
};

/** A grave situation the page opened on, which asks nothing however it is graded. */
const STANDING: RailBanner = {
  id: "probe.retired",
  severity: "danger",
  raisedBy: "state",
  title: "Dieser Eintrag ist stillgelegt",
  inline: null,
};

/** What one press left: the map the form renders, the toasts raised, the lists handed to the dialog, the writes run. */
type Press = { fieldErrors: FieldErrors; toasts: string[]; confirmed: BlockingBanners[]; writes: number };

type GateHook = ReturnType<typeof useDraftFieldErrors<"team">>;

/** The hook as an editor holds it, over a form holding one control under each name given. */
function GateProbe({ names, onRender }: { names: readonly string[]; onRender: (hook: GateHook) => void }) {
  const hook = useDraftFieldErrors({ schemas: { team: TEAM_SCHEMA } });
  onRender(hook);

  return createElement("form", { ref: hook.formRef }, ...names.map((name, index) => createElement("input", { key: index, name })));
}

/** A form holding one control under each name given, which is all of a form `markedFieldCount` reads. */
const formNaming = (...names: string[]): HTMLFormElement => {
  const form = document.createElement("form");
  for (const name of names) form.append(Object.assign(document.createElement("input"), { name }));

  return form;
};

/** One press of the hook's own gate, made in a mounted form holding one control under each name given. */
async function pressSave(
  payload: unknown,
  banners?: readonly RailBanner[],
  names: readonly string[] = ["shorthand", "full_name"],
): Promise<Press> {
  const press: Press = { fieldErrors: {}, toasts: [], confirmed: [], writes: 0 };
  const latest: { hook: GateHook | null } = { hook: null };
  const danger = mock.method(appToast, "danger", (title: string, options?: { description?: string }) => {
    press.toasts.push(`${title}: ${options?.description ?? ""}`);
    return "";
  });
  const { unmount } = render(
    createElement(GateProbe, {
      names,
      onRender: (hook) => {
        latest.hook = hook;
      },
    }),
  );

  try {
    const write = () => {
      press.writes += 1;
    };
    const confirm = (blocking: BlockingBanners) => {
      press.confirmed.push(blocking);
    };

    await act(async () => {
      latest.hook?.guardSubmit({ team: payload }, write, banners === undefined ? undefined : { banners, confirm });
    });
    press.fieldErrors = latest.hook?.fieldErrors ?? {};
  } finally {
    danger.mock.restore();
    // Before the next press in the same case mounts its own form.
    unmount();
  }

  return press;
}

describe("a press on an editor whose draft raises a consequence", () => {
  it("marks and announces a draft the schemas refuse, and raises no dialog over it", async () => {
    const press = await pressSave({ shorthand: "", full_name: "FC Beispiel" }, [CONSEQUENCE]);

    assert.deepEqual(press.fieldErrors, { shorthand: CLIENT_SHORTHAND }, "the refused field is not marked");
    assert.deepEqual(press.toasts, [`${BLOCKED_SUBMIT_TITLE}: ${blockedSubmitDetail(1)}`], "the blocked press is not announced");
    // The defect this order exists against: a consequence accepted over a save the same press then refuses.
    assert.deepEqual(press.confirmed, [], "the dialog asks about a save the draft's own refusal blocks");
    assert.equal(press.writes, 0);
  });

  it("raises the dialog over a draft it would send, and leaves the one write to the dialog's confirm", async () => {
    const press = await pressSave({ shorthand: "FC", full_name: "FC Beispiel" }, [STANDING, CONSEQUENCE]);

    assert.deepEqual(press.confirmed, [[CONSEQUENCE]], "the dialog lists something other than the consequence the save causes");
    assert.equal(press.writes, 0, "the press wrote beside raising the dialog, so its confirm writes a second time");
    assert.deepEqual(press.toasts, []);
    assert.deepEqual(press.fieldErrors, {});
  });

  it("writes once where nothing the save causes needs asking", async () => {
    for (const banners of [undefined, [], [STANDING]]) {
      const press = await pressSave({ shorthand: "FC", full_name: "FC Beispiel" }, banners);

      assert.equal(press.writes, 1, `${JSON.stringify(banners)} kept a clean draft from writing exactly once`);
      assert.deepEqual(press.confirmed, [], `${JSON.stringify(banners)} confirmed a save that causes nothing`);
    }
  });
});

describe("markedFieldCount", () => {
  it("counts one field where one control writes several refused paths", () => {
    // The application's consent switch: one press writes all three seats, so the schema refuses three paths.
    const refusals = {
      "kontakte.ansprechperson.einwilligung.erteilt": "Ohne diese Kenntnisnahme …",
      "kontakte.stellvertretung.einwilligung.erteilt": "Ohne diese Kenntnisnahme …",
      "kontakte.trainer.einwilligung.erteilt": "Ohne diese Kenntnisnahme …",
    };

    assert.equal(markedFieldCount(formNaming("kontakte.ansprechperson.einwilligung.erteilt"), refusals), 1);
  });

  it("counts a field once however many elements carry its name", () => {
    // A `NumberField` names its hidden input beside the visible one, and a radio group names each radio.
    assert.equal(markedFieldCount(formNaming("kader.gute_spieler", "kader.gute_spieler"), { "kader.gute_spieler": "…" }), 1);
  });

  it("leaves out a refused path no control renders, and a control nothing refused", () => {
    // A Trainer sharing a seat is a copy with no box: its refusal is on the wire and on no field.
    const refusals = { "kontakte.stellvertretung.email": "Diese E-Mail-Adresse …", "kontakte.trainer.email": "Diese E-Mail-Adresse …" };

    assert.equal(markedFieldCount(formNaming("kontakte.stellvertretung.email", "kontakte.stellvertretung.telefon"), refusals), 1);
  });

  it("counts nothing where no form is mounted", () => {
    assert.equal(markedFieldCount(null, { shorthand: CLIENT_SHORTHAND }), 0);
  });
});

describe("a blocked press's announcement", () => {
  it("names the fields the form marks rather than the paths the schema refused", async () => {
    // Both TEAM_SCHEMA fields are refused, and the form renders a box for one of them.
    const press = await pressSave({ shorthand: "", full_name: "" }, undefined, ["shorthand"]);

    assert.deepEqual(press.toasts, [`${BLOCKED_SUBMIT_TITLE}: ${blockedSubmitDetail(1)}`]);
  });

  it("raises nothing where no field is marked, leaving the press to the unhandled-refusal report", async () => {
    // `useServerFieldErrors` announces a map no control renders; a second toast would point at marks nobody sees.
    const press = await pressSave({ shorthand: "", full_name: "" }, undefined, ["website_url"]);

    assert.deepEqual(
      press.toasts,
      [`Änderung nicht gespeichert: ${UNHANDLED_FIELD_REFUSAL}`],
      "the press raised a toast beside the report, or no report",
    );
    assert.equal(press.writes, 0, "a press nothing marked still wrote");
  });
});

describe("settledVerdicts", () => {
  const inputs = (payload: unknown, submitted: unknown, afterSubmit: boolean) => ({
    shown: {},
    payloads: { team: payload },
    schemas: { team: TEAM_SCHEMA },
    submitted: { team: submitted },
    afterSubmit,
  });

  it("hands back the very verdicts it was given once a commit has nothing to change", () => {
    const empty = { shorthand: "", full_name: "" };
    const once = settledVerdicts({}, inputs(empty, empty, true));

    assert.notDeepEqual(once, {}, "a submitted empty draft published no missing value");
    assert.equal(settledVerdicts(once, inputs(empty, empty, true)), once);
  });
});

/** Past this many renders of one press the form is not settling; the loop it guards against never stops by itself. */
const RENDER_CEILING = 50;

describe("the forgiveness effect, committed by react-dom's client", () => {
  /** A transition that suspends on a promise nothing resolves, so the verdict update it carries stays queued. */
  const NEVER = new Promise<never>(() => {});

  function Suspends(): null {
    use(NEVER);
    return null;
  }

  function mountEditor(start: unknown) {
    const probe = {
      renders: 0,
      hook: null as ReturnType<typeof useDraftFieldErrors<"team">> | null,
      hold: null as ((held: boolean) => void) | null,
      retype: null as ((payload: unknown) => void) | null,
    };

    const onRender = (hook: ReturnType<typeof useDraftFieldErrors<"team">>) => {
      probe.renders += 1;
      if (probe.renders > RENDER_CEILING) throw new Error(`the editor rendered ${String(RENDER_CEILING)} times without settling`);
      probe.hook = hook;
    };

    const onHold = (hold: (held: boolean) => void) => {
      probe.hold = hold;
    };

    const onRetype = (retype: (payload: unknown) => void) => {
      probe.retype = retype;
    };

    function Editor({ payload, report }: { payload: unknown; report: typeof onRender }) {
      const hook = useDraftFieldErrors({ schemas: { team: TEAM_SCHEMA } });
      hook.useForgiveFixed({ team: payload });
      report(hook);
      return null;
    }

    function Page({ report, reportHold, reportRetype }: { report: typeof onRender; reportHold: typeof onHold; reportRetype: typeof onRetype }) {
      const [held, setHeld] = useState(false);
      const [payload, setPayload] = useState(start);
      reportHold(setHeld);
      reportRetype(setPayload);
      return createElement(Suspense, { fallback: null }, held ? createElement(Suspends) : null, createElement(Editor, { payload, report }));
    }

    render(createElement(Page, { report: onRender, reportHold: onHold, reportRetype: onRetype }));
    const retype = (payload: unknown) =>
      act(async () => {
        probe.retype?.(payload);
      });

    return { probe, retype };
  }

  it("settles after a blocked press while another update is held pending", async () => {
    // The browser's crash, React error 185: with an update held, React cannot drop a no-op one and replays it from
    // the queue's base, so an effect queueing on every commit re-renders the form until the depth limit.
    const empty = { shorthand: "", full_name: "" };
    const { probe } = mountEditor(empty);

    await act(async () => {
      startTransition(() => {
        probe.hold?.(true);
        probe.hook?.validatePaths("team", { shorthand: "A", full_name: "" }, ["shorthand"]);
      });
    });

    probe.renders = 0;
    await act(async () => {
      probe.hook?.guardSubmit({ team: empty }, () => {});
    });

    assert.ok(probe.renders <= 3, `a blocked press took ${String(probe.renders)} renders to settle`);
    assert.deepEqual(Object.keys(probe.hook?.fieldErrors ?? {}).sort(), ["full_name", "shorthand"], "the press marked nothing");
  });

  it("still forgives a field the moment its value is fixed", async () => {
    const empty = { shorthand: "", full_name: "" };
    const { probe, retype } = mountEditor(empty);

    await act(async () => {
      probe.hook?.guardSubmit({ team: empty }, () => {});
    });
    await retype({ shorthand: "AB", full_name: "" });

    assert.deepEqual(probe.hook?.fieldErrors, { full_name: "Bitte gib den vollständigen Namen ein." });
  });
});

describe("applyVerdicts", () => {
  it("hands back the very same object when the retraction changes nothing", () => {
    // The render loop. A server refusal on an untouched path retracts to `{ null, false }` after every
    // render; a fresh object each time would re-render forever, so identity is the termination condition.
    const current: FieldVerdicts = { shorthand: { message: null, differs: false } };

    assert.equal(applyVerdicts(current, { shorthand: { message: null, differs: false } }), current);
  });

  it("hands back the same object when there is nothing to retract", () => {
    const current: FieldVerdicts = { shorthand: { message: null, differs: false } };

    assert.equal(applyVerdicts(current, null), current);
  });

  it("settles on the second pass, which is what ends the loop", () => {
    const retracted = { shorthand: { message: null, differs: true } };
    const first = applyVerdicts({}, retracted);

    assert.deepEqual(first, retracted);
    assert.equal(applyVerdicts(first, retracted), first);
  });

  it("still writes a retraction that genuinely moves a verdict", () => {
    const current: FieldVerdicts = { shorthand: { message: "Das Kürzel besteht aus genau 2 Zeichen.", differs: true } };
    const next = applyVerdicts(current, { shorthand: { message: null, differs: true } });

    assert.notEqual(next, current);
    assert.deepEqual(next, { shorthand: { message: null, differs: true } });
  });
});

const sources = new Map(
  filesUnder(SRC_DIR, (name) => name.endsWith(".tsx") && !isTestFile(name), 200).map((file) => [
    path.relative(SRC_DIR, file).split(path.sep).join("/"),
    readFileSync(file, "utf8"),
  ]),
);

/**
 * **Every form, found by the element it renders, not by a marker a conforming form carries.** A listing
 * filtered on the property it asserts cannot fail, so a form holding neither the prop nor the hook
 * stays invisible to its own sweep (PRE-4).
 */
const RENDERS_A_FORM = /^\s*<Form(?![\w.])/m;

/** The same net without the position, so a render the strict pattern misses lands in the difference below. */
const MENTIONS_A_FORM = /<Form(?![\w.])/;

const formFiles = [...sources].filter(([, text]) => RENDERS_A_FORM.test(text)).map(([file]) => file);

/**
 * The files naming `<Form>` in prose alone. Named one by one rather than counted: a NEW file rendering a form in a
 * shape `RENDERS_A_FORM` cannot see lands here instead of vanishing, and this list is what refuses it.
 */
const PROSE_ONLY = [
  "features/bewerbungen/components/forms/AdminBewerbungAnnehmenSection.tsx",
  "features/bewerbungen/components/forms/BewerbungForm/FormSchuleSection.tsx",
  "features/spieler/components/forms/ClosedSetSelect.tsx",
  "features/spieler/components/forms/TeamSelect.tsx",
  "features/teams/components/forms/GruppeSelect.tsx",
  "features/teams/components/forms/WebsiteUrlField.tsx",
  "shared/components/ui/AddressFields.tsx",
];

describe("the sweep's own reach", () => {
  it("finds the same forms by two routes that share no condition", () => {
    // One listing reads WHERE `<Form` sits, the other every file naming it, less a hand-written allowlist.
    // Neither sees a marker only a conforming form carries, so narrowing either breaks the equality
    // instead of shrinking the sweep.
    const namesAForm = [...sources].filter(([, text]) => MENTIONS_A_FORM.test(text)).map(([file]) => file);
    const byElimination = namesAForm.filter((file) => !PROSE_ONLY.includes(file));

    // The anti-vacuity clause: a discriminator that stopped matching leaves every assertion below
    // true of an empty list, and the equality below true of two empty ones. Set under the tree, so
    // adding or retiring a form never moves it.
    assert.ok(formFiles.length >= 8, `expected at least 8 forms, found ${String(formFiles.length)}: ${formFiles.join(", ")}`);
    assert.deepEqual(formFiles, byElimination, "the two routes disagree: a form is swept by one and not the other");
  });

  for (const file of PROSE_ONLY) {
    it(`${file} still only talks about a form rather than rendering one`, () => {
      // The allowlist is the one hole both routes share: a render here that the line-start pattern cannot
      // see is invisible to each of them, so they agree on a wrong answer. Read from the AST, which sees a
      // `<Form>` wherever it sits on the line.
      const source = ts.createSourceFile(file, sources.get(file) ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const rendered: string[] = [];

      const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          const opening = ts.isJsxElement(node) ? node.openingElement : node;
          if (opening.tagName.getText(source) === "Form")
            rendered.push(String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1));
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
      assert.deepEqual(rendered, [], `${file} renders a form at line ${rendered.join(", ")} while sitting on the prose allowlist`);
    });
  }
});

const pageOwnedEditors = [...sources].filter(([, text]) => text.includes("const resetDraftToStored =")).map(([file]) => file);

describe("every page-owned editor", () => {
  it("is discovered by the sweep", () => {
    // A floor rather than an exact count: what it guards is a discovery that silently finds nothing
    // after the routine is renamed, which would leave every assertion below vacuously true.

    // Two under the population, which holds one editor per admin entity, so retiring one never
    // fires it.
    assert.ok(
      pageOwnedEditors.length >= 6,
      `expected at least 6 page-owned editors, found ${String(pageOwnedEditors.length)}: ${pageOwnedEditors.join(", ")}`,
    );
  });

  for (const file of pageOwnedEditors) {
    it(`${file} routes its field errors through the composed hook`, () => {
      const source = sources.get(file) ?? "";

      assert.ok(source.includes("useDraftFieldErrors({"), `${file} does not take its field errors from useDraftFieldErrors`);
      // Holding the submit half directly is how the merge gets assembled at the call site again, and a
      // call site that merges in the wrong order fails silently: the refusal is produced and deleted.
      assert.ok(!source.includes("useServerFieldErrors("), `${file} holds the submit half directly instead of the composed hook`);
    });
  }

  for (const file of formFiles) {
    it(`${file} leaves missing values to the submit rather than to the browser`, () => {
      // The one mechanism, on every form. In `native` react-aria commits on each DOM `change`, so an
      // edited field cleared again paints the browser's required message on the blur.
      assert.match(sources.get(file) ?? "", /validationBehavior="aria"/, `${file} still lets the browser judge an emptied field`);
    });

    it(`${file} forgives against the payload it judges, not the draft beside it`, () => {
      // A LITERAL pin, not a property: two callers assemble a payload that is not the draft, and forgiving
      // against the draft judges a shape the schema never sees.
      const source = sources.get(file) ?? "";
      if (!source.includes("useForgiveFixed({ entity:")) return;

      assert.ok(source.includes("useForgiveFixed({ entity: toPayload(draft) });"), `${file} forgives against the wrong shape`);
    });

    it(`${file} blocks its own submit`, () => {
      // `aria` sets `noValidate` and drops every `required`, so the browser prevents nothing. A form
      // without this call posts whatever it holds and learns the rules from the server.
      assert.match(sources.get(file) ?? "", /guardSubmit\(/, `${file} sends an unjudged draft to the server`);
    });
  }

  for (const file of pageOwnedEditors) {
    it(`${file} forgives a corrected field without waiting for a blur`, () => {
      // Once per editor rather than once per field, which is what lets every input in it forgive on the
      // same terms. An editor that skips the call keeps painting until the admin leaves the field.
      assert.ok(sources.get(file)?.includes("useForgiveFixed({"), `${file} never re-judges what it is already showing`);
      // The same call carries the submit sweep, so an editor without it also leaves every date that
      // cannot be natively refused blocking the submit in silence.
    });
  }

  for (const file of pageOwnedEditors) {
    it(`${file} tells the submit which payload it was answering about`, () => {
      const source = sources.get(file) ?? "";

      // A refusal recorded with no payload behind it grades every later verdict as differing, which is
      // the old recency rule again: the next blur on the refused field deletes the message.
      assert.ok(/setSubmitFieldErrors\([^)]*,\s*\{/.test(source), `${file} records a refusal without the payload the submit was refused on`);
    });
  }
});
