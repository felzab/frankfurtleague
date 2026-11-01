import { untilAnswered } from "@/test-support/answersInFlight.ts";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";

import { failureToastTitle } from "@/shared/utils/failureToastTitle.ts";

import type { AdminRefusal } from "@/core/auth.ts";
import type { SubjectSession } from "@/core/subject.ts";
import type { ActionFailure } from "@/shared/types/types.ts";
import type * as AppToastModule from "@/shared/utils/appToast.ts";

// Every double here is registered with `vi.doMock`, which reaches only the modules a suite imports
// after it: a suite calls these first and imports its subject with `await import`.

/** One write a component sent: the action's exported name, and the payload it was handed. */
export type ActionCall = { action: string; payload: unknown };

/** The modules a real action sends its writes through, whose doubles are the client's and the mailer's. */
const WRITE_MODULE = /\/(?:mutations|notifications)\.ts$|\/core\/mail\.ts$/;

/**
 * Replaces an actions module, or a read module a real action calls, at the module boundary, every
 * export recording its call: a test-only prop would be a seam in production code.
 */
export function doubleActions({
  modules,
  answer = () => Promise.resolve({ success: true, message: "Gespeichert." }),
  payloadOf = (args) => args[0],
}: {
  /** Each module to replace, by its `@/` path. */
  modules: readonly string[];
  /** What every replaced write answers, until `answerWith` names another for the rest of that case. */
  answer?: () => Promise<unknown>;
  /** The argument recorded as a call's payload: a form action under `useActionState` is handed the previous state first. */
  payloadOf?: (args: readonly unknown[]) => unknown;
}): {
  calls: ActionCall[];
  answerWith: (next: () => Promise<unknown>) => void;
  answerPending: (answer: unknown) => void;
  leavePending: (reason: string) => void;
  /** Awaited before reading what the answers set off, so every answer has landed. */
  answered: () => Promise<void>;
} {
  const calls: ActionCall[] = [];
  let answering = answer;
  const pending = new Set<{ action: string; release: (answer: unknown) => void; answered: Promise<unknown> }>();
  let mayLeavePending = false;
  // Back to `answer` before every case: a case that named another answer and never restored it
  // would otherwise hand that answer to the next case's write, which then passes on it.
  beforeEach(() => {
    answering = answer;
    mayLeavePending = false;
  });
  // A call left unanswered holds its transition past the case, where React can hold a later case's
  // transition behind it, so it fails the case that left it rather than the one it next reaches.
  afterEach(() => {
    const left = [...pending].map(({ action }) => action);
    pending.clear();
    if (!mayLeavePending) {
      expect(left, "the case left these actions pending: answer them with `answerPending`, or name why with `leavePending`").toStrictEqual([]);
    }
  });
  const answerOf = (action: string): Promise<unknown> => {
    let release: (answer: unknown) => void = () => undefined;
    // Raced rather than replaced, so a case's own held answer still decides until the case answers it.
    const answered = Promise.race([answering(), new Promise((resolve) => (release = resolve))]);
    const entry = { action, release, answered };
    pending.add(entry);
    const settle = (): void => void pending.delete(entry);
    answered.then(settle, settle);
    return answered;
  };
  const act =
    (action: string) =>
    async (...args: unknown[]): Promise<unknown> => {
      calls.push({ action, payload: payloadOf(args) });
      return answerOf(action);
    };

  for (const target of modules) {
    if (WRITE_MODULE.test(target)) {
      throw new Error(`${target} sends a write the admin spine judges its answer by; double its client with doubleApiAnswers instead`);
    }
    // Every export the real module has, each recording its call: the real module is read for its
    // names and nothing it exports is reached.
    vi.doMock(target, async (importOriginal) =>
      Object.fromEntries(Object.keys(await importOriginal<object>()).map((name) => [name, act(name)])),
    );
  }

  return {
    calls,
    answerWith: (next) => void (answering = next),
    answerPending: (answer) => {
      for (const { release } of pending) release(answer);
    },
    // A reason rather than a flag, so the case that holds a write open says at its call why it may.
    leavePending: (reason) => {
      expect(reason.trim(), "name why the case may leave its actions pending").not.toBe("");
      mayLeavePending = true;
    },
    // For a case reading only what it sent: its answers land inside it, or in the case after it.
    answered: () =>
      untilAnswered(
        () => [...pending].map(({ action, answered }) => ({ name: action, answer: answered })),
        "answer them with `answerPending` before awaiting `answered`",
      ),
  };
}

/** One invalidation a write made through `next/cache`: the export it called, and what it handed it. */
export type CacheCall = { name: string; args: unknown[] };

/** Every invalidation since the case began, `doubleActionRequest` emptying it before each case. */
export const cacheCalls: CacheCall[] = [];

const recorded = (names: readonly string[]): Record<string, (...args: unknown[]) => void> =>
  Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]): void => {
        cacheCalls.push({ name, args });
      },
    ]),
  );

/**
 * `next/cache` as a server action meets it, every invalidation recorded into `cacheCalls`, for a
 * suite that doubles its packages itself. `cacheLife` and `cacheTag` declare a cached read rather than
 * clear one, so they record nothing.
 */
export const NEXT_CACHE_DOUBLE = {
  ...recorded(["updateTag", "refresh", "revalidateTag", "revalidatePath"]),
  cacheLife: (): undefined => undefined,
  cacheTag: (): undefined => undefined,
};

/** The headers the doubled request arrived with: none, unless a suite sets the edge's own here. */
const incomingHeaders = new Headers();

/** `next/headers` for a request carrying `incomingHeaders`, for a suite that doubles its packages itself. */
export const NEXT_HEADERS_DOUBLE = { headers: () => Promise.resolve(new Headers(incomingHeaders)) };

/** One line an action logged: its level, its message, the fields beside them, and an error line's attached error. */
export type LoggedLine = { level: "debug" | "info" | "warn" | "error"; message: string; meta: unknown; attached?: unknown };

/**
 * An attached error's message and stack as thrown, before the real logger's address scrub: a suite's address check
 * over these lines is held to what the caller handed over.
 */
function writtenOf(error: unknown): unknown {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
}

/**
 * Every line logged since the case began, `doubleActionRequest` emptying it before each case. Recorded
 * rather than written: every refusal an action logs would otherwise reach the run's output as an error line.
 */
export const loggedLines: LoggedLine[] = [];

/** The request trace each line was written under, which the real logger stamps where the line's own fields name none. */
const traceOfLine = new WeakMap<LoggedLine, string | undefined>();

/** The scope's trace as the subject's own `requestScope` holds it, once the suite's imports have loaded it. */
let requestTraceId: () => string | undefined = () => undefined;

/** Reaches the request scope after the suite's own `await import`s, the instance its subject loaded. */
function readTracesOnceLoaded(): void {
  beforeAll(async () => {
    ({ getRequestTraceId: requestTraceId } = await import("@/core/requestScope.ts"));
  });
}

const logAt =
  (level: LoggedLine["level"]) =>
  (message: string, ...rest: unknown[]): void => {
    // `error` takes the thrown value before its fields, the other three their fields alone.
    const line: LoggedLine = { level, message, meta: level === "error" ? rest[1] : rest[0] };
    // Only where one was attached, so a line handed none equals its fields alone.
    if (level === "error" && rest[0] !== undefined) line.attached = writtenOf(rest[0]);
    traceOfLine.set(line, requestTraceId());
    loggedLines.push(line);
  };
const SILENT_LOGGER = { logger: { debug: logAt("debug"), info: logAt("info"), warn: logAt("warn"), error: logAt("error") } };

/** What the doubled sign-in store's `getAdminSession` answers: an administrator, nobody signed in, or a store that threw this. */
type AdminSessionDouble = { user: { email: string } } | null | Error;

/** What the doubled `getSubjectSession` answers: a person's records, no person signed in, or a lookup that threw this. */
type SubjectDouble = SubjectSession | null | Error;

/**
 * What one request's doubled sign-in store answers, until `setSession`, `setSubject` or `setFresh` names
 * another for the rest of that case.
 */
type SignInAnswers = {
  session: AdminSessionDouble;
  /**
   * What every read serves for `session`, one object as one request's reads hand over. Made at each
   * `setSession`, so a window read off its `createdAt` opens at the case's start, never the file's.
   */
  served: unknown;
  destination: string;
  subject: SubjectDouble;
  subjectReads: number;
  /** Every address a ban asked the store to sign out, in order. */
  signedOut: string[];
  /** What that sign-out throws, where a case asks it to fail. */
  signOutFailure: Error | null;
  /** Every address an erasure asked the store to delete the account of, in order. */
  deletedAccounts: string[];
  /** What that deletion throws, where a case asks it to fail. */
  accountDeletionFailure: Error | null;
  /** Whether an account holds the address a ban signs out or an erasure deletes, which the real store answers. */
  accountHeld: boolean;
  /** The folded addresses `accountStandsAt` finds an account at; none unless a case names one. */
  accountsAt: string[];
  /** `isFreshlySignedIn`'s answer, whatever session it is handed. */
  fresh: boolean;
  /** Why the guard refuses where it refuses, or `null` to read it off the landing the case named. */
  refusal: AdminRefusal | null;
};

/** Where the real store sends a caller the session leaves out, when a case names no other. */
const destinationOf = (session: AdminSessionDouble): string => (session === null ? "/signin" : "/bereich");

const answering = (answer: unknown): Promise<unknown> => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));

/**
 * The session, recorded as the request's actor where it is an administrator's, as the real
 * `getAdminSession` records it. Imported at the call, so the scope is the one the code under test loaded.
 */
async function administratorOf({ session, served }: SignInAnswers): Promise<unknown> {
  if (session !== null && !(session instanceof Error)) {
    const { setRequestActor } = await import("@/core/requestScope.ts");
    const { asSignInIdentifier } = await import("@/core/emailAddress.ts");
    // A token nobody verifies: the backend these suites reach is doubled.
    setRequestActor({ email: asSignInIdentifier(session.user.email), lane: "admin", authTime: 0, factor: "passkey" });
  }

  // Served in the real guard's shape: the admin shell reads the step-up window off the row.
  return answering(served);
}

/**
 * The guard's verdict with its reason. Nobody signed in is told apart by the landing the case named,
 * as the real guard and landing judge one session: `/bereich` is a session whose address holds no grant.
 */
async function verdictOf(answers: SignInAnswers): Promise<unknown> {
  if (answers.session === null) return { refused: answers.refusal ?? (answers.destination === "/bereich" ? "noGrant" : "signIn") };

  return { session: await administratorOf(answers) };
}

/**
 * The shape `fl_frontend/src/core/auth.ts :: getKontoSession` serves, signed in by passkey this moment:
 * a caller reading `user.id` or `session` off the bare `{ user }` would read `undefined` and pass.
 */
const servedOf = (session: AdminSessionDouble): unknown => {
  if (session === null || session instanceof Error) return session;
  const now = new Date();

  return {
    user: { id: "doubled-user", email: session.user.email },
    session: { id: "doubled-session", createdAt: now, updatedAt: now, authFactor: "passkey", passkeyCredentialId: "doubled-credential" },
  };
};

/**
 * The sign-in store answering the session and the sign-in destination `doubleActionRequest` holds,
 * replaced whole because the real one opens the database driver as it loads.
 */
const signInStore = (answers: SignInAnswers) => ({
  getAdminSession: () => administratorOf(answers),
  judgeAdminRequest: () => verdictOf(answers),
  // The account page's guard, answering the same session: its own lanes are the sign-in store's to judge.
  getKontoSession: () => answering(answers.served),
  getSignInDestination: () => Promise.resolve(answers.destination),
  // The sign-in page's read, `null` wherever the landing sends the caller to sign in, as the real one judges.
  getSignedInAddress: () =>
    answers.session instanceof Error
      ? Promise.reject(answers.session)
      : Promise.resolve(answers.session === null || answers.destination === "/signin" ? null : answers.session.user.email),
  // `null`, as the real store answers the session `served` holds: one its passkey made is offered no card.
  getPasskeyStep: () => (answers.session instanceof Error ? Promise.reject(answers.session) : Promise.resolve(null)),
  isFreshlySignedIn: () => answers.fresh,
  endSessionsOfAddress: (address: unknown) => {
    answers.signedOut.push(String(address));
    return answering(answers.signOutFailure ?? answers.accountHeld);
  },
  deleteAccountFor: (address: unknown) => {
    answers.deletedAccounts.push(String(address));
    return answering(answers.accountDeletionFailure ?? answers.accountHeld);
  },
  // Folded as the real lookup folds, so a case naming one spelling holds every other; imported at the call, for
  // `administratorOf`'s reason.
  accountStandsAt: async (address: unknown) => {
    const { asSignInIdentifier } = await import("@/core/emailAddress.ts");
    return answers.accountsAt.includes(asSignInIdentifier(String(address)));
  },
});

/**
 * The subject lookup answering what `doubleActionRequest` holds, counting every read: the real one
 * calls the sign-in store this file replaces, and reads the doubled `auth` it cannot build.
 */
const subjectLookup = (answers: Pick<SignInAnswers, "subject" | "subjectReads">) => ({
  getSubjectSession: async () => {
    answers.subjectReads += 1;
    // Recorded as the real lookup records it, so a person's admin-tier call goes out named rather than
    // refused by the client; imported at the call, for `administratorOf`'s reason.
    if (answers.subject !== null && !(answers.subject instanceof Error)) {
      const { setRequestActor } = await import("@/core/requestScope.ts");
      setRequestActor({ email: answers.subject.email, lane: "person", authTime: 0, factor: "code" });
    }

    return answering(answers.subject);
  },
});

/**
 * The request a server action runs in, so a case calls the REAL action, its `mutations.ts` doubled
 * through `doubleApiAnswers`. Called before the action's `await import`.
 */
export function doubleActionRequest({
  session = { user: { email: "vorstand@example.org" } },
  subject = null,
}: {
  /** Who the request is signed in as, until `setSession` names another for the rest of that case; `null` for nobody. */
  session?: AdminSessionDouble;
  /** What the subject lookup answers, until `setSubject` names another for the rest of that case; `null` for no person. */
  subject?: SubjectDouble;
} = {}): {
  setSession: (next: AdminSessionDouble, destination?: string) => void;
  setSubject: (next: SubjectDouble) => void;
  /** Whether the session counts as confirmed within the step-up window, for the rest of that case; confirmed by default. */
  setFresh: (next: boolean) => void;
  /** How often `getSubjectSession` was called since the case began. */
  subjectReads: () => number;
  /** Every address a ban signed out since the case began. */
  signedOut: () => readonly string[];
  /** Makes every sign-out for the rest of the case throw `failure`. */
  failSignOut: (failure: Error) => void;
  /** Every address an erasure deleted the account of since the case began. */
  deletedAccounts: () => readonly string[];
  /** Makes every account deletion for the rest of the case throw `failure`. */
  failAccountDeletion: (failure: Error) => void;
  /** Makes every sign-out and account deletion for the rest of the case find no account; an account is held by default. */
  holdNoAccount: () => void;
  /** Makes `accountStandsAt` find an account at `address`, folded, for the rest of the case. */
  holdAccountAt: (address: string) => Promise<void>;
  /** Why the guard refuses for the rest of the case, where it refuses. */
  setRefusal: (next: AdminRefusal) => void;
} {
  const answers: SignInAnswers = {
    session,
    served: servedOf(session),
    destination: destinationOf(session),
    subject,
    subjectReads: 0,
    signedOut: [],
    signOutFailure: null,
    deletedAccounts: [],
    accountDeletionFailure: null,
    accountHeld: true,
    accountsAt: [],
    fresh: true,
    refusal: null,
  };
  // The destination goes with the session, so a case cannot leave one standing that another case's session contradicts.
  const setSession = (next: AdminSessionDouble, destination = destinationOf(next)): void => {
    answers.session = next;
    answers.served = servedOf(next);
    answers.destination = destination;
  };
  const setSubject = (next: SubjectDouble): void => void (answers.subject = next);
  // Before every case: one reading `cacheCalls` would otherwise also read every earlier case's
  // invalidations, and one after a case that signed out would run its write with no session.
  beforeEach(() => {
    cacheCalls.length = 0;
    loggedLines.length = 0;
    setSession(session);
    setSubject(subject);
    answers.subjectReads = 0;
    answers.signedOut.length = 0;
    answers.signOutFailure = null;
    answers.deletedAccounts.length = 0;
    answers.accountDeletionFailure = null;
    answers.accountHeld = true;
    answers.accountsAt.length = 0;
    answers.fresh = true;
    answers.refusal = null;
  });
  readTracesOnceLoaded();
  // The request every action runs in: the sign-in store, the subject lookup and the logger, and the
  // two packages that answer only inside a request Next itself is serving.
  vi.doMock("@/core/auth.ts", () => signInStore(answers));
  vi.doMock("@/core/subject.ts", () => subjectLookup(answers));
  vi.doMock("@/core/logging.ts", () => SILENT_LOGGER);
  vi.doMock("next/cache", () => NEXT_CACHE_DOUBLE);
  vi.doMock("next/headers", () => NEXT_HEADERS_DOUBLE);

  return {
    setSession,
    setSubject,
    setFresh: (next) => void (answers.fresh = next),
    subjectReads: () => answers.subjectReads,
    signedOut: () => [...answers.signedOut],
    failSignOut: (failure) => void (answers.signOutFailure = failure),
    deletedAccounts: () => [...answers.deletedAccounts],
    failAccountDeletion: (failure) => void (answers.accountDeletionFailure = failure),
    holdNoAccount: () => void (answers.accountHeld = false),
    holdAccountAt: async (address) => {
      const { asSignInIdentifier } = await import("@/core/emailAddress.ts");
      answers.accountsAt.push(asSignInIdentifier(address));
    },
    setRefusal: (next) => void (answers.refusal = next),
  };
}

/** One announcement a component raised: the severity it chose, and the words it handed the reader. */
export interface RaisedToast {
  readonly variant: string;
  readonly title: string;
  readonly description: string | undefined;
  /** Everything else the call passed: where `failure` keeps its marker. */
  readonly options: { description?: string; outcome?: ActionFailure["outcome"] } | undefined;
}

/**
 * Replaces the toast module at the module boundary, every member of the real `appToast` recording its
 * call: a double short of one answers `undefined` where a component raises it.
 *
 * The real module hands its raising to HeroUI's queue rather than back to the caller.
 */
export function doubleToasts(): { raised: RaisedToast[] } {
  const raised: RaisedToast[] = [];
  const raise =
    (variant: string) =>
    (title: string, options?: RaisedToast["options"]): string => {
      raised.push({ variant, title, description: options?.description, options });
      return String(raised.length);
    };
  // Titled as the real module titles it, so a press marked partly saved or of unknown outcome reads so
  // in every suite rather than under the raising site's title.
  const fail = (title: string, failure?: Pick<ActionFailure, "error" | "unplacedError" | "outcome">, unclearTitle?: string): string =>
    raise("danger")(failureToastTitle(title, failure?.outcome, unclearTitle), {
      description: failure?.unplacedError ?? failure?.error,
      outcome: failure?.outcome,
    });
  vi.doMock("@/shared/utils/appToast.ts", async (importOriginal) => {
    const { appToast } = await importOriginal<typeof AppToastModule>();
    const members = Object.keys(appToast).map((name) => [name, name === "failure" ? fail : raise(name)]);
    return { appToast: Object.fromEntries(members) };
  });

  return { raised };
}
