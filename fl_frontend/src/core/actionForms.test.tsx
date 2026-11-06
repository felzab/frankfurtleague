// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ReactElement } from "react";
import type { z } from "zod";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
// The lane itself rather than its guarded runner, so its `input` schema is readable.
vi.mock("@/core/action", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  action: (lane: unknown) => lane,
}));

/**
 * A form posts FormData under each box's `name`, a string `tsc` reads against nothing and every unit test of a lane
 * passes an object to, so a name meeting no key loses its value at the parse with every check green. Each case holds
 * one lane's keys to what its form posts.
 */
type Parsed = z.ZodObject | z.ZodDiscriminatedUnion<z.ZodObject[]>;
type Lane = { input: Parsed | z.ZodPipe<z.ZodTransform, Parsed> };

const keysOf = (lane: unknown): string[] => {
  const { input: declared } = lane as Lane;
  const input = "out" in declared ? declared.out : declared;
  const objects = "options" in input ? input.options : [input];
  return [...new Set(objects.flatMap((object) => Object.keys((object as z.ZodObject).shape)))].toSorted();
};

/** Every box by its name: an unpicked radio group posts nothing though its name stands. */
const namesIn = (element: ReactElement): string[] => {
  const { container } = render(<form>{element}</form>);
  return [...new Set([...container.querySelectorAll("[name]")].flatMap((box) => box.getAttribute("name") ?? []))];
};

/** The boxes, the `set`s and the carried fields a source file spells, for a form no test mounts: a page, a closure. */
const spelledIn = (...files: readonly string[]): Set<string> => {
  const source = files.map((file) => readFileSync(path.join(process.cwd(), "src", file), "utf8")).join("\n");
  const carried = [...source.matchAll(/carry(?:: |=\{)\{([^}]*)\}/g)].flatMap(([, keys = ""]) =>
    [...keys.matchAll(/(\w+):/g)].map(([, key = ""]) => key),
  );
  const spelled = [...source.matchAll(/\bname="([\w.]+)"|\.set\("([\w.]+)"/g)].map(([, box, set]) => box ?? set ?? "");
  return new Set([...spelled, ...carried]);
};

describe("each form's posted names meet its lane's keys", () => {
  it("loses no box of the referee create dialog", async () => {
    const { createSchiedsrichter } = await import("@/app/admin/(liste)/schiedsrichter/createSchiedsrichter");
    const { SchiedsrichterFields } = await import("@/app/admin/(liste)/schiedsrichter/SchiedsrichterFields");

    expect(namesIn(<SchiedsrichterFields />).toSorted()).toStrictEqual(keysOf(createSchiedsrichter));
  });

  it("loses no box of the venue create dialog", async () => {
    const { createSpielort } = await import("@/app/admin/createSpielort");
    const { SpielortFields } = await import("@/app/admin/SpielortFields");
    const { SPIELORT_RULES } = await import("@/app/admin/spielortRules");

    expect(namesIn(<SpielortFields rules={SPIELORT_RULES} />).toSorted()).toStrictEqual(keysOf(createSpielort));
  });

  it("loses no box of a new school's entry", async () => {
    const { enterTeam } = await import("@/app/admin/(liste)/saisons/[saison]/teams/enterTeam");
    const { TeamEntryFields } = await import("@/app/admin/(liste)/saisons/[saison]/teams/TeamEntryFields");
    const { TEAM_ENTRY_RULES } = await import("@/features/teams/fieldRules");
    const names = namesIn(
      <TeamEntryFields
        saison="2027"
        clubs={[]}
        gruppen={[]}
        rules={TEAM_ENTRY_RULES}
        clubRequired
      />,
    );

    // The season the dialog carries, and the form's kind, which the lane reads off the club's select.
    expect([...names, "saison_id", "kind"].toSorted()).toStrictEqual(keysOf(enterTeam));
  });

  it("loses no box of the referee's confirmation", async () => {
    const { ConfirmationFields } = await import("@/app/(classic)/confirm/schiedsrichter/ConfirmationFields");
    const { answerSchiedsrichter } = await import("@/app/(classic)/confirm/schiedsrichter/answerSchiedsrichter");
    const names = namesIn(
      <ConfirmationFields
        earliestBirth={"1900-01-01" as never}
        latestBirth={"2030-01-01" as never}
        mediaLatestBirth={"2030-01-01" as never}
        required={{ birth_date: true, scope: true }}
      />,
    );

    // `media` renders once a birthdate stands; `act` and `token` are `kit/OneShot.tsx`'s carry.
    expect([...new Set([...names, "media", "act", "token"])].toSorted()).toStrictEqual(keysOf(answerSchiedsrichter));
  });

  it("loses no box of a contact person's confirmation", async () => {
    const { answerKontakt } = await import("@/app/(classic)/confirm/kontakt/answerKontakt");
    const posted = spelledIn("app/(classic)/confirm/kontakt/ConfirmationFields.tsx");

    // Spelled rather than rendered: `media` renders only once a birthdate stands, and a consent box whose name meets no
    // key parses as a refusal. `act` and `token` are `kit/OneShot.tsx`'s carry.
    expect([...posted, "act", "token"].toSorted()).toStrictEqual(keysOf(answerKontakt));
  });

  // The application's boxes post dotted names `applicationOf` reads by string, its own parse seeing a nested body, and an
  // optional box meeting no key turns into a silent null. A digit string survives both its text and its figure's reading.
  it.each([
    ["a new school's", []],
    ["a listed school's", [{ id: "team", name: "Schule" }]],
  ])("carries every box of %s application into its body", async (_, schulen) => {
    const { applicationOf } = await import("@/app/(classic)/bewerbung/[saison]/application");
    const { BEWERBUNG_RULES } = await import("@/app/(classic)/bewerbung/[saison]/bewerbungRules");
    const { BewerbungFields } = await import("@/app/(classic)/bewerbung/[saison]/BewerbungFields");
    const names = namesIn(
      <BewerbungFields
        schulen={schulen}
        taken={[]}
        rules={BEWERBUNG_RULES}
      />,
    );
    const valueOf = (name: string) => String(100_000 + names.indexOf(name));
    const body = JSON.stringify(applicationOf(Object.fromEntries(names.map((name) => [name, valueOf(name)]))));

    expect(names.filter((name) => !body.includes(valueOf(name)))).toStrictEqual([]);
  });

  it.each([
    ["the season create dialog", "@/features/saisons/createSaison", "createSaison", ["app/admin/(liste)/saisons/CreateFields.tsx"]],
    [
      "a Zusage's dialog",
      "@/app/admin/(liste)/saisons/[saison]/enterZusage",
      "enterZusage",
      ["app/admin/(liste)/saisons/[saison]/page.tsx", "app/admin/(liste)/saisons/[saison]/ZusageDialog.tsx"],
    ],
    ["the address change's box", "@/features/account/personActions", "startAddressChange", ["app/account/(pages)/signin/SignInBoxes.tsx"]],
    ["a passkey's rename", "@/features/passkeys/actions", "renamePasskeyAction", ["app/account/(pages)/security/SecurityBoxes.tsx"]],
    ["the sign-in form", "@/features/auth/actions", "handleSignIn", ["features/auth/components/forms/SignInFlow.tsx"]],
    [
      "a team's exit",
      "@/app/admin/(editor)/saisons/[saison]/teams/[team]/teamActs",
      "recordAustritt",
      ["app/admin/(editor)/saisons/[saison]/teams/[team]/TeamEditor.tsx"],
    ],
    [
      "„Sitz bearbeiten“",
      "@/app/admin/(editor)/saisons/[saison]/teams/[team]/teamActs",
      "writeSeat",
      ["features/teams/components/forms/SeatActs.tsx", "app/admin/(editor)/saisons/[saison]/teams/[team]/TeamEditor.tsx"],
    ],
  ])("loses no key of %s", async (_, module, lane, files) => {
    const loaded = (await import(/* @vite-ignore */ module)) as Record<string, unknown>;
    const posted = spelledIn(...files);

    expect(keysOf(loaded[lane]).filter((key) => !posted.has(key))).toStrictEqual([]);
  });
});
