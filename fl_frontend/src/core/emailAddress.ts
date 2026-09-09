/**
 * `core` rather than beside `fl_frontend/src/shared/schemas.ts :: KontaktEmailSchema`, which is its
 * other caller: `fl_frontend/src/core/config.ts` judges the administrator allowlist, and
 * `eslint.config.mjs :: LAYER_BOUNDARY` refuses `core` an import from `shared`. A second spelling
 * over there is what disagrees with this one.
 */

/**
 * RFC 5322 3.2.3's atext, extended by RFC 6531 3.3 to every code point above ASCII and narrowed by
 * the two categories `EmailStr` calls unsafe, `Z` and `C`.
 */
const EMAIL_ATOM = "(?:[a-zA-Z0-9_!#$%&'*+\\-/=?^`{|}~]|[^\\p{ASCII}\\p{Z}\\p{C}])+";

// A combining mark may not OPEN the local part: it would combine with whatever text precedes the address.
/**
 * No ceiling on the local part: email-validator applies RFC 5321's 64 only under `strict`, which
 * pydantic does not pass, so one here would refuse an address the API accepts.
 */
const EMAIL_LOCAL_PART_REGEX = new RegExp(`^(?!\\p{M})${EMAIL_ATOM}(?:\\.${EMAIL_ATOM})*$`, "u");

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

// The API's refusals that rest on a registry rather than on characters stay the API's: IDNA 2008's
// code-point tables, RFC 5890's reserved labels, and IANA's special-use names.
/** `EmailStr`'s own three checks: the local part's alphabet, the host's, and the host's lengths after punycoding. */
export function isDeliverableAddress(value: string): boolean {
  const at = value.lastIndexOf("@");
  if (at < 1 || !EMAIL_LOCAL_PART_REGEX.test(value.slice(0, at))) return false;

  const host = value.slice(at + 1);
  if (!EMAIL_HOST_CHARS_REGEX.test(host)) return false;

  let punycoded: string;
  try {
    // The only punycode route a browser offers, and `EmailStr` measures the lengths below on this form too.
    punycoded = new URL(`https://${host}`).hostname;
  } catch {
    return false;
  }
  if (punycoded.length > EMAIL_HOST_MAX_OCTETS || !EMAIL_HOST_TLD_REGEX.test(punycoded)) return false;

  const labels = punycoded.split(".");
  // A host with no dot is deliverable nowhere, which is the reason `EmailStr` refuses one.
  return labels.length > 1 && labels.every((label) => label.length <= EMAIL_HOST_LABEL_MAX_OCTETS && EMAIL_HOST_LABEL_REGEX.test(label));
}

/**
 * The form `@auth/core`'s own `defaultNormalizer` hands the `signIn` callback, which is what
 * `fl_frontend/src/core/auth.ts :: isUserAdmin` compares an allowlist entry against.
 */
export function asSignInIdentifier(value: string): string {
  // NFKC before the fold, in that order: the composed and decomposed spellings of one umlaut are
  // different strings, so an entry normalised any other way matches nothing anybody can type.
  return value.normalize("NFKC").toLowerCase().trim();
}
