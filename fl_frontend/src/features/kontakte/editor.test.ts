import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { LIGA_KENNTNISNAHME } from "@/core/einwilligung";
import { buildEmptyBewerbungKontaktperson } from "@/features/bewerbungen/utils";
import { FLSaisonSchema } from "@/features/saisons/schemas.ts";
import { einwilligungHerkunftLabel, TRAINER_ZUGLEICH_FRAGE, TRAINER_ZUGLEICH_OPTIONS } from "@/features/teams/constants";
import { FLTeamMembershipSchema, FLTeamWithMembershipsSchema } from "@/features/teams/schemas";
import { buildEmptyKontaktperson } from "@/features/teams/utils";
import { formPanel } from "@/shared/components/ui/formPanel";
import { resolveBlockingBanners } from "@/shared/components/ui/railBanner";
import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import {
  answer,
  answerReadsWith,
  clearSteps,
  EMPTIEST_ANSWER,
  OBJECT_ID,
  pageBody,
  readsOf,
  saisonFields,
  steps,
} from "@/shared/testing/pageHarness.ts";
import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { renderMarkup, renderTree } from "@/shared/testing/renderTest";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import { buildKontakteBanners } from "./components/forms/AdminKontakteEditForm/banners.ts";
import { deriveKontakteDraftStatus } from "./kontakteDraftStatus.ts";
import { mapStaleBlockRefusal } from "./refusals.ts";
import { FLPatchSaisonTeamKontaktePayloadSchema } from "./schemas.ts";
import { describeUnrestorableKontakte, teamPageHref, toKontaktePayload } from "./utils.ts";

import type { FLKontaktperson, FLSaisonTeamKontakte } from "@/features/teams/schemas";
import type { AdminKontakteRow, AdminKontaktSeat } from "@/features/teams/types";
import type { ReactNode } from "react";
import type { KontakteBanner } from "./components/forms/AdminKontakteEditForm/banners.ts";
import type { FLPatchSaisonTeamKontaktePayload } from "./schemas.ts";

/**
 * Every slice's writes, replaced at the module boundary: a real one needs a session and a backend, and
 * the club editor rendered below reaches its own slices' actions.
 */
const { calls, answerWith } = doubleEveryAction();

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/** The undo's dispatch, which posts to a route handler with the browser's own `fetch`. */
const fetchMock = doubleFetch();

/** Each navigation a control makes, which both destructive controls and both ways out are judged by. */
const { router, seen } = recordingRouter();

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
  seen.pushed.length = 0;
  seen.replaced.length = 0;
  seen.back = 0;
  seen.refresh = 0;
});

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { FormKontakteLinkSection } = await import("@/features/teams/components/forms/AdminTeamEditForm/FormKontakteLinkSection.tsx");
const { AdminKontakteList } = await import("@/features/teams/components/collections/AdminKontakteList.tsx");
const { FormKontakteSection } = await import("./components/forms/AdminKontakteEditForm/FormKontakteSection.tsx");
const { AdminKontakteEditView } = await import("./components/views/AdminKontakteEditView.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { default: AdminKontakteEditPage } = await import("@/app/admin/kontakte/[team_id]/page.tsx");
const { AdminTeamEditForm } = await import("@/features/teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx");
const { DRAFT_DISCARDED } = await import("@/shared/utils/draftGuard.ts");

/** The stored shape, which the list seat takes a subset of, so one person serves both renders below. */
const ADA: FLKontaktperson = {
  vorname: "Ada",
  nachname: "Byron",
  email: "ada@example.org",
  telefon: "069 111",
  geburtsdatum: "1990-12-10",
  einwilligung: { umfang: "kontaktdaten", erfasst_von: "person", text_version: "1", datum: "2026-03-12", bestaetigt_am: "2026-03-14" },
};

/** One list seat. `person: null` is what an erasure leaves, which is the state these cases are about. */
const seat = (rolle: AdminKontaktSeat["rolle"], label: string, person: AdminKontaktSeat["person"]): AdminKontaktSeat => ({
  rolle,
  label,
  person,
  istTrainerZugleich: false,
});

const listRow = (seats: readonly AdminKontaktSeat[]): AdminKontakteRow => ({
  id: "t1",
  teamId: "t1",
  teamName: "SG Alpha",
  teamShorthand: "ALP",
  seats,
  besetzt: seats.filter((each) => each.person !== null).length,
});

/**
 * `useSearchParams` reads a context and nothing else supplies one, so the table renders under the
 * provider rather than against a stubbed hook.
 */
const listMarkup = (row: AdminKontakteRow, query: string): string =>
  renderTree(underNext(h(AdminKontakteList, { filteredKontakte: [row], emptiness: "none" }), { search: query }));

/** The editor's banner author, in the one state each case below is about. */
const bannersFor = (state: Partial<Parameters<typeof buildKontakteBanners>[0]>): readonly KontakteBanner[] =>
  buildKontakteBanners({
    saisonId: "2526",
    saisonStatus: "active",
    isMember: true,
    emptiedSeatLabels: [],
    renamedConfirmedSeatLabels: [],
    ...state,
  });

/** One stored seat. The ADDRESS is what decides whether that seat offers the person's erasure. */
const seatPerson = (vorname: string, nachname: string, email: string): FLKontaktperson => ({ ...ADA, vorname, nachname, email });

/** Three seats filled in, which is the state most of the renders below are about. */
const BLOCK: FLSaisonTeamKontakte = {
  trainer: seatPerson("Ada", "Byron", "ada@example.org"),
  ansprechperson: seatPerson("Grace", "Hopper", "grace@example.org"),
  stellvertretung: seatPerson("Alan", "Turing", "alan@example.org"),
  trainer_ist_zugleich: null,
};

/** The same three without an address, so no seat offers the erasure and its own rule stays out. */
const BLOCK_WITHOUT_ADDRESS: FLSaisonTeamKontakte = {
  ...BLOCK,
  trainer: seatPerson("Ada", "Byron", ""),
  ansprechperson: seatPerson("Grace", "Hopper", ""),
  stellvertretung: seatPerson("Alan", "Turing", ""),
};

/** Three empty seats: what an erasure leaves, and the state neither surface may explain. */
const BLOCK_EMPTY: FLSaisonTeamKontakte = { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null };

/**
 * The three contexts the editor's own subtree reads and no prop carries: the router both destructive
 * controls hold, the query the way out rides, and the status each field label looks itself up in.
 */
const editorElement = (node: ReactNode, kontakte: FLSaisonTeamKontakte | null): ReactNode =>
  underNext(
    h(DraftStatusProvider, {
      status: deriveKontakteDraftStatus({ stored: { kontakte }, draft: { kontakte }, fieldErrors: {} }),
      children: node,
    }),
    { search: "saison_id=2526", router },
  );

const editorTree = (node: ReactNode, kontakte: FLSaisonTeamKontakte | null): string => renderTree(editorElement(node, kontakte));

const sectionElement = (kontakte: FLSaisonTeamKontakte | null, isMember = true): ReactNode =>
  h(FormKontakteSection, {
    value: kontakte,
    isMember,
    teamHref: "/admin/teams/t1?saison_id=2526",
    banners: [],
    onChange: () => undefined,
    onFieldLeft: () => undefined,
    isDirty: false,
    onValidateSelection: () => undefined,
  });

/** The seats as the admin meets them, in the state each case names. */
const sectionMarkup = (kontakte: FLSaisonTeamKontakte | null, isMember = true): string =>
  editorTree(sectionElement(kontakte, isMember), kontakte);

/** The whole editor a reader meets: the view renders the form, and the form the seats and the deletion. */
/** `teamId` is the payload's own field: a save is judged against the mirror, which refuses a short id. */
const viewElement = (kontakte: FLSaisonTeamKontakte | null, hasRow = true, teamId = "t1"): ReactNode =>
  h(AdminKontakteEditView, {
    team: { id: teamId, name: "SG Alpha", shorthand: "ALP", inactive_since: null },
    saison: {
      saisonId: "2526",
      saisonStatus: "active",
      membership: hasRow ? { gruppe: "A", austritt: null, trikot_farbe: null, kontakte, kontakte_stand: "9f2c" } : null,
    },
  });

const viewMarkup = (kontakte: FLSaisonTeamKontakte | null, hasRow = true): string => editorTree(viewElement(kontakte, hasRow), kontakte);

/** A club id the payload's mirror takes, so a save reaches the write rather than stopping at the block. */
const TEAM_ID = "507f1f77bcf86cd799439011";

/** The write's answer to a save, carrying the token of the block it left. */
const SAVED = { success: true, message: "Kontakte gespeichert.", saison_team: { kontakte_stand: "a1b2" } };

/** Lets a transition's answer, and everything it sets off, land. */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Every box a refusal marks, read off its description as a reader of the box hears it. */
const refusedBoxes = (): HTMLElement[] => screen.queryAllByRole("textbox", { description: /./ });

/** The editor over `stored`, saved once `change` has edited it; the telephone, over which no banner is raised, by default. */
async function saveOver(
  stored: FLSaisonTeamKontakte,
  answered: unknown = SAVED,
  change = async (user: ReturnType<typeof userEvent.setup>) => {
    const phone = screen.getAllByRole("textbox", { name: "Telefon" })[0] ?? assert.fail("the seats render no telephone box");
    await user.clear(phone);
    await user.type(phone, "069 222");
  },
): Promise<void> {
  const user = userEvent.setup({ delay: null });
  answerWith(() => Promise.resolve(answered));
  render(editorElement(viewElement(stored, true, TEAM_ID), stored));
  await change(user);
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  await settle();
}

/** Presses the Rückgängig the save's toast offered, as the toast's own button does. */
async function pressUndo(): Promise<void> {
  const offer = toasts.find(({ options }) => options?.actionProps?.onPress !== undefined) ?? assert.fail("the save offered no undo");
  offer.options?.actionProps?.onPress?.();
  await settle();
}

/** One seat's person as nobody has confirmed them, so a new name there costs no confirmation and raises no dialog. */
const unconfirmed = (vorname: string, nachname: string, email: string): FLKontaktperson => ({
  ...ADA,
  vorname,
  nachname,
  email,
  einwilligung: { ...ADA.einwilligung, erfasst_von: "administrativ", bestaetigt_am: null },
});

/** Three people and one address among them, so the page offers exactly one person's erasure. */
const ONE_ADDRESS: FLSaisonTeamKontakte = { ...BLOCK_WITHOUT_ADDRESS, ansprechperson: seatPerson("Grace", "Hopper", "grace@example.org") };

/** What the erasure's arming read answers: one seat, in a season this page does not show. */
const ERASURE_READ = {
  success: true,
  ansicht: { acknowledged: 1, saison_teams: [{ saison_id: "2425", rolle: "trainer", vorname: "Grace", nachname: "Hopper" }], bewerbungen: [] },
};

/** The editor page's address: the club the answers below hold, in the season they hold it in. */
const PAGE_PROPS = { params: Promise.resolve({ team_id: OBJECT_ID }), searchParams: Promise.resolve({ saison_id: "2526" }) };

/** The block the page's memberships read answers with, as the backend holds it at that moment. */
let storedBlock: FLSaisonTeamKontakte = BLOCK;

/** The season the address names. */
const SAISON = answer(FLSaisonSchema, "/saisons/list/admin", saisonFields("2526", "active"));

answerReadsWith((endpoint, schema, params) => {
  if (endpoint === "/saisons/list/admin") return answer(schema, endpoint, { saisons: [SAISON] });
  if (endpoint === "/teams/memberships") {
    const club = answer(FLTeamWithMembershipsSchema, endpoint, {
      id: OBJECT_ID,
      name: "SG Alpha",
      shorthand: "SA",
      full_name: "Sportgemeinschaft Alpha",
      address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
      memberships: [{ saison_id: "2526", gruppe: "A", austritt: null, trikot_farbe: null, kontakte: storedBlock, kontakte_stand: "9f2c" }],
    });
    return answer(schema, endpoint, { teams: [club] });
  }
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

/** The words a reader hears at one heading level, in the order the markup carries them. */
const headings = (html: string, level: string): string[] =>
  [...html.matchAll(new RegExp(`<${level}[^>]*>([^<]*)<`, "g"))].map((found) => found[1] ?? "");

/** Each rendered seat card, cut into the header carrying its title and the body beneath it. */
const seatCards = (html: string): { header: string; body: string }[] => {
  const panel = formPanel();

  return html
    .split(`<section class="${panel.root()}">`)
    .slice(1)
    .map((card) => {
      const [header = "", body = ""] = card.split(`<div class="${panel.body()}">`);

      return { header, body };
    });
};

const KONTAKTE_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte";
/* Spelled out rather than read off the published document, which is the very thing the case below
   compares it to: a code taken from `publishedRefusals` would agree with itself whatever the backend publishes. */
const STALE_BLOCK = "REQ-KONTAKT-001";

describe("the contacts write against the codes its endpoint publishes", () => {
  /* Worded apart from the undo, whose toast has not got the form the save's sentence sends the admin to
     (`fl_frontend/src/app/api/admin/kontakte/undo/route.test.ts`). A code the save leaves unmapped
     falls through to the shared fallback, which names no reason. */
  it("words the one refusal its endpoint publishes, at the save", () => {
    const published = publishedRefusals(KONTAKTE_OPERATION);

    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      [STALE_BLOCK],
    );
    for (const code of published) {
      assert.notEqual(answerShown(KONTAKTE_OPERATION, code, mapStaleBlockRefusal), null, `${code} reaches the admin as an unhandled conflict`);
    }
    // Two sentences, the way out second: the shared refusal shape, which a hand-spelled pair drifts from.
    assert.match(String(mapStaleBlockRefusal(refusedOn(KONTAKTE_OPERATION, STALE_BLOCK))), /^[^.]+\. [^.]+\.$/);
  });
});

describe("the editor's shape", () => {
  /* One `h1` per page and the shell owns it. The heading LEVEL is `PanelHeading`'s now and pinned there;
     what a seat owes is using it. */
  it("raises no heading the shell already owns", async () => {
    const { container, unmount } = render(underNext(await pageBody(AdminKontakteEditPage, PAGE_PROPS), { search: "saison_id=2526" }));

    // The control: an editor rendering no title at all would satisfy the absence below.
    assert.ok(
      [...container.querySelectorAll("h2")].some((heading) => heading.textContent === "Trainer"),
      "the page renders no seat title, so the absence below proves nothing",
    );
    // A boolean rather than the node: a failing assertion over a DOM node serialises its whole tree.
    assert.ok(container.querySelector("h1") === null, "the page raises an h1 the shell already owns");
    unmount();
  });

  /* The page's chrome may never wait on the row: rendered with no boundary awaited, its fallback
     stands, where an async page would suspend whole. */
  it("renders its fallback before the row resolves", () => {
    assert.ok(renderTree(h(AdminKontakteEditPage, PAGE_PROPS)).includes('role="status"'), "the page waits on the row before it renders");
  });

  /* The club is judged before the backend is asked: a malformed id reads nothing. */
  it("answers a malformed club id with a 404 before any read", async () => {
    clearSteps();

    await assert.rejects(pageBody(AdminKontakteEditPage, { ...PAGE_PROPS, params: Promise.resolve({ team_id: "kein-team" }) }), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    assert.deepEqual(readsOf(steps), [], "the page asked the backend about an id it could have refused unread");
  });

  /* Re-seeding is a `key`, not a prop: every field is `useState` initialised from the row, and an
     initialiser runs once per mounted instance. */
  it("keys the view by the state the draft mirrors", async () => {
    const user = userEvent.setup({ delay: null });
    storedBlock = BLOCK;
    const { rerender, unmount } = render(underNext(await pageBody(AdminKontakteEditPage, PAGE_PROPS), { search: "saison_id=2526" }));
    const addresses = () => screen.getAllByRole<HTMLInputElement>("textbox", { name: "E-Mail" });
    await user.clear(addresses()[0] ?? assert.fail("the seats render no address box"));
    await user.paste("erika@example.org");

    // The refresh after a save re-reads the row as the backend stored it, which is not what was typed.
    storedBlock = { ...BLOCK, ansprechperson: seatPerson("Grace", "Hopper", "grace.hopper@example.org") };
    rerender(underNext(await pageBody(AdminKontakteEditPage, PAGE_PROPS), { search: "saison_id=2526" }));

    assert.equal(addresses()[0]?.value, "grace.hopper@example.org", "the box keeps the draft over the block the save stored");
    unmount();
  });

  /* A ratified decision (`.claude/rules/frontend.md`): a typed field is judged when it is LEFT. A
     message between two keystrokes describes a value nobody finished entering. */
  it("judges a typed field when it is left, and never between keystrokes", async () => {
    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(BLOCK), BLOCK));
    // A refusal reaches the reader as the box's own description, which is where it is read from here.
    const refused = () => screen.queryAllByRole("textbox", { name: "E-Mail", description: /./ });
    const [address] = screen.getAllByRole("textbox", { name: "E-Mail" });

    await user.clear(address ?? assert.fail("the seats render no address box"));
    await user.paste("erika@");
    assert.equal(refused().length, 0, "a seat's field is judged between keystrokes");

    await user.tab();
    assert.equal(refused().length, 1, "leaving a seat's field judges nothing");
  });

  /* The claim is honoured at the ONE compose site. Written into the draft it overwrites whichever of
     two real people it does not name, on the first keystroke and with no undo — a stored row can hold
     the claim over two DIFFERENT people. */
  it("honours the claim when the payload is composed, and never in the draft", async () => {
    const claimed: FLSaisonTeamKontakte = {
      trainer: unconfirmed("Ada", "Byron", "ada@example.org"),
      ansprechperson: unconfirmed("Grace", "Hopper", "grace@example.org"),
      stellvertretung: unconfirmed("Alan", "Turing", "alan@example.org"),
      trainer_ist_zugleich: "ansprechperson",
    };
    await saveOver(claimed);

    const [saved] = calls.map(({ payload }) => payload as FLPatchSaisonTeamKontaktePayload);
    assert.equal(
      saved?.kontakte?.trainer?.vorname,
      "Grace",
      "the payload no longer composes the claim, so the save writes the draft's Trainer",
    );
    cleanup();

    // The draft keeps the Trainer's own person through a pick and back, which a claim written into it would overwrite.
    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(BLOCK), BLOCK));
    const trainerFirstName = () => screen.getAllByRole<HTMLInputElement>("textbox", { name: "Vorname" })[2]?.value;
    await user.click(screen.getByRole("radio", { name: "Die Ansprechperson" }));
    await user.click(screen.getByRole("radio", { name: "Eine andere Person" }));

    assert.equal(trainerFirstName(), "Ada", "the claim was written into the draft, and the Trainer it named over is gone");
  });

  /* A seat switched off and on again is one press somebody may take back, and the person it held is
     typed rather than stored anywhere else. */
  it("keeps what a switched-off seat held, and hands it back on the way on", async () => {
    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(BLOCK), BLOCK));
    // The seats render in the order this file's heading case pins, so the first is the Ansprechperson's.
    const firstNames = () => screen.queryAllByRole<HTMLInputElement>("textbox", { name: "Vorname" });
    const held = firstNames()[0]?.value ?? "";

    assert.notEqual(held, "", "the seat holds nobody, so the switch below takes nothing away");
    assert.equal(firstNames().length, 3, "a seat renders no name box, so the count below reads the wrong seats");

    await user.click(screen.getByRole("switch", { name: "Ansprechperson hinterlegt" }));
    assert.equal(firstNames().length, 2, "the switched-off seat keeps its boxes");

    await user.click(screen.getByRole("switch", { name: "Ansprechperson hinterlegt" }));
    assert.equal(firstNames()[0]?.value, held, "the seat comes back empty, so the press cost the person it held");
  });

  /* While the claim stands the Trainer is the named seat's person, so leaving one of that seat's
     fields judges the Trainer's copy too: judged alone, the copy keeps a verdict over a value it never saw. */
  it("judges the Trainer's copy when a field of the seat it copies is left", async () => {
    const user = userEvent.setup({ delay: null });
    const claimed: FLSaisonTeamKontakte = { ...BLOCK, trainer_ist_zugleich: "ansprechperson" };
    render(editorElement(viewElement(claimed), claimed));
    const [address] = screen.getAllByRole("textbox", { name: "E-Mail" });

    await user.clear(address ?? assert.fail("the seats render no address box"));
    await user.paste("grace@");
    await user.tab();

    assert.deepEqual(
      refusedBoxes().map((box) => box.getAttribute("name")),
      ["kontakte.ansprechperson.email", "kontakte.trainer.email"],
      "a left field is judged without the Trainer's copy of it",
    );
  });

  /* An empty seat is a saveable state rather than a half-finished one, and the record keeps no field
     saying why it is empty — so neither surface may say why either. */
  it("renders an empty seat as its switch alone, and never explains one", () => {
    const CLAIMS = ["gelöscht", "entfernt worden", "nicht mehr", "unbekannt", "keine Angabe"];
    /* Both states of the editor's own seats, and the arm that renders neither: a club with no junction
       row meets a link where the seats would be, which every render passing `isMember` reads past. */
    for (const [wo, html] of [
      ["an empty seat", sectionMarkup(BLOCK_EMPTY)],
      ["a filled seat", sectionMarkup(BLOCK)],
      ["a club with no junction row", sectionMarkup(BLOCK_EMPTY, false)],
    ] as const) {
      for (const claim of CLAIMS) assert.ok(!html.includes(claim), `the editor says „${claim}“ at ${wo}, which the row records no field for`);
    }
    // Nothing beneath the switch: an empty seat renders no sub-heading of its own, the Kenntnisnahme's included.
    assert.deepEqual(headings(sectionMarkup(BLOCK_EMPTY), "h4"), [], "an empty seat renders something beneath its switch");

    const seats = [
      seat("trainer", "Trainer", ADA),
      seat("ansprechperson", "Ansprechperson", null),
      seat("stellvertretung", "Stellvertretung", null),
    ];
    const emptyList = listMarkup(listRow(seats), "");
    const times = (needle: string) => emptyList.split(needle).length - 1;

    /* The occupied seat is the control: a list rendering no seat at all would satisfy every negative
       check below. Counted against each other rather than against a number, because the phone cards
       and the table each render all three. */
    assert.ok(times("Ada Byron") > 0, "the list renders no seat at all, so the empty ones prove nothing");
    assert.equal(times("Niemand hinterlegt"), 2 * times("Ada Byron"), "an empty seat stopped reading as a sentence, or borrowed a person");

    for (const claim of ["gelöscht", "entfernt worden", "nicht mehr", "unbekannt", "keine Angabe"]) {
      assert.ok(!emptyList.includes(claim), `the list says „${claim}“ about a seat, which the row records no field for`);
    }
  });

  /* The save's own block, which reaches the field through the form the hook holds: a refusal that
     reached no control would leave the admin a page saying nothing and a save that never ran. */
  it("marks the refused field when a save is blocked", async () => {
    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(BLOCK), BLOCK));
    const [firstName] = screen.getAllByRole("textbox", { name: "Vorname" });

    await user.clear(firstName ?? assert.fail("the seats render no name box"));
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    assert.ok(screen.queryAllByRole("textbox", { description: /./ }).length > 0, "the blocked save marks no field at all");
  });

  /* Both gates of the reused-tree defect, and neither is sufficient alone: the key above re-seeds a
     reopened editor, and this reset is what makes a tree the router kept alive honest. */
  it("resets the draft on the way out of a save", async () => {
    const user = userEvent.setup({ delay: null });
    answerWith(() => Promise.resolve({ success: true, message: "Kontakte gespeichert.", saison_team: { kontakte_stand: "a1b2" } }));
    render(editorElement(viewElement(BLOCK, true, "507f1f77bcf86cd799439011"), BLOCK));
    // The telephone, over which no banner is raised: a changed name or address opens the save dialog.
    const phone = screen.getAllByRole<HTMLInputElement>("textbox", { name: "Telefon" })[0] ?? assert.fail("the seats render no telephone box");

    await user.clear(phone);
    await user.type(phone, "069 222");
    assert.equal(phone.value, "069 222", "the typed value never reached the draft, so the reset below proves nothing");

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    // The write runs inside a transition, so its answer and the reset behind it land after the press.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(calls.length, 1, "the press never reached the write, so the reset below proves nothing");
    assert.equal(phone.value, BLOCK.ansprechperson?.telefon, "a save leaves typed values standing in the tree");
  });

  /* Unsaved work may not leave unasked, by the header's way out or by the action bar's. */
  it("asks before leaving over unsaved work, by either way out", async () => {
    for (const wayOut of [/Zurück/, /^Abbrechen$/]) {
      const user = userEvent.setup({ delay: null });
      const { unmount } = render(editorElement(viewElement(BLOCK), BLOCK));
      const phone = screen.getAllByRole("textbox", { name: "Telefon" })[0] ?? assert.fail("the seats render no telephone box");
      await user.type(phone, "2");
      await user.click(screen.getByRole("button", { name: wayOut }));

      assert.ok(screen.queryByRole("button", { name: "Verwerfen" }) !== null, `${String(wayOut)} leaves unsaved work unasked`);
      assert.deepEqual([seen.back, seen.pushed], [0, []], `${String(wayOut)} navigated over unsaved work`);
      unmount();

      // The control: with nothing typed, the same press leaves, so the refusal above is the draft's.
      const clean = render(editorElement(viewElement(BLOCK), BLOCK));
      await user.click(screen.getByRole("button", { name: wayOut }));
      assert.equal(seen.back + seen.pushed.length, 1, `${String(wayOut)} does not leave a clean editor, so the refusal above proves nothing`);
      clean.unmount();
      seen.back = 0;
      seen.pushed.length = 0;
    }
  });

  /* A page-owned editor's undo is a route handler (`docs/frontend/spec.md` §1.3). The STORED block and
     both ids restore through the same PATCH: the save run backwards, never a second write shape. */
  it("offers an undo that replays the pre-save block to its own route handler", async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(Response.json({ success: true, message: "Kontakte wiederhergestellt.", warn: false })),
    );
    await saveOver(BLOCK);

    // The save's own body carries the token the page was SERVED, which is the whole of what it judges.
    assert.deepEqual(
      calls.map(({ action, payload }) => [action, (payload as { kontakte_stand?: unknown }).kontakte_stand]),
      [["patchSaisonTeamKontakteAction", "9f2c"]],
    );

    await pressUndo();
    assert.deepEqual(
      fetchMock.mock.calls.map((call) => [String(call.arguments[0]), JSON.parse(String(call.arguments[1]?.body)) as unknown]),
      [
        [
          "/api/admin/kontakte/undo",
          // The precondition is the write's own answer: this save has moved the row past the block the
          // page read, so replaying that one asks the endpoint to refuse.
          { team_id: TEAM_ID, saison_id: "2526", kontakte: toKontaktePayload(BLOCK), kontakte_stand: SAVED.saison_team.kontakte_stand },
        ],
      ],
    );
  });

  /* A ratified decision (`.claude/rules/frontend.md`) keeps the offer on the save the confirmation dialog gated too. */
  it("offers the same undo on a save the confirmation dialog gated", async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(Response.json({ success: true, message: "Kontakte wiederhergestellt.", warn: false })),
    );
    await saveOver(BLOCK, SAVED, async (user) => {
      await user.click(screen.getByRole("switch", { name: "Stellvertretung hinterlegt" }));
    });
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Trotzdem speichern" }));
    await settle();

    assert.equal(calls.length, 1, "the dialog's confirmation never reached the write, so the offer below is judged over nothing");
    await pressUndo();
    assert.deepEqual(
      fetchMock.mock.calls.map((call) => (JSON.parse(String(call.arguments[1]?.body)) as { kontakte?: unknown }).kontakte),
      [toKontaktePayload(BLOCK)],
    );
  });

  /* The token is what every save is judged against, so a mirror dropping it leaves the editor sending
     `undefined` and the endpoint refusing a row nobody has touched. */
  it("mirrors the token the membership read serves", () => {
    const parsed = FLTeamMembershipSchema.safeParse({
      saison_id: "2526",
      gruppe: "A",
      austritt: null,
      trikot_farbe: null,
      kontakte: BLOCK_EMPTY,
      kontakte_stand: "9f2c",
    });

    assert.ok(parsed.success, "the membership mirror refuses a row the memberships read serves");
    assert.equal(parsed.data.kontakte_stand, "9f2c");
  });

  /* A seat the person confirmed for WhatsApp reaches the editor on the read and is spelled by no
     payload, so it is the block where the replay and the route's own parse can disagree. */
  it("replays a confirmed seat at the scope an administrator may write", () => {
    const confirmedSeat: FLKontaktperson = { ...ADA, einwilligung: { ...ADA.einwilligung, umfang: "kontaktdaten_whatsapp" } };
    const restorable = {
      team_id: "507f1f77bcf86cd799439011",
      saison_id: "2526",
      kontakte: toKontaktePayload({ ...BLOCK, trainer: confirmedSeat }),
      kontakte_stand: "9f2c",
    };
    const parsed = FLPatchSaisonTeamKontaktePayloadSchema.safeParse(restorable);

    assert.ok(parsed.success, "the undo route refuses the block a confirmed seat leaves");
    assert.equal(parsed.data.kontakte?.trainer?.einwilligung.umfang, "kontaktdaten");
    assert.deepEqual(Object.keys(restorable.kontakte?.trainer?.einwilligung ?? {}).sort(), ["datum", "text_version", "umfang"]);
    // The offer's own verdict, over the body it hands on: a withheld undo sends the admin to re-enter
    // three people by hand.
    assert.equal(describeUnrestorableKontakte(restorable), null, "the offer withholds an undo the endpoint would take");
  });
});

describe("what the undo says when it cannot run", () => {
  /* It is raised one press after the save's own „Kontakte gespeichert“, and a reload replaces the
     block on screen with the one that save wrote: an imperative to reload destroys the very values
     the sentence then asks for by hand. */
  it("asks for the pre-save values without sending anybody through a reload first", async () => {
    // A save whose answer carried no token for the block it left, so the replay has no precondition.
    await saveOver(BLOCK, { success: true, message: "Kontakte gespeichert." });
    await pressUndo();

    const [refused] = toasts.filter(({ variant }) => variant === "danger").map(({ description }) => description ?? "");
    assert.match(refused ?? "", /von Hand ein/, "the refusal no longer asks for the pre-save values by hand");
    assert.doesNotMatch(refused ?? "", /Lade die Seite neu/, "the refusal reloads away the values it then asks for");
    assert.equal(fetchMock.mock.callCount(), 0, "a replay with no precondition was dispatched");
  });

  /* Backend I36 (`docs/backend/spec.md`) admits a malformed address on READ, and such a block is no
     legal write. The spine can only answer that body with a reload, so the caller — which alone
     holds the payload and the reason — diagnoses first. */
  // The diagnosis itself: `fl_frontend/src/features/kontakte/utils.test.ts :: describeUnrestorableKontakte`.
  it("diagnoses an unrestorable block itself rather than dispatching it", async () => {
    const malformed: FLSaisonTeamKontakte = { ...BLOCK, stellvertretung: unconfirmed("Alan", "Turing", "alan.example.org") };
    const restorable = { team_id: TEAM_ID, saison_id: "2526", kontakte: toKontaktePayload(malformed), kontakte_stand: "a1b2" };
    // The address corrected, which is the save such a row takes: the stored block is what the undo replays.
    await saveOver(malformed, SAVED, async (user) => {
      const address = screen.getAllByRole("textbox", { name: "E-Mail" })[1] ?? assert.fail("the seats render no second address box");
      await user.clear(address);
      await user.type(address, "alan@example.org");
    });
    assert.equal(calls.length, 1, "the corrected save never reached the write, so the offer below is judged over nothing");

    await pressUndo();
    assert.deepEqual(
      toasts.filter(({ variant }) => variant === "danger").map(({ title, description }) => [title, description]),
      [["Änderung nicht zurückgenommen", describeUnrestorableKontakte(restorable)]],
    );
    assert.equal(fetchMock.mock.callCount(), 0, "an unrestorable block was dispatched to a route that can only answer it with a reload");
  });
});

describe("what the banners say", () => {
  /* `resolveBlockingBanners` takes the non-info banners raised by the CHANGE, so the emptied seats and the
     cleared confirmation are what open the save dialog — and a standing situation, however grave, asks
     nothing. */
  it("puts what the save takes away in front of the save dialog, and neither situation", () => {
    const severities = (state: Parameters<typeof bannersFor>[0]) => bannersFor(state).map((banner) => banner.severity);

    for (const state of [{ emptiedSeatLabels: ["Trainer"] }, { renamedConfirmedSeatLabels: ["Trainer"] }]) {
      assert.deepEqual(severities(state), ["warning"], `${JSON.stringify(state)} raises nothing, or grades a removal as ordinary`);
      assert.notEqual(resolveBlockingBanners(bannersFor(state)), null, `${JSON.stringify(state)} saves without confirming what it clears`);
    }

    for (const state of [{ isMember: false }, { saisonStatus: "past" as const }]) {
      /* Each grade asserted outright, which is also the floor: `null` below reads the same for a
         situation correctly let through and for a state that raised nothing at all. */
      assert.deepEqual(severities(state), ["info"], `${JSON.stringify(state)} raises nothing, or grades a standing state as a warning`);
      assert.equal(resolveBlockingBanners(bannersFor(state)), null, `${JSON.stringify(state)} confirms a situation the save did not cause`);
    }
  });

  /* No count in a sentence that would have to agree with it: the seats are read out in the body
     instead, which is what keeps the wording right for one seat and for three. */
  it("names the emptied seats in a readout rather than counting them", () => {
    const [einer] = bannersFor({ emptiedSeatLabels: ["Trainer"] });
    const [drei] = bannersFor({ emptiedSeatLabels: ["Trainer", "Ansprechperson", "Stellvertretung"] });

    assert.equal(einer?.body, "Betroffen: Trainer.");
    assert.equal(drei?.body, "Betroffen: Trainer, Ansprechperson, Stellvertretung.");
    for (const banner of [einer, drei]) {
      assert.doesNotMatch(`${banner?.title ?? ""} ${banner?.body ?? ""}`, /\d/, "the banner counts the seats in a sentence that must agree");
    }
  });

  /* „endgültig“ is the half an admin would otherwise get wrong: no junction seat can be confirmed a
     second time, so a title offering a way back would be spent the first time somebody looked. */
  it("reads the renamed seats out and calls the lost confirmation final", () => {
    const [einer] = bannersFor({ renamedConfirmedSeatLabels: ["Trainer"] });
    const [zwei] = bannersFor({ renamedConfirmedSeatLabels: ["Ansprechperson", "Trainer"] });

    assert.equal(einer?.id, "kontakte.confirmation-cleared");
    assert.equal(einer?.body, "Betroffen: Trainer.");
    assert.equal(zwei?.body, "Betroffen: Ansprechperson, Trainer.");
    assert.equal(einer?.title, zwei?.title, "the title changes with the seats, so it has to agree with a count");
    assert.match(einer?.title ?? "", /endgültig/, "the title leaves the loss open, which a fresh confirmation cannot repair");
  });
});

describe("the way in and out of the editor", () => {
  /* The club editor holds none of the block any more, and the link in its place carries the season:
     the seats are season-scoped, so a link without it would open another season's three people. */
  it("leaves the club editor with a link and none of the block", () => {
    const clubEditor = renderTree(
      underNext(
        h(AdminTeamEditForm, {
          team: {
            id: TEAM_ID,
            name: "SG Alpha",
            shorthand: "ALP",
            description: "",
            full_name: "Sportgemeinschaft Alpha",
            website_url: null,
            address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
            schulform: null,
            inactive_since: null,
          },
          saison: {
            saisonId: "2526",
            saisonStatus: "active",
            membership: { gruppe: "A", austritt: null, trikot_farbe: null, kontakte: BLOCK, kontakte_stand: "9f2c" },
          },
          today: "2026-03-01",
          gruppeLocked: false,
          gruppeOffer: [{ gruppe: "A", occupied: 1, capacity: 4 }],
          swap: { teams: [], playedKnockoutSpiele: 0 },
          einladung: null,
          pageHeader: { title: "SG Alpha" },
        }),
        { search: "saison_id=2526" },
      ),
    );

    // The control: the club's season panel renders, so the absence of the seats below is the editor's.
    assert.match(clubEditor, /name="gruppe"/, "the club editor rendered no season panel, so the absence below proves nothing");
    assert.ok(!clubEditor.includes("Trainer hinterlegt"), "the club editor still renders the contacts block");
    assert.equal(
      /<a [^>]*href="([^"]*)"[^>]*>3 Kontakteinträge für Saison 2526 bearbeiten</.exec(clubEditor)?.[1],
      `/admin/kontakte/${TEAM_ID}?saison_id=2526`,
      "the club editor's link does not open this editor on the season it shows",
    );
  });

  /* Seats HELD, never the three the block always carries: an erasure leaves a block whose seats are
     empty, and a count off the block's presence would call that three. */
  it("counts the seats the link names off what is in them", () => {
    const block = (held: number): FLSaisonTeamKontakte => ({
      trainer: held > 0 ? ADA : null,
      ansprechperson: held > 1 ? ADA : null,
      stellvertretung: null,
      trainer_ist_zugleich: null,
    });
    const linkText = (kontakte: FLSaisonTeamKontakte | null): string =>
      /<a [^>]*>(.*?)<\/a>/s.exec(renderMarkup(FormKontakteLinkSection, { saisonId: "2526", kontakte, href: "/admin/kontakte/t1" }))?.[1] ?? "";

    /* An erasure leaves a block whose seats are empty, so an emptied block and an absent one read the
       same: a count off the block's presence would call the first of these three. */
    assert.equal(linkText(null), "Kontakte für Saison 2526 hinterlegen");
    assert.equal(linkText(block(0)), "Kontakte für Saison 2526 hinterlegen");
    assert.equal(linkText(block(1)), "1 Kontakteintrag für Saison 2526 bearbeiten");
    assert.equal(linkText(block(2)), "2 Kontakteinträge für Saison 2526 bearbeiten");
  });

  /* The editor's own way back out, which the list's link and the club editor's each carry too. What
     the builder returns is `fl_frontend/src/features/kontakte/utils.test.ts :: teamPageHref`. */
  it("sends the panel's way out through the builder that carries the season", () => {
    // Rendered where the club has no junction row, which is the state the way out exists for.
    const wayOut = /<a [^>]*href="([^"]*)"[^>]*>Zur Seite des Teams</.exec(viewMarkup(null, false))?.[1] ?? "";

    assert.equal(wayOut, teamPageHref("t1", "2526"), "the way out is spelled a second time, or lost the season");
  });

  /* One noun for one concept: `Saison-Zugehörigkeit` is what the admin surface calls a junction row,
     and a second word for it inside one slice reads as a second thing. */
  it("calls the junction row by the admin surface's own noun", () => {
    const [ohneZeile] = bannersFor({ isMember: false });

    assert.match(
      ohneZeile?.body ?? "",
      /Kontakte werden bei der Saison-Zugehörigkeit hinterlegt/,
      "the banner renamed the row the seats hang off",
    );
    /* The arm that renders no seat at all belongs here more than the others: it is the one place the
       editor has to NAME the junction row, being the state where the club has none. */
    for (const [wo, html] of [
      ["the editor", viewMarkup(BLOCK)],
      ["a club with no junction row", viewMarkup(null, false)],
    ] as const)
      assert.ok(!html.includes("Saisonteilnahme"), `${wo} carries a second noun for the junction row`);
    // Every state the banner author can be in, since a rail banner is composed rather than rendered here.
    for (const state of [
      {},
      { isMember: false },
      { saisonStatus: "past" as const },
      { emptiedSeatLabels: ["Trainer"] },
      { renamedConfirmedSeatLabels: ["Trainer"] },
    ])
      for (const banner of bannersFor(state))
        assert.ok(!`${banner.title} ${banner.body ?? ""}`.includes("Saisonteilnahme"), "a banner carries a second noun for the junction row");
  });

  /* A row is one club's three seats, edited together, so its control opens this editor and not the
     club's — and the season it was pressed in rides along, the seats being season-scoped. */
  it("points every row of the list at this editor, with the season riding along", () => {
    const hrefs = (query: string) => [
      ...new Set([...listMarkup(listRow([seat("trainer", "Trainer", ADA)]), query).matchAll(/href="([^"]*)"/g)].map((found) => found[1])),
    ];

    assert.deepEqual(hrefs("saison_id=2526"), ["/admin/kontakte/t1?saison_id=2526"]);
    // The season the sidemenu holds is the whole of what rides along; every other filter stays behind.
    assert.deepEqual(hrefs("saison_id=2526&q=alpha&besetzung=teilweise"), ["/admin/kontakte/t1?saison_id=2526"]);
    // Absent rather than empty: `?saison_id=` would read as a season nobody picked.
    assert.deepEqual(hrefs("q=alpha"), ["/admin/kontakte/t1"]);
  });
});

describe("how the editor clears a season's contact block", () => {
  /* A switch that answers „hinterlegt“ and silently drops three people is destructive work wearing a
     toggle's shape. The deletion says what it does, and it is the one path that writes the null. */
  it("offers no toggle that empties the block as a side effect", () => {
    const renderedSeats = sectionMarkup(BLOCK);

    assert.ok(!renderedSeats.includes("Kontakte hinterlegt"), "the block toggle is back, and it deletes on the way off");
    // The arm the seats never render in, which the sweep above reads past: a toggle put there would
    // sit above the link rather than above the seats.
    assert.ok(
      !sectionMarkup(BLOCK_EMPTY, false).includes("Kontakte hinterlegt"),
      "the block toggle is back where the club has no junction row",
    );
    // The control: one switch per seat is what stayed, so a render carrying none proves nothing above.
    assert.ok(renderedSeats.includes("Trainer hinterlegt"), "the seats render no switch at all");
  });

  /* Its own red section, and LAST: every editor on the site puts its destructive section at the
     bottom, and a reader scanning one editor for it looks where the last one had it. */
  it("puts the deletion in its own section, after everything the form edits", () => {
    const editor = viewMarkup(BLOCK);

    assert.ok(editor.includes("Kontakte dieser Saison löschen"), "the deletion is not offered on a season the club has contacts in");
    assert.ok(
      editor.indexOf("Kontakte dieser Saison löschen") > editor.indexOf("Trainer hinterlegt"),
      "the deletion sits above the fields it deletes",
    );
    /* Every graded slot the section renders, never the box alone: the recipe grades the header band
       and the title beside it, and each falls back to neutral on its own. */
    const danger = formPanel({ tone: "danger" });

    assert.ok(editor.includes(`<section class="${danger.root()}">`), "the deletion's box is not graded as destructive");
    assert.ok(editor.includes(`<div class="${danger.header()}">`), "the deletion's header band is not graded as destructive");
    assert.ok(editor.includes(`<h2 class="${danger.heading()}`), "the deletion's title is not graded as destructive");
    // Nothing stored is nothing at stake, so the grade is spent nowhere.
    assert.ok(!viewMarkup(null).includes("border-danger/30"), "an empty block is graded as destructive");
    assert.ok(
      !viewMarkup(null, false).includes("Kontakte dieser Saison löschen"),
      "the deletion renders on a condition other than the junction row existing",
    );
  });

  /* Neither the record nor its reader can tell a row nobody filled in from one an erasure emptied, so the
     page opens both alike (`fl_frontend/src/features/teams/utils.ts :: holdsNobody`). */
  it("opens a row holding nobody the same way whichever shape stores it", () => {
    const nobodyHeld = viewMarkup(null);

    /* The state both shapes open in, asserted outright: two renders agreeing would pass as readily over
       three switched-off seats and a red, open deletion. */
    assert.equal([...nobodyHeld.matchAll(/role="switch"[^>]*checked=""/g)].length, 3, "a row holding nobody opens with a seat switched off");
    assert.ok(
      !nobodyHeld.includes(`<section class="${formPanel({ tone: "danger" }).root()}">`),
      "the deletion is graded as destructive over nobody",
    );
    assert.match(
      nobodyHeld,
      /<button[^>]*\sdisabled=""[^>]*>(?:(?!<button)[\s\S])*?Kontakte löschen<\/button>/,
      "the deletion is open over nobody",
    );
    assert.match(nobodyHeld, /<button[^>]*type="submit"[^>]*\sdisabled=""/, "a row holding nobody opens with a change to save");

    for (const [wie, kontakte] of [
      ["three empty seats", BLOCK_EMPTY],
      ["three empty seats under a claim naming one of them", { ...BLOCK_EMPTY, trainer_ist_zugleich: "ansprechperson" }],
    ] as const) {
      assert.equal(viewMarkup(kontakte), nobodyHeld, `a row storing ${wie} opens differently from a row storing no block`);
    }

    // The control: a row with somebody on file renders apart, so the equality above is not one page twice.
    assert.notEqual(viewMarkup(BLOCK), nobodyHeld, "the view renders the same page whatever the row holds");
  });

  /* The reset runs on the way out, and a tree the router keeps alive reopens on whatever it left: reset
     to the stored block of empty seats, the row would reopen in a state it never opens in. */
  it("leaves a row holding nobody in the state it opens on", async () => {
    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(BLOCK_EMPTY), BLOCK_EMPTY));
    const switchStates = () => screen.getAllByRole<HTMLInputElement>("switch").map((switchBox) => switchBox.checked);
    const openedWith = switchStates();

    await user.click(screen.getByRole("switch", { name: "Ansprechperson hinterlegt" }));
    assert.notDeepEqual(switchStates(), openedWith, "the press moved no seat, so the discard below restores nothing");

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await user.click(screen.getByRole("button", { name: "Verwerfen" }));

    assert.deepEqual(switchStates(), openedWith, "leaving reopens the row in a state nobody opens it in");
  });

  /* A person's erasure is keyed on an ADDRESS across every season and both collections. This clears
     ONE junction row. Merging them would answer a request to be forgotten by emptying one season. */
  it("clears this season's block and never reaches a person's erasure", async () => {
    const editor = viewMarkup(BLOCK);

    assert.match(
      editor.slice(editor.indexOf("Kontakte dieser Saison löschen")),
      /Saison-Zugehörigkeit/,
      "the section does not say which record it clears",
    );

    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(BLOCK), BLOCK));
    await pressTwice(user, { resting: "Kontakte löschen", armed: "Ja, Kontakte dieser Saison endgültig löschen" });
    await settle();

    // This row, by its natural key and under the token the page was served: the clearing is a save on
    // the same endpoint, and one sent without the token is refused whole.
    assert.deepEqual(calls, [
      { action: "patchSaisonTeamKontakteAction", payload: { team_id: "t1", saison_id: "2526", kontakte: null, kontakte_stand: "9f2c" } },
    ]);
  });
});

describe("how the editor asks which person the Trainer is", () => {
  /* The DIRECTION is the thing that was unreadable. „Zugleich“ names the flag and gets read as „who
     else is the Trainer also“, which is the way round the mirror does NOT run. */
  it("asks who the Trainer is, and never who else is also the Trainer", () => {
    assert.match(TRAINER_ZUGLEICH_FRAGE, /Trainer/, "the question no longer names the Trainer as its subject");
    assert.doesNotMatch(TRAINER_ZUGLEICH_FRAGE, /zugleich/i, "the question names the flag again instead of the consequence");
  });

  /* Every answer completes the question as one sentence, which is what carries the direction: the named
     seat IS the Trainer, so that seat's details are what the Trainer's boxes read. */
  it("offers answers that complete the question as a sentence", () => {
    assert.ok(TRAINER_ZUGLEICH_OPTIONS.length >= 3, "the picker no longer offers all three answers");

    for (const option of TRAINER_ZUGLEICH_OPTIONS) {
      assert.match(option.label, /^(Eine|Die)\b/, `„${option.label}“ does not complete „${TRAINER_ZUGLEICH_FRAGE}“`);
      assert.doesNotMatch(option.label, /zugleich|sonst/i, `„${option.label}“ answers a question about the flag`);
    }
  });

  /* The picker belongs to the Trainer seat, which is what it defines. On the block header it read as a
     property of the whole block rather than of the person it fills in. */
  it("renders the picker inside the Trainer seat and nowhere else", () => {
    const renderedSeats = sectionMarkup(BLOCK);

    assert.deepEqual(
      seatCards(renderedSeats).map((card) => card.body.includes(TRAINER_ZUGLEICH_FRAGE)),
      [false, false, true],
      "the picker is not bound to the Trainer seat",
    );
    // The control the answer is written into, which one press may claim for one seat only.
    assert.equal(renderedSeats.split('name="kontakte.trainer_ist_zugleich"').length - 1, 1, "the picker renders more than once");
  });
});

describe("what the editor says about a Kenntnisnahme it may not write", () => {
  /* The server composes both fields. A control offering either would let an administrator record a
     Kenntnisnahme as the person's own, or overwrite the stamp a confirmation wrote — which no rendered
     surface would show afterwards. */
  it("renders the origin and the confirmation stamp, and offers a control for neither", () => {
    const renderedSeats = sectionMarkup(BLOCK);

    assert.match(renderedSeats, />Erfasst</, "the Kenntnisnahme's origin is no longer shown at all");
    assert.match(renderedSeats, />Bestätigt am</, "the confirmation stamp is no longer shown at all");
    assert.ok(renderedSeats.includes(einwilligungHerkunftLabel("person")), "the origin renders as its stored slug rather than its label");
    assert.ok(renderedSeats.includes("14.03.2026"), "the stamp renders no date, or renders it as the stored string");

    for (const fieldName of ["erfasst_von", "bestaetigt_am"]) {
      assert.ok(!renderedSeats.includes(`einwilligung.${fieldName}"`), `${fieldName} is still a named field, so a save can carry it`);
    }
    // The chips themselves, because a disabled group would still read as a question with an answer.
    assert.ok(!renderedSeats.includes(einwilligungHerkunftLabel("administrativ")), "the origin is still offered as a pick");
  });
});

describe("which wording a record cites", () => {
  /* The version NAMES the text. Kept apart, a rewording without a bump leaves every earlier record
     citing a text nobody was shown. */
  it("keeps a version and the wording it names, both filled in", () => {
    // That the two are one object is this file's type error; what no type can say is that neither
    // half is a placeholder.
    assert.notEqual(LIGA_KENNTNISNAHME.textVersion, "", "the version is empty, so every record cites nothing");
    assert.ok(LIGA_KENNTNISNAHME.absaetze.length > 0, "the version names no wording at all");
    for (const wordingParagraph of LIGA_KENNTNISNAHME.absaetze) assert.notEqual(wordingParagraph, "", "the wording carries an empty paragraph");
    assert.notEqual(LIGA_KENNTNISNAHME.schalter, "", "the wording carries no sentence for the switch to agree to");
  });

  /* Both surfaces gather the SAME Kenntnisnahme, so a copy per feature is two texts that drift and two
     versions that disagree about which one a record cites. */
  it("stamps that one version on a new record from either surface", () => {
    assert.equal(
      buildEmptyKontaktperson().einwilligung.text_version,
      LIGA_KENNTNISNAHME.textVersion,
      "the admin editor stamps its own version",
    );
    assert.equal(
      buildEmptyBewerbungKontaktperson().einwilligung.text_version,
      LIGA_KENNTNISNAHME.textVersion,
      "the public form stamps its own version",
    );
  });

  /* Typed by hand, the version is a value nobody decided stored as though somebody had — and an edit
     to a STORED one would rewrite which text that person was shown, which is history. */
  it("never lets the version be typed, on a new record or a stored one", () => {
    const box = /<input[^>]*name="kontakte\.trainer\.einwilligung\.text_version"[^>]*>/.exec(sectionMarkup(BLOCK))?.[0] ?? "";

    assert.notEqual(box, "", "the Fassung field is no longer rendered at all");
    assert.match(box, /readonly=""/i, "the Fassung field is no longer read-only");
  });
});

describe("how the editor divides one person from the next", () => {
  // A class list drawing a rule, its top border and the padding under it matched in either order,
  // since the order is prettier's to set.
  const RULE_CLASS = /class="(?=[^"]*(?<=[\s"])border-t(?=[\s"]))(?=[^"]*(?<=[\s"])pt-\d)[^"]*"/g;

  /* Two depths drawn the same way read as one: a rule between two people is then the rule between a
     person's details and their Kenntnisnahme, and neither reads as a boundary. */
  it("gives every seat its own panel rather than a rule inside one", () => {
    const panel = formPanel();
    const cards = seatCards(sectionMarkup(BLOCK));

    // The recipe's own classes rather than a copy of them: a seat drawn at the call site drifts from
    // every other panel with nothing able to see it.
    assert.equal(cards.length, 3, "a seat is drawn as something other than its own panel");
    for (const { header } of cards) {
      assert.ok(header.startsWith(`<div class="${panel.header()}">`), "a seat's panel opens on something other than the panel header");
      // The heading slot, not what the heading holds: pinning the contents made adding the seat's
      // own info icon read as the panel being lost.
      assert.ok(header.includes(`<h2 class="${panel.heading()}`), "a seat spells its own heading again");
    }
    // The slice's own class alone, since prettier sorts others between it and the rule it drops.
    assert.doesNotMatch(sectionMarkup(BLOCK), /(?<=[\s"])first:border-t-0(?=[\s"])/, "the seats are back to being slices of one panel");
  });

  /* An empty card carrying a title and nothing else is what the block heading had become once each
     seat had a card of its own. */
  it("raises no block panel above the seats", () => {
    // The whole panel-title estate rather than one spelling: any panel above the seats is a fourth
    // heading here, whatever it is called.
    assert.deepEqual(
      headings(sectionMarkup(BLOCK), "h2"),
      ["Ansprechperson", "Stellvertretung", "Trainer"],
      "a panel above the seats is back, or a seat lost its own",
    );
  });

  /* One explanation per seat, on the seat: the three answer different questions, and a reader at a
     seat should not have to look elsewhere to learn which. */
  it("explains each seat on its own heading", async () => {
    // Off the HEADER of each card: a hint in the body would be an explanation a reader meets after
    // the fields it is about.
    const seatHints = seatCards(sectionMarkup(BLOCK)).map((card) => /aria-label="([^"]*)"/.exec(card.header)?.[1] ?? "");

    assert.equal(seatHints.length, 3, "the seats carry no cards of their own, so this compares nothing");
    assert.equal(new Set(seatHints).size, 3, `two seats share one explanation, or a seat carries none: ${seatHints.join(" | ")}`);
    for (const seatHint of seatHints) assert.match(seatHint, /^Hinweis zu/, `„${seatHint}“ is no explanation of a seat`);

    // What each press opens, since three labels derived from the seat names are distinct while all
    // three explanations read alike.
    const user = userEvent.setup({ delay: null });
    render(editorElement(sectionElement(BLOCK), BLOCK));
    const seatExplanations: string[] = [];

    for (const seatHint of seatHints) {
      await user.click(screen.getByRole("button", { name: seatHint }));
      seatExplanations.push(screen.queryByRole("dialog")?.textContent.trim() ?? "");
      await user.keyboard("{Escape}");
    }

    assert.ok(!seatExplanations.includes(""), `a seat's hint opens on nothing: ${seatExplanations.join(" | ")}`);
    assert.equal(new Set(seatExplanations).size, 3, `two seats are explained by the same sentence: ${seatExplanations.join(" | ")}`);
  });

  /* The lighter rule stays where it belongs: INSIDE a person, between their details and the
     Kenntnisnahme. One depth, one drawing. */
  it("keeps exactly one rule inside a seat, for the Kenntnisnahme", () => {
    /* No address in any seat, so none offers the person's erasure: that control draws its own rule
       from its own file, and what this case is about is the division inside one person. */
    for (const { body } of seatCards(sectionMarkup(BLOCK_WITHOUT_ADDRESS))) {
      const seatRules = [...body.matchAll(RULE_CLASS)].map((found) => found[0]);

      assert.equal(seatRules.length, 1, `the seat draws ${String(seatRules.length)} rules where the Kenntnisnahme needs one`);
      assert.match(
        body.split(seatRules[0] ?? "")[1] ?? "",
        /^><h4[^>]*>Kenntnisnahme</,
        "the seat's one rule opens something other than the Kenntnisnahme",
      );
    }
    /* Counted over the whole section as well: a rule drawn BETWEEN the cards sits inside no seat's body,
       so every count above passes while the two depths are back to being drawn alike. */
    assert.equal(
      [...sectionMarkup(BLOCK_WITHOUT_ADDRESS).matchAll(RULE_CLASS)].length,
      seatCards(sectionMarkup(BLOCK_WITHOUT_ADDRESS)).length,
      "the section draws a rule outside a seat",
    );
  });
});

describe("what the two destructive controls do to the page", () => {
  /* Both write on the server and then re-read the page, so an unsaved draft would be diffed against a
     baseline that moved underneath it. Every one-way control here guards the same way. */
  it("refuses to write over unsaved work, on both", async () => {
    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(ONE_ADDRESS), ONE_ADDRESS));
    await user.type(screen.getAllByRole("textbox", { name: "Telefon" })[0] ?? assert.fail("the seats render no telephone box"), "2");

    await user.click(screen.getByRole("button", { name: "Kontaktperson löschen" }));
    await user.click(screen.getByRole("button", { name: "Kontakte löschen" }));

    assert.deepEqual(
      toasts.map(({ variant, title, description }) => [variant, title, description]),
      [
        ["warning", "Erst speichern", DRAFT_DISCARDED],
        ["warning", "Erst speichern", DRAFT_DISCARDED],
      ],
      "a destructive control pressed over an unsaved draft does not say why it refused",
    );
    assert.equal(screen.queryAllByRole("button", { name: /^Ja, / }).length, 0, "a destructive control armed over an unsaved draft");
    assert.deepEqual(calls, [], "a destructive control asked or wrote over an unsaved draft");
  });

  /* The row is the team BEING IN the season, so clearing its contacts cannot remove it. Navigating to
     a list that still shows the entry would read as a failed delete. */
  it("stays on the page and leaves the re-read to the action, on both", async () => {
    for (const [resting, armed] of [
      ["Kontaktperson löschen", "Ja, Kontaktperson endgültig löschen"],
      ["Kontakte löschen", "Ja, Kontakte dieser Saison endgültig löschen"],
    ] as const) {
      const user = userEvent.setup({ delay: null });
      const { unmount } = render(editorElement(viewElement(ONE_ADDRESS), ONE_ADDRESS));
      answerWith(() => Promise.resolve(ERASURE_READ));
      await pressTwice(user, {
        resting,
        armed,
        whileArmed: async () => {
          await settle();
          answerWith(() => Promise.resolve({ success: true, cleared: 1, message: "Gelöscht." }));
        },
      });
      await settle();

      // The re-read comes back with the action's own answer, so a second one from here re-renders nothing new.
      assert.deepEqual([seen.refresh, seen.pushed, seen.replaced], [0, [], []], `${resting} leaves the page, or reads it a second time`);
      unmount();
    }
  });

  /* On a page showing one season, an erasure without its reach spelled out reads as clearing this seat.
     The ADDRESS keys both the read and the write; the list itself is
     `fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktReveal.test.ts`'s. */
  it("reads whom the address holds before the write can be confirmed", async () => {
    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(ONE_ADDRESS), ONE_ADDRESS));
    answerWith(() => Promise.resolve(ERASURE_READ));

    await pressTwice(user, {
      resting: "Kontaktperson löschen",
      armed: "Ja, Kontaktperson endgültig löschen",
      whileArmed: async () => {
        await settle();
        assert.ok(document.body.textContent.includes("Saison 2425 · Trainer"), "the armed panel names none of the seats the write would clear");
        answerWith(() => Promise.resolve({ success: true, cleared: 1, message: "Gelöscht." }));
      },
    });
    await settle();

    assert.deepEqual(calls, [
      { action: "readKontaktErasureAnsichtAction", payload: { email: "grace@example.org" } },
      { action: "eraseKontaktpersonAction", payload: { email: "grace@example.org" } },
    ]);
  });

  /* The season's own delete sends a reader who wants a person gone everywhere to a control by name, and
     a name that control does not carry sends them looking for nothing. */
  it("names the person's erasure by the words its control carries", async () => {
    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(BLOCK), BLOCK));
    const erasure =
      screen
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent.trim())
        .find((title) => title.endsWith("löschen")) ?? "";

    assert.notEqual(erasure, "", "no seat renders the person's erasure, so the name below is compared to nothing");

    // Behind a press: the sentence naming it stands in the clear section's hint, which is an overlay.
    await user.click(screen.getByRole("button", { name: "Hinweis zum Löschen der Kontakte" }));

    assert.ok(
      screen.getByRole("dialog").textContent.includes(`„${erasure}“`),
      `the season's delete sends the reader to a control not called „${erasure}“`,
    );
  });
});

describe("which way the claim runs, at every site that reads it", () => {
  /* ONE direction, and it landed in half the editor: the named seat is the SOURCE and the Trainer the
     copy. Run the other way, the source seat rendered read-only while whatever was typed into the
     Trainer was overwritten at save. */
  it("reads out the TRAINER, never the seat the claim names", () => {
    const box = (html: string, rolle: string): string =>
      new RegExp(`<input[^>]*name="kontakte\\.${rolle}\\.vorname"[^>]*>`).exec(html)?.[0] ?? "";
    const mirroredMarkup = sectionMarkup({ ...BLOCK, trainer_ist_zugleich: "ansprechperson" });

    assert.match(box(mirroredMarkup, "trainer"), /readonly=""/i, "the Trainer takes input while another seat is the source");
    assert.doesNotMatch(
      box(mirroredMarkup, "ansprechperson"),
      /readonly=""/i,
      "the source seat is the one rendered read-only, so the person cannot be edited anywhere",
    );
    // The control: with no claim standing, neither seat reads out.
    assert.doesNotMatch(box(sectionMarkup(BLOCK), "trainer"), /readonly=""/i, "the Trainer reads out with no claim standing");
  });

  /* A blur judges `buildPayload()`, which is composed. Spread raw, a pick was judged against the
     unmirrored draft, so the two disagreed about who the Trainer is. */
  it("judges a pick against the block the save would write", async () => {
    // The named seat's address is malformed and the Trainer's own is not: composed, the Trainer the save
    // writes carries the malformed one, which the raw draft's Trainer does not.
    const malformedSource: FLSaisonTeamKontakte = { ...BLOCK, ansprechperson: seatPerson("Grace", "Hopper", "grace@") };
    const user = userEvent.setup({ delay: null });
    render(editorElement(viewElement(malformedSource), malformedSource));

    await user.click(screen.getByRole("radio", { name: "Die Ansprechperson" }));

    assert.deepEqual(
      refusedBoxes().map((box) => box.getAttribute("name")),
      ["kontakte.ansprechperson.email", "kontakte.trainer.email"],
      "a pick is judged against the raw draft, whose Trainer the save never writes",
    );
  });

  /* Emptying or renaming the seat the claim names reaches the composed Trainer. Read off the raw draft,
     neither banner would name the seat the save is about to change. */
  it("warns about the seats the composed block empties and renames", async () => {
    const user = userEvent.setup({ delay: null });
    const said = () => document.body.textContent;

    // Renaming: the claim puts the named seat's person where the Trainer who confirmed stood.
    const renamed = render(editorElement(viewElement(BLOCK), BLOCK));
    assert.ok(!said().includes("Betroffen:"), "the editor warns before anything changed, so the warning below proves nothing");
    await user.click(screen.getByRole("radio", { name: "Die Ansprechperson" }));
    assert.ok(said().includes("Betroffen: Trainer."), "a claim renaming the Trainer raises no warning, the banner reading the raw draft");
    renamed.unmount();

    // Emptying: switching off the named seat empties the Trainer that copies it.
    const claimed: FLSaisonTeamKontakte = { ...BLOCK, trainer_ist_zugleich: "ansprechperson" };
    render(editorElement(viewElement(claimed), claimed));
    await user.click(screen.getByRole("switch", { name: "Ansprechperson hinterlegt" }));
    assert.ok(
      said().includes("Betroffen: Ansprechperson, Trainer."),
      "emptying the named seat does not name the Trainer it empties, the banner reading the raw draft",
    );
  });
});

describe("whose birthdate a seat holds, and who may put one there", () => {
  /** The readout in ONE seat's card: it carries no `name`, and every seat renders the same label. */
  const birthdateBox = (html: string, rolle: string): string => {
    const card = seatCards(html).find(({ body }) => body.includes(`id="feld-kontakte.${rolle}"`))?.body ?? "";

    return /Geburtsdatum<\/label>[\s\S]*?<input[^>]*>/.exec(card)?.[0] ?? "";
  };

  /** One seat whose person has not confirmed: `geburtsdatum` null is what the read serves for one. */
  const WITHOUT_BIRTHDATE: FLSaisonTeamKontakte = {
    ...BLOCK,
    trainer: {
      ...seatPerson("Ada", "Byron", "ada@example.org"),
      geburtsdatum: null,
      einwilligung: { ...ADA.einwilligung, erfasst_von: "administrativ", bestaetigt_am: null },
    },
  };

  /* A date typed on somebody's behalf is the one field the published notice says only that person
     fills, and it is what the age floor at the confirmation is there to judge. */
  it("reads the stored date out and offers no box to type one into", () => {
    const box = birthdateBox(sectionMarkup(BLOCK), "trainer");

    assert.notEqual(box, "", "the seat renders no birthdate at all");
    assert.match(box, /readonly=""/i, "an administrator can type a date on another person's behalf");
    assert.ok(box.includes('value="10.12.1990"'), "the stored date is not what the seat reads out");
    assert.doesNotMatch(sectionMarkup(BLOCK), /name="kontakte\.[a-z]+\.geburtsdatum"/, "a birthdate box still reaches the payload by name");
  });

  /* `isReadOnly` and not `isDisabled`: a disabled control leaves the tab order and is announced as
     unavailable, so the one reader who cannot see the value loses it entirely. */
  it("leaves the readout reachable by keyboard and named by its label", () => {
    const box = birthdateBox(sectionMarkup(BLOCK), "trainer");

    assert.match(box, /tabindex="0"/i, "the readout is out of the tab order, so a keyboard cannot reach the value");
    assert.doesNotMatch(box, /\sdisabled/i, "the readout is disabled rather than read-only");
    assert.match(box, /aria-labelledby="[^"]+"/, "the readout is announced without its label");
  });

  /* An empty box on a read-only field reads as a value that failed to load, and „noch offen“ reads as
     something the administrator is expected to get round to. */
  it("names who fills it where the seat holds none", () => {
    const box = birthdateBox(sectionMarkup(WITHOUT_BIRTHDATE), "trainer");

    assert.ok(box.includes("Trägt die Person selbst ein"), "an undated seat leaves the reader without who fills the field");
  });

  /* A seat whose person has not confirmed holds no date: a payload requiring one refuses a body no
     administrator can repair, taking the Kenntnisnahme, the address and every other field on that
     seat down with it. */
  it("saves a seat whose birthdate is null", () => {
    const payload = {
      team_id: "507f1f77bcf86cd799439011",
      saison_id: "2526",
      kontakte: toKontaktePayload(WITHOUT_BIRTHDATE),
      kontakte_stand: "9f2c",
    };

    assert.deepEqual(Object.keys(payload.kontakte?.trainer ?? {}).sort(), ["einwilligung", "email", "nachname", "telefon", "vorname"]);
    assert.ok(FLPatchSaisonTeamKontaktePayloadSchema.safeParse(payload).success, "an unconfirmed seat cannot be saved at all");
    assert.equal(describeUnrestorableKontakte(payload), null, "the undo is withheld over a seat nobody has confirmed");
  });
});
