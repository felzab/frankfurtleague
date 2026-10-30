import { assert, describe, it } from "vitest";

import { renderMail } from "./emailShell.ts";

import type { Mail } from "./emailShell.ts";

const ORIGIN = "https://example.com";

const MAIL: Mail = {
  art: "mitteilung",
  subjectLine: "Spiel abgesagt",
  origin: ORIGIN,
  vorname: "",
  absaetze: [["Das Spiel ist abgesagt."]],
};

describe("renderMail", () => {
  // A reader whose client shows the text version alone has no button to press.
  it("prints the button's link in the text version", () => {
    const button = renderMail({ ...MAIL, aktion: { label: "Zum Eintrag", href: `${ORIGIN}/eintrag?token=eins` } });
    assert.include(button.text, `${ORIGIN}/eintrag?token=eins`);
  });

  // A link to pass on stands in its box as text a reader can copy, in both versions, and the mail draws no button.
  it("prints a passed-on link in its box in both versions", () => {
    const link = `${ORIGIN}/registrierung?token=eins`;
    const { html, text } = renderMail({ ...MAIL, block: { link: link } });

    assert.include(html, `href="${link}"`);
    assert.include(text.split("\n"), link);
    assert.notInclude(html, 'fl-knopf"');
  });

  // A team name or a stated reason is typed outside the league and lands inside markup.
  it("escapes every value in the designed version", () => {
    const boese = '<img src=x onerror="alert(1)">';
    const { html } = renderMail({
      ...MAIL,
      subjectLine: boese,
      vorname: boese,
      absaetze: [[boese, [{ strong: boese }]]],
      block: { titel: boese, facts: [{ label: boese, value: boese }] },
      aktion: { label: boese, href: `${ORIGIN}/"><script>` },
    });

    assert.notInclude(html, "<img src=x");
    assert.notInclude(html, '"><script>');
  });

  // A break in a header ends it, and whatever follows is a header of its own.
  it("folds the subject to one line", () => {
    assert.notMatch(renderMail({ ...MAIL, subjectLine: "Spiel abgesagt\r\nBcc: fremd@example.com" }).subject, /[\r\n]/);
  });
});
