import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { NUMMER_MAX_LENGTH, NUMMER_MUST_BE_DIGITS } from "@/features/spieler/constants.ts";
import { FLPostSaisonSpielerPayloadSchema } from "@/features/spieler/schemas.ts";
import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderMarkup } from "@/shared/testing/renderTest.ts";

import type { ReactNode } from "react";

/* Every write answers as landed, so a case reads what each form sent. */
const { calls: gesendet } = doubleActions({
  modules: ["/src/features/spieler/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Gespeichert.", spieler_id: "68c1f0a2b3c4d5e6f7a8b9c0" }),
});

/* A hook, not a first line in each case: one that throws before its own reset leaves the array
   dirty for whatever runs next, and one added without a reset inherits the last case's writes with
   nothing failing. */
beforeEach(() => {
  gesendet.length = 0;
});

/** The squad number each write of one action carried, in order. */
const nummern = (action: string): unknown[] =>
  gesendet.filter((call) => call.action === action).map((call) => (call.payload as { nummer?: unknown }).nummer);

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { NummerField } = await import("./NummerField.tsx");
const { AdminCreateSpielerForm } = await import("./AdminCreateSpielerForm.tsx");
const { AdminSpielerEditForm } = await import("./AdminSpielerEditForm/AdminSpielerEditForm.tsx");

const TEAM = { teamId: "68c1f0a2b3c4d5e6f7a8b9c1", name: "SG Alpha", shorthand: "SGA" };

/** The season the sidemenu names; no case here makes a navigation, so the router stays inert. */
const underSaison = (tree: ReactNode): ReactNode => underNext(tree, { search: "saison_id=2026" });

const renderDialog = () =>
  render(
    underSaison(
      h(AdminCreateSpielerForm, {
        saisonOptions: [{ saisonId: "2026", istNachnominiert: false, teams: [TEAM], erlaubteStufen: ["Q1"] }],
        defaultSaisonId: "2026",
        onClose: () => undefined,
      }),
    ),
  );

/** The player's editor on a stored squad row wearing 10. */
const renderEditor = () =>
  render(
    underSaison(
      h(AdminSpielerEditForm, {
        spieler: { id: "68c1f0a2b3c4d5e6f7a8b9c0", vorname: "Lena", nachname: "Meier", inactive_since: null, geburtsdatum: null },
        einwilligung: null,
        saison: {
          saisonId: "2026",
          saisonStatus: "active",
          erlaubteStufen: ["Q1"],
          membership: {
            team_id: TEAM.teamId,
            nummer: "10",
            position: null,
            stufe: null,
            ist_nachnominiert: false,
            rolle: null,
            inactive_since: null,
          },
        },
        teams: [TEAM],
        membershipCount: 1,
        pageHeader: { title: "Lena Meier" },
      }),
    ),
  );

const nummerBox = () => screen.getByRole("textbox", { name: "Nummer" });

describe("the squad number's refusal as the admin reads it", () => {
  it("tells the create dialog's reader the format once Speichern is pressed, and not before", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(nummerBox(), "7a");
    assert.ok(screen.queryByText(NUMMER_MUST_BE_DIGITS) === null, "the dialog judged the number before anybody pressed Speichern");

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    screen.getByText(NUMMER_MUST_BE_DIGITS);
  });

  // Never between keystrokes (`.claude/rules/frontend.md` forms), and in the dialog's own sentence once left.
  it("tells the squad editor's reader the same sentence once the box is left, and nothing while typing", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.clear(nummerBox());
    await user.type(nummerBox(), "7a");
    assert.ok(screen.queryByText(NUMMER_MUST_BE_DIGITS) === null, "the editor judged a number nobody had finished typing");

    await user.tab();
    screen.getByText(NUMMER_MUST_BE_DIGITS);
  });
});

/* Surrounding whitespace is no format an administrator should have to fight, and one field should not take a
   number on one form that it refuses on the other. */
describe("a squad number typed with space around it", () => {
  it("is sent trimmed from the create dialog", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByRole("textbox", { name: "Vorname" }), "Lena");
    await user.type(screen.getByRole("textbox", { name: "Nachname" }), "Meier");
    await user.click(screen.getByRole("button", { name: "Team" }));
    await user.click(screen.getByRole("option", { name: new RegExp(TEAM.name) }));
    await user.type(nummerBox(), " 7 ");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    assert.deepEqual(nummern("postSpielerAction"), ["7"], "the dialog sends the space along, or sends nothing");
  });

  it("is sent trimmed from the squad editor", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.clear(nummerBox());
    await user.type(nummerBox(), " 7 ");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    assert.deepEqual(nummern("patchSaisonSpielerAction"), ["7"], "the editor sends the space along, or sends nothing");
  });
});

describe("the cap the sentence names", () => {
  /* `SQUAD_NUMMER_REGEX` spells its figure for the backend mirror to pair, so nothing but this ties it to
     the cap the box holds and the sentence names. */
  it("is the one the box holds and the schema refuses past", () => {
    const box = renderMarkup(NummerField, { label: "Nummer", value: "", onChange: () => undefined });
    const nummer = FLPostSaisonSpielerPayloadSchema.shape.nummer;

    assert.match(box, new RegExp(`maxLength="${String(NUMMER_MAX_LENGTH)}"`, "i"), "the box holds a cap the sentence does not name");
    assert.equal(nummer.safeParse("1".repeat(NUMMER_MAX_LENGTH)).success, true, "the schema refuses a number the box accepts");
    assert.equal(
      nummer.safeParse("1".repeat(NUMMER_MAX_LENGTH + 1)).error?.issues[0]?.message,
      NUMMER_MUST_BE_DIGITS,
      "the schema takes a number longer than the sentence allows",
    );
  });
});
