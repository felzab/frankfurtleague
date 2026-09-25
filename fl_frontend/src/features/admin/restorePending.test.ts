import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { before, describe, it } from "node:test";

import { createElement as h } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas.ts";
import type { AdminSpielerRow } from "@/features/spieler/types.ts";
import type { FLSpielort } from "@/features/spielorte/schemas.ts";
import type { AdminTeamRow } from "@/features/teams/types.ts";
import type { ReactNode } from "react";

/** A reactivation nobody has answered: the list stays in the state its running write holds it in. */
const { calls, answerPending } = doubleActions({ modules: [/\/src\/features\/\w+\/actions\.ts$/], answer: () => new Promise(() => undefined) });

const APP_TOAST = 'const raise = () => () => "0";\nexport const appToast = { success: raise(), danger: raise() };';

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/shared/utils/appToast.ts")) return { format: "module", source: APP_TOAST, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const STILLGELEGT_AM = "2026-09-09";
const TEAM_ID = "6890a1b2c3d4e5f607910001";

/** A retired club, whose only restore is its own. */
const CLUB: AdminTeamRow = {
  id: "t1",
  name: "Lessing",
  full_name: "Lessing Gymnasium",
  shorthand: "LE",
  inactive_since: STILLGELEGT_AM,
  selected: { gruppe: "A", austritt: null },
  isRetireable: false,
  publicSaisonId: null,
};

/** Retired twice over, so the row carries both restores the list draws: the person's and the squad row's. */
const PERSON: AdminSpielerRow = {
  id: "s1",
  vorname: "Lena",
  nachname: "Meier",
  fullName: "Lena Meier",
  inactive_since: STILLGELEGT_AM,
  selected: {
    team_id: TEAM_ID,
    nummer: "7",
    position: "Angriff",
    stufe: "Q2",
    ist_nachnominiert: false,
    rolle: null,
    inactive_since: STILLGELEGT_AM,
    teamName: "Carl-Schurz-Schule",
    teamShorthand: "CSS",
  },
};

const ORT: FLSpielort = {
  id: "o1",
  name: "Halle West",
  address: { strasse: "Feldweg", hausnummer: "3", plz: "60437", stadtteil: "", stadt: "Frankfurt am Main" },
  maps_link: "Halle West, Feldweg 3, 60437 Frankfurt am Main",
  default_mietpreis: 40,
  inactive_since: STILLGELEGT_AM,
};

const REFEREE: FLSchiedsrichter = {
  id: "r1",
  name: "Ben Vogt",
  schule: "Carl-Schurz-Schule",
  default_payment: 20,
  kontakt: { telefon: "069 1234567", email: "kontakt@example.com" },
  inactive_since: STILLGELEGT_AM,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
};

/** Filled from `before`: each list is imported after this file's own doubles are registered. */
const LISTS: Record<string, () => ReactNode> = {};

before(async () => {
  const { AdminTeamsTable } = await import("@/features/teams/components/collections/AdminTeamsTable.tsx");
  const { AdminSpielerTable } = await import("@/features/spieler/components/collections/AdminSpielerTable.tsx");
  const { AdminSpielorteTable } = await import("@/features/spielorte/components/collections/AdminSpielorteTable.tsx");
  const { AdminSchiedsrichterTable } = await import("@/features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx");

  LISTS.AdminTeamsTable = () => h(AdminTeamsTable, { filteredTeams: [CLUB], emptiness: "none", setDeletingTeam: () => undefined });
  LISTS.AdminSpielerTable = () =>
    h(AdminSpielerTable, {
      filteredSpieler: [PERSON],
      emptiness: "none",
      saisonTeams: [{ teamId: TEAM_ID, name: "Carl-Schurz-Schule", shorthand: "CSS" }],
      selectedSaisonId: "2026",
      setDeletingSpieler: () => undefined,
    });
  LISTS.AdminSpielorteTable = () => h(AdminSpielorteTable, { filteredSpielorte: [ORT], emptiness: "none", setDeletingOrt: () => undefined });
  LISTS.AdminSchiedsrichterTable = () =>
    h(AdminSchiedsrichterTable, { filteredSchiedsrichter: [REFEREE], emptiness: "none", setDeletingSchiedsrichter: () => undefined });
});

/** Every admin list offering a restore, found by its import rather than by the pending state this file asserts. */
function listsOfferingARestore(): string[] {
  const features = path.resolve(import.meta.dirname, "..");

  return readdirSync(features)
    .map((slice) => path.join(features, slice, "components", "collections"))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((file) => file.endsWith(".tsx"))
        .filter((file) => /\bRowActionRestore\b/.test(readFileSync(path.join(dir, file), "utf8")))
        .map((file) => file.replace(/\.tsx$/, "")),
    )
    .sort();
}

/** Each list under the two contexts every row reads, ready to render. */
const mount = (list: ReactNode): ReactNode => underNext(list, { search: "saison_id=2026" });

/** Every restore the list draws, by the name it carries; both layouts render, so each name comes twice. */
const restores = (): HTMLElement[] => screen.getAllByRole("button", { name: /reaktivieren$/ });

/** The first control of that name, which is the one a reader at this width presses. */
const restore = (name: string): HTMLElement => restores().find((button) => button.getAttribute("aria-label") === name) ?? assert.fail(name);

describe("a restore on an admin list while a reactivation runs", () => {
  /* First: a list that stopped offering a restore, or one added beside these four, would otherwise leave the
     case below reading a population nobody chose. */
  it("is asserted on every list that offers one", () => {
    assert.deepEqual(Object.keys(LISTS).sort(), listsOfferingARestore());
  });

  /* A second press during the request sends the reactivation twice, and the second answers a row already live.
     Each restore the row draws is pressed on a list of its own, the Spieler row's two sharing one write. */
  it("holds each restore it offers until that write returns", async () => {
    for (const [list, mounted] of Object.entries(LISTS)) {
      render(mount(mounted()));
      const names = [...new Set(restores().map((button) => button.getAttribute("aria-label") ?? ""))];
      assert.ok(names.length > 0, `${list} renders no restore, so the case proves nothing`);
      cleanup();

      for (const name of names) {
        const user = userEvent.setup();
        render(mount(mounted()));
        calls.length = 0;

        await user.click(restore(name));
        assert.equal(calls.length, 1, `${list}: „${name}“ sent no reactivation`);

        assert.equal(restore(name).getAttribute("data-pending"), "true", `${list}: „${name}“ is open while its write runs`);
        await user.click(restore(name));
        assert.equal(calls.length, 1, `${list}: „${name}“ took a second press and wrote again`);
        cleanup();
        answerPending({ success: true, message: "Reaktiviert." });
      }
    }
  });
});
