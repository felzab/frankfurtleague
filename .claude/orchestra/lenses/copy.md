# Lens: copy

**Question.** Does each string a visitor reads, on a page or in a mail, keep the copy standard,
`docs/frontend/copy.md`? Types and lint hold where a string lives; whether it is the right pattern,
the shared entry rather than a second one, or a sentence that should not exist, only a reader holds.

**Read first.** `docs/frontend/copy.md` whole and the glossary, `docs/glossary.md`. Then the change
to the catalogue, `fl_frontend/src/core/copy.ts` and its audience files under
`fl_frontend/src/core/copy/`, `fl_frontend/src/core/serverCopy.ts` and
`fl_frontend/src/core/consentWordings.ts`, and each component, action or mail using an entry the
change adds or alters.

**Checklist.**

1. Each new or changed sentence: would a reader do something wrong without it? Where not, it goes.
2. Does a message under a field take one of `COPY.shared.field`'s patterns, filled with the rule's
   bounds, and does a status line or callout say what is so, never why or how to repair it?
3. Does a new entry repeat a string the catalogue already holds under another key: any section of
   `COPY`, its own or another audience's constant, `SERVER_COPY` or `copy.ts`'s plain words? No test
   hunts duplicate text.
4. Is each string within its kind's ceiling, in the voice and punctuation the standard sets?
5. Does each date, time, number, score and season's name go through the formatting module or the
   catalogue's season entries, and the current time through the clock module?
6. Is each domain term spelled as the glossary spells it?
7. Does a mail hold only the data the standard's section on mail allows?
8. Is a consent wording or a legal text changed only as the standard's section on legal text allows?
9. Does each new field pattern serve many fields, as the standard requires, rather than one?

Name each string by its catalogue key and where it renders.

**Not its business.** Whether a person can perceive and operate the text (`accessibility`), and
taste the standard does not rule on, which the owner flags on the screen it sits on.

**Silent.** Yes: a string off the standard renders and passes every check, and a mail or a rare
state may never reach the owner's screen.

**Applies.** paths `fl_frontend/src/**` except `**/*.test.*`, `fl_frontend/src/test-support/**`,
`fl_frontend/src/core/generated/**`.

**Run by.** auditor.
