import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk.ts";
import { describe, expect, it } from "vitest";

import { ROUTES } from "./routes.ts";

import type { FLOutboxHandout } from "./generated/client/types.ts";

const { mailFor } = await import("./mailKinds.ts");

const APP = path.resolve(import.meta.dirname, "..", "app");

const ORIGIN = "http://localhost:3000";

/** Made up, and spelled so no other part of a mail can hold it by chance. */
const TOKEN = "example-mailed-link-token";

type OutboxData = FLOutboxHandout["data"];
type OutboxKind = OutboxData["kind"];

/** The member whose `kind` admits `A`, as `core/mailKinds.ts` reads the union. */
type Member<D, A> = D extends { kind: infer K } ? (A extends K ? D : never) : never;

const ANSETZUNG = { date: "2026-10-24", time: "16:00:00", team1: "Ahorn", team2: "Kastanie", spielort: "Sportpark Riedberg" };
const APPOINTMENT = { date: "2026-10-24", time: "16:00:00", team1: "Ahorn", team2: "Kastanie" };

/**
 * One mail's facts for every kind the backend hands out. Typed over the hand-out's union, so a kind the backend adds
 * fails the type check here until it takes a row: the table is held to the contract rather than to how a builder
 * happens to spell its link.
 */
const FACTS: { [A in OutboxKind]: Member<OutboxData, A> } = {
  sign_in_code: { kind: "sign_in_code" },
  passkey_added: { kind: "passkey_added", instant: "2026-10-17T10:00:00Z" },
  passkey_erased: { kind: "passkey_erased", instant: "2026-10-17T10:00:00Z" },
  account_erasure: { kind: "account_erasure" },
  ban: { kind: "ban", ban_reason: "Fake", barred_until_saison_id: "2728" },
  grant: { kind: "grant", change: "granted", stage: "completed", address: null, new_address: null, effective_from: null },
  address_change_link: { kind: "address_change_link", way: "account", holder: null },
  address_change_notice: { kind: "address_change_notice", way: "account", holder: null },
  address_change_effective: { kind: "address_change_effective", instant: "2026-10-17T10:00:00Z" },
  address_change_discarded: { kind: "address_change_discarded" },
  schiedsrichter_confirmation: { kind: "schiedsrichter_confirmation", deadline: "2026-10-17" },
  spiel_request: {
    kind: "spiel_request",
    ansetzung: ANSETZUNG,
    deadline: "2026-10-17",
    moved_from: null,
    saison_id: "2627",
    team: "Ahorn",
    team_id: "6890a1b2c3d4e5f607250011",
  },
  spiel_reminder: {
    kind: "spiel_reminder",
    ansetzung: ANSETZUNG,
    deadline: "2026-10-17",
    moved_from: null,
    saison_id: "2627",
    team: "Ahorn",
    team_id: "6890a1b2c3d4e5f607250011",
  },
  spiel_einteilung: { kind: "spiel_einteilung", ansetzung: ANSETZUNG, moved_from: null },
  spiel_moved: { kind: "spiel_moved", appointment: APPOINTMENT, moved_to: null, asked_again: false, recipient: "team" },
  spiel_cancelled: { kind: "spiel_cancelled", appointment: APPOINTMENT, recipient: "team" },
  spiel_einteilung_lifted: { kind: "spiel_einteilung_lifted", appointment: APPOINTMENT },
  spiel_vorschlag_discarded: { kind: "spiel_vorschlag_discarded", appointment: APPOINTMENT },
  aufstellung_reminder: {
    kind: "aufstellung_reminder",
    appointment: ANSETZUNG,
    due_at: "2026-10-23T14:00:00Z",
    saison_id: "2627",
    team: "Ahorn",
    team_id: "6890a1b2c3d4e5f607250011",
  },
  austritt_notice: { kind: "austritt_notice", saison_id: "2627", team: "Ahorn", spiele: [{ ...APPOINTMENT }] },
  registrierung_confirmation: { kind: "registrierung_confirmation", saison_id: "2627", team: "Goethe-Gymnasium" },
  registrierung_absage: { kind: "registrierung_absage", saison_id: "2627", team: "Goethe-Gymnasium", reason: null },
  invitation: { kind: "invitation", saison_id: "2627", team: "Goethe-Gymnasium" },
  bewerbung_received: {
    kind: "bewerbung_received",
    deadline: "2026-10-17",
    pending: ["stellvertretung"],
    rollen: ["trainer"],
    saison_id: "2627",
  },
  bewerbung_confirmation: {
    kind: "bewerbung_confirmation",
    deadline: "2026-10-17",
    rollen: ["trainer"],
    saison_id: "2627",
    schule: "Lessing-Kolleg",
  },
  bewerbung_reminder: { kind: "bewerbung_reminder", deadline: "2026-10-17", rollen: ["trainer"], saison_id: "2627", schule: "Lessing-Kolleg" },
  bewerbung_zusage: {
    kind: "bewerbung_zusage",
    gruppe: "A",
    rollen: ["trainer"],
    saison_id: "2627",
    shorthand: "LES",
    team: "Lessing",
    trikot_farbe: null,
  },
  bewerbung_absage: { kind: "bewerbung_absage", reason: "Zu spät", rollen: ["trainer"], saison_id: "2627", team: "Lessing" },
  deletion_notice: { kind: "deletion_notice", saison_id: null },
  bewerbung_objection: {
    kind: "bewerbung_objection",
    deadline: "2026-10-17",
    declined: ["stellvertretung"],
    rollen: ["trainer"],
    saison_id: "2627",
  },
  kontakt_confirmation: {
    kind: "kontakt_confirmation",
    deadline: "2026-10-17",
    rollen: ["ansprechperson"],
    row: "open",
    saison_id: "2627",
    schule: "Lessing-Kolleg",
  },
};

const KINDS = Object.keys(FACTS) as OutboxKind[];

/** Every address in `value`, a mail's button, its passed-on block and its runs alike, that carries the made-up token. */
function tokenLinksIn(value: unknown): string[] {
  if (typeof value === "string") return value.startsWith(ORIGIN) && value.includes(TOKEN) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(tokenLinksIn);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(tokenLinksIn);
  return [];
}

/** Each kind's links carrying its credential, built through the drain's own `mailFor` with a made-up token and secret. */
function tokenLinksOf(kind: OutboxKind): string[] {
  const mail = mailFor(kind, FACTS[kind] as never, { token: TOKEN, secret: TOKEN, origin: ORIGIN });
  if (mail === undefined) throw new Error(`the kind ${kind} has no builder`);
  return tokenLinksIn(mail);
}

/**
 * The segments a route folder answers at, as `core/routes.test.ts` reads them: a route group's `(…)` and a parallel slot's
 * `@…` are no segment, an interception's `(.)` prefix leaves its segment, and a dynamic `[…]` is kept as written.
 */
const segmentsOf = (file: string): string[] =>
  path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((folder) => folder !== "" && !/^\(.*\)$/.test(folder) && !folder.startsWith("@"))
    .map((folder) => folder.replace(/^(\(\.{1,3}\))+/, ""));

/** The address each page file answers at. */
const PAGES = new Set(filesUnder(APP, (name) => name === "page.tsx", 20).map((file) => `/${segmentsOf(file).join("/")}`));

/** The address of each ROUTES row taking no segment, which a mailed link's page is. */
const FIXED_ROUTES = new Set(Object.values(ROUTES).flatMap((row) => (row.path.length === 0 ? [(row.path as () => string)()] : [])));

describe("a mailed link's token", () => {
  // The edge's access line carries a request's path and never its query (`nginx/shared/http.conf :: fl_json`), so a
  // builder spelling the token into the path writes every live token of its kind, a minor's included, into the log
  // with nothing else failing. Every kind's mail is built, so a link a later builder spells in any way is held here.
  it.each(KINDS)("rides in the query, never in the path the edge logs, in a %s mail", (kind) => {
    for (const link of tokenLinksOf(kind)) {
      const { pathname, searchParams } = new URL(link);
      expect(pathname.includes(TOKEN), `the link ${link} carries the token in its path`).toBe(false);
      expect([...searchParams.values()].includes(TOKEN), `the link ${link} carries the token outside its query`).toBe(true);
    }
  });

  // A mailed link opens a page by its ROUTES row, whose row decides what robots.txt refuses and what the page names as
  // its own address; a link to an address no page answers is a dead mail.
  it.each(KINDS)("opens a page of its own ROUTES row, in a %s mail", (kind) => {
    for (const link of tokenLinksOf(kind)) {
      const { pathname } = new URL(link);
      expect(FIXED_ROUTES.has(pathname), `${pathname} is no ROUTES row`).toBe(true);
      expect(PAGES.has(pathname), `no page answers at ${pathname}`).toBe(true);
    }
  });

  // The two cases above hold nothing where no mail carries a link, as a builder that dropped its token would.
  it("is carried by the mails that lead a person to a page", () => {
    expect(KINDS.filter((kind) => tokenLinksOf(kind).length > 0).length).toBeGreaterThan(0);
  });
});
