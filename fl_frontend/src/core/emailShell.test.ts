import { assert, describe, it } from "vitest";

import { COPY } from "./copy/shared";
import { renderMail } from "./emailShell";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";

const ORIGIN = "https://example.com";

/**
 * A catalogue entry carrying a value typed outside the league, the one way such a value reaches a slot taking the
 * catalogue's words: a fixture named by its clubs.
 */
const naming = (typed: string) => COPY.page.spiel({ record: typed }, { record: "Eiche" });

const MAIL: Mail = {
  audience: "notice",
  subjectLine: naming("Ahorn"),
  origin: ORIGIN,
  paragraphs: [[SERVER_COPY.mail.bewerbung.confirmOrOppose]],
};

describe("renderMail", () => {
  // A link to pass on stands in its box as text a reader can copy, in both versions, and the mail draws no button.
  it("prints a passed-on link in its box in both versions", () => {
    const link = `${ORIGIN}/registrierung?token=eins`;
    const { html, text } = renderMail({ ...MAIL, block: { link } });

    assert.include(html, `href="${link}"`);
    assert.include(text.split("\n"), link);
    assert.notInclude(html, 'fl-button"');
  });

  // A team name or a stated reason is typed outside the league and lands inside markup.
  it("escapes every value in the designed version", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { html } = renderMail({
      ...MAIL,
      subjectLine: naming(hostile),
      paragraphs: [[naming(hostile), [{ strong: hostile }]]],
      block: { title: naming(hostile), facts: [{ label: naming(hostile), value: hostile }] },
      button: { label: naming(hostile), href: `${ORIGIN}/"><script>` },
    });

    assert.notInclude(html, "<img src=x");
    assert.notInclude(html, '"><script>');
  });

  // „Hallo,“ runs on into the first paragraph, which begins small (Duden, D 132), while the same sentence opens a page
  // capitalised; a paragraph opening on a club's name keeps it.
  it("begins the paragraph under the greeting small in both versions, unless it opens on a noun", () => {
    const opening = SERVER_COPY.mail.bewerbung.confirmOrOppose;
    const small = `${opening.charAt(0).toLowerCase()}${opening.slice(1)}`;
    const { html, text } = renderMail(MAIL);
    const named = renderMail({ ...MAIL, paragraphs: [[naming("Ahorn")]], opensOnNoun: true });

    assert.include(html, `>${small}</p>`);
    assert.include(text.split("\n"), small);
    assert.include(named.html, `>${naming("Ahorn")}</p>`);
    assert.include(named.text.split("\n"), naming("Ahorn"));
  });

  // A break in a header ends it, and whatever follows is a header of its own.
  it("folds the subject to one line", () => {
    assert.notMatch(renderMail({ ...MAIL, subjectLine: naming("Ahorn\r\nBcc: fremd@example.com") }).subject, /[\r\n]/);
  });
});
