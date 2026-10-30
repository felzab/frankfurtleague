import "server-only";

import { updateTag } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { judgeAdminRequest } from "./auth";
import { COPY } from "./copy";
import { APIBadStatusError, loggedByBackend, requestOf } from "./errors";
import { funktionenOf, isSeatAt } from "./funktionen";
import { logger } from "./logging";
import { runWithRequestScope } from "./requestScope";
import { SITE_CACHE_TAG } from "./siteCache";
import { getSubjectSession } from "./subject";
import { mintTraceId, readTraceparent, TRACEPARENT_HEADER } from "./trace";
import { turnstileRefusal } from "./turnstile";
import { TURNSTILE_FIELD } from "./turnstileToken";
import { feldMeldung } from "./zodGerman";

import type { ActionAnswer } from "@/kit/useFormAction";
import type { z } from "zod";
import type { AdminRefusal } from "./auth";
import type { Copy } from "./copy";
import type { Funktion } from "./funktionen";
import type { Code } from "./generated/client/types";
import type { SubjectSession } from "./subject";

/** A code the catalogue words in a person's own terms, `COPY.shared.ablehnung`'s keys. */
type WordedCode = keyof typeof COPY.shared.ablehnung;

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

type Seat = Extract<Funktion, { art: "kontakt" }>;

/** What every lane declares: its name for the failure line, its input's schema, and how its refusals are placed. */
type Declared<Schema extends z.ZodType> = {
  readonly name: string;
  /** The generated request schema, or a draft built from its fields, so every published bound holds the input. */
  readonly input: Schema;
  /**
   * The codes this screen words in their own words, a person causing each knowingly from it: on the box it names,
   * or, with `true`, as the status line's reason. Every other code answers a shared failure line.
   */
  readonly ownWords?: { readonly [C in WordedCode]?: Field<z.output<Schema>> | true };
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
  "funktion_nicht_gehalten",
  // The input passed the API's own rules as this page knows them: the page is older than the API.
  "payload_refused",
  "body_unreadable",
]);

/** The admin guard's refusals, each in the words of what repairs it. */
const TURNED_AWAY: Readonly<Record<AdminRefusal, Copy>> = {
  signIn: COPY.shared.fehler.abgelaufen,
  noGrant: COPY.shared.fehler.zugangWeg,
  grantGone: COPY.shared.fehler.zugangWeg,
  unread: COPY.shared.fehler.zugangUngeprueft,
};

const UNEXPECTED = { ok: false, reason: COPY.shared.fehler.unerwartet } as const;

const isWorded = (code: Code): code is Code & WordedCode => Object.hasOwn(COPY.shared.ablehnung, code);

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
      const line = feldMeldung(issue, example === undefined ? {} : { [path.map(String).join(".")]: example });
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

/** The backend's refusal in this screen's words where it words the code, else the shared line its kind answers. */
function refused<Schema extends z.ZodType>(declared: Declared<Schema>, code: Code): ActionAnswer<never> {
  const placed = isWorded(code) ? declared.ownWords?.[code] : undefined;
  if (placed !== undefined && isWorded(code)) {
    const text = COPY.shared.ablehnung[code];
    return typeof placed === "string"
      ? { ok: false, errorCode: code, fieldErrors: { [placed]: text } }
      : { ok: false, errorCode: code, reason: text };
  }
  if (STALE.has(code)) return { ok: false, errorCode: code, reason: COPY.shared.fehler.veraltet };
  // The grant went between the guard's read and the backend's.
  if (code === "actor_not_admin") return { ok: false, errorCode: code, reason: COPY.shared.fehler.zugangWeg };
  return { ok: false, errorCode: code, reason: COPY.shared.fehler.unerwartet };
}

/**
 * Logged by name alone, an action's callee may throw with a submitted value in its message; a failure the backend
 * answered is its own line's, so it is written once.
 */
function logFailure(name: string, error: unknown): void {
  if (loggedByBackend(error)) return;
  logger.error("action.failed", undefined, { action: name, name: error instanceof Error ? error.name : "unknown", ...requestOf(error) });
}

/** A person turned away, by the operation and the reason, never an address. */
function turnedAwayPerson(operation: string, grund: "keine_sitzung" | "kein_sitz"): ActionAnswer<never> {
  logger.info("funktion.verweigert", { operation, grund });
  return { ok: false, reason: grund === "keine_sitzung" ? COPY.shared.fehler.abgelaufen : COPY.shared.fehler.veraltet };
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
        typeof team === "string" && typeof saison === "string"
          ? funktionenOf(subject).funktionen.filter((funktion) => isSeatAt(funktion, team, saison))
          : [];
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
 * unexpected failure. An administrator's or a person's write clears the site's one cache tag whatever the body came
 * to: a write may stand behind a refusal, a throw or a lost answer, and every cached read carries the tag, so no
 * write has to know which it moves. The tag's clearing also renders the page again in the action's response. A
 * public write, the sign-in's code, reaches no cached read, so it leaves every other visitor's pages cached.
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
      return refused(lane, error.serverErrorCode);
    }
    logFailure(lane.name, error);
    return UNEXPECTED;
  } finally {
    if (lane.lane !== "public") updateTag(SITE_CACHE_TAG);
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
