import "server-only";

import { updateTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { z } from "zod";

import { getAccountSession, judgeAdminRequest, passesPasskeyTouch } from "./auth/guards";
import { COPY } from "./copy";
import { asSignInIdentifier, KONTAKT_EMAIL_MAX_LENGTH } from "./emailAddress";
import { APIBadStatusError, loggedByBackend, requestOf } from "./errors";
import { logger } from "./logging";
import { logRefused } from "./refused";
import { getRequestActor, requestWriteMayStand } from "./requestScope";
import { isSeatAt, rolesOf } from "./roles";
import { isBoundedCode, isWordedRule, ruleMessage } from "./ruleMessage";
import { SERVER_COPY } from "./serverCopy";
import { SITE_CACHE_TAG } from "./siteCache";
import { getSubjectSession } from "./subject";
import { runWithIncomingTrace } from "./traceScope";
import { turnstileRefusal } from "./turnstile";
import { TURNSTILE_FIELD } from "./turnstileToken";
import { fieldMessage } from "./zodGerman";

import type { AdminRefusal, JudgedSession } from "./auth/guards";
import type { Words as CatalogueWords, Copy } from "./copy";
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
 * its fields alone may leave the line to the form. `warn` marks an act that partly happened, its note or its reason
 * read in the warn tone: neither a clean save nor a refusal that left everything as it stood.
 */
export type ActionAnswer<Value = undefined> =
  | { ok: true; value: Value; note?: Copy; warn?: true }
  | { ok: false; fieldErrors?: Readonly<Record<string, Copy>>; reason?: Copy; errorCode?: Code; ask?: SaveQuestion; warn?: true };

/**
 * A save the server holds back until the person confirms what it would set off beyond the record, such as the later
 * results a match's new score deletes: the question its editor asks, the facts it rests on, and `confirm`, the token a
 * confirmed send carries back. The token names what was confirmed, so a save that would now set off something else
 * is asked about again rather than let through.
 */
export type SaveQuestion = {
  subject: Copy;
  consequence: Copy;
  facts?: ReadonlyArray<{ readonly label: Copy; readonly value: CatalogueWords }>;
  confirm: string;
};

/** A code the catalogue words in a person's own terms: `SERVER_COPY.refusal`'s keys, and `SERVER_COPY.refusalLine`'s. */
type WordedCode = keyof typeof SERVER_COPY.refusal | keyof typeof SERVER_COPY.refusalLine;

/** Every row of a list, in a declared path: `scorers.*.minute` declares the minute of each of the list's records. */
const EVERY_ROW = "*";

/** The fields of a list's record, each under its list's every row; a list of single values holds none. */
type RowField<Item, List extends string> = Item extends readonly unknown[]
  ? never
  : Item extends object
    ? `${List}.${typeof EVERY_ROW}.${keyof Item & string}`
    : never;

/**
 * The dotted path of every leaf of an input: the key its box's message is answered by. A list counts as one leaf, its
 * box holding every item, and a list of records adds each record's fields, a row's own boxes, declared for every row
 * at once.
 */
type Field<T, Above extends string = ""> = T extends readonly unknown[]
  ? never
  : T extends object
    ? {
        [K in keyof T & string]-?: NonNullable<T[K]> extends readonly (infer Item)[]
          ? `${Above}${K}` | RowField<Item, `${Above}${K}`>
          : NonNullable<T[K]> extends object
            ? Field<NonNullable<T[K]>, `${Above}${K}.`>
            : `${Above}${K}`;
      }[keyof T & string]
    : never;

/** A seat a person's write claims: the team and the season it names, read off the input. */
type SeatClaim = { readonly team_id: string; readonly saison_id: string };

type Seat = Extract<Role, { kind: "kontakt" }>;

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
   * by dots as a box's are (`fieldOf`). A row's field is declared once for every row, `*` standing where the index
   * does on both sides, `"bericht.scorers.*.minute": "changes.scorers.*.minute"`, and a refusal naming row 2 lands on
   * row 2's box. A field the screen shows no box for has no entry: a phrase has no subject but its box, so a refusal
   * only a phrase words, about a field this screen does not show, is not its own, and a row's refusal never falls
   * back to its list's box.
   */
  readonly paths?: { readonly [path: string]: Field<z.output<Schema>> };
  /** The example a box's „Format: …“ message names, by the box; a row's field names it for every row. */
  readonly examples?: { readonly [F in Field<z.output<Schema>>]?: Copy };
};

type Run<Schema extends z.ZodType, Context, Value> = (input: z.output<Schema>, context: Context) => Promise<ActionAnswer<Value>>;

/**
 * The address the page was drawn for, which every act of the account and every act behind the passkey touch posts: a
 * page whose own session has ended acts as whichever account the browser holds now, and its touch asks a prompt naming
 * nobody, which any account's passkey answers, signing that account in.
 */
export const PAGE_HOLDER = { holder: z.string().min(1).max(KONTAKT_EMAIL_MAX_LENGTH) };

/** A published rule a field's value is held to, or an action's own reading of a box over it. */
type Rule = { readonly safeParse: (value: unknown) => { readonly success: boolean } };

/**
 * Whether a write requires a field, which its box's asterisk says: whether its rule refuses what the box sends while
 * empty, `""` for a text box passed on as typed, `null` for a figure, a day or a box read as no value
 * (`numberBox`, `blankIsNull`), `[]` for a choice of several with none picked. Read on the server, so the schema
 * never reaches the browser.
 */
export const requires = (rule: Rule, empty: "" | null | readonly []): boolean => !rule.safeParse(empty).success;

/**
 * A digit box's text held to its rule as a number: an empty box no value, digits alone their figure, anything else the
 * text as typed, which the rule refuses in its own words.
 */
export const numberBox = <Figure extends z.ZodType>(rule: Figure) =>
  z.preprocess((value) => (value === "" ? null : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value), rule);

/** A text box whose emptiness is no value, held to its rule: an empty box `null`, anything else as typed. */
export const blankIsNull = <Text extends z.ZodType>(rule: Text) => z.preprocess((value) => (value === "" ? null : value), rule);

/** Declarable only over an input carrying `PAGE_HOLDER`, so no such act is posted without it. */
type Held<Schema extends z.ZodType> = z.output<Schema> extends { readonly holder: string } ? unknown : never;

/**
 * The passkey touch, which an act on its fixed list declares: the browser asks it on every final press, and the act runs
 * only on a session a passkey sign-in made within `PASSKEY_TOUCH_SECONDS`, for a person holding a passkey, and only
 * for the address its page was drawn for; a person holding none passes.
 */
type Touched<Schema extends z.ZodType> = { readonly passkey?: never } | ({ readonly passkey: true } & Held<Schema>);

/** An administrator's write: the administrator's guard admits the caller before anything else runs. */
type AdminLane<Schema extends z.ZodType, Value> = Declared<Schema> &
  Touched<Schema> & {
    readonly lane: "admin";
    readonly run: Run<Schema, undefined, Value>;
  };

/**
 * A person's write, by the claim it makes: a seat the session must hold at the team and season its input names; a
 * record of the person's own, which the backend authorises in its transaction; or an act only Konto's pages reach,
 * which the account's own guard admits too (`fl_frontend/src/core/auth/guards.ts :: getAccountSession`), handing the
 * body the session it judged, so a session an administrator's mailbox made changes nothing of that administrator's
 * account, their consents among it. An act of the account runs only for the address its page was drawn for.
 */
type PersonLane<Schema extends z.ZodType, Value> = Declared<Schema> &
  Touched<Schema> & { readonly lane: "person" } & (
    | { readonly claim: "seat"; readonly run: Run<Schema, { readonly subject: SubjectSession; readonly seats: readonly Seat[] }, Value> }
    | { readonly claim: "record"; readonly run: Run<Schema, { readonly subject: SubjectSession }, Value> }
    | ({
        readonly claim: "account";
        readonly run: Run<Schema, { readonly subject: SubjectSession; readonly served: JudgedSession }, Value>;
      } & Held<Schema>)
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
  // A season narrowed, or a club a replacement took out of it, since the page offering the Stufe or the row's return was read.
  "kader_stufe_not_allowed",
  "kader_team_not_in_saison",
  // A role given away since the page offering the row's return was read, which the reloaded page locks. The save, whose
  // box this code stands on, words it itself.
  "kader_rolle_taken",
  "wiring_unsupported",
  "wiring_seed_past_the_opening_round",
  "wiring_gruppe_not_run",
  // A club's entry and group move, and its retiring, each of which the Teams pages and an application's decision close off
  // their own read before it is pressed: the season, its groups or the club's seasons moved since the page was served.
  "entry_saison_not_future",
  "entry_gruppe_not_offered",
  "entry_gruppe_full",
  "entry_gruppe_locked",
  "retire_blocked",
  // A seat's fresh link, which the team editor offers only to a seat waiting on its answer.
  "kontakt_seat_without_confirmation",
  "kontakt_row_without_saison",
  "role_not_held",
  // A consent's choices moved since the page was served.
  "choices_stale",
  // A grant offered on a record that since takes a withdrawal alone.
  "giving_not_allowed",
  // A choice moved onto a grant under a label reworded since the page was served.
  "grant_wording_stale",
  // An act on an administrator or on what waits, each of which Administratoren closes off its own read before it is
  // pressed: the owner role, the list or the change moved since the page was served.
  "grant_only_owner",
  "grant_owner",
  "grant_handover_waiting",
  "grant_not_in_effect",
  // The address holds nothing a change moves, its records erased since the page was served.
  "address_change_nothing",
  // A running change ended, or a newer one replaced it, since the list offering its acts was read.
  "address_change_ended",
  // A team's refusals, which a screen setting no team meets only where the fixture changed under it; a screen
  // setting one words them as its own.
  "ergebnis_side_emptied",
  "spieltag_occupied",
  "eligibility_team_not_in_saison",
  // A fixture's confirmation answered, closed or left by its fixture since the page offering an act on it was read.
  "ansetzung_not_enterable",
  "ansetzung_not_discardable",
  "ansetzung_not_adoptable",
  "ansetzung_foreign_row",
  // A team's or a referee's own answer to a fixture someone answered first, the league closed or decided, or the
  // fixture left, or one pressed past the deadline on a page read before it.
  "ansetzung_answered",
  "ansetzung_closed",
  "ansetzung_decided",
  "ansetzung_changed",
  "ansetzung_deadline_past",
  // A registration's stored person named or renamed since the list offering its admission was read.
  "registrierung_person_not_named",
  // A rule the screen does not word, its input holding every rule the API publishes: the page is older than the API.
  "payload_refused",
  "body_unreadable",
  // A contact's link answered in another window, or its season row closed, since the page was served.
  "bewerbung_seat_already_answered",
  "kontakt_saison_past",
  // An application decided, or its seats or its season moved, since the page offering its decision was read.
  "bewerbung_already_decided",
  "bewerbung_kontakte_unconfirmed",
  // A unique index answering a write the page's read let through, with no field to place it on: another press got there first.
  "duplicate_key",
  // A season's dates, rules, draw, swap, replacement and links, each of which the season editor closes off its own read
  // before it is pressed: the season moved since the page was served.
  "saison_start_taken_place",
  "rules_saison_started",
  "rules_shape_after_spielplan",
  "spielplan_already_drawn",
  "spielplan_spieltage_held",
  "spielplan_replace_outside_its_window",
  "spielplan_undraw_outside_its_window",
  "spielplan_berichte_submitted",
  "swap_not_a_swap",
  "swap_saison_started",
  "swap_sides_taken_place",
  "replace_sides_taken_place",
  "replace_saison_started",
  "replace_incoming_already_entered",
  "replace_one_team_on_both_ends",
  // The replacement's incoming club retired since the page listed it, which lists none retired.
  "team_retired",
  "invitation_team_not_entered",
  // The application's window shut, or its picked club went, since the form was read.
  "bewerbung_window_closed",
  "bewerbung_picked_team_unusable",
  // A referee's fresh link, which the editor offers only to a live entry with an address and no answer yet: the
  // referee moved since the page was served.
  "schiedsrichter_retired",
  "confirmation_exists",
  "schiedsrichter_no_address",
  // A confirmed referee's address, which the editor shows read-only: only a page read before the confirmation sends it.
  "schiedsrichter_address_only_per_change",
  // A referee who has not confirmed, whom the match editor offers only as a closed choice.
  "booking_unconfirmed_schiedsrichter",
]);

/**
 * The admin guard's refusals: an ended sign-in and a gone grant each in the words of what holds, and a grant the backend
 * left unread, an outage nothing the person does repairs, as every other failure.
 */
const TURNED_AWAY: Readonly<Record<AdminRefusal, Copy>> = {
  signIn: COPY.shared.failure.signInExpired,
  noGrant: COPY.shared.failure.accessGone,
  grantGone: COPY.shared.failure.accessGone,
  unread: COPY.shared.failure.unexpected,
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

/** A posted form as an object, each box under its name, a name posted twice keeping its last value. */
const posted = (raw: unknown): unknown => (raw instanceof FormData ? Object.fromEntries(raw) : raw);

/**
 * A refused path as the box it belongs to: `key`, the box's own, the path's names and indices joined by dots;
 * `declared`, the path a lane declares it by, `*` standing for each index; and `rows`, those indices in order.
 */
type Box = { readonly key: string; readonly declared: string; readonly rows: readonly number[] };

/**
 * The box an issue belongs to. A list's box holds every item, so the indices at a path's end go: `stufen.1` is the
 * list `stufen`'s, as the list's own refusal is. An index with a name after it stays, `scorers.2.minute` being the
 * minute of the list's third row and no other's. Keyed by the whole path, two leaves sharing a last name,
 * `team1.tore` and `team2.tore`, stay two boxes.
 */
function fieldOf(path: readonly PropertyKey[]): Box | undefined {
  const key: string[] = [];
  const declared: string[] = [];
  const rows: number[] = [];
  // Indices wait for the name after them, which alone makes them a row's.
  let waiting: number[] = [];
  for (const segment of path) {
    if (typeof segment === "number" && key.length > 0) {
      waiting.push(segment);
      continue;
    }
    if (typeof segment !== "string") break;
    key.push(...waiting.map(String), segment);
    declared.push(...waiting.map(() => EVERY_ROW), segment);
    rows.push(...waiting);
    waiting = [];
  }
  return key.length === 0 ? undefined : { key: key.join("."), declared: declared.join("."), rows };
}

/** A declared box as the one a refusal lands on: each `*` takes the row the refused path names at its place. */
function inRows(box: string, rows: readonly number[]): string | undefined {
  const left = [...rows];
  const segments = box.split(".").map((segment) => (segment === EVERY_ROW ? left.shift() : segment));
  return segments.includes(undefined) ? undefined : segments.join(".");
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
      const example = field === undefined ? undefined : examples[field.declared];
      const line = fieldMessage(issue, example === undefined ? {} : { [path.map(String).join(".")]: example });
      // The first issue on a box is the one it shows.
      if (field !== undefined) fieldErrors[field.key] ??= line;
      return line;
    },
  });
  if (result.success) return { input: result.data };

  const unplaced = result.error.issues.some((issue) => {
    const field = fieldOf(issue.path);
    return field === undefined || fieldErrors[field.key] === undefined;
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
    const shown = field === undefined ? undefined : declared.paths?.[field.declared];
    const box = field === undefined || shown === undefined ? undefined : inRows(shown, field.rows);
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

/** A sentence filled from the bounds its refusal carries, as `ruleMessage` fills a phrase: `undefined` where one is missing. */
type BoundedSentence = (context: FLRefusedField["ctx"]) => Copy | undefined;

/** One `SERVER_COPY.refusalLine` entry, of any of the three shapes its docstring names. */
type LineEntry = Copy | Readonly<Record<string, Copy>> | BoundedSentence;

/**
 * A code's sentence for the field it names: the code's one sentence, the sentence its bounds fill, or, where its entry
 * is keyed by the field, the one for the path's first name. `undefined` where the entry holds none for it.
 */
function sentenceOf(code: Code & keyof typeof SERVER_COPY.refusalLine, refused: FLRefusedField | undefined): Copy | undefined {
  return sentenceIn(SERVER_COPY.refusalLine[code], refused);
}

/** Apart from `sentenceOf`, whose read of the catalogue would narrow the entry to the shapes it holds today. */
function sentenceIn(entry: LineEntry, refused: FLRefusedField | undefined): Copy | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry === "function") return entry(refused?.ctx ?? {});
  const [head] = refused?.path ?? [];
  return typeof head === "string" && Object.hasOwn(entry, head) ? entry[head] : undefined;
}

/**
 * A refusal this screen words: a refused payload's broken rules where the screen words every one, a code's phrase on
 * the box of each field it names, filled from the bounds the refusal carries where its pattern names them, or a code's
 * sentence on the status line. `undefined` where the screen does not word it or cannot place it.
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
    const reason = sentenceOf(code, fields[0]);
    return reason === undefined ? undefined : { ok: false, errorCode: code, reason };
  }
  // A phrase naming the bounds the refusal carries on each field it names, worded as a rule's phrase is.
  if (isBoundedCode(code)) {
    return placed(
      declared,
      code,
      fields.map(({ path, ctx }) => ({ path, ...ruleMessage({ kind: code, ctx, path }) })),
    );
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
function turnedAwayPerson(operation: string, refusal: "no_session" | "no_seat"): ActionAnswer<never> {
  logRefused(operation, refusal);
  return { ok: false, reason: refusal === "no_session" ? COPY.shared.failure.signInExpired : COPY.shared.failure.stale };
}

/**
 * An act whose recorded actor is not the address its page was drawn for: the page's own session ended and the browser
 * holds another account's now, a touch's sign-in or any other, so the act would run as that account. Answered as the
 * page's sign-in ended, which is what happened to it. `undefined` where the two are one address.
 */
function anotherHolder(input: unknown): ActionAnswer<never> | undefined {
  // `Held` declares the touch and the account's claim only over an input carrying the holder.
  const { holder } = input as { readonly holder: string };
  return asSignInIdentifier(holder) === getRequestActor()?.email ? undefined : { ok: false, reason: COPY.shared.failure.signInExpired };
}

/**
 * Past a lane's guard: the touch it declares, judged on the actor the guard recorded, the parse, the holder a touched
 * act's or an account act's input names, then `run` on the input, in that order.
 */
async function admitted<Schema extends z.ZodType, Value>(
  lane: Lane<Schema, Value>,
  raw: unknown,
  run: (input: z.output<Schema>) => Promise<ActionAnswer<Value>>,
): Promise<ActionAnswer<Value>> {
  const touched = "passkey" in lane && lane.passkey === true;
  if (touched && !(await passesPasskeyTouch(getRequestActor()))) return { ok: false, reason: COPY.signIn.refusal.touchMissing };
  const read = parsed(lane, raw);
  if ("answer" in read) return read.answer;
  const held = touched || (lane.lane === "person" && lane.claim === "account");
  return (held ? anotherHolder(read.input) : undefined) ?? run(read.input);
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
      return admitted(lane, raw, (input) => body(lane, () => lane.run(input, undefined)));
    }
    case "person": {
      const subject = await getSubjectSession();
      if (subject === null) return turnedAwayPerson(lane.name, "no_session");
      switch (lane.claim) {
        case "record":
          return admitted(lane, raw, (input) => body(lane, () => lane.run(input, { subject })));
        case "account": {
          const served = await getAccountSession();
          if (served === null) return turnedAwayPerson(lane.name, "no_session");
          return admitted(lane, raw, (input) => body(lane, () => lane.run(input, { subject, served })));
        }
        case "seat":
          return admitted(lane, raw, (input) => {
            // A request can hand an action anything at all, so the claim is read as possibly absent.
            const { team_id: team, saison_id: saison } = (input ?? {}) as Partial<SeatClaim>;
            const seats =
              typeof team === "string" && typeof saison === "string"
                ? rolesOf(subject).roles.filter((role) => isSeatAt(role, team, saison))
                : [];
            if (seats.length === 0) return Promise.resolve(turnedAwayPerson(lane.name, "no_seat"));
            return body(lane, () => lane.run(input, { subject, seats }));
          });
      }
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
  // An async function, as Next defines a server action, though its check at runtime sees only a function.
  return async (raw) => runWithIncomingTrace(() => answered(lane, raw));
}

/**
 * The lane, its guards' own failures answered as the unexpected failure, as the body answers its own: a guard whose
 * lookup the backend could not answer has written nothing, while the browser's catch of a thrown action reads the page
 * again as though the press may have landed (`fl_frontend/src/kit/useFormAction.ts :: answering`).
 */
async function answered<Schema extends z.ZodType, Value>(lane: Lane<Schema, Value>, raw: unknown): Promise<ActionAnswer<Value>> {
  try {
    return await guarded(lane, raw);
  } catch (error) {
    unstable_rethrow(error);
    logFailure(lane.name, error);
    return UNEXPECTED;
  }
}
