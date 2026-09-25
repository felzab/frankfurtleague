import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h, useState } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { refusalWrappers, renderTree } from "@/shared/testing/renderTest.ts";

import type { ReactNode } from "react";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { Hint } = await import("./Hint.tsx");
const { InfoHint } = await import("./InfoHint.tsx");
const { Button } = await import("@heroui/react/button");
const { Input } = await import("@heroui/react/input");
const { Label } = await import("@heroui/react/label");
const { TextField } = await import("@/shared/components/ui/TextField.tsx");

const REASON = "Es gibt noch keine Änderung zu speichern.";
const LABEL = "Speichern";

/** A closed control as every call site hands one in: native `disabled`, which takes it out of the tab order. */
const refused = (reason: string | null, label = LABEL): ReactNode =>
  h(Hint, {
    mode: "refusal",
    reason,
    label,
    children: h("button", { type: "submit", disabled: reason !== null }, label),
  });

/** A link with nothing to follow yet, as the club editor's two outward links render while their address is incomplete. */
const refusedLink = (reason: string, label: string): ReactNode =>
  h(Hint, { mode: "refusal", reason, label, children: h("a", { "aria-disabled": true, "aria-label": label }) });

/** The field somebody is typing in beside the hint, which is where a pointer crossing the hint finds the focus. */
const beside = (hint: ReactNode): ReactNode => h("div", null, h("input", { "aria-label": "Feld" }), hint);

/** A panel showing `text`, whichever way it opened: the refusal's own description carries the reason too, hidden. */
const panelShows = (text: string): boolean => screen.queryAllByText(text).some((node) => node.closest("[hidden]") === null);

describe("a refusal laid over a closed control", () => {
  /* WCAG 2.5.3: speech input finds a control by the words on it, so the one stop is named by those words and the
     reason describes it. */
  it("is one closed button named by the control's words and described by the reason", () => {
    render(refused(REASON));

    const overlay = screen.getByRole("button", { name: LABEL, description: REASON });
    assert.equal(overlay.getAttribute("aria-disabled"), "true", "the overlay is announced as a control that can be used");
    // Inert, or the control is announced a second time beside the overlay naming it.
    assert.ok(screen.getByText(LABEL).closest("[inert]") !== null, "the closed control is reachable beside the overlay naming it");
    assert.equal(panelShows(REASON), false, "the reason stands in the flow beside the control");
  });

  it("describes each of two refusals on one page by its own reason", () => {
    render(h("div", null, refused(REASON), refused("Wähle zuerst ein Team.", "Gruppen tauschen")));

    assert.ok(screen.getByRole("button", { name: LABEL, description: REASON }));
    assert.ok(screen.getByRole("button", { name: "Gruppen tauschen", description: "Wähle zuerst ein Team." }));
  });

  /* An overlay announcing a closure over an open control closes it for a screen reader. */
  it("lays nothing over a control nothing refuses", () => {
    const { container } = render(refused(null));

    assert.equal(screen.getAllByRole("button").length, 1, "an open control sits under an overlay");
    assert.equal(screen.getByRole("button", { name: LABEL }).getAttribute("aria-describedby"), null, "an open control describes a refusal");
    assert.ok(container.querySelector("[inert]") === null, "an open control is taken out of reach");
  });

  /* A write that closes the control it ran from lands the reason while the keyboard is still there, and the next Tab
     would otherwise start from the top of the page. */
  it("hands the keyboard's focus to the overlay when a reason arrives under it", async () => {
    function Schreibt() {
      const [reason, setGrund] = useState<string | null>(null);
      const button = h("button", { type: "button", disabled: reason !== null, onClick: () => setGrund(REASON) }, LABEL);
      return h(Hint, { mode: "refusal", reason, label: LABEL, children: button });
    }
    render(h(Schreibt));

    await userEvent.setup().click(screen.getByRole("button", { name: LABEL }));

    // `ok` rather than `equal` on elements throughout: a failure's report inspects both sides, and a jsdom node holds the whole window.
    assert.ok(document.activeElement === screen.getByRole("button", { name: LABEL, description: REASON }), "the focus left the overlay's stop");
  });

  /* The panel's open state lives with the overlay: a reason lifting under an open panel and returning before the
     pointer moves would otherwise show a panel nobody opened. */
  it("opens no panel for a returning reason that its lifted reason left open", async () => {
    const { rerender } = render(refused(REASON));
    await userEvent.setup().hover(screen.getByRole("button", { name: LABEL, description: REASON }));
    assert.ok(panelShows(REASON), "the hover opened nothing, so nothing below is left open");

    rerender(refused(null));
    rerender(refused(REASON));

    assert.equal(panelShows(REASON), false, "the returning reason shows the panel its lifted reason left open");
  });
});

/* One mechanism opens all three (`fl_frontend/src/shared/hooks/useHoverOpenOverlay.ts :: useHoverOpenOverlay`): a hover
   opens a plain panel beside the page, and a press, which a mouse makes only after hovering, opens the dialog. */
describe("a hint a hover or a press opens", () => {
  // The refusal's trigger by its description too: the control under it answers to the same name.
  const HINTS: [name: string, hint: ReactNode, trigger: { name: string; description?: string }, text: string][] = [
    ["a refusal", refused(REASON), { name: LABEL, description: REASON }, REASON],
    [
      "a revealed hint",
      h(Hint, { mode: "reveal", label: "Hinweis zur Adresse", body: { lead: "Der Heimstandort." } }),
      { name: "Hinweis zur Adresse" },
      "Der Heimstandort.",
    ],
    [
      "an info hint",
      h(InfoHint, { label: "Was hier steht", children: "Alle Warnungen an einem Ort." }),
      { name: "Was hier steht" },
      "Alle Warnungen an einem Ort.",
    ],
  ];

  for (const [name, hint, trigger, text] of HINTS) {
    it(`opens ${name} beside the page on a hover, leaving the focus in the field`, async () => {
      const user = userEvent.setup();
      render(beside(hint));
      await user.click(screen.getByRole("textbox", { name: "Feld" }));

      await user.hover(screen.getByRole("button", trigger));

      assert.ok(panelShows(text), "a pointer moving over the trigger opens nothing");
      assert.ok(screen.queryByRole("dialog") === null, "the hover mounts a dialog, which takes the focus");
      assert.ok(document.activeElement === screen.getByRole("textbox", { name: "Feld" }), "the hover takes the focus out of the field");
    });

    it(`turns ${name}'s hover-opened panel into a dialog named by its trigger on a press`, async () => {
      const user = userEvent.setup();
      render(hint);

      await user.hover(screen.getByRole("button", trigger));
      await user.click(screen.getByRole("button", trigger));

      assert.ok(screen.getByRole("dialog", { name: trigger.name }).textContent?.includes(text), "the press opens no dialog holding the text");
    });
  }

  /* A finger has no hover, and one dragged across the trigger is the page scrolling under it. */
  it("opens nothing for a touch moving over the trigger", () => {
    render(refused(REASON));

    fireEvent.pointerMove(screen.getByRole("button", { name: LABEL, description: REASON }), { pointerType: "touch" });

    assert.equal(panelShows(REASON), false, "a finger crossing the overlay opens its panel");
  });
});

/* HeroUI's button rather than a native one: react-aria hands a popover trigger's `id` and `aria-expanded` to every
   pressable inside the trigger, and a native `<button>` consumes nothing, so it cannot show the leak. */
describe("a refusal laid over HeroUI's closed button", () => {
  const html = renderTree(
    h(Hint, { mode: "refusal", reason: REASON, label: LABEL, children: h(Button, { type: "submit", isDisabled: true }, LABEL) }),
  );

  it("gives no two elements one id, and the popover's trigger state to the overlay alone", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((hit) => hit[1]!);
    const button = /<button[^>]*>/.exec(html)?.[0] ?? assert.fail("the refusal renders no button");

    // The reason and the button each carry one, so fewer means the render lost what the case compares.
    assert.ok(ids.length >= 2, `the refusal renders ${String(ids.length)} ids, too few to hold a duplicate`);
    assert.deepEqual(ids, [...new Set(ids)], "two elements answer to one id, so a reference to it resolves to either");
    assert.doesNotMatch(button, /aria-expanded/, "the closed button underneath is announced as a popover trigger");
  });
});

/* Every panel test reads its refusals through `refusalWrappers`, so this is where its reading is held
   to the markup the overlay really renders rather than to a copy of it. */
describe("the shared refusal reader over this overlay's own markup", () => {
  it("reads each refusal's name, its control's label and its reason, and nothing from a reveal hint or an open control", () => {
    const html = renderTree(
      h(
        "div",
        null,
        h(Hint, { mode: "reveal", label: "Hinweis zur Adresse", body: { lead: "Der Heimstandort." } }),
        refused(REASON),
        h(Hint, {
          mode: "refusal",
          reason: "Wähle zuerst ein Team.",
          label: "Gruppen tauschen",
          children: h(Button, { isDisabled: true }, "Gruppen tauschen"),
        }),
        h(Hint, {
          mode: "refusal",
          reason: "Trage zuerst eine Adresse ein.",
          label: "Link erneut senden an Trainer",
          children: h(Button, { isDisabled: true, "aria-label": "Link erneut senden an Trainer" }, "Link erneut senden"),
        }),
        refusedLink("Erst eine gültige Adresse eingeben", "Website in neuem Tab öffnen"),
        refused(null, "Abbrechen"),
      ),
    );

    assert.deepEqual(refusalWrappers(html), [
      { name: LABEL, label: LABEL, reason: REASON },
      { name: "Gruppen tauschen", label: "Gruppen tauschen", reason: "Wähle zuerst ein Team." },
      // The control's own name where it says more than its words, which the overlay then carries whole.
      { name: "Link erneut senden an Trainer", label: "Link erneut senden an Trainer", reason: "Trage zuerst eine Adresse ein." },
      { name: "Website in neuem Tab öffnen", label: "Website in neuem Tab öffnen", reason: "Erst eine gültige Adresse eingeben" },
    ]);
  });

  /* The reader's other half of the closure: an overlay over a control that still works is no refusal a panel may
     count, for a button and for a link alike. */
  it("reads no refusal over a control left open", () => {
    const html = renderTree(refusedLink("Erst eine gültige Adresse eingeben", "Website in neuem Tab öffnen"));
    const openLink = html.replace("<a ", '<a href="https://www.beispielverein.de" ');
    const openButton = renderTree(refused(REASON)).replace(' disabled=""', "");

    assert.equal(refusalWrappers(html).length, 1, "the closed link is not read, so the two cases below compare nothing");
    assert.notEqual(openLink, html, "the link is not where this case opens it");
    assert.deepEqual(refusalWrappers(openLink), [], "a link with somewhere to go is read as closed");
    assert.deepEqual(refusalWrappers(openButton), [], "a button nothing disables is read as closed");
  });

  /* WCAG 2.5.3 on the one tab stop: speech input says the words on screen, so a name holding more than
     them is found and a name missing them is not. */
  it("refuses an overlay whose name does not contain the words its control shows", () => {
    const html = renderTree(refused(REASON));
    const renamed = html.replace(`aria-label="${LABEL}"`, 'aria-label="Sichern"');

    assert.notEqual(renamed, html, "the overlay's name is not where this case renames it");
    assert.throws(() => refusalWrappers(renamed), /Sichern.*Speichern/);
  });
});

const FIELD_HINT = "An diese Adresse schicken wir den Link.";

describe("a hint inside the field it explains", () => {
  /* The field names its description itself, so no call site can leave the sentence describing nothing. */
  it("describes the field's own input", () => {
    render(h(TextField, null, h(Label, null, "E-Mail"), h(Input), h(Hint, { mode: "field", text: FIELD_HINT })));

    const hint = screen.getByText(FIELD_HINT);
    assert.ok(hint.id !== "", "the hint publishes no id");
    assert.ok(
      (screen.getByRole("textbox", { name: "E-Mail" }).getAttribute("aria-describedby") ?? "").split(" ").includes(hint.id),
      "the input is not described by the hint inside its field",
    );
  });
});
