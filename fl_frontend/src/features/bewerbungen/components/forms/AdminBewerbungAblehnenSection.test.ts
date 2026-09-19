import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the panel renders under the one
   Next keeps it on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { BEWERBUNG_GRUND_MAX_LENGTH } from "@/features/bewerbungen/constants.ts";
import { FLAblehnenBewerbungPayloadSchema } from "@/features/bewerbungen/schemas.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";

import type { ContextType } from "react";

const { AdminBewerbungAblehnenSection } = await import("./AdminBewerbungAblehnenSection.tsx");

/** Every method the panel reaches only after a write, which no case here makes. */
const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "ablehnenSection",
};

/** The write's own sentence for a reason past the cap, so this case follows the schema's wording. */
const ZU_LANG = (() => {
  const geprueft = FLAblehnenBewerbungPayloadSchema.shape.grund.safeParse("a".repeat(BEWERBUNG_GRUND_MAX_LENGTH + 1));

  return geprueft.success ? assert.fail("the schema takes a reason past its own cap") : (geprueft.error.issues[0]?.message ?? "");
})();

function renderPanel() {
  const user = userEvent.setup();
  render(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(AdminBewerbungAblehnenSection, { bewerbungId: "68d0f2a4c1e2b3a4d5e6f708", teamName: "SG Alpha", saisonId: "2027" }),
    ),
  );
  const grund = screen.getByRole("textbox", { name: "Grund für die Absage" });

  /** Replaces the box's reason in one paste, as a thousand keystrokes would. */
  const schreibe = async (text: string) => {
    await user.clear(grund);
    await user.click(grund);
    await user.paste(text);
  };

  return { user, grund, schreibe };
}

describe("the decline's control over the reason typed into it", () => {
  /* The button is the half a schema cannot reach, and `docs/frontend/spec.md` I18 makes it the schema's
     rule: measured trimmed, so padding neither opens an empty reason nor closes one inside the cap. */
  it("closes the decline on the trimmed reason the schema judges", async () => {
    const { schreibe } = renderPanel();

    await schreibe("   ");
    closedControl("Bewerbung ablehnen", "Schreibe zuerst einen Grund.");
    // A keystroke lifts this closure, so a sentence beside the control would move the panel under the reader (§1.14).
    assert.equal(isInTheFlow("Schreibe zuerst einen Grund."), false, "the missing reason stands in the flow");

    await schreibe(`  ${"a".repeat(BEWERBUNG_GRUND_MAX_LENGTH)}  `);
    assert.equal(
      screen.getByRole("button", { name: "Bewerbung ablehnen" }).getAttribute("aria-disabled"),
      null,
      "the decline is refused at a length the write accepts",
    );

    await schreibe("a".repeat(BEWERBUNG_GRUND_MAX_LENGTH + 1));
    closedControl("Bewerbung ablehnen", "Kürze den Grund.");
  });

  /* `.claude/rules/frontend.md` **forms**: a message between two keystrokes describes a reason nobody
     finished writing. */
  it("says the reason is too long once the box is left, and takes that back on the keystroke that fixes it", async () => {
    const { user, grund, schreibe } = renderPanel();

    await schreibe("a".repeat(BEWERBUNG_GRUND_MAX_LENGTH + 1));
    assert.equal(screen.queryByText(ZU_LANG), null, "the box judged a reason still being written");

    await user.tab();
    assert.ok(screen.queryByText(ZU_LANG), "leaving an over-long reason says nothing about its length");

    await user.type(grund, "{Backspace}");
    assert.equal(screen.queryByText(ZU_LANG), null, "the fixed reason keeps its message until the box is left again");
  });

  /* A counter over a cap the write does not enforce reads as a refusal, and a preview holding padding the
     write drops promises a message nobody sends. */
  it("counts and previews the reason the write carries", async () => {
    const { user, schreibe } = renderPanel();

    await schreibe("  Kein Platz.  ");
    assert.ok(screen.queryByText(`11 von ${String(BEWERBUNG_GRUND_MAX_LENGTH)} Zeichen`), "the counter measures a string the schema does not");

    await user.click(screen.getByRole("button", { name: "Bewerbung ablehnen" }));
    assert.ok(
      screen.queryByText("Diese Begründung geht so an die Kontaktpersonen: „Kein Platz.“"),
      "the confirmation previews a reason other than the one that goes out",
    );
  });
});
