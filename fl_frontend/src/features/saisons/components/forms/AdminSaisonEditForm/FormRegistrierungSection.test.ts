import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { declaredStatus } from "@/shared/testing/declaredStatus.ts";

import type { SaisonFieldPath } from "@/features/saisons/saisonDraftStatus.ts";
import type { FLSaisonRegistrierung } from "@/features/saisons/schemas.ts";

const { FormRegistrierungSection } = await import("./FormRegistrierungSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

type PanelProps = Parameters<typeof FormRegistrierungSection>[0];

const STATUS = declaredStatus<SaisonFieldPath>(["registrierung"]);

const WINDOW: FLSaisonRegistrierung = { offen: true, von: "2026-02-01", bis: "2026-03-01" };

const panel = (props: Partial<PanelProps>) =>
  h(DraftStatusProvider, {
    status: STATUS,
    children: h(FormRegistrierungSection, {
      registrierung: null,
      onRegistrierungChange: () => undefined,
      onFieldLeft: () => undefined,
      ...props,
    }),
  });

const outerSwitch = (): HTMLElement => screen.getByRole("switch", { name: /Diese Saison hat eine Registrierungsfrist/ });
const freischaltung = (): HTMLElement | null => screen.queryByRole("switch", { name: /Registrierungen sind freigeschaltet/ });

describe("the registration window panel", () => {
  /* The deploy ships the window dark, so the closed state is the one every season stands in: a panel
     rendering its span before anybody opened one would offer a deadline nobody chose. */
  it("shows the outer switch alone until a window is recorded", () => {
    const { unmount } = render(panel({}));

    assert.ok(screen.getByRole("switch", { name: /Diese Saison hat eine Registrierungsfrist/, checked: false }));
    assert.ok(screen.queryByText("Registrierungsfrist") === null, "the span is rendered on a season that records no window");
    assert.equal(freischaltung(), null);
    unmount();
  });

  it("offers both ends and the freischaltung once a window stands", () => {
    const { unmount } = render(panel({ registrierung: WINDOW }));

    assert.ok(screen.getByText("Registrierungsfrist"));
    // The pair is one control to a screen reader, which is what makes the window one decision.
    assert.ok(screen.getByRole("group", { name: "Registrierungsfrist" }));
    assert.ok(screen.getByRole("switch", { name: /Registrierungen sind freigeschaltet/, checked: true }));
    unmount();
  });

  /* The whole block or `null`, never a half-written one: `null` is what the payload reads as the
     season that takes no registrations, and a flag left beside an emptied span would not be that. */
  it("writes null out of the switch, and a dateless block back in", async () => {
    const written: (FLSaisonRegistrierung | null)[] = [];
    const { unmount } = render(panel({ registrierung: WINDOW, onRegistrierungChange: (next) => written.push(next) }));

    await userEvent.click(outerSwitch());
    unmount();

    const { unmount: leave } = render(panel({ onRegistrierungChange: (next) => written.push(next) }));
    await userEvent.click(outerSwitch());
    leave();

    assert.deepEqual(written, [null, { offen: false, von: "", bis: "" }]);
  });

  /* The three names a refusal of this panel's payload lands on. The outer switch carries no `name`:
     `registrierung` itself is refusable only on a shape the typed payload cannot build. */
  it("names each field of the block and leaves the record's own switch unnamed", () => {
    const { unmount } = render(panel({ registrierung: WINDOW }));

    const named = new Set([...document.querySelectorAll("[name]")].map((element) => element.getAttribute("name")));

    assert.deepEqual([...named].sort(), ["registrierung.bis", "registrierung.offen", "registrierung.von"]);
    unmount();
  });

  it("reports each end's own path when the picker is left", async () => {
    const left: string[] = [];
    const { unmount } = render(panel({ registrierung: WINDOW, onFieldLeft: (paths) => left.push(...paths) }));

    await userEvent.click(screen.getByRole("spinbutton", { name: /Tag, Beginn/ }));
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();

    assert.ok(left.includes("registrierung.von"), `no blur reached the start picker; saw ${JSON.stringify(left)}`);
    unmount();
  });
});
