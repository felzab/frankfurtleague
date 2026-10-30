import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { SPECIAL_USE_DOMAINS } from "@/core/emailAddress.ts";

import {
  ADDRESS_HAUSNUMMER_MAX_LENGTH,
  ADDRESS_STADT_MAX_LENGTH,
  ADDRESS_STADTTEIL_MAX_LENGTH,
  ADDRESS_STRASSE_MAX_LENGTH,
  CustomTimeStringSchema,
  ExternalUrlSchema,
  FLAddressPayloadSchema,
  FLKontaktPayloadSchema,
  KONTAKT_EMAIL_MAX_LENGTH,
  KontaktEmailSchema,
  PHONE_REGEX,
} from "./schemas.ts";

const validAddress = {
  strasse: "Hanauer Landstraße",
  hausnummer: "12a",
  plz: "60314",
  stadtteil: "Ostend",
  stadt: "Frankfurt am Main",
};

describe("FLAddressPayloadSchema", () => {
  it("accepts a valid address", () => {
    expect(FLAddressPayloadSchema.safeParse(validAddress).success).toBe(true);
  });

  it("requires plz to be exactly five digits", () => {
    for (const plz of ["6031", "603145", "6031a", "", " 60314", "60 314"]) {
      expect(FLAddressPayloadSchema.safeParse({ ...validAddress, plz }).success, `expected "${plz}" to be rejected`).toBe(false);
    }
    expect(FLAddressPayloadSchema.safeParse({ ...validAddress, plz: "01067" }).success).toBe(true);
  });

  it("accepts hausnummer as digits, hyphens and a/b/c, or empty", () => {
    for (const hausnummer of ["12", "12a", "12-14", "12B", "", "1-3c"]) {
      expect(FLAddressPayloadSchema.safeParse({ ...validAddress, hausnummer }).success, `expected "${hausnummer}" to be accepted`).toBe(true);
    }
  });

  // The filler is per field rather than shared: `hausnummer` has an alphabet, so an `x` would prove
  // the pattern refusing a long value and leave the ceiling itself untested.
  const capped = [
    { field: "strasse", cap: ADDRESS_STRASSE_MAX_LENGTH, filler: "x" },
    { field: "stadt", cap: ADDRESS_STADT_MAX_LENGTH, filler: "x" },
    { field: "stadtteil", cap: ADDRESS_STADTTEIL_MAX_LENGTH, filler: "x" },
    { field: "hausnummer", cap: ADDRESS_HAUSNUMMER_MAX_LENGTH, filler: "1" },
  ] as const;

  it("accepts a value exactly at the cap and refuses the next character", () => {
    for (const { field, cap, filler } of capped) {
      const atTheCap = filler.repeat(cap);
      expect(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: atTheCap }).success, `${field} at the cap`).toBe(true);
      expect(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: atTheCap + filler }).success, `${field} over it`).toBe(false);
    }
  });

  it("refuses an empty strasse or stadt", () => {
    for (const field of ["strasse", "stadt"] as const) {
      expect(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: "" }).success, `${field} empty`).toBe(false);
    }
  });

  // The API strips before its floor counts, so an untrimmed mirror takes what the endpoint refuses
  // with a `REQ-VAL-001` marking the box with a generic sentence rather than the floor's German.
  it("refuses a strasse or stadt of spaces alone, and sends a padded one stripped", () => {
    for (const field of ["strasse", "stadt"] as const) {
      expect(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: "   " }).success, `${field} spaces alone`).toBe(false);
      // `.trim()` has to precede the floor: `.nonempty().trim()` type-checks, lints, and takes spaces alone.
      const padded = FLAddressPayloadSchema.parse({ ...validAddress, [field]: `  ${validAddress[field]}  ` });

      expect(padded[field], `${field} reaches the API padded`).toBe(validAddress[field]);
    }
  });

  // A venue can genuinely lack a house number or a district, so neither field carries a floor and the
  // ceiling bounding its length must not turn it into a required one.
  it("accepts an empty hausnummer or stadtteil", () => {
    for (const field of ["hausnummer", "stadtteil"] as const) {
      expect(FLAddressPayloadSchema.safeParse({ ...validAddress, [field]: "" }).success, `${field} empty`).toBe(true);
    }
  });

  // Nothing else would catch the loss: a pattern is outside what `fl_frontend/src/core/apiContract.test.ts` compares.
  it("refuses a hausnummer outside its alphabet", () => {
    for (const hausnummer of ["12d", "12 a", "Nr. 12"]) {
      expect(FLAddressPayloadSchema.safeParse({ ...validAddress, hausnummer }).success, `expected "${hausnummer}" to be rejected`).toBe(false);
    }
  });
});

describe("PHONE_REGEX", () => {
  // The German spellings the tree's own fixtures use, plus the bracketed trunk zero with a grouping
  // hyphen: refusing one of these refuses a school the only channel the league reaches it on.
  const IN_USE = [
    "+49 (0) 69 1234-567",
    "069 1234567",
    "+49 (0)170 1234567",
    "0049-170-1234567",
    "(0170) 123 45 67",
    "069.123.4567",
    "+4915112345678",
    "030 123",
  ];

  it("accepts every spelling of a German number the tree already uses", () => {
    for (const telefon of IN_USE) {
      expect(PHONE_REGEX.test(telefon), `expected ${JSON.stringify(telefon)} to be accepted`).toBe(true);
    }
  });

  // The API stores what it is sent and the club page shows it, so a value with no digit in it is a
  // number handed to whoever tries to ring the school.
  it("refuses a value carrying no digit at all", () => {
    for (const telefon of ["   ", "().", "---", "(  )"]) {
      expect(PHONE_REGEX.test(telefon), `expected ${JSON.stringify(telefon)} to be refused`).toBe(false);
    }
  });

  // How the rule reaches the case above: every telephone number ends in a digit, and no floor over
  // the digit count fits a pattern that carries its own ceiling as well.
  it("refuses a value trailing off into a space or punctuation", () => {
    for (const telefon of ["(069)", "069 ", "069-"]) {
      expect(PHONE_REGEX.test(telefon), `expected ${JSON.stringify(telefon)} to be refused`).toBe(false);
    }
  });

  // The pattern carries the ceiling itself, no length bound standing beside it, so taking the final
  // digit out of the run must leave the window where it was: a `{3,20}` run beside one stores 21.
  it("keeps the twenty-character ceiling and the three-character floor", () => {
    for (const [telefon, accepted] of [
      ["0".repeat(3), true],
      ["0".repeat(20), true],
      ["0".repeat(2), false],
      ["0".repeat(21), false],
    ] as const) {
      expect(PHONE_REGEX.test(telefon), `expected ${String(telefon.length)} characters to be ${String(accepted)}`).toBe(accepted);
    }
  });
});

/** A valid address, so a case about the telephone is judged on the telephone alone: the address is required. */
const ADRESSE = "kontakt@example.de";

describe("FLKontaktPayloadSchema", () => {
  it("accepts common German phone formats", () => {
    for (const telefon of ["069123456", "+49 69 123456", "(069) 123-456", "+49-69-123456"]) {
      expect(FLKontaktPayloadSchema.safeParse({ telefon, email: ADRESSE }).success, `expected "${telefon}" to be accepted`).toBe(true);
    }
  });

  it("rejects phone numbers with letters, or shorter than 3 / longer than 20 characters", () => {
    for (const telefon of ["ab", "06", "069-ABC-123", "+4969123456789012345678"]) {
      expect(FLKontaktPayloadSchema.safeParse({ telefon, email: ADRESSE }).success, `expected "${telefon}" to be rejected`).toBe(false);
    }
  });

  // With `\s` inside `^...$` every one of these passed here and was refused by the API. Patterns are
  // out of the contract comparison, so a unit test is what holds the two spellings together.
  it("rejects a phone number carrying a control character, which the backend rejects too", () => {
    for (const telefon of ["+49 69 1234567\n", "\n\n1234567", "+49\t69\t1234567", "+49 69 1234567\r", "069123\n456"]) {
      expect(FLKontaktPayloadSchema.safeParse({ telefon, email: ADRESSE }).success, `expected ${JSON.stringify(telefon)} to be rejected`).toBe(
        false,
      );
    }
  });

  // The telephone takes null (not supplied) and "" (supplied but cleared), two distinct states in
  // the admin forms.
  it("accepts null and empty string for the telephone", () => {
    expect(FLKontaktPayloadSchema.safeParse({ telefon: null, email: ADRESSE }).success).toBe(true);
    expect(FLKontaktPayloadSchema.safeParse({ telefon: "", email: ADRESSE }).success).toBe(true);
  });

  // The address is how a referee learns an administrator entered them. Both referee forms fold a
  // cleared box to null, so this one sentence is what an empty box says.
  it("refuses a missing address with the one sentence an empty box shows", () => {
    const refused = FLKontaktPayloadSchema.safeParse({ telefon: null, email: null });
    expect(refused.error?.issues.map((issue) => issue.message)).toStrictEqual(["Bitte gib eine E-Mail-Adresse ein."]);
    expect(FLKontaktPayloadSchema.safeParse({ telefon: null, email: "" }).success).toBe(false);
  });

  // `PHONE_REGEX` refuses a value with no digit, so the union's empty branch is what takes a box
  // holding spaces alone — as `fl_backend/app/shared/schemas/custom.py :: parse_empty_string_to_none` reads it.
  it("takes a telefon of spaces alone as cleared rather than as malformed", () => {
    expect(FLKontaktPayloadSchema.safeParse({ telefon: "   ", email: ADRESSE }).success).toBe(true);
  });

  // Each is a value the API takes and stores: an umlaut host it converts to punycode, an atext
  // character outside zod's class, and a local part past RFC 5321's 64.
  it("takes every address the API stores, whose rule no zod pattern spells", () => {
    for (const email of ["kaethe@käthe-schule.example", "a!b@example.de", `${"a".repeat(70)}@example.de`]) {
      expect(FLKontaktPayloadSchema.safeParse({ telefon: null, email }).success, `expected "${email}" to be accepted`).toBe(true);
    }
  });

  it("rejects a missing field outright", () => {
    expect(FLKontaktPayloadSchema.safeParse({ telefon: null }).success).toBe(false);
  });
});

const RESERVIERT = "Diese Adresse können wir nicht nutzen: Der Teil nach dem @ ist reserviert und empfängt keine E-Mails.";

describe("KontaktEmailSchema", () => {
  const refusals = (value: unknown): string[] => KontaktEmailSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];

  // Each is a value the API takes, and `z.email()`'s alphabet refuses the umlaut domain and the atext
  // character: a school whose contact address holds one could not submit an application at all.
  it("takes every address the API stores, umlaut domains and atext characters and all", () => {
    const addresses = [
      "kaethe@käthe-schule.example",
      "kaethe@xn--kthe-schule-l8a.example",
      "a!b@example.de",
      `${"a".repeat(70)}@example.de`,
      "Anna@Example.DE",
    ];

    for (const email of addresses) {
      expect(KontaktEmailSchema.safeParse(email).success, `expected "${email}" to be accepted`).toBe(true);
    }
  });

  // Each is one the API answers with a REQ-VAL-001 marking the box with a generic sentence, which
  // never tells the applicant what to change.
  it("refuses every address the API refuses on its characters and lengths", () => {
    const addresses = [
      "person@ab-.de",
      "anna@-example.de",
      `person@${"a".repeat(70)}.de`,
      "anna@example",
      "anna@1.2.3.4",
      "anna@example..de",
      "anna@example.de.",
      "anna@ex_ample.de",
      ".anna@example.de",
      "anna.@example.de",
      "an..na@example.de",
      "an,na@example.de",
      "an na@example.de",
      "anna@@example.de",
    ];

    for (const email of addresses) {
      expect(KontaktEmailSchema.safeParse(email).success, `expected "${email}" to be rejected`).toBe(false);
    }
  });

  // The label cap is 63 OCTETS of the punycoded host and an umlaut costs more than one, so read on the
  // value as typed the second of these is 58 characters and passes.
  it("measures the label cap on the punycoded host rather than on what was typed", () => {
    expect(KontaktEmailSchema.safeParse(`anna@${"ä".repeat(57)}.de`).success).toBe(true);
    expect(KontaktEmailSchema.safeParse(`anna@${"ä".repeat(58)}.de`).success).toBe(false);
  });

  // Pydantic strips before it validates, so the API takes this and stores it trimmed. The padding is
  // invisible, which is what makes a refusal over it unactionable.
  it("takes a pasted address padded with spaces and submits it trimmed", () => {
    expect(KontaktEmailSchema.parse("  erika@example.de  ")).toBe("erika@example.de");
  });

  // The API takes this one and stores the address alone. Refused rather than unwrapped: the name is on
  // screen for the applicant to delete, where a quiet rewrite would submit what nobody typed.
  it("refuses an address wrapped in a display name rather than unwrapping it", () => {
    expect(KontaktEmailSchema.safeParse("Erika <erika@example.de>").success).toBe(false);
  });

  // A person can repair only what the sentence names, and the generic one names nothing an umlaut
  // domain does not share. The full-width at sign is built from its code point, rendering as the ASCII one.
  it("refuses, in a sentence of its own, a local part above ASCII", () => {
    for (const email of ["käthe@schule.de", `erika${String.fromCharCode(0xff20)}x@schule.de`]) {
      expect(refusals(email), email).toStrictEqual([
        "Diese Adresse können wir nicht nutzen: Vor dem @ dürfen keine Umlaute, kein ß, keine Akzente und keine anderen Schriften stehen.",
      ]);
    }
  });

  // The API refuses these on IANA's list and answers the box with its generic field sentence, which names
  // nothing to change; a domain under a name is as reserved as the name.
  it("refuses, in a sentence of its own, a domain under every special-use name the API refuses", () => {
    assert.ok(SPECIAL_USE_DOMAINS.length > 0, "no special-use name, so this case refuses nothing");

    for (const name of SPECIAL_USE_DOMAINS) {
      for (const email of [`trainer@example.${name}`, `Trainer@Schule.${name.toUpperCase()}`]) {
        expect(refusals(email), email).toStrictEqual([RESERVIERT]);
      }
    }
  });

  // The library leaves these off its list, so the API stores them and a stricter copy refuses what the save takes.
  it("takes the example domains the special-use names leave out", () => {
    for (const email of ["trainer@example.com", "trainer@example.org", "trainer@example.net"]) {
      expect(refusals(email), email).toStrictEqual([]);
    }
  });

  it("carries one German sentence per fault", () => {
    expect(refusals("erika@")).toStrictEqual(["Bitte gib eine gültige E-Mail-Adresse ein."]);
    expect(refusals(`${"e".repeat(300)}@schule.de`)).toStrictEqual([
      `Die E-Mail-Adresse darf höchstens ${String(KONTAKT_EMAIL_MAX_LENGTH)} Zeichen lang sein.`,
    ]);
  });
});

describe("FLKontaktPayloadSchema's email bounds", () => {
  // Every domain label stays under the 63-octet cap, so a boundary case can only fail on the total.
  function addressOfLength(total: number): string {
    const local = "a".repeat(64);
    let remaining = total - local.length - 1;
    const labels: string[] = [];
    while (remaining > 0) {
      const size = Math.min(60, remaining);
      labels.push("b".repeat(size));
      remaining -= size;
      if (remaining > 0) remaining -= 1;
    }
    return `${local}@${labels.join(".")}`;
  }

  it("validates email addresses", () => {
    expect(FLKontaktPayloadSchema.safeParse({ telefon: null, email: "info@frankfurtleague.de" }).success).toBe(true);
    for (const email of ["info@", "@frankfurtleague.de", "info frankfurtleague.de", "info@@x.de"]) {
      expect(FLKontaktPayloadSchema.safeParse({ telefon: null, email }).success, `expected "${email}" to be rejected`).toBe(false);
    }
  });

  // The boundary, not a wildly long string: a bound set anywhere passes that. Past it the API's
  // REQ-VAL-001 marks the box with a generic sentence, so without this the ceiling went unnamed.
  it("accepts an address at the backend ceiling and refuses the next character, in German", () => {
    const atTheCap = addressOfLength(KONTAKT_EMAIL_MAX_LENGTH);
    expect(atTheCap.length).toBe(KONTAKT_EMAIL_MAX_LENGTH);
    expect(FLKontaktPayloadSchema.safeParse({ telefon: null, email: atTheCap }).success, "at the cap").toBe(true);

    const over = FLKontaktPayloadSchema.safeParse({ telefon: null, email: addressOfLength(KONTAKT_EMAIL_MAX_LENGTH + 1) });
    expect(over.success, "one over the cap").toBe(false);
    // No union carries the message, so the box names the ceiling rather than calling the address invalid.
    expect(over.error?.issues.map((issue) => issue.message)).toStrictEqual([
      `Die E-Mail-Adresse darf höchstens ${String(KONTAKT_EMAIL_MAX_LENGTH)} Zeichen lang sein.`,
    ]);
  });

  // email-validator applies RFC 5321's 64-octet local-part cap only under `strict`, which pydantic
  // does not pass. A bound here alone would refuse in German an address the API stores.
  it("accepts a local part over 64 characters, which the backend accepts too", () => {
    expect(FLKontaktPayloadSchema.safeParse({ telefon: null, email: `${"a".repeat(65)}@example.com` }).success).toBe(true);
  });
});

describe("ExternalUrlSchema", () => {
  const USERINFO = [
    "https://frankfurtleague.de@evil.com",
    "https://frankfurtleague.de@evil.com/spenden",
    "http://frankfurtleague.de:geheim@evil.com",
    "https://user@frankfurtleague.de",
    // A password and no user at all, so neither half of the check stands in for the other.
    "https://:geheim@evil.com",
  ];
  const HARMLOS = ["https://www.carl-schurz-schule.de", "http://example.de", "https://a.b.example.de/pfad?q=1#top"];
  // The whole reason this schema exists: bare z.url() accepts every one of these.
  it("rejects the script-bearing schemes that z.url() lets through", () => {
    for (const url of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "file:///etc/passwd"]) {
      expect(ExternalUrlSchema.safeParse(url).success, `expected "${url}" to be rejected`).toBe(false);
      expect(z.url().safeParse(url).success, `z.url() no longer accepts "${url}" — this test can be simplified`).toBe(true);
    }
  });

  // The case above refuses each value on its host as well, so it stays green without `protocol`. Each
  // host here passes the domain rule, and the first still runs: its `%0a` ends the `//` comment.
  it("refuses a scheme other than http and https on a host the domain rule takes", () => {
    const hostAlone = z.url({ hostname: z.regexes.domain });

    for (const url of ["javascript://example.de/%0aalert(1)", "data://example.de/x", "ftp://example.de/x"]) {
      expect(ExternalUrlSchema.safeParse(url).success, `expected "${url}" to be rejected`).toBe(false);
      expect(hostAlone.safeParse(url).success, `the domain rule refuses "${url}" itself, so this case pins nothing`).toBe(true);
    }
  });

  it("accepts ordinary http and https links", () => {
    for (const url of HARMLOS) {
      expect(ExternalUrlSchema.safeParse(url).success, `expected "${url}" to be accepted`).toBe(true);
    }
  });

  it("rejects a URL whose userinfo hides the host it reaches", () => {
    // Everything before the `@` is userinfo. The visible text names the league; the browser goes to evil.com.
    for (const url of USERINFO) {
      expect(ExternalUrlSchema.safeParse(url).success, `expected "${url}" to be rejected`).toBe(false);
    }
  });

  it("accepts nothing that navigates anywhere but the host it displays", () => {
    // The property the case above samples: a listed spelling proves only that spelling, and userinfo
    // has more of them than a test can name.
    const accepted = [...USERINFO, ...HARMLOS].filter((url) => ExternalUrlSchema.safeParse(url).success);

    expect(accepted, "the corpus proves nothing unless the harmless half still parses").toStrictEqual(HARMLOS);
    for (const url of accepted) {
      expect(new URL(url).username, `${url}: accepted while carrying a user`).toBe("");
      expect(new URL(url).password, `${url}: accepted while carrying a password`).toBe("");
    }
  });

  it("rejects a hostname that is not a domain", () => {
    for (const url of ["https://ok", "https://localhost", "https://127.0.0.1"]) {
      expect(ExternalUrlSchema.safeParse(url).success, `expected "${url}" to be rejected`).toBe(false);
    }
  });

  // The backend validates hosts with its copy of zod's domain regex, so a hand-written `hostname` in
  // the schema's place would part the two ends.
  it("judges every hostname exactly as zod's domain regex does", () => {
    const hosts = [
      "example.de",
      "a-b.example.de",
      `${"a".repeat(63)}.de`,
      `${"a".repeat(64)}.de`,
      "-example.de",
      "example-.de",
      "ex_ample.de",
      "example.d",
    ];
    const judged = hosts.map((host) => [host, ExternalUrlSchema.safeParse(`https://${host}/`).success]);
    const expected = hosts.map((host) => [host, z.regexes.domain.test(host)]);

    assert.ok(
      new Set(expected.map(([, verdict]) => verdict)).size === 2,
      "the hosts hold one verdict alone, so agreeing on them proves nothing",
    );
    expect(judged).toStrictEqual(expected);
  });
});

describe("CustomTimeStringSchema", () => {
  it("accepts HH:MM:SS", () => {
    for (const t of ["00:00:00", "09:05:00", "14:30:00", "23:59:59"]) {
      expect(CustomTimeStringSchema.safeParse(t).success, `expected ${t} to parse`).toBe(true);
    }
  });

  // `z.iso.time()` accepts both of these and the backend's `CustomTimeString` does not, so a
  // looser schema here lets the admin form submit a value the API answers with a 422.
  it("rejects a time without seconds, which the backend rejects too", () => {
    expect(CustomTimeStringSchema.safeParse("14:30").success).toBe(false);
  });

  it("rejects fractional seconds, which the backend rejects too", () => {
    expect(CustomTimeStringSchema.safeParse("14:30:00.5").success).toBe(false);
  });

  it("rejects out-of-range and malformed values", () => {
    for (const t of ["24:00:00", "14:60:00", "14:30:60", "2:30:00", "", "abc"]) {
      expect(CustomTimeStringSchema.safeParse(t).success, `expected ${t} to be rejected`).toBe(false);
    }
  });
});
