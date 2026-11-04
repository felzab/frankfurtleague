import "server-only";

import { updateTag } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { judgeAdminRequest, passesPasskeyTouch } from "./auth";
import { COPY } from "./copy";
import { APIBadStatusError, loggedByBackend, requestOf } from "./errors";
import { logger } from "./logging";
import { logRefused } from "./refused";
import { getRequestActor, requestWriteMayStand, runWithRequestScope } from "./requestScope";
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
   * The codes and the rules this screen words, a person causing each knowingly from it. A field pattern's phrase is
   * placed on the box `paths` names for the path its refusal names; a sentence stands on the status line. One whose
   * phrase names a path `paths` does not declare, or whose sentence names a path its entry holds none for, answers
   * as every other code does, and so does a refused payload breaking any rule the screen does not word: with a
   * shared failure line.
   */
  readonly ownWords?: readonly (WordedCode | WordedRule)[];
  /**
   * The box showing a field pattern's phrase, by the path the backend names for the refused field, its names joined
   * by dots up to the first index as a box's are. A field the screen shows no box for has no entry: a phrase has no
   * subject but its box, so a refusal only a phrase words, about a field this screen does not show, is not its own.
   */
  readonly paths?: { readonly [path: string]: Field<z.output<Schema>> };
  /** The example a box's „Format: …“ message names, by the box. */
  readonly examples?: { readonly [F in Field<z.output<Schema>>]?: Copy };
};

type Run<Schema extends z.ZodType, Context, Value> = (input: z.output<Schema>, context: Context) => Promise<ActionAnswer<Value>>;

/**
 * The passkey touch, which an act on its fixed list declares: the act runs only on a session a passkey sign-in made
 * within `PASSKEY_TOUCH_SECONDS`, for a person holding a passkey, every time; a person holding none passes.
 */
type Touched = { readonly passkey?: true };

/** An administrator's write: the administrator's guard admits the caller before anything else runs. */
type AdminLane<Schema extends z.ZodType, Value> = Declared<Schema> &
  Touched & {
    readonly lane: "admin";
    readonly run: Run<Schema, undefined, Value>;
  };

/**
 * A person's write, by the claim it makes: a seat the session must hold at the team and season its input names,
 * or a record of the person's own, which the backend authorises in its transaction.
 */
type PersonLane<Schema extends z.ZodType, Value> = Declared<Schema> &
  Touched & { readonly lane: "person" } & (
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

/** One refused field in the catalogue's words: a field pattern's phrase for its box, or a sentence of its own. */
type Words = { readonly path: FLRefusedField["path"] } & ({ readonly field: Copy } | { readonly line: Copy });

/**
 * Each refusal where this screen shows it: a phrase on the box `paths` names for its path, a sentence on the status
 * line. The first a box meets is the one it shows, and the first sentence the one the line shows. `undefined` where
 * a phrase's path has no box here, so no field phrase reaches the status line without its field.
 */
function placed<Schema extends z.ZodType>(declared: Declared<Schema>, code: Code, refusals: readonly Words[]): ActionAnswer<never> | undefined {
  if (refusals.length === 0) return undefined;
  const fieldErrors: Record<string, Copy> = {};
  let reason: Copy | undefined;
  for (const refusal of refusals) {
    if ("line" in refusal) {
      reason ??= refusal.line;
      continue;
    }
    const field = fieldOf(refusal.path);
    const box = field === undefined ? undefined : declared.paths?.[field];
    if (box === undefined) return undefined;
    fieldErrors[box] ??= refusal.field;
  }
  return {
    ok: false,
    errorCode: code,
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * A code's sentence for the path it names: the code's one sentence, or, where its entry is keyed by the field, the
 * one for the path's first name. `undefined` where the entry holds none for it.
 */
function sentenceOf(code: Code & keyof typeof SERVER_COPY.refusalLine, path: FLRefusedField["path"] | undefined): Copy | undefined {
  const entry: Copy | Readonly<Record<string, Copy>> = SERVER_COPY.refusalLine[code];
  if (typeof entry === "string") return entry;
  const [head] = path ?? [];
  return typeof head === "string" && Object.hasOwn(entry, head) ? entry[head] : undefined;
}

/**
 * A refusal this screen words: a refused payload's broken rules where the screen words every one, a code's phrase on
 * the box of each field it names, or a code's sentence on the status line. `undefined` where the screen does not word
 * it or cannot place it.
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
      fields.map((refused) => ({ path: refused.path, ...ruleMessage(refused) })),
    );
  }
  if (!wordsOwn(declared, code)) return undefined;
  if (isLined(code)) {
    const reason = sentenceOf(code, fields[0]?.path);
    return reason === undefined ? undefined : { ok: false, errorCode: code, reason };
  }
  // A phrase names no field of its own, so a code naming none has nothing to place it on.
  if (!isWorded(code)) return undefined;
  const phrase = SERVER_COPY.refusal[code];
  return placed(
    declared,
    code,
    fields.map(({ path }) => ({ path, field: phrase })),
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

/** The touch a lane declares, judged on the actor its guard recorded: `undefined` where it declares none or passes. */
async function untouched(lane: Touched): Promise<ActionAnswer<never> | undefined> {
  if (lane.passkey !== true || (await passesPasskeyTouch(getRequestActor()))) return undefined;
  return { ok: false, reason: COPY.signIn.refusal.touchMissing };
}

/**
 * The lane's guard, the touch it declares, the parse and the body, in that order: no part of the input is read before
 * the guard admits.
 */
async function guarded<Schema extends z.ZodType, Value>(lane: Lane<Schema, Value>, raw: unknown): Promise<ActionAnswer<Value>> {
  switch (lane.lane) {
    case "admin": {
      const judged = await judgeAdminRequest();
      if ("refused" in judged) return { ok: false, reason: TURNED_AWAY[judged.refused] };
      const touch = await untouched(lane);
      if (touch !== undefined) return touch;
      const read = parsed(lane, raw);
      return "answer" in read ? read.answer : body(lane, () => lane.run(read.input, undefined));
    }
    case "person": {
      const subject = await getSubjectSession();
      if (subject === null) return turnedAwayPerson(lane.name, "keine_sitzung");
      const touch = await untouched(lane);
      if (touch !== undefined) return touch;
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
