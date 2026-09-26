import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FunktionOrt } from "./FunktionSwitcher.tsx";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FunktionSwitcher } = await import("./FunktionSwitcher.tsx");
const { SidemenuStateProvider } = await import("./SidemenuState.tsx");
const { NAME_WRAP_CLASSES } = await import("../../ui/nameWrap.ts");

const GOETHE: FunktionOrt = { href: "/bereich/team/t1/2526", titel: "Goethe-Gymnasium", detail: "Saison 2526 · Trainer" };
const SPIELER: FunktionOrt = { href: "/bereich/spieler", titel: "Spieler", detail: "Dein Kadereintrag" };
const VERWALTUNG: FunktionOrt = { href: "/bereich/admin", titel: "Verwaltung", detail: "Die Verwaltung der Liga" };

/** The switcher as a shell's sidemenu renders it, standing at `pathname`; the drawer's closes counted. */
function switcherAt(
  pathname: string,
  { orte = [GOETHE, SPIELER], mitBereich = true, isDesktopCollapsed = false } = {},
): { closes: () => number } {
  let closes = 0;
  render(
    underNext(
      h(SidemenuStateProvider, {
        state: { isDesktopCollapsed: isDesktopCollapsed, onMobileClose: () => void (closes += 1) },
        children: h(FunktionSwitcher, { orte: orte, ohneOrt: "Dein Bereich", mitBereich: mitBereich }),
      }),
      { pathname },
    ),
  );

  return { closes: () => closes };
}

/** Opens the menu from the trigger named `name` and answers its items. */
async function openMenu(name: string): Promise<HTMLElement[]> {
  await userEvent.setup().click(screen.getByRole("button", { name }));
  // react-aria names the menu by the trigger that opens it, as the menu-button pattern does, so the list's
  // own name sits on the group holding the places.
  const menu = screen.getByRole("menu", { name });
  assert.ok(within(menu).getByRole("group", { name: "Deine Funktionen" }), "the places are not named as the person's Funktionen");

  // Every item in the order it is offered, the places' radio items and the plain way to `/bereich` alike.
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')];
}

describe("when the switcher shows", () => {
  /* One place is no choice: a press would land where it started. */
  it("shows nothing for a person whose Funktionen lead to one place", () => {
    switcherAt(GOETHE.href, { orte: [GOETHE] });

    assert.equal(screen.queryAllByRole("button").length, 0, "one place is offered as a choice");
  });

  it("shows for a person whose Funktionen lead to two places", () => {
    switcherAt(GOETHE.href);

    assert.ok(screen.getByRole("button", { name: "Goethe-Gymnasium, Funktion wechseln" }));
  });
});

describe("what the switcher's trigger names", () => {
  /* Every page inside a place is that place's: the longest address the path opens with decides. */
  it("names the place the address stands in, below its own page too", () => {
    switcherAt(`${GOETHE.href}/kader`, { orte: [GOETHE, SPIELER, VERWALTUNG] });

    assert.ok(screen.getByRole("button", { name: "Goethe-Gymnasium, Funktion wechseln" }));
  });

  /* A place is a whole segment: `/bereich/spielerin` stands in no place `/bereich/spieler` names. */
  it("names the shell's own words where the address is none of the places", () => {
    switcherAt("/bereich/spielerin");

    assert.ok(screen.getByRole("button", { name: "Dein Bereich, Funktion wechseln" }));
  });

  /* Two clubs sharing a long name's opening words are told apart only by the rest, which a truncated
     line hides on a phone: the name wraps, as the landing's cards and the forbidden panel wrap it. */
  it("wraps a club's name on the trigger and in the list rather than cutting it", async () => {
    const lang: FunktionOrt = { ...GOETHE, titel: "Städtisches Gymnasium Nord mit bilingualem Zweig" };
    switcherAt(GOETHE.href, { orte: [lang, SPIELER] });
    const trigger = screen.getByRole("button", { name: `${lang.titel}, Funktion wechseln` });
    const [item] = await openMenu(`${lang.titel}, Funktion wechseln`);

    for (const [where, holder] of [
      ["trigger", trigger],
      ["list", item!],
    ] as const) {
      const name = within(holder).getByText(lang.titel);
      assert.ok(
        NAME_WRAP_CLASSES.split(" ").every((token) => name.classList.contains(token)),
        `the ${where} does not wrap the name`,
      );
      assert.ok(!name.classList.contains("truncate"), `the ${where} cuts the name off`);
    }
    assert.ok(!trigger.classList.contains("h-9"), "the trigger fixes a height a wrapped name runs out of");
  });

  /* Collapsed, the square holds a glyph alone, so its name is the action rather than a title nobody sees. */
  it("names the action alone on the collapsed rail's square", () => {
    switcherAt(GOETHE.href, { isDesktopCollapsed: true });

    assert.ok(screen.getByRole("button", { name: "Funktion wechseln" }));
  });
});

describe("what the switcher lists", () => {
  it("lists the places as links in their order, then the way to the person's own area", async () => {
    switcherAt(GOETHE.href);
    const items = await openMenu("Goethe-Gymnasium, Funktion wechseln");

    assert.deepEqual(
      items.map((item) => [item.getAttribute("href"), item.textContent]),
      [
        [GOETHE.href, "Goethe-GymnasiumSaison 2526 · Trainer"],
        [SPIELER.href, "SpielerDein Kadereintrag"],
        ["/bereich", "Zu Deinem Bereich"],
      ],
    );
  });

  /* The person shell's own landing is `/bereich`, which its sidemenu already lists. */
  it("leaves the way to the person's own area out where the shell's landing is that address", async () => {
    switcherAt(SPIELER.href, { mitBereich: false });
    const items = await openMenu("Spieler, Funktion wechseln");

    assert.deepEqual(
      items.map((item) => item.getAttribute("href")),
      [GOETHE.href, SPIELER.href],
    );
  });

  /* The trigger names the current place, and the list marks it: selection and a link on one item. */
  it("marks the place the address stands in, and no other", async () => {
    switcherAt(`${SPIELER.href}/konto`);
    const items = await openMenu("Spieler, Funktion wechseln");

    assert.deepEqual(
      items.map((item) => [item.getAttribute("href"), item.getAttribute("aria-checked")]),
      [
        [GOETHE.href, "false"],
        [SPIELER.href, "true"],
        ["/bereich", null],
      ],
    );
  });

  /* A place is chosen; the way to `/bereich` is an action beside the places, never one of them, so it is
     no radio option and sits in no group to announce its own name a second time. */
  it("offers the way to the person's own area as a plain item outside the places", async () => {
    switcherAt(GOETHE.href);
    await openMenu("Goethe-Gymnasium, Funktion wechseln");
    const menu = screen.getByRole("menu");
    const bereich = within(menu).getByRole("menuitem", { name: "Zu Deinem Bereich" });

    assert.equal(bereich.getAttribute("aria-checked"), null, "the way to /bereich is offered as a place to choose");
    assert.equal(bereich.closest('[role="group"]'), null, "the way to /bereich sits in a group of its own name");
    assert.equal(menu.getAttribute("aria-label"), null, "the menu carries a name its trigger's overrides");
  });

  /* The roles are the detail, read after the name rather than run on into it. */
  it("names each place by its title and describes it by its detail", async () => {
    switcherAt(GOETHE.href);
    await openMenu("Goethe-Gymnasium, Funktion wechseln");

    for (const ort of [GOETHE, SPIELER]) {
      assert.ok(
        screen.getByRole("menuitemradio", { name: ort.titel, description: ort.detail }),
        `${ort.titel} is not named by its title alone`,
      );
    }
  });

  /* Each press leaves the shell, and the router hides the departing tree rather than unmounting it. */
  it("closes the drawer on every press", async () => {
    const { closes } = switcherAt(GOETHE.href);
    const offered = (await openMenu("Goethe-Gymnasium, Funktion wechseln")).length;

    // Each press closes the menu, so it is opened again for the next item, the way to `/bereich` among them.
    for (let index = 0; index < offered; index += 1) {
      const items =
        index === 0
          ? [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')]
          : await openMenu("Goethe-Gymnasium, Funktion wechseln");
      await userEvent.setup().click(items[index]!);
    }

    assert.equal(offered, 3, `the menu offers ${String(offered)} items rather than two places and the way to /bereich`);
    assert.equal(closes(), offered, "a press leaves the drawer open behind it");
  });
});
