import { z } from "zod";

/**
 * `core` rather than beside `fl_frontend/src/shared/schemas.ts :: KontaktEmailSchema`, which is its
 * other caller: `fl_frontend/src/core/config.ts` judges the administrator allowlist, and
 * `eslint.config.mjs :: LAYER_BOUNDARY` refuses `core` an import from `shared`. A second spelling
 * over there is what disagrees with this one.
 */

/**
 * The whole-address ceiling, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Declared here rather than beside
 * `fl_frontend/src/shared/schemas.ts :: KontaktEmailSchema`, which re-exports it, because the
 * administrator allowlist holds entries to the same ceiling and `core` may not import from `shared`.
 */
export const KONTAKT_EMAIL_MAX_LENGTH = 254;

/**
 * RFC 5322 3.2.3's atext and nothing above ASCII, as the HTML standard's `type=email` address takes
 * it: the API stores only what every mail system carries (`docs/backend/spec.md :: I332`).
 */
const EMAIL_ATOM = "[a-zA-Z0-9_!#$%&'*+\\-/=?^`{|}~]+";

/**
 * Dots only between atoms, where the HTML standard also takes a leading, trailing or doubled one the
 * API refuses. No 64-character ceiling: email-validator applies RFC 5321's only under `strict`, which
 * the API does not pass.
 */
const EMAIL_LOCAL_PART_REGEX = new RegExp(`^${EMAIL_ATOM}(?:\\.${EMAIL_ATOM})*$`);

/**
 * Exclusions enumerated rather than allowances united (I226): a union of two classes needs the
 * `v` flag, which `package.json`'s browserslist refuses at `safari >= 16.4`.
 */
/** Read before `new URL` below, which would take a slash or a colon here for a path or a port and answer a host nobody typed. */
const EMAIL_HOST_CHARS_REGEX = /^[^\p{Z}\p{C}!"#$%&'()*+,/:;<=>?@[\]\\^_`{|}~]+$/u;

/** RFC 1123 2.1's letter-digit-hyphen label, which is the clause that refuses `person@ab-.de`. */
const EMAIL_HOST_LABEL_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

/** Every delegated top-level domain ends in a letter, so this refuses a host that is an IP address without parsing one. */
const EMAIL_HOST_TLD_REGEX = /[a-zA-Z]$/;

// RFC 1035 2.3.4 and 2.3.1, in octets of the punycoded host: an umlaut label transmits longer than it reads.
const EMAIL_HOST_MAX_OCTETS = 253;
const EMAIL_HOST_LABEL_MAX_OCTETS = 63;

/** The only punycode route a browser offers, and the one every caller below takes: a second spelling is what drifts from this one. */
function asAsciiHost(host: string): string | undefined {
  try {
    return new URL(`https://${host}`).hostname;
  } catch {
    return undefined;
  }
}

/** A host already inside ASCII, which `withAsciiDomain` hands back rather than rebuilding. */
const ASCII_HOST_REGEX = /^\p{ASCII}+$/u;

/** The address with its domain in the ASCII form every mail system carries, or `undefined` where the domain has none. */
export function withAsciiDomain(address: string): string | undefined {
  const at = address.lastIndexOf("@");
  if (at < 1) return undefined;

  const host = address.slice(at + 1);
  // Byte for byte where nothing needs converting: `new URL` also lower-cases, and a recipient
  // spelled differently from the stored row is one no later delivery event can be matched back to it.
  if (ASCII_HOST_REGEX.test(host)) return address;

  // Narrower than `isDeliverableAddress`'s own reading of the same alphabet, and deliberately: an
  // ASCII host is handed back unparsed above, so only the conversion below can answer another host.
  if (!EMAIL_HOST_CHARS_REGEX.test(host)) return undefined;

  const ascii = asAsciiHost(host);

  // A row stored before the address rule may hold a local part above ASCII, and only SMTPUTF8 carries
  // one: nothing here can promise the receiving server speaks it, so it crosses untouched.
  return ascii === undefined ? undefined : `${address.slice(0, at)}@${ascii}`;
}

// The API's refusals that rest on a registry rather than on characters stay the API's: IDNA 2008's
// code-point tables, RFC 5890's reserved labels, and IANA's special-use names.
/** The API's address rule: the local part's alphabet, the host's, and the lengths it measures in octets. */
export function isDeliverableAddress(value: string): boolean {
  const at = value.lastIndexOf("@");
  if (at < 1 || !EMAIL_LOCAL_PART_REGEX.test(value.slice(0, at))) return false;

  const host = value.slice(at + 1);
  if (!EMAIL_HOST_CHARS_REGEX.test(host)) return false;

  const punycoded = asAsciiHost(host);
  if (punycoded === undefined) return false;
  if (punycoded.length > EMAIL_HOST_MAX_OCTETS || !EMAIL_HOST_TLD_REGEX.test(punycoded)) return false;

  // email-validator holds the whole address to the ceiling in UTF-8 octets, as typed and with its host
  // punycoded, where an umlaut domain reaches it first. Its third form, a punycode-typed host decoded
  // back, goes unmeasured: nobody types one that long.
  const whole = Math.max(new TextEncoder().encode(value).length, at + 1 + punycoded.length);
  if (whole > KONTAKT_EMAIL_MAX_LENGTH) return false;

  const labels = punycoded.split(".");
  // A host with no dot is deliverable nowhere, which is the reason the API refuses one.
  return labels.length > 1 && labels.every((label) => label.length <= EMAIL_HOST_LABEL_MAX_OCTETS && EMAIL_HOST_LABEL_REGEX.test(label));
}

/** Whether what stands before the at sign is ASCII: the one refusal a box words apart, the rest reading as a mistyped address. */
export function hasAsciiLocalPart(value: string): boolean {
  const at = value.lastIndexOf("@");
  return at === -1 || /^\p{ASCII}*$/u.test(value.slice(0, at));
}

/**
 * The sign-in library's own primitive rather than a copy of its pattern: `better-auth` parses the
 * magic-link body with `z.email()`. What holds the two together is the table in
 * `fl_frontend/src/core/config.test.ts :: "the sign-in library's own rule"` and nothing else.
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

/** A domain above ASCII converted as the address rule converts it, so a row stored in Unicode before the rule joins its punycode spelling. */
function foldedDomain(domain: string): string {
  const converted = ASCII_HOST_REGEX.test(domain) || !EMAIL_HOST_CHARS_REGEX.test(domain) ? domain : (asAsciiHost(domain) ?? domain);
  return asciiLowerCase(converted);
}

/**
 * The one folded form `fl_frontend/src/core/auth.ts :: isUserAdmin` compares an allowlist entry
 * against, and the form each entry is stored in: the sign-in library lower-cases only the row it
 * stores, and normalises nothing on either lane.
 */
export function asSignInIdentifier(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  return at === -1 ? asciiLowerCase(trimmed) : `${asciiLowerCase(trimmed.slice(0, at))}@${foldedDomain(trimmed.slice(at + 1))}`;
}

/**
 * What makes two stored addresses one inbox, the key every send and the correction's press dedupe
 * on, as `fl_backend/app/shared/folding.py :: mailbox_key` does. Never `asSignInIdentifier`: folded
 * whole, two people are one recipient and one of them is never written to.
 */
export function mailboxKey(address: string): string {
  const at = address.lastIndexOf("@");
  // The local part byte for byte and the domain without case (RFC 5321 §2.4).
  return at === -1 ? address : `${address.slice(0, at)}@${foldedDomain(address.slice(at + 1))}`;
}
