// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { assert, describe, expect, it } from "vitest";

import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { serveBackend } from "@/test-support/backend";
import { posted } from "@/test-support/posted";
import { signedInRequest } from "@/test-support/session";
import { thrownRedirect } from "@/test-support/thrownRedirect";

import type { ReactElement } from "react";

/* A form posts FormData under each box's `name`, a string `tsc` reads against nothing and every unit test of a lane
   passes an object to, so a name meeting no key loses its value at the parse with every check green. Each case posts
   what its form posts, under the form's own names, through the real action, and reads the one request the backend
   took: a box whose name meets no key is a value missing from it, or the action's refusal of a key nothing posted. */
const backend = serveBackend();
const { arriveAs, store } = signedInRequest();

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
function formOf(names: Iterable<string>, typed: Readonly<Record<string, string>>): FormData {
  const named = new Set(names);
  return posted(Object.fromEntries(Object.entries(typed).filter(([name]) => named.has(name))));
}

/** Fails where the form renders a box the case types nothing into: a box no case fills is a box no case holds. */
function everyBoxTyped(names: readonly string[], typed: Readonly<Record<string, string>>): void {
  const untyped = names.filter((name) => !Object.hasOwn(typed, name));
  assert(untyped.length === 0, `the case types nothing into ${untyped.join(", ")}: give each a value`);
}

/** What a confirmation page carries beside its boxes: `kit/OneShot.tsx`'s act and token, and the page's labels. */
const CARRIED = ["act", "token", "text_versions.scope", "text_versions.media"] as const;

/** The carried values of a confirmation's main act, under the labels `versions` names. */
const carriedBy = (versions: { readonly scope: string; readonly media: string }) => ({
  act: "primary",
  token: "link-token",
  "text_versions.scope": versions.scope,
  "text_versions.media": versions.media,
});

const ID = "64b000000000000000000002";
const TEAM = "64a000000000000000000001";

describe("each form's posted names meet its lane's keys", () => {
  it("loses no box of the referee create dialog", async () => {
    const { createSchiedsrichter } = await import("@/app/admin/(list)/schiedsrichter/createSchiedsrichter");
    const { SchiedsrichterFields } = await import("@/app/admin/(list)/schiedsrichter/SchiedsrichterFields");
    const names = namesIn(<SchiedsrichterFields />);
    const typed = {
      name: "Erika Muster",
      email: "erika@example.org",
      phone: "069 90009123",
      schule: "Goethe-Gymnasium",
      default_payment: "25",
    };
    everyBoxTyped(names, typed);
    takes(["POST", "/schiedsrichter", { created_id: ID, confirmation: { email: "erika@example.org" } }]);

    // The dialog is behind the passkey touch, which posts the page's holder beside its boxes (`Dialog`'s `touch`). The
    // note names the mailbox the link went to, in wording from a catalogue this core test may not import.
    const touched = formOf([...names, "holder"], { ...typed, holder: ADMIN_EMAIL });
    expect(await createSchiedsrichter(touched)).toStrictEqual({
      ok: true,
      value: undefined,
      note: expect.stringContaining("erika@example.org") as unknown,
    });
    expect(requestsSent()).toStrictEqual([
      [
        "POST /schiedsrichter",
        {
          name: "Erika Muster",
          kontakt: { email: "erika@example.org", phone: "069 90009123" },
          schule: "Goethe-Gymnasium",
          default_payment: 25,
        },
      ],
    ]);
  });

  it("loses no box of the venue create dialog", async () => {
    const { createSpielort } = await import("@/features/spielorte/createSpielort");
    const { SpielortFields } = await import("@/features/spielorte/SpielortFields");
    const names = namesIn(<SpielortFields />);
    const typed = {
      name: "Sporthalle Nord",
      street: "Hauptstraße",
      house_number: "12a",
      postcode: "60311",
      district: "Innenstadt",
      city: "Frankfurt am Main",
      default_mietpreis: "40",
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
    const { createSaison } = await import("@/app/admin/(list)/saisons/createSaison");
    const { CreateFields } = await import("@/app/admin/(list)/saisons/CreateFields");
    const names = namesIn(<CreateFields next={{ start: null, end: null }} />);
    const typed = { start_date: "2027-03-06", end_date: "2027-07-03" };
    everyBoxTyped(names, typed);
    takes(["POST", "/saisons", { created_id: "2027" }]);

    expect(await createSaison(formOf(names, typed))).toStrictEqual({ ok: true, value: undefined });
    expect(requestsSent()).toStrictEqual([["POST /saisons", { start_date: "2027-03-06", end_date: "2027-07-03" }]]);
  });

  it("loses no box of a new school's entry", async () => {
    const { enterTeam } = await import("@/app/admin/(list)/saisons/[saison]/teams/enterTeam");
    const { NEW_TEAM } = await import("@/app/admin/(list)/saisons/[saison]/teams/newTeam");
    const { TeamEntryFields } = await import("@/app/admin/(list)/saisons/[saison]/teams/TeamEntryFields");
    const names = namesIn(
      <TeamEntryFields
        saison="2027"
        teams={[]}
        gruppen={[]}
        colours={[]}
      />,
    );
    const typed = {
      team: NEW_TEAM,
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
    takes(["POST", "/teams/saisons/2027/entry", new Response(null, { status: 204 })]);

    // The season the dialog carries beside its boxes.
    expect(await enterTeam(formOf([...names, "saison_id"], { ...typed, saison_id: "2027" }))).toStrictEqual({ ok: true, value: undefined });
    expect(requestsSent()).toStrictEqual([
      [
        "POST /teams/saisons/2027/entry",
        {
          team: {
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
        consent={{ name: "scope", wording: SCHIEDSRICHTER_WORDINGS.scope }}
        media={SCHIEDSRICHTER_WORDINGS.media}
        earliestBirth={"1900-01-01" as never}
        latestBirth={"2030-01-01" as never}
        mediaLatestBirth={"2030-01-01" as never}
      />,
    );
    const typed = { birth_date: "1990-05-01", scope: "kader_public", media: "on" };
    everyBoxTyped(names, typed);
    await arriveAs(null);
    takes(["POST", "/schiedsrichter/confirmation", new Response(null, { status: 204 })]);

    // Done, the press leads on to the done page, which Next's redirect thrown past the action names.
    await thrownRedirect(
      answerSchiedsrichter(formOf([...names, "media", ...CARRIED], { ...typed, ...carriedBy(SCHIEDSRICHTER_TEXT_VERSIONS) })),
    );

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
      />,
    );
    const typed = { birth_date: "1985-09-12", whatsapp: "on", media: "on" };
    everyBoxTyped(names, typed);
    await arriveAs(null);
    takes(["POST", "/bewerbungen/confirmation", new Response(null, { status: 204 })]);

    // Done, the press leads on to the done page, which Next's redirect thrown past the action names.
    await thrownRedirect(answerKontakt(formOf([...names, "media", ...CARRIED], { ...typed, ...carriedBy(SEAT_TEXT_VERSIONS) })));

    expect(requestsSent()).toStrictEqual([
      [
        "POST /bewerbungen/confirmation",
        { answer: "given", token: "link-token", birth_date: "1985-09-12", whatsapp: true, media: true, text_versions: SEAT_TEXT_VERSIONS },
      ],
    ]);
  });

  /* The harm: a confirmation pressed on a page drawn before a rewording's deploy recorded under the labels of words the
     person never saw, the record being the consent's only trace. */
  it("sends nothing for a confirmation posting a label no longer current, answering it as a stale page", async () => {
    const { answerKontakt } = await import("@/app/(classic)/confirm/kontakt/answerKontakt");
    const { SEAT_TEXT_VERSIONS } = await import("@/core/consentWordings");
    const { COPY } = await import("@/core/copy/shared");
    const typed = { birth_date: "1985-09-12", whatsapp: "on", media: "on" };
    await arriveAs(null);
    takes(["POST", "/bewerbungen/confirmation", new Response(null, { status: 204 })]);

    // The media label a page drawn under an earlier wording carries.
    const replaced = { ...carriedBy(SEAT_TEXT_VERSIONS), "text_versions.media": "2025-01-media-0" };
    const answer = await answerKontakt(formOf([...Object.keys(typed), ...CARRIED], { ...typed, ...replaced }));

    expect(answer).toStrictEqual({ ok: false, reason: COPY.shared.failure.stale });
    expect(requestsSent()).toStrictEqual([]);
  });

  // The application's boxes post dotted names `applicationOf` reads by string, its own parse seeing a nested body, and an
  // optional box meeting no key turns into a silent null. A digit string survives both its text and its figure's reading.
  it.each([
    ["a new school's", []],
    ["a listed school's", [{ id: "team", name: "Schule" }]],
  ])("carries every box of %s application into its body", async (_, schulen) => {
    const { applicationOf } = await import("@/app/(classic)/bewerbung/[saison]/application");
    const { BewerbungFields } = await import("@/app/(classic)/bewerbung/[saison]/BewerbungFields");
    const names = namesIn(
      <BewerbungFields
        schulen={schulen}
        taken={[]}
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
      const { enterZusage } = await import("@/features/spielbestaetigungen/enterZusage");
      const spelled = spelledIn("features/spielbestaetigungen/answerActs.tsx", "features/spielbestaetigungen/ZusageDialog.tsx");
      takes(["POST", `/spielbestaetigungen/${ID}/enter`, { version: 2 }]);

      expect(await enterZusage(formOf(spelled, { id: ID, reason: "Telefonisch zugesagt" }))).toStrictEqual({ ok: true, value: undefined });
      expect(requestsSent()).toStrictEqual([[`POST /spielbestaetigungen/${ID}/enter`, { reason: "Telefonisch zugesagt" }]]);
    });

    it("loses no key of the address change's box", async () => {
      const { startAddressChange } = await import("@/features/account/personActions");
      const spelled = spelledIn("app/account/(pages)/signin/SignInBoxes.tsx");
      await arriveAs({ email: "pia@example.org" });
      takes(["POST", "/account/address_change", new Response(null, { status: 204 })]);

      const answer = await startAddressChange(formOf(spelled, { email: "pia.neu@example.org", holder: "pia@example.org" }));

      expect(answer).toStrictEqual({ ok: true, value: undefined });
      expect(requestsSent()).toStrictEqual([["POST /account/address_change", { email: "pia.neu@example.org" }]]);
    });

    // The rename writes the sign-in store alone, so the row it names is what the case reads.
    // An administrator's, the one account holding a passkey: the file's visitor unless a case names another.
    it("loses no key of a passkey's rename", async () => {
      const { renamePasskeyAction } = await import("@/app/account/(pages)/security/passkeyActs");
      const spelled = spelledIn("app/account/(pages)/security/SecurityBoxes.tsx");
      const account = store.user.find(({ email }) => email === ADMIN_EMAIL);
      assert(account !== undefined, "the administrator's arrival wrote no account");
      store.passkey.push({
        id: "pk-1",
        name: "Laptop",
        userId: account.id,
        credentialID: "credential-of-the-laptop",
        publicKey: "fabricated-public-key",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        transports: "internal",
        createdAt: new Date(),
      });

      const answer = await renamePasskeyAction(formOf(spelled, { id: "pk-1", name: "Telefon", holder: ADMIN_EMAIL }));

      expect(answer).toStrictEqual({ ok: true, value: undefined });
      const renamed = store.passkey.filter(({ id }) => id === "pk-1");
      expect(renamed.map(({ userId, name }) => [userId, name])).toStrictEqual([[account.id, "Telefon"]]);
    });

    it("loses no key of a team's exit", async () => {
      const { recordAustritt } = await import("@/app/admin/(editor)/saisons/[saison]/teams/[team]/teamActs");
      const spelled = spelledIn("app/admin/(editor)/saisons/[saison]/teams/[team]/TeamEditor.tsx");
      takes(["PUT", `/teams/${TEAM}/saisons/2027/austritt`, {}]);

      const typed = { team_id: TEAM, saison_id: "2027", date: "2027-04-01", reason: "Nicht angetreten", type: "rueckzug" };
      expect(await recordAustritt(formOf(spelled, typed))).toStrictEqual({ ok: true, value: undefined });
      expect(requestsSent()).toStrictEqual([
        [`PUT /teams/${TEAM}/saisons/2027/austritt`, { date: "2027-04-01", reason: "Nicht angetreten", type: "rueckzug" }],
      ]);
    });

    const SEAT_PERSON = { first_name: "Jana", last_name: "Schmidt", email: "jana@example.org", phone: "069 90009765" };
    // The seat's dialog is behind the passkey touch, which posts the page's holder beside its carry (`Dialog`'s `touch`).
    const seatPosted = (...files: readonly string[]) => new Set([...spelledIn(...files), "holder"]);

    it("loses no key of „Sitz bearbeiten“", async () => {
      const { writeSeat } = await import("@/app/admin/(editor)/saisons/[saison]/teams/[team]/teamActs");
      const spelled = seatPosted("features/teams/SeatActs.tsx", "app/admin/(editor)/saisons/[saison]/teams/[team]/TeamEditor.tsx");
      takes(["PUT", `/teams/${TEAM}/saisons/2027/kontakte/trainer`, { email: null }]);

      const typed = {
        team_id: TEAM,
        saison_id: "2027",
        seat: "trainer",
        ...SEAT_PERSON,
        trainer_is_also: "ansprechperson",
        version: "3",
        holder: ADMIN_EMAIL,
      };
      expect(await writeSeat(formOf(spelled, typed))).toStrictEqual({ ok: true, value: undefined });
      expect(requestsSent()).toStrictEqual([
        [`PUT /teams/${TEAM}/saisons/2027/kontakte/trainer`, { ...SEAT_PERSON, trainer_is_also: "ansprechperson", version: 3 }],
      ]);
    });

    it("loses no key of an application's „Sitz bearbeiten“", async () => {
      const { writeBewerbungSeat } = await import("@/app/admin/(list)/saisons/[saison]/bewerbungen/[bewerbung]/seatActs");
      const spelled = seatPosted("features/teams/SeatActs.tsx", "app/admin/(list)/saisons/[saison]/bewerbungen/[bewerbung]/page.tsx");
      takes(["POST", `/bewerbungen/${ID}/kontakte/trainer`, { email: "jana@example.org" }]);

      const typed = { id: ID, seat: "trainer", ...SEAT_PERSON, version: "3", holder: ADMIN_EMAIL };
      expect(await writeBewerbungSeat(formOf(spelled, typed))).toMatchObject({ ok: true });
      expect(requestsSent()).toStrictEqual([[`POST /bewerbungen/${ID}/kontakte/trainer`, { ...SEAT_PERSON, version: 3 }]]);
    });
  });
});
