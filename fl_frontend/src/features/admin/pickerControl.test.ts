import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { createElement as h, useState } from "react";

import { fireEvent, render } from "@testing-library/react";

import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

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

/** No descriptor for any field, which is the state an editor's panel stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

const OPTIONEN: RefusableOption[] = [{ id: "t1", name: "SG Alpha", meta: null, refusal: null }];

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
  const onChange = (id: string) => setGewaehlt(OPTIONEN.find((option) => option.id === id) ?? null);
  return h(RefusableSelect, { label: "Team", placeholder: "Team wählen", value: gewaehlt, options: OPTIONEN, onChange, isDisabled: false });
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
      const gemeldet: string[] = [];
      for (const kanal of ["warn", "error"] as const)
        mock.method(console, kanal, (...teile: unknown[]) => void gemeldet.push(teile.map(String).join(" ")));
      const { container, unmount } = render(host);
      const mirror = container.querySelector("select") ?? assert.fail(`${name} renders no mirrored select`);

      fireEvent.change(mirror, { target: { value: key } });

      mock.restoreAll();
      unmount();
      assert.equal(mirror.value, key, `${name} never took the pick, so nothing below is judged`);
      assert.deepEqual(
        gemeldet.filter((zeile) => /uncontrolled to controlled|controlled to uncontrolled/.test(zeile)),
        [],
        `${name} changed its kind`,
      );
    }
  });
});
