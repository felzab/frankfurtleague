import "server-only";

import { updateTag } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { judgeAdminRequest } from "./auth";
import { COPY } from "./copy";
import { APIBadStatusError, loggedByBackend, requestOf } from "./errors";
import { logger } from "./logging";
import { logRefused } from "./refused";
import { requestWriteMayStand, runWithRequestScope } from "./requestScope";
import { isSeatAt, rolesOf } from "./roles";
import { isWordedRule, ruleMessage } from "./ruleMessage";
import { SERVER_COPY } from "./serverCopy";
import { SITE_CACHE_TAG } from "./siteCache";
import { getSubjectSession } from "./subject";
import { mintTraceId, readTraceparent, TRACEPARENT_HEADER } from "./trace";
import { turnstileRefusal } from "./turnstile";
import { TURNSTILE_FIELD } from "./turnstileToken";
import { fieldMessage } from "./zodGerman";

import type { z } from "zod";
import type { AdminRefusal } from "./auth";
import type { Copy } from "./copy";
import type { Code, FLRefusedField } from "./generated/client/types";
import type { Role } from "./roles";
import type { WordedRule } from "./ruleMessage";
import type { SubjectSession } from "./subject";

/**
 * What a server action answers a form, as `action` builds it and the kit's `useFormAction` reads it: done, with
 * what the page needs next and, where the write did more than the form asked, the line saying so; or not done,
 * with each field's message by the field's `name`, the one line the status line shows, and the backend's code
 * where the backend refused. A refusal a person can cause from the screen brings its reason, a stale read the
 * stale-page line, an ended session the sign-in line, anything unexpected the shared failure line; a refusal for
 * its fields alone may leave the line to the form.
 */
export type ActionAnswer<Value = undefined> =
  { ok: true; value: Value; note?: Copy } | { ok: false; fieldErrors?: Readonly<Record<string, Copy>>; reason?: Copy; errorCode?: Code };

/** A code the catalogue words in a person's own terms: `SERVER_COPY.refusal`'s keys, and `SERVER_COPY.refusalLine`'s. */
type WordedCode = keyof typeof SERVER_COPY.refusal | keyof typeof SERVER_COPY.refusalLine;

/** The dotted path of every leaf of an input, a list counting as one leaf: the key its box's message is answered by. */
type Field<T, Above extends string = ""> = T extends readonly unknown[]
  ? never
  : T extends object
    ? {
        [K in keyof T & string]-?: NonNullable<T[K]> extends readonly unknown[]
          ? `${Above}${K}`
          : NonNullable<T[K]> extends object
            ? Field<NonNullable<T[K]>, `${Above}${K}.`>
            : `${Above}${K}`;
      }[keyof T & string]
    : never;

/** A seat a person's write claims: the team and the season it names, read off the input. */
type SeatClaim = { readonly team_id: string; readonly saison_id: string };

type Seat = Extract<Role, { art: "kontakt" }>;

/** What every lane declares: its name for the failure line, its input's schema, and how its refusals are placed. */
type Declared<Schema extends z.ZodType> = {
  readonly name: string;
  /** The generated request schema, or a draft built from its fields, so every published bound holds the input. */
  readonly input: Schema;
  /**
   * The codes and the rules this screen words, a person causing each knowingly from it. Each is placed by the paths
   * its refusal names, every phrase wording one field; a code naming no field is answered with its own line where the
   * catalogue has one. One naming a path `paths` does not declare, or no field without a line, answers as every other
   * code does, and so does a refused payload breaking any rule the screen does not word: with a shared failure line.
   */
  readonly ownWords?: readonly (WordedCode | WordedRule)[];
  /**
   * Where this screen shows a refusal about one field, by the path the backend names for it, its names joined by dots
   * up to the first index as a box's are: the box showing it, or, for a field the screen shows no box for, the
   * field's name, which the status line sets before the refusal's phrase.
   */
  readonly paths?: { readonly [path: string]: Field<z.output<Schema>> | { readonly name: Copy } };
  /** The example a box's „Format: …“ message names, by the box. */
  readonly examples?: { readonly [F in Field<z.output<Schema>>]?: Copy };
};

type Run<Schema extends z.ZodType, Context, Value> = (input: z.output<Schema>, context: Context) => Promise<ActionAnswer<Value>>;

/** An administrator's write: the administrator's guard admits the caller before anything else runs. */
type AdminLane<Schema extends z.ZodType, Value> = Declared<Schema> & {
  readonly lane: "admin";
  // Session 4: builds the passkey check for its fixed list of acts here, the slot typed shut until then.
  readonly passkey?: never;
  readonly run: Run<Schema, undefined, Value>;
};

/**
 * A person's write, by the claim it makes: a seat the session must hold at the team and season its input names,
 * or a record of the person's own, which the backend authorises in its transaction.
 */
type PersonLane<Schema extends z.ZodType, Value> = Declared<Schema> & { readonly lane: "person" } & (
    | { readonly claim: "seat"; readonly run: Run<Schema, { readonly subject: SubjectSession; readonly seats: readonly Seat[] }, Value> }
    | { readonly claim: "record"; readonly run: Run<Schema, { readonly subject: SubjectSession }, Value> }
  );

/**
 * A write anybody may send: the bot check answers before anything of the input is read, or the lane names why a
 * script choosing what it sends gains nothing here.
 */
type PublicLane<Schema extends z.ZodType, Value> = Declared<Schema> & {
  readonly lane: "public";
  readonly run: Run<Schema, undefined, Value>;
} & ({ readonly botCheck: true } | { readonly exempt: string });

type Lane<Schema extends z.ZodType, Value> = AdminLane<Schema, Value> | PersonLane<Schema, Value> | PublicLane<Schema, Value>;

/** Every code that means the page was read before something changed: a reload shows the record as it stands. */
const STALE: ReadonlySet<Code> = new Set<Code>([
  "document_not_found",
  "version_stale",
  "booking_schiedsrichter_moved",
  "wiring_unsupported",
  "wiring_seed_past_the_opening_round",
  "wiring_gruppe_not_run",
  "role_not_held",
  // A team's refusals, which a screen setting no team meets only where the fixture changed under it; a screen
  // setting one words them as its own.
  "ergebnis_side_emptied",
  "spieltag_occupied",
  "spieltag_occupied_by_the_resolution",
  "eligibility_team_not_in_saison",
  // A rule the screen does not word, its input holding every rule the API publishes: the page is older than the API.
  "payload_refused",
  "body_unreadable",
]);

/** The admin guard's refusals, each in the words of what repairs it. */
const TURNED_AWAY: Readonly<Record<AdminRefusal, Copy>> = {
  signIn: COPY.shared.failure.signInExpired,
  noGrant: COPY.shared.failure.accessGone,
  grantGone: COPY.shared.failure.accessGone,
  unread: COPY.shared.failure.accessUnchecked,
};

const UNEXPECTED = { ok: false, reason: COPY.shared.failure.unexpected } as const;

const isWorded = (code: Code): code is Code & keyof typeof SERVER_COPY.refusal => Object.hasOwn(SERVER_COPY.refusal, code);

const isLined = (code: Code): code is Code & keyof typeof SERVER_COPY.refusalLine => Object.hasOwn(SERVER_COPY.refusalLine, code);

// The backend's own strip, Python's `str.strip`: Unicode's White_Space and U+001C to U+001F, from both ends. A field
// stripped by Pydantic's `strip_whitespace` keeps those four, which is safe, since the stripped text is what is sent.
// Never JavaScript's `trim`, whose set adds U+FEFF, which the backend keeps.
const ENDS = /^[\p{White_Space}\x1c-\x1f]+|[\p{White_Space}\x1c-\x1f]+$/gu;

/** Every text in the input stripped as the backend strips it, so a bound is judged on what the backend stores. */
function stripped(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll(ENDS, "");
  if (Array.isArray(value)) return value.map(stripped);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, stripped(inner)]));
  }
  return value;
}

/** A posted form as an object, each box under its name; a box posted twice keeps its last value. */
const posted = (raw: unknown): unknown => (raw instanceof FormData ? Object.fromEntries(raw) : raw);

/**
 * The box an issue belongs to: its path's names joined by dots, up to the first index, where a list's box holds every
 * item. Keyed by the whole path, two leaves sharing a last name, `team1.tore` and `team2.tore`, stay two boxes.
 */
function fieldOf(path: readonly PropertyKey[]): string | undefined {
  const names: string[] = [];
  for (const segment of path) {
    if (typeof segment !== "string") break;
    names.push(segment);
  }
  return names.length === 0 ? undefined : names.join(".");
}

/**
 * The input parsed, or the answer placing each refusal on its box. Each box's line is the German error map's, asked
 * per parse: the map reads the raw issue's input and schema, which a finished parse's issues no longer carry. An
 * issue naming no box, or one a schema's own message words past the map, is the unexpected failure.
 */
function parsed<Schema extends z.ZodType>(
  declared: Declared<Schema>,
  raw: unknown,
): { input: z.output<Schema> } | { answer: ActionAnswer<never> } {
  const examples: Readonly<Record<string, Copy | undefined>> = declared.examples ?? {};
  const fieldErrors: Record<string, Copy> = {};
  const result = declared.input.safeParse(stripped(posted(raw)), {
    error: (issue) => {
      const path = issue.path ?? [];
      const field = fieldOf(path);
      const example = field === undefined ? undefined : examples[field];
      const line = fieldMessage(issue, example === undefined ? {} : { [path.map(String).join(".")]: example });
      // The first issue on a box is the one it shows.
      if (field !== undefined) fieldErrors[field] ??= line;
      return line;
    },
  });
  if (result.success) return { input: result.data };

  const unplaced = result.error.issues.some((issue) => {
    const field = fieldOf(issue.path);
    return field === undefined || fieldErrors[field] === undefined;
  });
  return { answer: unplaced ? UNEXPECTED : { ok: false, fieldErrors } };
}

const wordsOwn = <Schema extends z.ZodType>(declared: Declared<Schema>, kind: string): boolean =>
  declared.ownWords?.some((own) => own === kind) ?? false;

/**
 * Each refused field's line where this screen shows the field, by the path the backend named: on its box, or on the
 * status line after the field's name. `undefined` where the refusal names no field, or one the screen does not
 * declare, so no field phrase reaches the status line without its field.
 */
function placed<Schema extends z.ZodType>(
  declared: Declared<Schema>,
  code: Code,
  lines: readonly { readonly path: FLRefusedField["path"]; readonly line: Copy }[],
): ActionAnswer<never> | undefined {
  if (lines.length === 0) return undefined;
  const fieldErrors: Record<string, Copy> = {};
  let reason: Copy | undefined;
  for (const { path, line } of lines) {
    const field = fieldOf(path);
    const shown: string | { readonly name: Copy } | undefined = field === undefined ? undefined : declared.paths?.[field];
    if (shown === undefined) return undefined;
    // The first refusal a box meets is the one it shows.
    if (typeof shown === "string") fieldErrors[shown] ??= line;
    else reason ??= COPY.template.namedField(shown.name, line);
  }
  return {
    ok: false,
    errorCode: code,
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * A refusal this screen words, placed by its fields: a refused payload's broken rules where the screen words every
 * one, a code's phrase, or, for a code naming no field, its line on the status line. `undefined` where the screen does
 * not word it or cannot place it.
 */
function worded<Schema extends z.ZodType>(
  declared: Declared<Schema>,
  code: Code,
  fields: readonly FLRefusedField[],
): ActionAnswer<never> | undefined {
  if (code === "payload_refused") {
    if (!fields.every(({ kind }) => isWordedRule(kind) && wordsOwn(declared, kind))) return undefined;
    return placed(
      declared,
      code,
      fields.map((refused) => ({ path: refused.path, line: ruleMessage(refused) })),
    );
  }
  // A refusal of the write as a whole, never a field's phrase without its field: a phrase needs its field as a subject.
  if (fields.length === 0)
    return isLined(code) && wordsOwn(declared, code) ? { ok: false, errorCode: code, reason: SERVER_COPY.refusalLine[code] } : undefined;
  if (!isWorded(code) || !wordsOwn(declared, code)) return undefined;
  const line = SERVER_COPY.refusal[code];
  return placed(
    declared,
    code,
    fields.map(({ path }) => ({ path, line })),
  );
}

/** The backend's refusal in this screen's words where it words and places it, else the shared line its kind answers. */
function refused<Schema extends z.ZodType>(declared: Declared<Schema>, code: Code, fields: readonly FLRefusedField[]): ActionAnswer<never> {
  const answer = worded(declared, code, fields);
  if (answer !== undefined) return answer;
  if (STALE.has(code)) return { ok: false, errorCode: code, reason: COPY.shared.failure.stale };
  // The grant went between the guard's read and the backend's.
  if (code === "actor_not_admin") return { ok: false, errorCode: code, reason: COPY.shared.failure.accessGone };
  return { ok: false, errorCode: code, reason: COPY.shared.failure.unexpected };
}

/**
 * Logged by name alone, an action's callee may throw with a submitted value in its message; a failure the backend
 * answered is its own line's, so it is written once.
 */
function logFailure(name: string, error: unknown): void {
  if (loggedByBackend(error)) return;
  logger.error("action.failed", undefined, { action: name, name: error instanceof Error ? error.name : "unknown", ...requestOf(error) });
}

/** A person turned away, logged as a page's turn-away is. */
function turnedAwayPerson(operation: string, refusal: "keine_sitzung" | "kein_sitz"): ActionAnswer<never> {
  logRefused(operation, refusal);
  return { ok: false, reason: refusal === "keine_sitzung" ? COPY.shared.failure.signInExpired : COPY.shared.failure.stale };
}

/** The lane's guard, the parse and the body, in that order: no part of the input is read before the guard admits. */
async function guarded<Schema extends z.ZodType, Value>(lane: Lane<Schema, Value>, raw: unknown): Promise<ActionAnswer<Value>> {
  switch (lane.lane) {
    case "admin": {
      const judged = await judgeAdminRequest();
      if ("refused" in judged) return { ok: false, reason: TURNED_AWAY[judged.refused] };
      const read = parsed(lane, raw);
      return "answer" in read ? read.answer : body(lane, () => lane.run(read.input, undefined));
    }
    case "person": {
      const subject = await getSubjectSession();
      if (subject === null) return turnedAwayPerson(lane.name, "keine_sitzung");
      const read = parsed(lane, raw);
      if ("answer" in read) return read.answer;
      if (lane.claim === "record") return body(lane, () => lane.run(read.input, { subject }));

      // A request can hand an action anything at all, so the claim is read as possibly absent.
      const claim = (read.input ?? {}) as Partial<SeatClaim>;
      const { team_id: team, saison_id: saison } = claim;
      const seats =
        typeof team === "string" && typeof saison === "string" ? rolesOf(subject).roles.filter((role) => isSeatAt(role, team, saison)) : [];
      if (seats.length === 0) return turnedAwayPerson(lane.name, "kein_sitz");
      return body(lane, () => lane.run(read.input, { subject, seats }));
    }
    case "public": {
      if ("botCheck" in lane) {
        // First, before the input is read at all: nothing an unverified sender posted is parsed.
        const token = raw instanceof FormData ? raw.get(TURNSTILE_FIELD) : (raw as Partial<Record<string, unknown>> | null)?.[TURNSTILE_FIELD];
        const refusal = await turnstileRefusal(typeof token === "string" ? token : null);
        if (refusal !== null) return { ok: false, reason: refusal };
      }
      const read = parsed(lane, raw);
      return "answer" in read ? read.answer : body(lane, () => lane.run(read.input, undefined));
    }
  }
}

/**
 * The body and its call to the backend, answering the backend's refusal by its code and anything else as the
 * unexpected failure. A body that sent a backend write which may have landed clears the site's one cache tag, which
 * also renders the page again, whatever the body came to: the write may stand behind a throw or a lost answer, and
 * every cached read carries the tag, so no write has to know which it moves. A body whose writes were each refused, or
 * that sent none, carries only its answer and renders nothing again: a refused editor keeps what was typed into it. A
 * body changing state outside the cache, the sign-in store's, calls Next's `refresh()` itself.
 */
async function body<Schema extends z.ZodType, Value>(
  lane: Lane<Schema, Value>,
  run: () => Promise<ActionAnswer<Value>>,
): Promise<ActionAnswer<Value>> {
  try {
    return await run();
  } catch (error) {
    // Next's redirect and not-found are how a body leads on, never a failure.
    unstable_rethrow(error);
    if (error instanceof APIBadStatusError && error.serverErrorCode !== undefined) {
      return refused(lane, error.serverErrorCode, error.refusedFields);
    }
    logFailure(lane.name, error);
    return UNEXPECTED;
  } finally {
    if (requestWriteMayStand()) updateTag(SITE_CACHE_TAG);
  }
}

/**
 * The one way to build a server action: every export of a `"use server"` module is one of these, which the lint
 * rule `fl/server-action` holds. The action runs under the edge's trace, behind its lane's guard, on its input
 * stripped and parsed against its schema, and answers the kit's `ActionAnswer`: done, a field's message, the
 * backend's refusal with its code, or the one unexpected failure.
 */
export function action<Schema extends z.ZodType, Value = undefined>(
  lane: Lane<Schema, Value>,
): (raw: z.input<Schema> | FormData) => Promise<ActionAnswer<Value>> {
  return async (raw) => {
    const incoming = readTraceparent((await headers()).get(TRACEPARENT_HEADER));
    return runWithRequestScope({ traceId: incoming ?? mintTraceId() }, () => guarded(lane, raw));
  };
}
