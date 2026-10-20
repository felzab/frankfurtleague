import "@/shared/testing/dom.ts";
import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import { act, createElement as h, useState } from "react";
import { useRouter } from "next/navigation";

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import ts from "typescript";

import { einwilligungAnswer } from "@/core/einwilligungDocument.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { person, sitz } from "@/core/subjectFixtures.ts";
import { filesUnder } from "@/core/treeWalk.ts";
import { FLSaisonSchema } from "@/features/saisons/schemas.ts";
import { FLTeamSchema } from "@/features/teams/schemas.ts";
import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { bestaetigteEinwilligung } from "@/shared/testing/einwilligung.ts";
import { laufendeKontaktFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { parseModule } from "@/shared/testing/jsxReader.ts";
import { membershipAnswer } from "@/shared/testing/membershipFixtures.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import {
  answer,
  answerReadsWith,
  EMPTIEST_ANSWER,
  isNavigation,
  OBJECT_ID,
  redirectTarget,
  resolvedPage,
  saisonFields,
} from "@/shared/testing/pageHarness.ts";

import type { Sicherheit } from "@/features/konto/types.ts";
import type { Navigations } from "@/shared/testing/nextContexts.ts";
import type { AnswerSchema } from "@/shared/testing/pageHarness.ts";
import type { ActionFailure } from "@/shared/types/types.ts";
import type { ReactNode } from "react";

const { answerWith } = doubleEveryAction();
/* Signed in as somebody every area admits: an administrator holding a seat on the club and season
   every address names, a pupil record and a referee record. A public page is visited signed out. */
const { setSession } = doubleActionRequest({
  subject: person(
    {
      sitze: [sitz({ team_id: OBJECT_ID, saison_id: "2026" })],
      spieler: [{ spieler_id: OBJECT_ID }],
      schiedsrichter: [{ schiedsrichter_id: OBJECT_ID }],
      verwaltung: "administration",
      berechtigt_seit: "2026-01-01T00:00:00Z",
    },
    true,
  ),
});

/** The account page's security section, whose real read opens the sign-in store's database. */
const SICHERHEIT: Sicherheit = {
  passkeys: [
    { id: "eins", name: "Laptop", anbieter: null, eingerichtetAm: "2026-09-01T08:00:00.000Z", zuletztVerwendetAm: null, diesesGeraet: true },
  ],
  kannHinzufuegen: true,
  anmeldungen: [],
  verwaltung: true,
  inhaberId: "doubled-user",
  inhaberAdresse: "pia@example.org",
  freshUntil: null,
  enrolmentUntil: null,
  servedAt: 0,
};

/** Every document the page's own script loaded, by the address it asked for, or `null` where jsdom kept that to itself. */
const loads: (string | null)[] = [];

/** A passkey ceremony the browser refused, as the plugin's client reports one: on `error`, never by throwing. */
const refusedCeremony = () => Promise.resolve({ data: null, error: { status: 400, statusText: "Bad Request", message: "abgelehnt" } });

registerDoubles({
  modules: {
    "features/konto/sicherheit.ts": { readSicherheit: () => Promise.resolve(SICHERHEIT) },
    // The erasure link's read of the grant holder's session, which opens the same store; the holder has a passkey.
    "features/konto/loeschungStepUp.ts": {
      readGrantHolderStepUp: () =>
        Promise.resolve({ stepUp: { freshUntil: null, enrolmentUntil: null, servedAt: 0, holderId: SICHERHEIT.inhaberId }, hasPasskey: true }),
    },
    // The browser's credential calls, which a press reaches and this runner has none of.
    "core/authClient.ts": { authClient: { passkey: { addPasskey: refusedCeremony }, signIn: { passkey: refusedCeremony } } },
    // The app's one way to load a document, recorded with the address jsdom's own notice leaves out.
    "shared/utils/documentNavigation.ts": {
      leaveDocumentFor: (to: string) => void loads.push(to),
      reloadDocument: () => void loads.push(window.location.href),
    },
  },
});

/* `await import`, never a static import beside the doubles, which register as this module evaluates. */
const { LINK_UNLESBAR_TITEL } = await import("@/features/bewerbungen/components/views/BestaetigungPanels.tsx");

/** Open for applications and for registrations, so the public forms render rather than their closed panels. */
const FENSTER = { offen: true, von: "2026-01-01", bis: "2026-12-31" };

const SAISON = FLSaisonSchema.parse({
  ...saisonFields("2026", "active"),
  start_date: "2026-03-07",
  end_date: "2026-10-31",
  schedule: [],
  spielplan: null,
  bewerbung: FENSTER,
  registrierung: FENSTER,
});

/** The season after it, planned: a club enters only a planned season, so the club's create dialog holds no form without one. */
const GEPLANT = FLSaisonSchema.parse({
  ...saisonFields("2027", "future"),
  start_date: "2027-03-06",
  end_date: "2027-10-30",
  schedule: [],
  spielplan: null,
  bewerbung: FENSTER,
  registrierung: FENSTER,
});

const ADDRESS = { strasse: "Hauptstraße", hausnummer: "1", plz: "60311", stadtteil: "", stadt: "Frankfurt am Main" };

/** The club every address names, in the fields each of its reads shares. */
const CLUB = {
  id: OBJECT_ID,
  name: "FC Alpha",
  shorthand: "AL",
  description: "",
  full_name: "FC Alpha Frankfurt",
  website_url: null,
  address: ADDRESS,
  schulform: null,
  inactive_since: null,
};

/** A squad row of the player every address names, on that club in that season. */
const KADER_ZEILE = {
  spieler_id: OBJECT_ID,
  vorname: "Ada",
  nachname: null,
  nummer: null,
  position: null,
  stufe: null,
  rolle: null,
  ist_nachnominiert: false,
  inactive_since: null,
  nummer_doppelt: false,
};

/** The fields each record a page opens by its address carries, by the read listing it. */
const LISTED: Readonly<Record<string, Record<string, unknown>>> = {
  "/teams/memberships": { teams: [{ ...CLUB, memberships: [membershipAnswer({ saison_id: "2026" })] }] },
  "/spieler/memberships": {
    spieler: [
      {
        id: OBJECT_ID,
        vorname: "Ada",
        nachname: null,
        inactive_since: null,
        geburtsdatum: "2009-05-04",
        einwilligung: bestaetigteEinwilligung(),
        email: null,
        adresswechsel_id: null,
        memberships: [{ ...KADER_ZEILE, saison_id: "2026", team_id: OBJECT_ID }],
      },
    ],
  },
  "/spielorte": {
    spielorte: [
      {
        id: OBJECT_ID,
        name: "Sportpark Nord",
        maps_link: "https://maps.example.org",
        default_mietpreis: 0,
        inactive_since: null,
        address: ADDRESS,
      },
    ],
  },
  [`/spieler/kader/${OBJECT_ID}/2026`]: { team_id: OBJECT_ID, saison_id: "2026", erlaubte_stufen: ["Q1"], kader: [KADER_ZEILE] },
  // The fixture a club's link opens, open for an answer: its dates take no empty value, so `OPEN` alone answers none.
  "/spielbestaetigungen/ansicht": {
    zustand: "gueltig",
    seite: "team1",
    ansetzung: { team1_name: CLUB.name, team2_name: "FC Beta", datum: "2026-11-07", uhrzeit: "14:30:00", spielort: null },
    frist: "2026-10-31",
    vorschlag: null,
    beantwortet_von: null,
  },
  // The new mailbox's link, still to confirm: its view sits one level down, where `OPEN` does not reach.
  "/adresswechsel/bestaetigung/ansicht": {
    ansicht: {
      seite: "neu",
      zustand: "gueltig",
      gueltig_bis: "2026-10-31T10:00:00Z",
      wirksam_ab: null,
      weg: "konto",
      genehmigung_offen: false,
    },
  },
};

/** What a read answers wherever its schema takes it: a link still valid, a window running. */
const OPEN: Readonly<Record<string, unknown>> = {
  zustand: "gueltig",
  laeuft: true,
  offen: true,
  kader_frei: true,
  team_eingetragen: true,
  saison_id: "2026",
  erlaubte_stufen: ["Q1"],
  // A label the registry runs: the contact confirmation renders its words or no form.
  laufende_fassung: laufendeKontaktFassung().textVersion,
};

/** The members of `schema` a read can be answered as: itself, or each member of its union. */
const members = (schema: AnswerSchema): AnswerSchema[] =>
  [schema, ...(schema.def?.options ?? [])].filter((member) => member.shape !== undefined);

/** The first member answering with `OPEN`'s fields where its own take them, and a grouped teams read grouped. */
function opened(endpoint: string, schema: AnswerSchema, params: Record<string, unknown>): unknown {
  for (const member of members(schema)) {
    const fields = Object.fromEntries(Object.entries(OPEN).filter(([key, value]) => member.shape?.[key]?.safeParse(value).success === true));
    if (params.in_gruppen === true && member.shape?.format?.values?.has("grouped") !== true) continue;
    try {
      return answer(member, endpoint, fields);
    } catch {
      // The next member, where this one's other fields take no empty value.
    }
  }
  return EMPTIEST_ANSWER(endpoint, schema, params);
}

/* One running season, the club, player, venue and squad every address names, and every link and
   window open: a read answered empty ends a page at its not-found or closed panel, before any field. */
answerReadsWith((endpoint, schema, params) => {
  if (endpoint.startsWith("/einwilligung/")) return einwilligungAnswer(endpoint);
  if (endpoint === "/saisons/current") return answer(schema, endpoint, { saison: SAISON });
  if (endpoint === "/saisons") return answer(schema, endpoint, { saisons: [SAISON] });
  if (endpoint === "/saisons/list/admin") return answer(schema, endpoint, { saisons: [SAISON, GEPLANT] });
  if (endpoint === `/teams/${OBJECT_ID}`) return answer(schema, endpoint, { team: answer(FLTeamSchema as AnswerSchema, endpoint, CLUB) });
  const listed = LISTED[endpoint];
  if (listed !== undefined) return answer(schema, endpoint, listed);
  return opened(endpoint, schema, params);
});

/** The pages a link from a mail opens, which show their form only for the token it carries. */
const LINKED: ReadonlySet<string> = new Set([
  "(public)/registrierung/page.tsx",
  "(public)/bestaetigung/kontakt/page.tsx",
  "(public)/bestaetigung/schiedsrichter/page.tsx",
  "(public)/bestaetigung/spieler/page.tsx",
  "(public)/bestaetigung/adresse/page.tsx",
  "(public)/bestaetigung/spiel/page.tsx",
  "(public)/loeschung/page.tsx",
]);

/** Every URL the page's own script sent, by each of the browser's ways to send one that the app could reach for. */
const requested: string[] = [];
const sent = (url: unknown): void => void requested.push(url instanceof Request ? url.url : String(url));
globalThis.fetch = ((input: RequestInfo | URL) => {
  sent(input);
  return new Promise<never>(() => undefined);
}) as typeof fetch;
window.XMLHttpRequest.prototype.open = function (_method: string, url: string | URL) {
  sent(url);
};
window.XMLHttpRequest.prototype.send = () => undefined;
/** A socket or a stream of server events, which asks for its address as it is made. */
class Connection extends window.EventTarget {
  constructor(url: string | URL) {
    super();
    sent(url);
  }
  close(): void {}
}
// On both: Node defines its own of each, which the window copy in `dom.ts` leaves in place.
for (const scope of [globalThis, window]) {
  Reflect.set(scope, "WebSocket", Connection);
  Reflect.set(scope, "EventSource", Connection);
}
for (const navigator of [globalThis.navigator, window.navigator]) {
  const beacon = (url: string | URL): boolean => {
    sent(url);
    return true;
  };
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
}
// An image fetches its source as it is set, whether the page holds the element or not.
const imageSource = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, "src");
Object.defineProperty(window.HTMLImageElement.prototype, "src", {
  ...imageSource,
  set(this: HTMLImageElement, url: string) {
    sent(url);
    imageSource?.set?.call(this, url);
  },
});

/** Every window the page's own script opened, by the address it opened. */
const windowsOpened: string[] = [];
const openWindow = ((url?: string | URL) => {
  windowsOpened.push(String(url ?? ""));
  return null;
}) as typeof window.open;
window.open = openWindow;
Reflect.set(globalThis, "open", openWindow);

/* jsdom loads no other document, and says so on the console rather than moving `location`: the one
   trace a `location.assign` past the app's own navigation leaves. The control below fails if its wording moves. */
const LEFT_DOCUMENT = /Not implemented: navigation/;

const APP_DIR = import.meta.dirname;
const PAGES = filesUnder(APP_DIR, (name) => name === "page.tsx", 40);
const label = (page: string) => path.relative(APP_DIR, page).split(path.sep).join("/");

/** One value per dynamic segment, and the address the page answers at with them. */
function addressOf(page: string): { params: Record<string, string | string[]>; pathname: string } {
  const params: Record<string, string | string[]> = {};
  const parts: string[] = [];
  for (const segment of path.relative(APP_DIR, path.dirname(page)).split(path.sep)) {
    // A route group names no segment of the address.
    if (segment === "" || /^\(.+\)$/.test(segment)) continue;
    const dynamic = /^\[(\.\.\.)?(\w+)\]$/.exec(segment);
    if (dynamic === null) {
      parts.push(segment);
      continue;
    }
    const name = dynamic[2]!;
    const value = dynamic[1] !== undefined ? ["nirgendwo"] : name === "saison_id" ? "2026" : OBJECT_ID;
    params[name] = value;
    parts.push(Array.isArray(value) ? value.join("/") : value);
  }
  return { params, pathname: `/${parts.join("/")}` };
}

/** How a page sent something out of itself. */
type Way = "router.push" | "router.replace" | "router.prefetch" | "location" | "document load" | "window" | "request" | "link";

/** One way out the page took, and the address it took it to, which jsdom withholds for a load it only reports. */
type Trace = { way: Way; to: string | null };

/** The ways that leave the page, which typing alone never takes, whatever the address. */
const NAVIGATIONS: ReadonlySet<Way> = new Set(["router.push", "router.replace", "location", "document load", "window"]);

/** What one action on the page did: typing into a field by its accessible name, or a press, and each trace it left. */
type Reached = { name: string; typed: boolean; traces: Trace[] };

/** What a page showed before the sweep touched it: its headings, and how many forms and buttons a reader could answer with. */
type FirstView = { headings: string[]; controls: number };

const ROLES = ["textbox", "searchbox", "combobox"] as const;

/** A marker no other text holds, and no other field's marker holds either. */
const markerOf = (index: number) => `zzmarke${String(index)}zz`;

/**
 * The marker a field takes as a person could type it: within its length, where a field gating a send on that length
 * would otherwise never send, and as an address where it asks for one.
 */
function shapedFor(field: HTMLInputElement | HTMLTextAreaElement, index: number): { marker: string; value: string } {
  const long = markerOf(index);
  const marker = field.maxLength > 0 && field.maxLength < long.length ? `qx${String(index)}`.slice(0, field.maxLength) : long;
  return { marker, value: field.type === "email" ? `${marker}@beispiel.de` : marker };
}

const carries = (text: string, marker: string) => text.toLowerCase().includes(marker);

/** The attributes an element sends a request or a navigation to. */
const ADDRESS_ATTRIBUTES = ["href", "src", "srcset", "action", "formaction", "ping", "poster", "data", "style"];

const ADDRESSED = ADDRESS_ATTRIBUTES.map((name) => `[${name}]`).join(", ");

/** The address one attribute names, by the attribute's name and value: a style's only address is a `url(…)`. */
function addressIn(element: Element, name: string): [string, string][] {
  const value = element.getAttribute(name);
  return value === null || (name === "style" && !value.includes("url(")) ? [] : [[`${name}=${value}`, value]];
}

/** The addresses an element names, and those of every element under it. */
const addressesUnder = (element: Element): [string, string][] =>
  [element, ...element.querySelectorAll(ADDRESSED)].flatMap((each) => ADDRESS_ATTRIBUTES.flatMap((name) => addressIn(each, name)));

/**
 * The page's changes as the observer hands them over at each microtask `settle` awaits, and every address the page
 * has named: a subtree a re-render mounts again names its old addresses again, which nothing typed wrote.
 */
type Watched = { observer: MutationObserver; records: MutationRecord[]; named: Set<string> };

function watching(document: Document): Watched {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((delivered) => void records.push(...delivered));
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ADDRESS_ATTRIBUTES });
  return { observer, records, named: new Set() };
}

/** The changes made since the last call, set aside. */
const changesSince = ({ observer, records }: Watched): MutationRecord[] => [...records.splice(0), ...observer.takeRecords()];

/**
 * Every address an attribute names for the first time since the last call: what an action wrote, read off what it
 * changed, since reading the whole page after every action of a large editor is slow.
 */
function addressesWritten(watched: Watched): string[] {
  const written: string[] = [];
  for (const record of changesSince(watched)) {
    // An attribute written is that one attribute, never the subtree under its element.
    const named =
      record.type === "attributes"
        ? record.target instanceof window.Element && record.attributeName !== null
          ? addressIn(record.target, record.attributeName)
          : []
        : [...record.addedNodes].flatMap((node) => (node instanceof window.Element ? addressesUnder(node) : []));
    for (const [address, value] of named) {
      if (watched.named.has(address)) continue;
      watched.named.add(address);
      written.push(value);
    }
  }
  return written;
}

/** Out of the accessibility tree as Testing Library's role queries judge it: hidden by an attribute or an inline style. */
function isHidden(field: Element): boolean {
  for (let node: Element | null = field; node !== null; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return true;
    const { style } = node as HTMLElement;
    if (style !== undefined && (style.display === "none" || style.visibility === "hidden")) return true;
  }
  return false;
}

/**
 * The untyped fields a person can type into, among what the page shows. The role query runs once one is shown, with
 * `hidden: true` and this file's own check, its computed styles costing every pick on a large editor.
 */
function typeable(document: Document, typed: ReadonlySet<Element>): (HTMLInputElement | HTMLTextAreaElement)[] {
  const shown = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter(
    (field) => !typed.has(field) && !field.disabled && !field.readOnly && !isHidden(field),
  );
  if (shown.length === 0) return [];
  const taking = new Set<Element>(ROLES.flatMap((role) => within(document.body).queryAllByRole(role, { hidden: true })));
  return shown.filter((field) => taking.has(field));
}

/** A write's refusal, as every action answers one. */
const REFUSED: ActionFailure = { success: false, error: "Nicht gespeichert." };

/** What a field's marker is looked for in, recorded as the page runs. */
type Ways = { seen: Navigations; prefetched: string[]; watched: Watched };

/** Where each record stood before an action, so the traces it left are what came after. */
type Mark = { href: string; pushed: number; replaced: number; prefetched: number; loads: number; windows: number; requested: number };

/** Where each record stands now, the attributes written so far set aside. */
function markOf({ seen, prefetched, watched }: Ways): Mark {
  changesSince(watched);
  return {
    href: window.location.href,
    pushed: seen.pushed.length,
    replaced: seen.replaced.length,
    prefetched: prefetched.length,
    loads: loads.length,
    windows: windowsOpened.length,
    requested: requested.length,
  };
}

/** Every trace left since `mark`, whatever it carries. */
function tracesSince(mark: Mark, { seen, prefetched, watched }: Ways): Trace[] {
  const after = (way: Way, records: readonly (string | null)[], from: number): Trace[] => records.slice(from).map((to) => ({ way, to }));
  return [
    ...after("router.push", seen.pushed, mark.pushed),
    ...after("router.replace", seen.replaced, mark.replaced),
    ...after("router.prefetch", prefetched, mark.prefetched),
    ...(window.location.href === mark.href ? [] : [{ way: "location" as const, to: window.location.href }]),
    ...after("document load", loads, mark.loads),
    ...after("window", windowsOpened, mark.windows),
    ...after("request", requested, mark.requested),
    ...after("link", addressesWritten(watched), 0),
  ];
}

/** What typing alone sent out: any navigation, and any address the field's marker rode. */
const typedAway = (traces: Trace[], marker: string): Trace[] =>
  traces.filter(({ way, to }) => NAVIGATIONS.has(way) || (to !== null && carries(to, marker)));

/** What a submit or a pick sent out of what was typed: any address a marker rode, and a load jsdom withheld the address of. */
const sentAway = (traces: Trace[], markers: readonly string[]): Trace[] =>
  traces.filter(({ to }) => to === null || markers.some((marker) => carries(to, marker)));

/** The rounds of timers and frames one action is given: a frame asking for the next one forever is an animation, not a write. */
const ROUNDS = 10;

/** One frame at sixty a second, the pace jsdom's own frames keep. */
const FRAME_MS = 1000 / 60;

/** The frames the page asks for: held while `settle` runs the case's own clock, and run on the real one otherwise. */
const frames = (() => {
  // Captured, never read off the global at each call as jsdom's frame loop reads `setInterval`: a stop made while the
  // case's clock stands in misses the real loop, which then keeps the process alive.
  const { setTimeout: later, clearTimeout: dropLater } = globalThis;
  const held = new Map<number, FrameRequestCallback>();
  const handedOn = new Map<number, ReturnType<typeof setTimeout>>();
  let holding = false;
  let last = 0;
  const handOn = (id: number, callback: FrameRequestCallback) =>
    handedOn.set(
      id,
      later(() => {
        handedOn.delete(id);
        callback(performance.now());
      }, FRAME_MS),
    );
  const request = (callback: FrameRequestCallback): number => {
    last += 1;
    if (holding) held.set(last, callback);
    else handOn(last, callback);
    return last;
  };
  const cancel = (id: number): void => {
    held.delete(id);
    const timer = handedOn.get(id);
    if (timer !== undefined) dropLater(timer);
    handedOn.delete(id);
  };
  for (const scope of [globalThis, window]) Object.assign(scope, { requestAnimationFrame: request, cancelAnimationFrame: cancel });
  return {
    hold: () => void (holding = true),
    /** Runs every frame held now, and answers whether there were any. */
    run: (): boolean => {
      const due = [...held.values()];
      held.clear();
      for (const callback of due) callback(performance.now());
      return due.length > 0;
    },
    /** Hands what is still held to the real clock: a focus restore waiting on a frame is not stranded. */
    release: () => {
      holding = false;
      for (const [id, callback] of held) handOn(id, callback);
      held.clear();
    },
  };
})();

/**
 * Runs `action`, then every timer, interval and frame it set on the case's own clock, so a write owed after any delay
 * is made before the traces are read.
 */
async function settle(action: () => unknown): Promise<void> {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  frames.hold();
  try {
    // In one `act`, so what an awaited answer sets after the action lands inside it.
    await act(async () => {
      await action();
      // Until a round's timers leave no frame: a frame's callback can set a timer, and a timer's a frame.
      for (let round = 0; round < ROUNDS; round += 1) {
        mock.timers.runAll();
        if (!frames.run()) break;
      }
    });
  } finally {
    mock.timers.reset();
    frames.release();
  }
  await act(async () => undefined);
}

/** A field's accessible name, as the report and the tables below spell it. */
const nameOf = (field: HTMLInputElement | HTMLTextAreaElement): string =>
  (field.getAttribute("aria-label") ?? field.labels?.[0]?.textContent ?? field.name).trim();

/** Types `value` into `field` as a person does, then presses Enter and leaves it: what its marker reached. */
async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, marker: string, value: string, ways: Ways): Promise<Reached> {
  const at = markOf(ways);
  await settle(() => {
    fireEvent.focus(field);
    // `input` for the keystrokes and `change` as the field commits them, as a browser fires the two.
    fireEvent.input(field, { target: { value } });
    fireEvent.change(field);
    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(field, { key: "Enter", code: "Enter" });
    fireEvent.blur(field);
  });
  return { name: nameOf(field), typed: true, traces: typedAway(tracesSince(at, ways), marker) };
}

/** A control that says it opens something it holds closed: a list, a dialog, a disclosure. */
const CLOSED = '[aria-expanded="false"]:not([aria-disabled="true"]):not(:disabled)';

/** The most controls one page's sweep opens, which a trigger rebuilt on every close would otherwise reopen forever. */
const MOST_OPENED = 150;

/** The most buttons one page's sweep presses, which a button renamed by every press would otherwise be pressed by forever. */
const MOST_PRESSED = 150;

/**
 * Types a marker into every field the page shows and submits each form holding one, then opens every closed control,
 * picking each option, and presses every other button: what each action reached that it never may.
 */
async function typeIntoEvery(
  tree: ReactNode,
  pathname: string,
  params: Record<string, string | string[]>,
): Promise<{ firstView: FirstView; reached: Reached[] }> {
  const prefetched: string[] = [];
  const { router, seen } = recordingRouter({ prefetch: (href: string) => void prefetched.push(href) });
  const watched = watching(window.document);
  const ways: Ways = { seen, prefetched, watched };
  const reported = console.error.bind(console);
  const consoleError = mock.method(console, "error", (...args: unknown[]) => {
    if (LEFT_DOCUMENT.test(args.map(String).join(" "))) loads.push(null);
    else reported(...args);
  });
  window.history.replaceState(null, "", pathname);

  try {
    const { container } = render(underNext(tree, { router, pathname, params }));
    await act(async () => undefined);
    const firstView: FirstView = {
      headings: [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) => (heading.textContent ?? "").trim()),
      controls: container.querySelectorAll('form, button, [role="button"]').length,
    };
    // Every write a submit or a press sends from here is refused: the one answer each action shares, where a success is
    // shaped as its own action answers it, and a handler handed another's shape takes the page down.
    answerWith(() => Promise.resolve(REFUSED));
    // What the page names as it renders, which no action wrote.
    addressesWritten(watched);
    const document = container.ownerDocument;
    const typed = new Set<Element>();
    const markers: string[] = [];
    const reached: Reached[] = [];
    // Each press judged by every marker typed so far: a pick or a submit legitimately navigates, never with one.
    const press = async (name: string, action: () => unknown): Promise<void> => {
      const at = markOf(ways);
      await settle(action);
      reached.push({ name, typed: false, traces: sentAway(tracesSince(at, ways), markers) });
    };
    const typeIntoShown = async () => {
      const forms = new Set<HTMLFormElement>();
      for (const field of typeable(document, typed)) {
        // An earlier field's marker can take a later one off the page, as a search empties its list.
        if (!field.isConnected) continue;
        typed.add(field);
        const { marker, value } = shapedFor(field, typed.size);
        markers.push(marker);
        reached.push(await typeInto(field, marker, value, ways));
        if (field.form !== null) forms.add(field.form);
      }
      // Once every field it shows holds a marker, so a search sending on its submit sends what was typed.
      for (const form of forms)
        if (form.isConnected)
          await press(`the submit of the form holding ${String(form.elements.length)} fields`, () => fireEvent.submit(form));
    };

    // `fireEvent` rather than user-event, whose every action awaits a `setTimeout` `settle` holds to the case's own clock:
    // React Aria reads a click no pointer led up to as a virtual press.
    const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });
    const openedControls = new Set<Element>();
    const closedNow = (): Element[] => [...document.querySelectorAll(CLOSED)].filter((control) => !openedControls.has(control));
    const isOpen = (control: Element) => control.getAttribute("aria-expanded") === "true";

    // Opens `control`, picks each option it lists, typing into what each pick shows, then types into what the opened
    // control holds and opens what it newly shows: a dialog's own lists.
    const explore = async (control: Element, depth: number): Promise<void> => {
      if (!control.isConnected) return;
      assert.ok(openedControls.size < MOST_OPENED, `the sweep opened ${String(MOST_OPENED)} controls on this page and stopped`);
      openedControls.add(control);
      const optionsBefore = new Set(document.querySelectorAll('[role="option"]'));
      const controlsBefore = new Set(document.querySelectorAll("[aria-expanded]"));
      const controlName = (control.getAttribute("aria-label") ?? control.textContent ?? "").trim();
      const open = () => press(`opening „${controlName}“`, () => fireEvent.click(control));
      const listed = () => [...document.querySelectorAll('[role="option"]')].filter((option) => !optionsBefore.has(option));

      await open();
      const holds = typeable(document, typed).length > 0;
      const count = listed().length;
      for (let index = 0; index < count && control.isConnected; index += 1) {
        // Opened again and picked in one press: the kit colour list is two presses per colour otherwise.
        await press(`picking option ${String(index + 1)} of „${controlName}“`, async () => {
          if (!isOpen(control)) {
            fireEvent.click(control);
            await act(async () => undefined);
          }
          const option = listed()[index];
          if (option !== undefined && option.getAttribute("aria-disabled") !== "true") fireEvent.click(option);
        });
        // Closed before typing, so a search box the list holds stays empty for the picks still to come.
        if (isOpen(control)) await press("Escape", escape);
        await typeIntoShown();
      }
      if (holds && control.isConnected && !isOpen(control)) await open();
      await typeIntoShown();
      if (depth < 2) {
        for (const shown of closedNow().filter((each) => !controlsBefore.has(each))) await explore(shown, depth + 1);
      }
      if (control.isConnected && isOpen(control)) await press("Escape", escape);
    };

    await typeIntoShown();
    for (let control = closedNow()[0]; control !== undefined; control = closedNow()[0]) await explore(control, 0);

    // Every other button, once each, every field holding its marker: a box sending what is typed on a press of a button
    // in no form sends it here.
    const pressedButtons = new Set<string>();
    const unpressed = (): { key: string; button: Element }[] => {
      const named = new Map<string, number>();
      return [...document.querySelectorAll('button, [role="button"]')].flatMap((button) => {
        const name = (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
        const place = named.get(name) ?? 0;
        named.set(name, place + 1);
        // By name and place among buttons of that name, since a press can rebuild the button it pressed.
        const key = `${name} (${String(place + 1)})`;
        const pressable =
          !button.hasAttribute("aria-expanded") && !(button as HTMLButtonElement).disabled && button.getAttribute("aria-disabled") !== "true";
        return pressable && !pressedButtons.has(key) && !isHidden(button) ? [{ key, button }] : [];
      });
    };
    for (let next = unpressed()[0]; next !== undefined; next = unpressed()[0]) {
      assert.ok(pressedButtons.size < MOST_PRESSED, `the sweep pressed ${String(MOST_PRESSED)} buttons on this page and stopped`);
      pressedButtons.add(next.key);
      const { button } = next;
      await press(`pressing „${next.key}“`, () => fireEvent.click(button));
      await typeIntoShown();
      // A press opening a dialog, a confirmation among them, closes it again before the next.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) await press("Escape", escape);
    }
    return { firstView, reached };
  } finally {
    cleanup();
    consoleError.mock.restore();
    watched.observer.disconnect();
  }
}

/** What one page did: threw on the way to its tree, or rendered and reached these; and which query parameters it read. */
type Visit = ({ thrown: unknown } | { firstView: FirstView; reached: Reached[] }) & { asked: ReadonlySet<string> };

/**
 * A page's query parameters as it reads them: none answered, every name it asks for recorded. Read off the render rather
 * than the source, so a token reached through a helper or a renamed binding is caught alike.
 */
function askedParameters(): { searchParams: Record<string, string>; asked: Set<string> } {
  const asked = new Set<string>();
  // `then` is `Promise.resolve`'s own question of every value it settles, never the page's.
  const record = (_target: object, name: string | symbol): undefined => {
    if (typeof name === "string" && name !== "then") asked.add(name);
    return undefined;
  };

  return { searchParams: new Proxy({}, { get: record }), asked };
}

async function visit(page: string): Promise<Visit> {
  const { default: Page } = (await import(pathToFileURL(page).href)) as { default: (props: unknown) => unknown };
  const { params, pathname } = addressOf(page);
  if (label(page).startsWith("(public)/")) setSession(null);

  const unlinked = askedParameters();
  let tree: ReactNode;
  try {
    tree = await resolvedPage(Page, {
      params: Promise.resolve(params),
      searchParams: Promise.resolve(LINKED.has(label(page)) ? { token: "zz-link-aus-der-mail" } : unlinked.searchParams),
    });
  } catch (error) {
    return { thrown: error, asked: unlinked.asked };
  }
  return { ...(await typeIntoEvery(tree, pathname, params)), asked: unlinked.asked };
}

const NOT_MATCHED = "the area's 404, answered for an address no other route takes";

/** The pages a session every area admits is sent away from, and why none holds a field to type into. */
const TURNED_AWAY: Readonly<Record<string, string>> = {
  "(public)/signin/passkey/page.tsx": "sends a session with no passkey step pending on to the landing; its card offers no field",
  "(public)/signin/weiter/page.tsx": "the sign-in landing, which renders nothing and only sends the session on",
  "bereich/(persoenlich)/[...unmatched]/page.tsx": NOT_MATCHED,
  "bereich/admin/[...unmatched]/page.tsx": NOT_MATCHED,
  "bereich/team/[team_id]/[saison_id]/[...unmatched]/page.tsx": NOT_MATCHED,
  "dashboard/[...unmatched]/page.tsx": NOT_MATCHED,
};

/** One field's text riding one address by design: the way it leaves, the address it opens on, and why that is no person's. */
type ByDesign = { way: Way; at: string; why: string };

const SCHULADRESSE: ByDesign = {
  way: "link",
  at: "https://www.google.com/maps/search/",
  why: "a school's public address, opened on the map link the administrator may follow, and no person's",
};

/** The fields whose text rides a URL by design, by page and then by the field's name: one way, one address each. */
const URL_BY_DESIGN: Readonly<Record<string, Readonly<Record<string, ByDesign>>>> = {
  "(public)/bewerbung/[saison_id]/page.tsx": {
    Wunschkürzel: {
      way: "request",
      at: "/api/bewerbung/kuerzel",
      why: "a club's two-letter code, checked against the league's own as the box is left, and no person's",
    },
  },
  "bereich/admin/teams/[team_id]/page.tsx": {
    Straße: SCHULADRESSE,
    "Nr.": SCHULADRESSE,
    PLZ: SCHULADRESSE,
    Stadt: SCHULADRESSE,
    Stadtteil: SCHULADRESSE,
  },
};

/** Whether `trace` leaves the way `design` names, for an address opening on the one it names. */
function isByDesign(trace: Trace, design: ByDesign | undefined): boolean {
  if (design === undefined || trace.way !== design.way || trace.to === null) return false;
  const to = new URL(trace.to, window.location.href);
  const at = new URL(design.at, window.location.href);
  return to.origin === at.origin && to.pathname.startsWith(at.pathname);
}

/**
 * The search label each page mounting `AdminCrudShell` passes its bar, read off the page's source: a page whose render
 * ends before the bar types into nothing, and must still fail by name.
 */
async function shellSearches(): Promise<Record<string, string>> {
  const searches: Record<string, string> = {};
  for (const page of PAGES) {
    const source = parseModule(page, readFileSync(page, "utf8"));
    const imported = new Map<string, string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) imported.set(element.name.text, statement.moduleSpecifier.text);
    }
    if (!imported.has("AdminCrudShell")) continue;

    const labels: ts.Expression[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "searchLabel" && node.initializer !== undefined) {
        labels.push(
          ts.isJsxExpression(node.initializer) && node.initializer.expression !== undefined ? node.initializer.expression : node.initializer,
        );
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
    const [given] = labels;
    assert.ok(
      labels.length === 1 && given !== undefined,
      `${label(page)} mounts AdminCrudShell with ${String(labels.length)} search labels, not one`,
    );
    if (ts.isStringLiteral(given)) {
      searches[label(page)] = given.text;
      continue;
    }
    // A slice's copy constant, as every admin list names its bar: `SPIELER_CRUD_COPY.searchLabel`.
    const owner = ts.isPropertyAccessExpression(given) && ts.isIdentifier(given.expression) ? given.expression.text : undefined;
    const from = owner === undefined ? undefined : imported.get(owner);
    assert.ok(owner !== undefined && from !== undefined, `${label(page)} names its search label in a form this sweep cannot read`);
    const copy = (await import(from)) as Record<string, Record<string, unknown>>;
    const searchLabel = copy[owner]?.[(given as ts.PropertyAccessExpression).name.text];
    assert.equal(typeof searchLabel, "string", `${label(page)}'s search label read no text off ${from}`);
    searches[label(page)] = searchLabel as string;
  }
  return searches;
}

/**
 * The search box each page holding one must show the sweep: a render reaching no field fails here by name. The admin
 * lists' are read off their pages; these three hold a search of their own.
 */
const SEARCHES: Readonly<Record<string, string>> = {
  ...(await shellSearches()),
  "(public)/bewerbung/[saison_id]/page.tsx": "Schule suchen",
  "bereich/admin/spielsuche/page.tsx": "Spiele suchen",
  "dashboard/spielsuche/page.tsx": "Spiele suchen",
};

/** A field writing what is typed into it out of the page one way, on the event a handler listens to. */
function Leaking({
  how,
  on = "onChange",
  ...attributes
}: {
  how: (typed: string, router: ReturnType<typeof useRouter>) => void;
  on?: "onChange" | "onInput";
  type?: string;
  maxLength?: number;
}): ReactNode {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  return h("input", {
    "aria-label": "Suchen",
    ...attributes,
    value: typed,
    onChange: (event: { target: { value: string } }) => setTyped(event.target.value),
    [on]: (event: { target: { value: string } }) => {
      setTyped(event.target.value);
      how(event.target.value, router);
    },
  });
}

/** A field whose text an element of the page names in `attribute`, for the address attributes the sweep reads. */
function Naming({ element, attribute }: { element: string; attribute: (typed: string) => Record<string, unknown> }): ReactNode {
  const [typed, setTyped] = useState("");
  return h("div", null, [
    h("input", {
      key: "feld",
      "aria-label": "Suchen",
      value: typed,
      onChange: (event: { target: { value: string } }) => setTyped(event.target.value),
    }),
    h(element, { key: "ziel", ...attribute(typed) }),
  ]);
}

/** A field, and a list whose one option `onPick` answers with what was typed and the router. */
function Picking({
  onPick,
  revealed,
}: {
  onPick?: (typed: string, router: ReturnType<typeof useRouter>) => void;
  revealed?: ReactNode;
}): ReactNode {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [isOpen, setOpen] = useState(false);
  const [picked, setPicked] = useState(false);
  return h("div", null, [
    h("input", {
      key: "feld",
      "aria-label": "Suchen",
      value: typed,
      onChange: (event: { target: { value: string } }) => setTyped(event.target.value),
    }),
    h(
      "button",
      { key: "auf", type: "button", "aria-haspopup": "listbox", "aria-expanded": isOpen, onClick: () => setOpen(true) },
      "Sortierung",
    ),
    isOpen &&
      h(
        "div",
        { key: "liste", role: "listbox" },
        h(
          "div",
          {
            role: "option",
            "aria-selected": picked,
            onClick: () => {
              setOpen(false);
              setPicked(true);
              onPick?.(typed, router);
            },
          },
          "Neueste",
        ),
      ),
    picked && h("div", { key: "neu" }, revealed),
  ]);
}

/** A trigger and the dialog it opens, holding `children`. */
function Opening({ children }: { children: ReactNode }): ReactNode {
  const [isOpen, setOpen] = useState(false);
  return h("div", null, [
    h("button", { key: "auf", type: "button", "aria-expanded": isOpen, onClick: () => setOpen(true) }, "Anlegen"),
    isOpen && h("div", { key: "dialog", role: "dialog", "aria-label": "Anlegen" }, children),
  ]);
}

/** A field, and a button in no form sending what is typed into it only once it is pressed. */
function Pressing(): ReactNode {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  return h("div", null, [
    h("input", {
      key: "feld",
      "aria-label": "Suchen",
      value: typed,
      onChange: (event: { target: { value: string } }) => setTyped(event.target.value),
    }),
    h("button", { key: "los", type: "button", onClick: () => router.push(`/x?suche=${typed}`) }, "Suchen"),
  ]);
}

/** A form holding a field, sending what is typed into it only once it is submitted. */
function Submitting(): ReactNode {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  return h(
    "form",
    {
      onSubmit: (event: { preventDefault: () => void }) => {
        event.preventDefault();
        router.push(`/x?suche=${typed}`);
      },
    },
    h("input", { "aria-label": "Suchen", value: typed, onChange: (event: { target: { value: string } }) => setTyped(event.target.value) }),
  );
}

const writesTheUrl = (typed: string, router: ReturnType<typeof useRouter>) => router.replace(`/x?suche=${typed}`);

/** Each way out of a page, the trace the sweep must report for it, and a tree taking it. */
const WAYS_OUT: { way: string; trace: Way; tree: ReactNode }[] = [
  { way: "a router replace", trace: "router.replace", tree: h(Leaking, { how: writesTheUrl }) },
  {
    way: "a debounced router push",
    trace: "router.push",
    tree: h(Leaking, { how: (typed, router) => void setTimeout(() => router.push(`/x?suche=${typed}`), 300) }),
  },
  {
    way: "an interval",
    trace: "router.push",
    tree: h(Leaking, { how: (typed, router) => void setInterval(() => router.push(`/x?suche=${typed}`), 300) }),
  },
  {
    way: "an animation frame",
    trace: "router.push",
    tree: h(Leaking, { how: (typed, router) => void requestAnimationFrame(() => router.push(`/x?suche=${typed}`)) }),
  },
  { way: "an input event", trace: "router.replace", tree: h(Leaking, { how: writesTheUrl, on: "onInput" }) },
  { way: "a prefetch", trace: "router.prefetch", tree: h(Leaking, { how: (typed, router) => router.prefetch(`/x?suche=${typed}`) }) },
  { way: "a history write", trace: "location", tree: h(Leaking, { how: (typed) => window.history.replaceState(null, "", `?suche=${typed}`) }) },
  {
    way: "a document load",
    trace: "document load",
    tree: h(Leaking, { how: (typed) => window.location.assign(new URL(`/x?suche=${typed}`, window.location.href)) }),
  },
  { way: "a new window", trace: "window", tree: h(Leaking, { how: (typed) => void window.open(`/x?suche=${typed}`) }) },
  { way: "a request", trace: "request", tree: h(Leaking, { how: (typed) => void fetch(`/api/suche?wer=${typed}`) }) },
  { way: "a socket", trace: "request", tree: h(Leaking, { how: (typed) => void new WebSocket(`ws://localhost/suche?wer=${typed}`) }) },
  { way: "a stream of server events", trace: "request", tree: h(Leaking, { how: (typed) => void new EventSource(`/api/suche?wer=${typed}`) }) },
  { way: "a beacon", trace: "request", tree: h(Leaking, { how: (typed) => void navigator.sendBeacon(`/api/suche?wer=${typed}`) }) },
  {
    way: "an image held by no page",
    trace: "request",
    tree: h(Leaking, {
      how: (typed) => {
        new Image().src = `/api/suche?wer=${typed}`;
      },
    }),
  },
  {
    way: "a field gating its send on its length",
    trace: "request",
    tree: h(Leaking, { maxLength: 2, how: (typed) => void (typed.length === 2 && fetch(`/api/kuerzel?k=${typed}`)) }),
  },
  {
    way: "an address field gating its send on an address",
    trace: "router.replace",
    tree: h(Leaking, { type: "email", how: (typed, router) => void (typed.includes("@") && writesTheUrl(typed, router)) }),
  },
  { way: "a link", trace: "link", tree: h(Naming, { element: "a", attribute: (typed) => ({ href: `/x?suche=${typed}` }) }) },
  {
    way: "a source set",
    trace: "link",
    tree: h(Naming, { element: "img", attribute: (typed) => ({ alt: "", srcSet: `/x?suche=${typed} 1x` }) }),
  },
  { way: "a ping", trace: "link", tree: h(Naming, { element: "a", attribute: (typed) => ({ href: "/x", ping: `/p?suche=${typed}` }) }) },
  {
    way: "a style's address",
    trace: "link",
    tree: h(Naming, { element: "div", attribute: (typed) => ({ style: { backgroundImage: `url(/x?suche=${typed})` } }) }),
  },
  {
    way: "a press of Enter",
    trace: "router.push",
    tree: h(function OnEnter() {
      const router = useRouter();
      const [typed, setTyped] = useState("");
      return h("input", {
        "aria-label": "Suchen",
        value: typed,
        onChange: (event: { target: { value: string } }) => setTyped(event.target.value),
        onKeyDown: (event: { key: string }) => event.key === "Enter" && router.push(`/x?suche=${typed}`),
      });
    }),
  },
  { way: "a submit", trace: "router.push", tree: h(Submitting) },
  { way: "a press of a button in no form", trace: "router.push", tree: h(Pressing) },
  { way: "a pick", trace: "router.replace", tree: h(Picking, { onPick: writesTheUrl }) },
  { way: "a field a pick shows", trace: "router.replace", tree: h(Picking, { revealed: h(Leaking, { how: writesTheUrl }) }) },
  { way: "a field a dialog holds", trace: "router.replace", tree: h(Opening, null, h(Leaking, { how: writesTheUrl })) },
];

describe("what a visitor types into a page", () => {
  /* The control: a sweep blind to one of these passes a page taking it. */
  for (const { way, trace, tree } of WAYS_OUT) {
    it(`is caught leaving by ${way}`, async () => {
      const { reached } = await typeIntoEvery(tree, "/kontrolle", {});

      assert.ok(
        reached.some((each) => each.typed),
        "the control's field was never typed into",
      );
      assert.ok(
        reached.some((each) => each.traces.some((found) => found.way === trace)),
        `${way} left no trace the sweep reports: ${JSON.stringify(reached)}`,
      );
    });
  }

  for (const page of PAGES) {
    it(`reaches no URL from ${label(page)}`, async () => {
      const visited = await visit(page);
      // Visited without one, a page reading a token renders only its dead-link panel, and the floor below never reaches it.
      assert.ok(!visited.asked.has("token"), "the page reads a link's token: add it to `LINKED`, so the sweep opens it with one");
      const excuse = TURNED_AWAY[label(page)];
      if ("thrown" in visited) {
        assert.ok(isNavigation(visited.thrown), `the page crashed: ${String(visited.thrown)}`);
        assert.notEqual(
          excuse,
          undefined,
          `the page sent the visitor to ${redirectTarget(visited.thrown) ?? "its 404"}, so nothing on it was typed into`,
        );
        return;
      }
      assert.equal(excuse, undefined, "the page renders: drop its excuse, so the sweep types into it");
      // A link whose read the sweep cannot answer opens on a panel holding links alone, nothing to type into or press.
      if (LINKED.has(label(page))) {
        assert.ok(
          !visited.firstView.headings.includes(LINK_UNLESBAR_TITEL) && visited.firstView.controls > 0,
          `the link opened on no form and no button, so the sweep proved nothing about it; answer its read in \`LISTED\`: ${visited.firstView.headings.join(" | ")}`,
        );
      }

      const byDesign = URL_BY_DESIGN[label(page)] ?? {};
      const leaked = visited.reached.flatMap(({ name, typed, traces }) => {
        const left = traces.filter((trace) => !(typed && isByDesign(trace, byDesign[name])));
        return left.length === 0 ? [] : [`${name}: ${left.map(({ way, to }) => `${way} ${to ?? "(address withheld)"}`).join(", ")}`];
      });
      assert.deepEqual(leaked, [], "hold what is typed in the page, and send it in a request's body (`docs/frontend/spec.md :: I680`)");
      // An exemption holds only while its field still leaves by the way, and for the address, it names.
      for (const [name, design] of Object.entries(byDesign)) {
        assert.ok(
          visited.reached.some((each) => each.typed && each.name === name && each.traces.some((trace) => isByDesign(trace, design))),
          `„${name}“ no longer leaves by ${design.way} for ${design.at}: drop its exemption`,
        );
      }
      const search = SEARCHES[label(page)];
      if (search !== undefined) {
        assert.ok(
          visited.reached.some((each) => each.typed && each.name === search),
          `the sweep typed into no „${search}“, so it proved nothing about this page's search: ${JSON.stringify(visited.reached.filter((each) => each.typed))}`,
        );
      }
    });
  }

  it("names only pages the app holds", () => {
    const held = new Set(PAGES.map(label));
    const named = [...Object.keys(TURNED_AWAY), ...Object.keys(URL_BY_DESIGN), ...Object.keys(SEARCHES), ...LINKED];

    assert.deepEqual(
      named.filter((page) => !held.has(page)),
      [],
    );
  });
});
