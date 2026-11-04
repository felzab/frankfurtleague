import { z } from "zod";

/**
 * `core` rather than beside `fl_frontend/src/shared/schemas.ts :: KontaktEmailSchema`, its other
 * caller: the sign-in fold and the mailer read these rules, and
 * `eslint.config.mjs :: LAYER_BOUNDARY` refuses `core` an import from `shared`. A second spelling
 * over there is what disagrees with this one.
 */

/**
 * The whole-address ceiling, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Declared here rather than beside
 * `fl_frontend/src/shared/schemas.ts :: KontaktEmailSchema`, which re-exports it, because
 * `isDeliverableAddress` below holds the same ceiling and `core` may not import from `shared`.
 */
export const KONTAKT_EMAIL_MAX_LENGTH = 254;

/**
 * RFC 5322 3.2.3's atext and nothing above ASCII, as the HTML standard's `type=email` address takes
 * it: the API stores only what every mail system carries.
 */
const EMAIL_ATOM = "[a-zA-Z0-9_!#$%&'*+\\-/=?^`{|}~]+";

/**
 * Dots only between atoms, where the HTML standard also takes a leading, trailing or doubled one the
 * API refuses. No 64-character ceiling: email-validator applies RFC 5321's only under `strict`, which
 * the API does not pass.
 */
const EMAIL_LOCAL_PART_REGEX = new RegExp(`^${EMAIL_ATOM}(?:\\.${EMAIL_ATOM})*$`);

/**
 * Read before `new URL`, which reads a slash or colon as path or port, answering a host nobody typed.
 * Exclusions, not united allowances: a union needs the `v` flag, which the browserslist refuses at
 * `safari >= 16.4`.
 */
const EMAIL_HOST_CHARS_REGEX = /^[^\p{Z}\p{C}!"#$%&'()*+,/:;<=>?@[\]\\^_`{|}~]+$/u;

/** RFC 1123 2.1's letter-digit-hyphen label, which is the clause that refuses `person@ab-.de`. */
const EMAIL_HOST_LABEL_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

/** Every delegated top-level domain ends in a letter, so this refuses a host that is an IP address without parsing one. */
const EMAIL_HOST_TLD_REGEX = /[a-zA-Z]$/;

/**
 * IANA's special-use names as the API's `email_validator` lists them (`SPECIAL_USE_DOMAIN_NAMES`), each
 * refused with every name under it. The library moves without us.
 */
export const SPECIAL_USE_DOMAINS = ["arpa", "invalid", "local", "localhost", "onion", "test"] as const;

// RFC 1035 2.3.4 and 2.3.1, in octets, which an ASCII host counts as characters.
const EMAIL_HOST_MAX_OCTETS = 253;
const EMAIL_HOST_LABEL_MAX_OCTETS = 63;

/** The only punycode route a browser offers, and the one `withAsciiDomain` takes: a second spelling is what drifts from this one. */
function asAsciiHost(host: string): string | undefined {
  try {
    return new URL(`https://${host}`).hostname;
  } catch {
    return undefined;
  }
}

/** A host already inside ASCII, which `withAsciiDomain` hands back rather than rebuilding. */
const ASCII_HOST_REGEX = /^\p{ASCII}+$/u;

/**
 * One run of characters no mailbox syntax gives a meaning: whitespace, controls, and RFC 5322's
 * specials, which open a display name, a group, a list, a comment, a quoted string or a literal.
 */
const MAILBOX_ATOM = String.raw`[^\p{Z}\p{C}\s"(),:;<>@[\]\\.]+`;

/** Dot-separated runs on both sides of one at sign, a dot never leading, trailing or doubled, the domain dotted. */
const ONE_BARE_MAILBOX_REGEX = new RegExp(`^${MAILBOX_ATOM}(?:\\.${MAILBOX_ATOM})*@${MAILBOX_ATOM}(?:\\.${MAILBOX_ATOM})+$`, "u");

/**
 * Read before the ban list is asked: a provider reads a display name, a list or a trailing dot as the mailbox inside it, where the list's
 * keying refuses the spelling and answers it unbarred.
 */
export function isOneBareMailbox(value: string): boolean {
  return ONE_BARE_MAILBOX_REGEX.test(value);
}

/** The address with its domain in the ASCII form every mail system carries, or `undefined` where the domain has none. */
export function withAsciiDomain(address: string): string | undefined {
  const at = address.lastIndexOf("@");
  if (at < 1) return undefined;

  const host = address.slice(at + 1);
  // Byte for byte where nothing needs converting: `new URL` also lower-cases, and a recipient
  // spelled differently from the stored row is one no later delivery event can be matched back to it.
  if (ASCII_HOST_REGEX.test(host)) return address;

  if (!EMAIL_HOST_CHARS_REGEX.test(host)) return undefined;

  const ascii = asAsciiHost(host);

  return ascii === undefined ? undefined : `${address.slice(0, at)}@${ascii}`;
}

/** Whether the lower-cased host is a special-use name or under one, compared as the API compares its domain. */
const isSpecialUseHost = (host: string): boolean => SPECIAL_USE_DOMAINS.some((name) => host === name || host.endsWith(`.${name}`));

/** The one refusal of the API's resting on a list this rule can copy, and so the one its box can word. */
export function isSpecialUseAddress(value: string): boolean {
  return isSpecialUseHost(asciiLowerCase(value.slice(value.lastIndexOf("@") + 1)));
}

// The API's refusals that rest on a registry this rule cannot copy stay the API's: IDNA 2008's
// reading of an `xn--` label and RFC 5890's reserved labels.
/**
 * The API's address rule: ASCII throughout, the local part's alphabet, each host label letters, digits and hyphens, its
 * special-use names, and its lengths. An umlaut domain is refused rather than converted, so the stored form is the fold of
 * what was typed.
 */
export function isDeliverableAddress(value: string): boolean {
  const at = value.lastIndexOf("@");
  if (at < 1 || value.length > KONTAKT_EMAIL_MAX_LENGTH || !EMAIL_LOCAL_PART_REGEX.test(value.slice(0, at))) return false;

  const host = value.slice(at + 1);
  if (host.length > EMAIL_HOST_MAX_OCTETS || !EMAIL_HOST_TLD_REGEX.test(host) || isSpecialUseHost(asciiLowerCase(host))) return false;

  const labels = host.split(".");
  // A host with no dot is deliverable nowhere, which is the reason the API refuses one.
  return labels.length > 1 && labels.every((label) => label.length <= EMAIL_HOST_LABEL_MAX_OCTETS && EMAIL_HOST_LABEL_REGEX.test(label));
}

/** Whether what stands before the at sign is ASCII: the one refusal a box words apart, the rest reading as a mistyped address. */
export function hasAsciiLocalPart(value: string): boolean {
  const at = value.lastIndexOf("@");
  return at === -1 || /^\p{ASCII}*$/u.test(value.slice(0, at));
}

/**
 * The sign-in library's own primitive rather than a copy of its pattern: `better-auth` checks a
 * code's address with `z.email()`.
 */
const SIGN_IN_LIBRARY_EMAIL = z.email();

/** Asked of the FOLDED address: `fl_frontend/src/features/auth/actions.ts :: handleSignIn` hands the library that form and no other. */
export function isSignInLibraryAddress(value: string): boolean {
  return SIGN_IN_LIBRARY_EMAIL.safeParse(value).success;
}

/** ASCII's 26 letters, never `toLowerCase`, whose tables move with the runtime's Unicode release: the API lowers the same 26. */
function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/**
 * The form every record stores an address in and every lookup asks with: trimmed and lower-cased. The sign-in
 * library lower-cases but never trims: better-auth 1.7.10 as installed, read 2026-10-20, moves without us.
 */
export function asSignInIdentifier(value: string): string {
  return asciiLowerCase(value.trim());
}
