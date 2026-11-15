// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { serveBackend, serveHost } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { render } from "@testing-library/react";
import { assert, describe, expect, it } from "vitest";

import type { ReactElement } from "react";

/* A form posts FormData under each box's `name`, a string `tsc` reads against nothing and every unit test of a lane
   passes an object to, so a name meeting no key loses its value at the parse with every check green. Each case posts
   what its form posts, under the form's own names, through the real action, and reads the one request the backend
   took: a box whose name meets no key is a value missing from it, or the action's refusal of a key nothing posted. */
const backend = serveBackend();
const { arriveAs, store } = signedInRequest();

// The bot check the sign-in form passes before its address is read.
serveHost("https://challenges.cloudflare.com", ({ method, url }) =>
  method === "POST" && url.pathname === "/turnstile/v0/siteverify" ? { success: true, "error-codes": [] } : undefined,
);

/** One request the backend takes for a form, by its method and its endpoint, and its answer; any other request fails the case. */
type Takes = readonly [method: string, endpoint: string, answer: unknown];

/** The backend taking the requests a form's write sends, each by its method and endpoint alone. */
function takes(...requests: readonly Takes[]): void {
  backend.answerWith(({ method, path: endpoint }) => requests.find(([taken, at]) => taken === method && at === endpoint)?.[2]);
}

/** Every request the case sent, as its method, endpoint and body. */
const requestsSent = () => backend.sent.map(({ method, path: endpoint, body }) => [`${method} ${endpoint}`, body]);

/** Every box by its name: an unpicked radio group posts nothing though its name stands. */
const namesIn = (element: ReactElement): string[] => {
  const { container, unmount } = render(<form>{element}</form>);
  const names = [...new Set([...container.querySelectorAll("[name]")].flatMap((box) => box.getAttribute("name") ?? []))];
  unmount();
  return names;
};

/** The boxes, the `set`s and the carried fields a source file spells, for a form no test mounts: a page, a closure. */
const spelledIn = (...files: readonly string[]): Set<string> => {
  const source = files.map((file) => readFileSync(path.join(process.cwd(), "src", file), "utf8")).join("\n");
  const carried = [...source.matchAll(/carry(?:: |=\{)\{([^}]*)\}/g)].flatMap(([, keys = ""]) =>
    // Each entry's key, a shorthand's among them; a value's own words are no key.
    keys.split(",").flatMap((entry) => /^\s*(\w+)\s*(?::|$)/.exec(entry)?.[1] ?? []),
  );
  const spelled = [...source.matchAll(/\bname="([\w.]+)"|\.set\("([\w.]+)"/g)].map(([, box, set]) => box ?? set ?? "");
  return new Set([...spelled, ...carried]);
};

/**
 * What a person typed, by the name of each box it stands in, posted under every name the form posts: a value whose
 * name the form posts nowhere is not sent, as a browser sends it under no name.
 */
function formOf(posted: Iterable<string>, typed: Readonly<Record<string, string>>): FormData {
  const names = new Set(posted);
  const form = new FormData();
  for (const [name, value] of Object.entries(typed)) if (names.has(name)) form.append(name, value);
  return form;
}

/** Fails where the form renders a box the case types nothing into: a box no case fills is a box no case holds. */
function everyBoxTyped(names: readonly string[], typed: Readonly<Record<string, string>>): void {
  const untyped = names.filter((name) => !Object.hasOwn(typed, name));
  assert(untyped.length === 0, `the case types nothing into ${untyped.join(", ")}: give each a value`);
}

const ID = "64b000000000000000000002";
const TEAM = "64a000000000000000000001";

describe("each form's posted names meet its lane's keys", () => {
  it("loses no box of the referee create dialog", async () => {
    const { createSchiedsrichter } = await import("@/app/admin/(list)/schiedsrichter/createSchiedsrichter");
    const { SchiedsrichterFields } = await import("@/app/admin/(list)/schiedsrichter/SchiedsrichterFields");
    const names = namesIn(<SchiedsrichterFields />);
    const typed = { name: "Erika Muster", email: "erika@example.org", phone: "069 1234567", schule: "Goethe-Gymnasium", default_payment: "25" };
    everyBoxTyped(names, typed);
    takes(["POST", "/schiedsrichter", { created_id: ID, confirmation: { deadline: "2027-01-15", email: "erika@example.org" } }]);

    expect(await createSchiedsrichter(formOf(names, typed))).toStrictEqual({ ok: true, value: undefined });
    expect(requestsSent()).toStrictEqual([
      [
        "POST /schiedsrichter",
        {
          name: "Erika Muster",
          kontakt: { email: "erika@example.org", phone: "069 1234567" },
          schule: "Goethe-Gymnasium",
          default_payment: 25,
        },
      ],
    ]);
  });

  it("loses no box of the venue create dialog", async () => {
    const { createSpielort } = await import("@/app/admin/createSpielort");
    const { SpielortFields } = await import("@/app/admin/SpielortFields");
    const { SPIELORT_RULES } = await import("@/app/admin/spielortRules");
    const names = namesIn(<SpielortFields rules={SPIELORT_RULES} />);
    const typed = {
      name: "Sporthalle Nord",
      street: "Hauptstraße",
      house_number: "12a",
      postcode: "60311",
      district: "Innenstadt",
      city: "Frankfurt am Main",
      mietpreis: "40",
    };
    everyBoxTyped(names, typed);
    takes(["POST", "/spielorte", { created_id: ID }]);

    expect(await createSpielort(formOf(names, typed))).toStrictEqual({ ok: true, value: undefined });
    expect(requestsSent()).toStrictEqual([
      [
        "POST /spielorte",
        {
          name: "Sporthalle Nord",
          default_mietpreis: 40,
          address: { street: "Hauptstraße", house_number: "12a", postcode: "60311", district: "Innenstadt", city: "Frankfurt am Main" },
        },
      ],
    ]);
  });

  it("loses no box of the season create dialog", async () => {
    const { createSaison } = await import("@/features/saisons/createSaison");
    const { CreateFields } = await import("@/app/admin/(list)/saisons/CreateFields");
    const names = namesIn(
      <CreateFields
        next={{ start: null, end: null }}
        required={{ start: true, end: true }}
      />,
    );
    const typed = { start_date: "2027-03-06", end_date: "2027-07-03" };
    everyBoxTyped(names, typed);
    takes(["POST", "/saisons", { created_id: "2027" }]);

    expect(await createSaison(formOf(names, typed))).toStrictEqual({ ok: true, value: undefined });
    expect(requestsSent()).toStrictEqual([["POST /saisons", { start_date: "2027-03-06", end_date: "2027-07-03" }]]);
  });

  it("loses no box of a new school's entry", async () => {
    const { enterTeam } = await import("@/app/admin/(list)/saisons/[saison]/teams/enterTeam");
    const { NEW_CLUB } = await import("@/app/admin/(list)/saisons/[saison]/teams/newClub");
    const { TeamEntryFields } = await import("@/app/admin/(list)/saisons/[saison]/teams/TeamEntryFields");
    const { TEAM_ENTRY_RULES } = await import("@/features/teams/fieldRules");
    const names = namesIn(
      <TeamEntryFields
        saison="2027"
        clubs={[]}
        gruppen={[]}
        colours={[]}
        rules={TEAM_ENTRY_RULES}
        clubRequired
      />,
    );
    const typed = {
      club: NEW_CLUB,
      gruppe: "B",
      trikot_farbe: "rot",
      name: "Goethe",
      shorthand: "GOE",
      full_name: "Goethe-Gymnasium Frankfurt",
      schulform: "gymnasium_g9",
      website_url: "https://goethe.example.org",
      street: "Friedrich-Ebert-Anlage",
      house_number: "22",
      postcode: "60325",
      district: "Westend",
      city: "Frankfurt am Main",
    };
    everyBoxTyped(names, typed);
    takes(["POST", "/teams/saisons/2027/entry", { team_id: TEAM }]);

    // The season the dialog carries beside its boxes.
    expect(await enterTeam(formOf([...names, "saison_id"], { ...typed, saison_id: "2027" }))).toStrictEqual({ ok: true, value: undefined });
    expect(requestsSent()).toStrictEqual([
      [
        "POST /teams/saisons/2027/entry",
        {
          club: {
            kind: "new",
            team: {
              name: "Goethe",
              shorthand: "GOE",
              full_name: "Goethe-Gymnasium Frankfurt",
              schulform: "gymnasium_g9",
              website_url: "https://goethe.example.org",
              description: "",
              address: {
                street: "Friedrich-Ebert-Anlage",
                house_number: "22",
                postcode: "60325",
                district: "Westend",
                city: "Frankfurt am Main",
              },
            },
          },
          gruppe: "B",
          trikot_farbe: "rot",
        },
      ],
    ]);
  });

  // `media` renders once a birthdate stands; `act` and `token` are `kit/OneShot.tsx`'s carry.
  it("loses no box of the referee's confirmation", async () => {
    const { ConfirmationFields } = await import("@/app/(classic)/confirm/ConfirmationFields");
    const { answerSchiedsrichter } = await import("@/app/(classic)/confirm/schiedsrichter/answerSchiedsrichter");
    const { SCHIEDSRICHTER_TEXT_VERSIONS, SCHIEDSRICHTER_WORDINGS } = await import("@/core/consentWordings");
    const names = namesIn(
      <ConfirmationFields
        consent={{ name: "scope", wording: SCHIEDSRICHTER_WORDINGS.scope, isRequired: true }}
        media={SCHIEDSRICHTER_WORDINGS.media}
        earliestBirth={"1900-01-01" as never}
        latestBirth={"2030-01-01" as never}
        mediaLatestBirth={"2030-01-01" as never}
        isBirthDateRequired
      />,
    );
    const typed = { birth_date: "1990-05-01", scope: "kader_public", media: "on" };
    everyBoxTyped(names, typed);
    await arriveAs(null);
    takes(["POST", "/schiedsrichter/confirmation", { id: ID }]);

    const answer = await answerSchiedsrichter(formOf([...names, "media", "act", "token"], { ...typed, act: "primary", token: "link-token" }));

    expect(answer).toMatchObject({ ok: true });
    expect(requestsSent()).toStrictEqual([
      [
        "POST /schiedsrichter/confirmation",
        { token: "link-token", birth_date: "1990-05-01", scope: "kader_public", media: true, text_versions: SCHIEDSRICHTER_TEXT_VERSIONS },
      ],
    ]);
  });

  // A consent box whose name meets no key parses as no consent.
  it("loses no box of a contact person's confirmation", async () => {
    const { ConfirmationFields } = await import("@/app/(classic)/confirm/ConfirmationFields");
    const { answerKontakt } = await import("@/app/(classic)/confirm/kontakt/answerKontakt");
    const { SEAT_TEXT_VERSIONS, SEAT_WORDINGS } = await import("@/core/consentWordings");
    const names = namesIn(
      <ConfirmationFields
        consent={{ name: "whatsapp", wording: SEAT_WORDINGS.scope }}
        media={SEAT_WORDINGS.media}
        earliestBirth={"1900-01-01" as never}
        latestBirth={"2030-01-01" as never}
        mediaLatestBirth={"2030-01-01" as never}
        isBirthDateRequired
      />,
    );
    const typed = { birth_date: "1985-09-12", whatsapp: "on", media: "on" };
    everyBoxTyped(names, typed);
    await arriveAs(null);
    takes(["POST", "/bewerbungen/einwilligung", {}]);

    const answer = await answerKontakt(formOf([...names, "media", "act", "token"], { ...typed, act: "primary", token: "link-token" }));

    expect(answer).toMatchObject({ ok: true });
    expect(requestsSent()).toStrictEqual([
      [
        "POST /bewerbungen/einwilligung",
        { answer: "given", token: "link-token", birth_date: "1985-09-12", whatsapp: true, media: true, text_versions: SEAT_TEXT_VERSIONS },
      ],
    ]);
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

  /* A form no test mounts posts what its sources spell: a value is sent only under a name they spell, so a box renamed
     in a source, or a key renamed in its lane, leaves its value out of the request. */
  describe("a form its sources spell", () => {
    it("loses no key of a Zusage's dialog", async () => {
      const { enterZusage } = await import("@/app/admin/(list)/saisons/[saison]/enterZusage");
      const posted = spelledIn("app/admin/(list)/saisons/[saison]/page.tsx", "app/admin/(list)/saisons/[saison]/ZusageDialog.tsx");
      takes(["POST", `/spielbestaetigungen/${ID}/enter`, { version: 2 }]);

      expect(await enterZusage(formOf(posted, { id: ID, reason: "Telefonisch zugesagt" }))).toStrictEqual({ ok: true, value: undefined });
      expect(requestsSent()).toStrictEqual([[`POST /spielbestaetigungen/${ID}/enter`, { reason: "Telefonisch zugesagt" }]]);
    });

    it("loses no key of the address change's box", async () => {
      const { startAddressChange } = await import("@/features/account/personActions");
      const posted = spelledIn("app/account/(pages)/signin/SignInBoxes.tsx");
      await arriveAs({ email: "pia@example.org" });
      takes(["POST", "/account/address_change", {}]);

      const answer = await startAddressChange(formOf(posted, { email: "pia.neu@example.org", holder: "pia@example.org" }));

      expect(answer).toStrictEqual({ ok: true, value: undefined });
      expect(requestsSent()).toStrictEqual([["POST /account/address_change", { email: "pia.neu@example.org" }]]);
    });

    // The rename writes the sign-in store alone, so the row it names is what the case reads.
    it("loses no key of a passkey's rename", async () => {
      const { renamePasskeyAction } = await import("@/features/passkeys/actions");
      const posted = spelledIn("app/account/(pages)/security/SecurityBoxes.tsx");
      await arriveAs({ email: "pia@example.org" });
      const account = store.user.find(({ email }) => email === "pia@example.org");
      assert(account !== undefined, "the person's arrival wrote no account");
      store.passkey.push({
        id: "pk-1",
        name: "Laptop",
        userId: account.id,
        credentialID: "credential-of-pia",
        publicKey: "fabricated-public-key",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        transports: "internal",
        createdAt: new Date(),
      });

      const answer = await renamePasskeyAction(formOf(posted, { id: "pk-1", name: "Telefon", holder: "pia@example.org" }));

      expect(answer).toStrictEqual({ ok: true, value: undefined });
      const own = store.passkey.filter(({ userId }) => userId === account.id);
      expect(own.map(({ id, name }) => [id, name])).toStrictEqual([["pk-1", "Telefon"]]);
    });

    // The address is the one answer the sign-in gives every address it admits, the code's mail sent behind it.
    it("loses no key of the sign-in form", async () => {
      const { handleSignIn } = await import("@/features/auth/actions");
      const { TURNSTILE_FIELD } = await import("@/core/turnstileToken");
      const posted = spelledIn("features/auth/components/forms/SignInFlow.tsx");
      await arriveAs(null);

      // The widget's token, which the page's script posts under its own name beside the form's boxes.
      const answer = await handleSignIn(formOf([...posted, TURNSTILE_FIELD], { email: "Pia@Example.org", [TURNSTILE_FIELD]: "widget-token" }));

      expect(answer).toStrictEqual({ ok: true, value: "pia@example.org" });
    });

    it("loses no key of a team's exit", async () => {
      const { recordAustritt } = await import("@/app/admin/(editor)/saisons/[saison]/teams/[team]/teamActs");
      const posted = spelledIn("app/admin/(editor)/saisons/[saison]/teams/[team]/TeamEditor.tsx");
      takes(["PUT", `/teams/${TEAM}/saisons/2027/austritt`, {}]);

      const typed = { team_id: TEAM, saison_id: "2027", date: "2027-04-01", reason: "Nicht angetreten", type: "rueckzug" };
      expect(await recordAustritt(formOf(posted, typed))).toStrictEqual({ ok: true, value: undefined });
      expect(requestsSent()).toStrictEqual([
        [`PUT /teams/${TEAM}/saisons/2027/austritt`, { date: "2027-04-01", reason: "Nicht angetreten", type: "rueckzug" }],
      ]);
    });

    const SEAT_PERSON = { first_name: "Jana", last_name: "Schmidt", email: "jana@example.org", phone: "069 7654321" };

    it("loses no key of „Sitz bearbeiten“", async () => {
      const { writeSeat } = await import("@/app/admin/(editor)/saisons/[saison]/teams/[team]/teamActs");
      const posted = spelledIn(
        "features/teams/components/forms/SeatActs.tsx",
        "app/admin/(editor)/saisons/[saison]/teams/[team]/TeamEditor.tsx",
      );
      takes(["PUT", `/teams/${TEAM}/saisons/2027/kontakte/trainer`, { email: null }]);

      const typed = { team_id: TEAM, saison_id: "2027", seat: "trainer", ...SEAT_PERSON, trainer_is_also: "ansprechperson", version: "3" };
      expect(await writeSeat(formOf(posted, typed))).toStrictEqual({ ok: true, value: undefined });
      expect(requestsSent()).toStrictEqual([
        [`PUT /teams/${TEAM}/saisons/2027/kontakte/trainer`, { ...SEAT_PERSON, trainer_is_also: "ansprechperson", version: 3 }],
      ]);
    });

    it("loses no key of an application's „Sitz bearbeiten“", async () => {
      const { writeSeat } = await import("@/app/admin/(list)/saisons/[saison]/bewerbungen/[bewerbung]/writeSeat");
      const posted = spelledIn(
        "features/teams/components/forms/SeatActs.tsx",
        "app/admin/(list)/saisons/[saison]/bewerbungen/[bewerbung]/page.tsx",
      );
      takes(["POST", `/bewerbungen/${ID}/kontakte/trainer`, { email: "jana@example.org" }]);

      const typed = { id: ID, seat: "trainer", ...SEAT_PERSON, version: "3" };
      expect(await writeSeat(formOf(posted, typed))).toMatchObject({ ok: true });
      expect(requestsSent()).toStrictEqual([[`POST /bewerbungen/${ID}/kontakte/trainer`, { ...SEAT_PERSON, version: 3 }]]);
    });
  });
});
