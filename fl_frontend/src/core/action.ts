import "server-only";

import { revalidateTag, updateTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { z } from "zod";

import { getAccountSession, judgeAdminRequest, passesPasskeyTouch } from "./auth/guards";
import { COPY } from "./copy/shared";
import { asSignInIdentifier, KONTAKT_EMAIL_MAX_LENGTH } from "./emailAddress";
import { APIBadStatusError, asRefusal, loggedByBackend, requestOf } from "./errors";
import { FieldCode } from "./generated/client/types";
import { logger } from "./logging";
import { ownKeyOf } from "./ownKeyOf";
import { logRefused } from "./refused";
import { getRequestActor, markDryRun, requestWriteMayStand } from "./requestScope";
import { phraseOf, sentenceOf } from "./ruleMessage";
import { SITE_CACHE_TAG } from "./siteCache";
import { getSubjectSession } from "./subject";
import { runWithIncomingTrace } from "./traceScope";
import { turnstileRefusal } from "./turnstile";
import { TURNSTILE_FIELD } from "./turnstileToken";
import { fieldMessage } from "./zodGerman";

import type { AdminRefusal, JudgedSession } from "./auth/guards";
import type { Words as CatalogueWords, Copy } from "./copy";
import type { ServedField } from "./errors";
import type { Code, FLRefusedField } from "./generated/client/types";
import type { SubjectSession } from "./subject";

/**
 * What a server action answers a form, as `action` builds it and the kit's `useFormAction` reads it: done, with
 * what the page needs next and, where the write did more than the form asked, the line saying so; or not done,
 * with each field's message by the field's `name`, the kind of the fault each box shows (`kinds`), the one line the
 * status line shows, and the backend's code where the backend refused. A refusal the catalogue words brings its reason,
 * every other refusal of the request the stale-page line, an ended session the sign-in line, an outage or a fault the
 * shared failure line; a refusal for its fields alone leaves the line to the form. Only the builder places a box's
 * message, so a lane's body answers its own faults through `fault` (`LaneAnswer`). `warn` marks an act that partly
 * happened, its note or its reason read in the warn tone: neither a clean save nor a refusal that left everything as it
 * stood. `done` is the done word of the act the answer did where that is not the one its press names, such as a decline
 * answered from an admission's dialog, and stands in for the press's own. `closed` marks an act whose passkey sheet the
 * person, or the browser on their behalf, closed: it never ran, and nothing is said of it.
 */
export type ActionAnswer<Value = undefined> =
  | Done<Value>
  | ({
      ok: false;
      fieldErrors?: Readonly<Record<string, Copy>>;
      /** The kind of the fault each box's message words, by the box: a backend code or rule, or `required`. */
      kinds?: Readonly<Record<string, FLRefusedField["kind"]>>;
    } & Said);

type Done<Value> = { ok: true; value: Value; note?: Copy; done?: Copy; warn?: true };

/** What a refusal says beside its boxes, a lane's own included. */
type Said = { reason?: Copy; errorCode?: Code; ask?: SaveQuestion; warn?: true; closed?: true };

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

/**
 * What every lane declares: its name for the failure line, its input's schema, and where its refusals are placed. The
 * catalogue words a refusal, never the screen: each fault's field phrase, by its own kind, lands on the box its
 * refused path stands for here (`boxes`, `paths`), and a fault whose field this screen shows no box for, or whose kind
 * no phrase words, takes its kind's sentence on the status line (`placed`). A refusal no fault of which the catalogue
 * words here answers as every code the catalogue does not word does (`refused`).
 */
type Declared<Schema extends z.ZodType> = {
  readonly name: string;
  /** The generated request schema, or a draft built from its fields, so every published bound holds the input. */
  readonly input: Schema;
  /**
   * The boxes this screen shows, by their names, a box's being its input's path joined by dots (`fieldOf`). A refusal
   * whose path names one lands on it. A row's field is declared once for every row, `*` standing where the index does,
   * `"changes.scorers.*.minute"`, and a refusal naming row 2 lands on row 2's box. An editor's input declares its boxes
   * itself: each field of its `changes` is a box, and a refused path naming one lands on `changes.<path>` undeclared
   * here. A field the form carries unseen, a record's id, a page's token, its version or the replay key, is none: a
   * phrase has no subject but its box, so a refusal only a phrase words, about a field this screen does not show, is not
   * its own, and a row's refusal never falls back to its list's box.
   */
  readonly boxes?: readonly Field<z.output<Schema>>[];
  /**
   * The box showing a field pattern's phrase where the backend names the refused field by another path than the box's
   * name, by that path: a box standing for a whole group, or an editor's box named otherwise than the write names its
   * field. An editor's box named for the write's own path needs no entry (`boxes`). A row's field is declared as
   * `boxes` declares it, `*` on both sides, `"bericht.scorers.*.minute": "changes.scorers.*.minute"`.
   */
  readonly paths?: { readonly [path: string]: Field<z.output<Schema>> };
  /** The example a box's „Format: …“ message names, by the box; a row's field names it for every row. */
  readonly examples?: { readonly [F in Field<z.output<Schema>>]?: Copy };
};

/** The kind of a box the lane's own judge finds empty where the save needs it, worded as the parse words an empty box. */
const REQUIRED = "required";

/**
 * A fault a lane's own judge finds on a box, by the box's key as the parse keys its issues (`fieldOf`): a backend field
 * code, or `required` for a box left empty that the save needs once another value is set. Only a judge the backend
 * cannot run builds one: a check against the sign-in store, which the backend cannot see, or a rule over the stored
 * record merged with an editor's changes, which the input alone does not hold; and the lane that built the entries a
 * backend fault names by index, which alone knows the row each index stands for.
 */
export type Fault = { readonly box: string; readonly kind: FieldCode | typeof REQUIRED; readonly ctx: FLRefusedField["ctx"] };

/** A fault on `box`, worded by `kind`'s phrase from the bounds `ctx` holds, as the builder words the backend's. */
export const fault = (box: string, kind: FieldCode | typeof REQUIRED, ctx: FLRefusedField["ctx"] = {}): Fault => ({ box, kind, ctx });

/**
 * What a lane's body answers: done, a refusal of its own naming no box, or its faults, which the builder words and
 * places as it places the backend's. A body never words a box: `fieldErrors` and `kinds` are the builder's alone, so a
 * body handing either back, a value built elsewhere included, fails the type check.
 */
// One refusal arm, its faults optional: a second arm for the faults would cost every body's `{ ok: true }` its literal.
export type LaneAnswer<Value = undefined> =
  Done<Value> | ({ ok: false; fieldErrors?: never; kinds?: never; faults?: readonly (Fault | ServedField)[] } & Said);

/**
 * A lane's faults, each placed by the builder, beside the backend's code where a backend refusal joined them: what a
 * lane's helper answers where it finds any.
 */
export type Faulted = { ok: false; faults: readonly (Fault | ServedField)[]; errorCode?: Code };

/**
 * A lane's own faults beside the backend's refusal of the same press, as one answer naming every fault, where the
 * backend refused fields: a check of the sign-in store on a dry run, which the backend's own faults join. A backend
 * refusal naming no field, a gate, stands alone, since no field means anything past it, and so does any other failure:
 * both are thrown on, as they were thrown.
 */
export function besideRefusal(faults: readonly Fault[], failed: unknown): Faulted {
  const refusal = asRefusal(failed);
  const code = refusal?.serverErrorCode;
  const ofFields = code === "payload_refused" || (code !== undefined && ownKeyOf(FieldCode, code));
  if (faults.length === 0 || refusal === null || !ofFields || refusal.refusedFields.length === 0) throw failed;
  return { ok: false, errorCode: code, faults: [...refusal.refusedFields, ...faults] };
}

type Run<Schema extends z.ZodType, Context, Value> = (input: z.output<Schema>, context: Context) => Promise<LaneAnswer<Value>>;

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

/** A checkbox read as yes or no: a ticked box posts „on“, an unticked or unoffered one nothing. */
export const ticked = z.preprocess((value) => value === "on", z.boolean());

/** Declarable only over an input carrying `PAGE_HOLDER`, so no such act is posted without it. */
type Held<Schema extends z.ZodType> = z.output<Schema> extends { readonly holder: string } ? unknown : never;

/**
 * The passkey touch, which an act on its fixed list declares, on the administration's lane or the account's claim: the
 * browser asks it on every final press, and the act runs only on a session a passkey sign-in made within
 * `PASSKEY_TOUCH_SECONDS`, for an administrator, and only for the address its page was drawn for; an address holding no
 * grant passes. On the account's claim the touch's whole strength rests on `served.isAdmin` being the grant read on
 * this request, which the account's guard throws on rather than answer unread as none.
 */
type Touched<Schema extends z.ZodType> =
  | { readonly passkey?: never; readonly dryRun?: never }
  | ({
      readonly passkey: true;
      /**
       * A touched write's dry run, which a lane over a backend `dry_run` judged by the write's own code path declares:
       * the kit sends the act once as its dry run before it asks the touch, so a refusal stands on its field with the
       * input kept, and asks the touch only once the dry run passed. The body hands its context's `dryRun` to the
       * backend call and skips every effect of its own on it, since a declared dry run passes no touch, save one that
       * takes access away from an address its refusal shows has already lost it, as the ban's ending of a listed
       * address's sessions does; the guard, the parse and the holder are judged on it as on the write. A lane declaring
       * none is told `false` on every call, its touch judged on each.
       */
      readonly dryRun?: true;
    } & Held<Schema>);

/** What the body of a lane that may declare a dry run is told beside its context: whether this call is the dry run. */
type DryRunContext = { readonly dryRun: boolean };

/** An administrator's write: the administrator's guard admits the caller before anything else runs. */
type AdminLane<Schema extends z.ZodType, Value> = Declared<Schema> &
  Touched<Schema> & {
    readonly lane: "admin";
    readonly run: Run<Schema, DryRunContext, Value>;
  };

/** What the account's guard hands an act of the account: the person, and the session it judged. */
type AccountContext = { readonly subject: SubjectSession; readonly served: JudgedSession };

/**
 * A person's write, by the claim it makes: a record of the person's own, a seat's write on its club among them, which
 * the backend authorises in its transaction; or an act only Konto's pages reach, which the account's own guard admits
 * too, handing the body the session it judged, so a session an administrator's mailbox made changes nothing of that
 * administrator's account, their consents among it. An act of the account runs only for the address its page was drawn
 * for.
 */
type PersonLane<Schema extends z.ZodType, Value> = Declared<Schema> & { readonly lane: "person" } & (
    | {
        readonly claim: "record";
        // A record's claim judges no grant, which the touch rests on.
        readonly passkey?: never;
        readonly run: Run<Schema, { readonly subject: SubjectSession }, Value>;
      }
    | ({
        readonly claim: "account";
        readonly run: Run<Schema, AccountContext & DryRunContext, Value>;
      } & Touched<Schema> &
        Held<Schema>)
  );

/**
 * Why a public write needs no bot check, by the name its lane declares: one sentence a reason, saying why a script
 * choosing what it sends gains nothing there. The names are the only exemptions a lane can declare. A type rather than
 * a value, since only the builder's type reads it.
 */
type Exemptions = {
  readonly mailedLink: "The link's token is the whole credential, minted for one mailbox and spent by its answer or its stop.";
};

/**
 * A write anybody may send: the bot check answers before anything of the input is read, or the lane names why a
 * script choosing what it sends gains nothing here, never both.
 */
type PublicLane<Schema extends z.ZodType, Value> = Declared<Schema> & {
  readonly lane: "public";
  readonly run: Run<Schema, undefined, Value>;
} & ({ readonly botCheck: true; readonly exempt?: never } | { readonly exempt: keyof Exemptions; readonly botCheck?: never });

type Lane<Schema extends z.ZodType, Value> = AdminLane<Schema, Value> | PersonLane<Schema, Value> | PublicLane<Schema, Value>;

/**
 * Every code that is no refusal of what the request asked: a credential the request lacked, a route or a method the API
 * does not serve, the store failing, the server failing, and a write whose outcome is unknown. Each answers the shared
 * failure line, since reading the page again repairs none of them, and is judged by its code alone, whatever the
 * status it came with. A refused payload and an unreadable body, which mean a page older than the API, a record gone or
 * a version raised since the page was read, and every other code the catalogue does not word answer the stale-page
 * line.
 */
const NOT_A_REFUSAL: ReadonlySet<Code> = new Set<Code>([
  "access_key_refused",
  "missing_actor",
  "session_refused",
  "no_route",
  "method_not_served",
  "database_failed",
  "unknown_outcome",
  "unhandled_crash",
  "stored_data_invalid",
]);

/**
 * The admin guard's refusals: an ended sign-in and a missing grant each in the words of what holds, and a grant the
 * backend left unread, an outage nothing the person does repairs, as every other failure.
 */
const TURNED_AWAY: Readonly<Record<AdminRefusal, Copy>> = {
  signIn: COPY.shared.failure.signInExpired,
  noGrant: COPY.shared.failure.accessGone,
  unread: COPY.shared.failure.unexpected,
};

const UNEXPECTED = { ok: false, reason: COPY.shared.failure.unexpected } as const;

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

/**
 * The fields a page fills from the build that drew it, which no box shows: a consent press's labels, naming the words
 * the page shows. The parse refusing one means a deploy moved those words since the page was drawn, so the press is
 * answered as a stale page, and the page read again shows the words the labels now name.
 */
const BUILT_INTO_THE_PAGE: ReadonlySet<PropertyKey> = new Set(["text_versions"]);

/**
 * A posted form with the labels its page drew with, which it carries unseen under `text_versions.scope` and
 * `text_versions.media`, nested as a consent's write names them: a label missing or no longer current then fails the
 * parse on `text_versions`, which answers as a stale page before anything is sent.
 */
export const withPostedLabels = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null) return raw;
  const form = raw as Readonly<Record<string, unknown>>;
  return { ...form, text_versions: { scope: form["text_versions.scope"], media: form["text_versions.media"] } };
};

/** A declared box as the one a refusal lands on: each `*` takes the row the refused path names at its place. */
function inRows(box: string, rows: readonly number[]): string | undefined {
  const left = [...rows];
  const segments = box.split(".").map((segment) => (segment === EVERY_ROW ? left.shift() : segment));
  return segments.includes(undefined) ? undefined : segments.join(".");
}

/**
 * The input parsed, or the answer placing each refusal on its box. Each box's line is the German error map's, asked
 * per parse: the map reads the raw issue's input and schema, which a finished parse's issues no longer carry. An
 * issue on a field built into the page is the stale page (`BUILT_INTO_THE_PAGE`), and one naming no box, or one a
 * schema's own message words past the map, the unexpected failure.
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
  if (result.error.issues.some(({ path: [head] }) => head !== undefined && BUILT_INTO_THE_PAGE.has(head))) {
    return { answer: { ok: false, reason: COPY.shared.failure.stale } };
  }

  const unplaced = result.error.issues.some((issue) => {
    const field = fieldOf(issue.path);
    return field === undefined || fieldErrors[field.key] === undefined;
  });
  return { answer: unplaced ? UNEXPECTED : { ok: false, fieldErrors } };
}

/** The object an editor's input holds its boxes in, each under its name. */
const CHANGES = "changes";

/**
 * Whether a schema holds a field at a declared path, as `fieldOf` declares it: a name may hold dots of its own, as an
 * editor's box named for the write's path does (`rules.win_points`), and `*` stands for each row of a list. It walks
 * the schemas' definitions, as Zod's core documents for a tool traversing schemas; a wrapper, a pipe's two ends and a
 * union's options each hold what their inner schemas hold.
 */
function holds(schema: z.core.$ZodType, path: string): boolean {
  const def = (schema as z.core.$ZodTypes)._zod.def;
  switch (def.type) {
    case "object":
      return Object.entries(def.shape).some(
        ([name, field]) => path === name || (path.startsWith(`${name}.`) && holds(field, path.slice(name.length + 1))),
      );
    case "array":
      return path.startsWith(`${EVERY_ROW}.`) && holds(def.element, path.slice(EVERY_ROW.length + 1));
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "nonoptional":
    case "readonly":
    case "catch":
      return holds(def.innerType, path);
    case "pipe":
      return holds(def.in, path) || holds(def.out, path);
    case "union":
      return def.options.some((option) => holds(option, path));
    default:
      return false;
  }
}

/**
 * The box a refused path stands for, both as `fieldOf` declares them: the box `paths` renames it to, else the path's own
 * box where the screen shows it, as `boxes` declares, else the editor's box of that name, where the input's `changes`
 * holds one. `undefined` for a field the screen shows no box for, such as one its form carries unseen.
 */
function boxFor<Schema extends z.ZodType>(declared: Declared<Schema>, path: string): string | undefined {
  const renamed: string | undefined = declared.paths?.[path];
  if (renamed !== undefined) return renamed;
  if (declared.boxes?.some((box) => box === path) ?? false) return path;
  const change = `${CHANGES}.${path}`;
  return holds(declared.input, change) ? change : undefined;
}

/** A fault's box on this screen: a lane's own by its key, a backend fault's where `boxFor` finds its path, else none. */
function boxOf<Schema extends z.ZodType>(declared: Declared<Schema>, refused: Fault | ServedField): string | undefined {
  if ("box" in refused) return refused.box;
  const field = fieldOf(refused.path);
  const shown = field === undefined ? undefined : boxFor(declared, field.declared);
  return field === undefined || shown === undefined ? undefined : inRows(shown, field.rows);
}

/** A fault as the catalogue words it, by its own kind, a lane's naming its field by the path its box's key spells. */
const asWorded = (refused: Fault | ServedField) =>
  "box" in refused ? { kind: refused.kind, ctx: refused.ctx, path: refused.box.split(".") } : refused;

/**
 * Every fault of one refusal where this screen shows it, each worded by its own kind: its field phrase on the box its
 * field stands for, else its sentence on the status line, so a fault on a field this screen shows no box for, such as
 * the adoption's of a fixture it moves from a row, still says what it can, and the answer keeps every fault it placed.
 * The first phrase a box meets is the one it shows, and the first sentence the one the line shows; a fault with
 * neither leaves the line to the stale-page line, the page read again showing the record as it stands. `undefined`
 * where the catalogue words none of them here.
 */
function placed<Schema extends z.ZodType>(
  declared: Declared<Schema>,
  code: Code | undefined,
  refusals: readonly (Fault | ServedField)[],
): ActionAnswer<never> | undefined {
  const fieldErrors: Record<string, Copy> = {};
  const kinds: Record<string, FLRefusedField["kind"]> = {};
  let reason: Copy | undefined;
  let unworded = false;
  for (const refused of refusals) {
    const box = boxOf(declared, refused);
    const worded = asWorded(refused);
    const phrase = refused.kind === REQUIRED ? COPY.shared.field.required : phraseOf(worded);
    if (box !== undefined && phrase !== undefined) {
      if (fieldErrors[box] === undefined) {
        fieldErrors[box] = phrase;
        kinds[box] = refused.kind;
      }
      continue;
    }
    const sentence = sentenceOf(worded);
    if (sentence === undefined) unworded = true;
    reason ??= sentence;
  }
  if (Object.keys(fieldErrors).length === 0 && reason === undefined) return undefined;
  const line = reason ?? (unworded ? COPY.shared.failure.stale : undefined);
  return {
    ok: false,
    ...(code === undefined ? {} : { errorCode: code }),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors, kinds } : {}),
    ...(line === undefined ? {} : { reason: line }),
  };
}

/**
 * A refusal in the catalogue's words where this screen can place them: each fault it names, by its own kind
 * (`placed`), a refused payload's broken rules as a judge's codes; or, for a gate naming no field, its code's sentence
 * on the status line. `undefined` where the catalogue does not word it or this screen cannot place it.
 */
function worded<Schema extends z.ZodType>(
  declared: Declared<Schema>,
  code: Code,
  fields: readonly ServedField[],
): ActionAnswer<never> | undefined {
  if (fields.length > 0) return placed(declared, code, fields);
  const reason = sentenceOf({ kind: code, ctx: {}, path: [] });
  return reason === undefined ? undefined : { ok: false, errorCode: code, reason };
}

/**
 * A lane's answer as the form reads it: its own faults worded and placed as the backend's are, its code the first
 * code among them; any other answer as it came. Faults this screen words none of answer the stale-page line.
 */
function settled<Schema extends z.ZodType, Value>(declared: Declared<Schema>, answer: LaneAnswer<Value>): ActionAnswer<Value> {
  if (answer.ok || answer.faults === undefined) return answer;
  const code = answer.errorCode ?? answer.faults.map(({ kind }) => kind).find((kind): kind is FieldCode => kind !== REQUIRED);
  return (
    placed(declared, code, answer.faults) ?? {
      ok: false,
      ...(code === undefined ? {} : { errorCode: code }),
      reason: COPY.shared.failure.stale,
    }
  );
}

/**
 * The backend's refusal in the catalogue's words wherever this screen places them; else the shared failure line for a
 * code that refuses nothing the request asked (`NOT_A_REFUSAL`), and the stale-page line for every other: the screen
 * offered what the API now refuses, so the page read again shows the record as it stands.
 */
function refused<Schema extends z.ZodType>(declared: Declared<Schema>, code: Code, fields: readonly ServedField[]): ActionAnswer<never> {
  const answer = worded(declared, code, fields);
  if (answer !== undefined) return answer;
  // The grant went between the guard's read and the backend's.
  if (code === "actor_not_admin") return { ok: false, errorCode: code, reason: COPY.shared.failure.accessGone };
  return { ok: false, errorCode: code, reason: NOT_A_REFUSAL.has(code) ? COPY.shared.failure.unexpected : COPY.shared.failure.stale };
}

/**
 * Logged by name alone, an action's callee may throw with a submitted value in its message; a failure the backend
 * answered is its own line's, so it is written once.
 */
function logFailure(name: string, error: unknown): void {
  if (loggedByBackend(error)) return;
  logger.error("action.failed", undefined, { action: name, name: error instanceof Error ? error.name : "unknown", ...requestOf(error) });
}

/** A person with no session turned away, logged as a page's turn-away is. */
function turnedAwayPerson(operation: string): ActionAnswer<never> {
  logRefused(operation, "no_session");
  return { ok: false, reason: COPY.shared.failure.signInExpired };
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
 * Past a lane's guard: the touch it declares, judged on the actor the guard recorded and on `granted`, the grant the
 * guard read for that address, unless `dryRun` says this call is the dry run the lane declares, which writes nothing;
 * then the parse, the holder a touched act's or an account act's input names, then `run` on the input, in that order.
 */
async function admitted<Schema extends z.ZodType, Value>(
  lane: Lane<Schema, Value>,
  raw: unknown,
  granted: boolean,
  dryRun: boolean,
  run: (input: z.output<Schema>) => Promise<LaneAnswer<Value>>,
): Promise<ActionAnswer<Value>> {
  const touched = "passkey" in lane && lane.passkey === true;
  if (touched && !dryRun && !passesPasskeyTouch(getRequestActor(), granted)) return { ok: false, reason: COPY.shared.touchMissing };
  const read = parsed(lane, raw);
  if ("answer" in read) return read.answer;
  const held = touched || (lane.lane === "person" && lane.claim === "account");
  return (held ? anotherHolder(read.input) : undefined) ?? settled(lane, await run(read.input));
}

/**
 * The lane's guard, the touch it declares, the parse and the body, in that order: no part of the input is read before
 * the guard admits. `asked` is the caller's second argument, a dry run only where it is `true` and the lane declares
 * one, so no other call skips a touch.
 */
async function guarded<Schema extends z.ZodType, Value>(lane: Lane<Schema, Value>, raw: unknown, asked: unknown): Promise<ActionAnswer<Value>> {
  // `in` first: a public lane declares no touch, so its type names no `dryRun`.
  const dryRun = asked === true && "dryRun" in lane && lane.dryRun === true;
  if (dryRun) markDryRun();
  switch (lane.lane) {
    case "admin": {
      const judged = await judgeAdminRequest();
      if ("refused" in judged) return { ok: false, reason: TURNED_AWAY[judged.refused] };
      return admitted(lane, raw, true, dryRun, (input) => lane.run(input, { dryRun }));
    }
    case "person": {
      const subject = await getSubjectSession();
      if (subject === null) return turnedAwayPerson(lane.name);
      switch (lane.claim) {
        case "record":
          // No touch to judge: a record's claim declares none.
          return admitted(lane, raw, false, false, (input) => lane.run(input, { subject }));
        case "account": {
          const served = await getAccountSession();
          if (served === null) return turnedAwayPerson(lane.name);
          return admitted(lane, raw, served.isAdmin, dryRun, (input) => lane.run(input, { subject, served, dryRun }));
        }
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
      return "answer" in read ? read.answer : settled(lane, await lane.run(read.input, undefined));
    }
  }
}

declare const DRY_RUN_FIRST: unique symbol;

/**
 * An action whose lane declares `dryRun: true`, which the kit's touch sends first with `dryRun` true and runs only once
 * that call passed. Its mark is the type's alone, so a touched dialog's slot can demand it.
 */
export type DryRunAction<Raw, Value = undefined> = ((raw: Raw, dryRun?: boolean) => Promise<ActionAnswer<Value>>) & {
  readonly [DRY_RUN_FIRST]: true;
};

/**
 * The one way to build a server action: every export of a `"use server"` module is one of these, which the lint
 * rule `fl/server-action` holds. The action runs under the edge's trace, behind its lane's guard, on its input
 * stripped and parsed against its schema, and answers the kit's `ActionAnswer`: done, a field's message, the
 * backend's refusal with its code, or the one unexpected failure. A lane declaring a dry run builds a `DryRunAction`.
 */
export function action<Schema extends z.ZodType, Value = undefined>(
  lane: Lane<Schema, Value> & { readonly dryRun: true },
): DryRunAction<z.input<Schema> | FormData, Value>;
export function action<Schema extends z.ZodType, Value = undefined>(
  lane: Lane<Schema, Value>,
): (raw: z.input<Schema> | FormData) => Promise<ActionAnswer<Value>>;
export function action<Schema extends z.ZodType, Value>(
  lane: Lane<Schema, Value>,
): (raw: never, dryRun?: boolean) => Promise<ActionAnswer<Value>> {
  // An async function, as Next defines a server action, though its check at runtime sees only a function. The second
  // argument crosses from the browser, so it is judged as untrusted (`guarded`).
  return async (raw: unknown, dryRun?: unknown) => runWithIncomingTrace(() => answered(lane, raw, dryRun));
}

/**
 * How long a public form's failed press lets a cached read stand stale while it is read again, in seconds: past this,
 * a read waits for the fresh one. Above 0, since `{ expire: 0 }` renders the page again in the same response, as
 * `updateTag` does.
 */
const STALE_AFTER_FAILED_PRESS = 5;

/**
 * The lane and its body, answering a backend refusal by its code, a guard's lookup included, and any other throw as
 * the unexpected failure, so no throw of the server's reaches the browser, where one carrying Next's `digest` reads the
 * page again as though the press may have landed.
 *
 * Where the body sent a backend write that may have landed, the site's one cache tag is cleared, whatever the body
 * came to: the write may stand behind a throw or a lost answer, and every cached read carries the tag, so no write
 * has to know which it moves. A clean answer, and every answer of an editor or an administrator, clears it with
 * `updateTag`, which renders the page again in the same response, so a failed save shows whether it landed. A public
 * form's failed press expires the tag without that render: the form keeps its typed values and its replay key, so a
 * second press repeats the first rather than writing again. An answer whose writes were each refused, or that sent
 * none, carries only its answer and renders nothing again: a refused editor keeps what was typed into it. A body
 * changing state outside the cache, the sign-in store's, calls Next's `refresh()` itself.
 */
async function answered<Schema extends z.ZodType, Value>(
  lane: Lane<Schema, Value>,
  raw: unknown,
  dryRun: unknown,
): Promise<ActionAnswer<Value>> {
  // Set once the answer is a failure; a redirect or a not-found leaves it unset, being how a body leads on.
  let failed = false;
  try {
    const answer = await guarded(lane, raw, dryRun);
    failed = !answer.ok;
    return answer;
  } catch (error) {
    // Next's redirect and not-found pass through.
    unstable_rethrow(error);
    failed = true;
    if (error instanceof APIBadStatusError && error.serverErrorCode !== undefined) {
      return refused(lane, error.serverErrorCode, error.refusedFields);
    }
    logFailure(lane.name, error);
    return UNEXPECTED;
  } finally {
    if (requestWriteMayStand()) {
      if (lane.lane === "public" && failed) revalidateTag(SITE_CACHE_TAG, { expire: STALE_AFTER_FAILED_PRESS });
      else updateTag(SITE_CACHE_TAG);
    }
  }
}
