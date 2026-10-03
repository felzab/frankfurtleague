import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { createElement as h, useState } from "react";

import { fireEvent, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { declaredStatus } from "@/shared/testing/declaredStatus.ts";

import type { SpielFieldPath } from "@/features/spiele/draftStatus.ts";
import type { FLSonderereignis } from "@/features/spiele/schemas.ts";
import type { FLGruppenNames } from "@/features/teams/schemas.ts";
import type { RefusableOption } from "@/shared/components/ui/refusableOption.ts";
import type { ReactNode } from "react";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { GruppeSelect } = await import("@/features/teams/components/forms/GruppeSelect.tsx");
const { TeamSelect } = await import("@/features/spieler/components/forms/TeamSelect.tsx");
const { FormSonderereignisSection } = await import("@/features/spiele/components/forms/AdminEditSpielDataForm/FormSonderereignisSection.tsx");
const { RefusableSelect } = await import("@/shared/components/ui/RefusableSelect.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

const STATUS = declaredStatus<SpielFieldPath>(["sonderereignis"]);

const OPTIONS: RefusableOption[] = [{ id: "t1", name: "SG Alpha", meta: null, refusal: null }];

function GruppeHost() {
  const [gruppe, setGruppe] = useState<FLGruppenNames | null>(null);
  const offer = [
    { gruppe: "A" as const, occupied: 1, capacity: 4 },
    { gruppe: "B" as const, occupied: 1, capacity: 4 },
  ];
  return h(GruppeSelect, { value: gruppe, onChange: setGruppe, offer });
}

function TeamHost() {
  const [teamId, setTeamId] = useState<string | null>(null);
  return h(TeamSelect, { value: teamId, onChange: setTeamId, teams: [{ teamId: "t1", name: "SG Alpha", shorthand: "SGA" }] });
}

function RefusableHost() {
  const [gewaehlt, setGewaehlt] = useState<RefusableOption | null>(null);
  const onChange = (id: string) => setGewaehlt(OPTIONS.find((option) => option.id === id) ?? null);
  return h(RefusableSelect, { label: "Team", placeholder: "Team wählen", value: gewaehlt, options: OPTIONS, onChange, isDisabled: false });
}

function SonderereignisHost() {
  const [sonderereignis, setSonderereignis] = useState<FLSonderereignis | null>(null);
  const section = h(FormSonderereignisSection, {
    sonderereignis,
    hasSonderereignis: true,
    onHasSonderereignisChange: () => undefined,
    hasBothSides: true,
    onSonderereignisChange: setSonderereignis,
    banners: [],
  });
  return h(DraftStatusProvider, { status: STATUS, children: section });
}

/** Each picker over a parent holding no pick yet, and the key picked through the `<select>` react-aria mirrors it into. */
const PICKERS: [name: string, host: ReactNode, key: string][] = [
  ["the group picker", h(GruppeHost), "A"],
  ["the team picker", h(TeamHost), "t1"],
  ["the refusable picker", h(RefusableHost), "t1"],
  ["the Sonderereignis picker", h(SonderereignisHost), "ausgefallen"],
];

/* A controlled picker holding no pick passes `null`: react-stately reads `undefined` as uncontrolled, so the first
   pick switches the picker's kind, which React warns about and a browser logs. */
describe("a picker whose parent holds no pick yet", () => {
  it("stays controlled through its first pick", () => {
    for (const [name, host, key] of PICKERS) {
      // Both channels: which of them reports the switch is React's and react-stately's to choose.
      const reported: string[] = [];
      for (const channel of ["warn", "error"] as const)
        mock.method(console, channel, (...parts: unknown[]) => void reported.push(parts.map(String).join(" ")));
      const { container, unmount } = render(host);
      const mirror = container.querySelector("select") ?? assert.fail(`${name} renders no mirrored select`);

      fireEvent.change(mirror, { target: { value: key } });

      mock.restoreAll();
      unmount();
      assert.equal(mirror.value, key, `${name} never took the pick, so nothing below is judged`);
      assert.deepEqual(
        reported.filter((line) => /uncontrolled to controlled|controlled to uncontrolled/.test(line)),
        [],
        `${name} changed its kind`,
      );
    }
  });
});

/* A team's name is whatever somebody typed. The trigger is one line at the field's height, and HeroUI floors the
   open list at the trigger's width and caps it nowhere, so a long name would widen either past the screen. */
describe("a picker holding a name somebody typed", () => {
  it("truncates the picked name inside the trigger", () => {
    const { container, unmount } = render(
      h(TeamSelect, { value: "t1", onChange: () => undefined, teams: [{ teamId: "t1", name: "SG Alpha", shorthand: "SGA" }] }),
    );
    const worte = [...container.querySelectorAll("button span")].find((span) => span.textContent === "SG Alpha")?.classList;
    unmount();

    assert.ok(worte?.contains("min-w-0") === true, "the trigger's words keep their longest word as their floor");
    assert.ok(worte.contains("truncate"), "the trigger's words run past the trigger rather than end in an ellipsis");
  });

  it("caps every picker's open list at the screen's width", async () => {
    for (const [name, host] of PICKERS) {
      const user = userEvent.setup();
      const { container, unmount } = render(host);
      await user.click(container.querySelector('button[aria-haspopup="listbox"]') ?? assert.fail(`${name} renders no trigger`));
      const liste = document.querySelector('[data-slot="select-popover"]') ?? assert.fail(`${name} opens no list`);
      const capped = liste.classList.contains("max-w-[calc(100vw-2rem)]");
      unmount();

      assert.ok(capped, `${name}'s open list widens past the screen for a long row`);
    }
  });
});
