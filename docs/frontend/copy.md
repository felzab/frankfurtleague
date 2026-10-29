# Frontend — copy standard

**Purpose:** how every string a visitor reads on the site or in a mail is written. Read it before
you write one; the strings themselves live in the catalogue, `fl_frontend/src/core/copy.ts :: COPY`.

| Section                                                                   | Answers                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Where a string lives](#a-string-lives-in-the-catalogue-and-nowhere-else) | Which file a string, a date or the current time comes from |
| [Who approves](#i-approve-what-a-visitor-navigates-by)                    | Which strings ship and which are proposed                  |
| [The one test](#every-sentence-passes-the-one-test)                       | Whether a sentence is written at all                       |
| [Voice](#the-voice-is-plain-and-says-du)                                  | Address, who speaks, gendering, how a message reads        |
| [Lengths](#each-kind-of-string-has-a-ceiling)                             | How long a label, a button, a message or a mail may be     |
| [Fixed patterns](#a-recurring-job-takes-its-fixed-pattern)                | Which catalogue entry a recurring job takes, and when      |
| [Help text](#help-text-is-one-of-three-kinds)                             | How a field, a section or a state is explained             |
| [Formats](#dates-and-numbers-go-through-the-formatting-module)            | How a date, a time, a number or a score is written         |
| [Punctuation](#punctuation-is-german-and-sparse)                          | Quotation marks, the ellipsis, the dash, the banned words  |
| [Mail](#a-mail-is-one-small-set-of-data)                                  | What a mail holds and how its lines are written            |
| [Legal text](#legal-text-keeps-its-own-rules)                             | What the privacy notice and the consent pages may do       |

## A string lives in the catalogue and nowhere else

- **One typed catalogue, German only, keyed by area.** Its `shared` section comes first and every
  area draws from it; an area adds a key of its own only for a string `shared` lacks. No test hunts
  duplicate text, so review is what keeps a second „Gespeichert“ out.
- **A component's text prop takes `fl_frontend/src/core/copy.ts :: Copy`**, so a string typed into a
  page does not compile. An `as Copy` assertion outside the catalogue defeats that and is never
  written.
- **A parameterised entry is a typed function** taking data, never a sentence: the plural of an empty
  state is the list's own title entry, a date is a stored `YYYY-MM-DD` day.
- **Every date, time, number, amount, score and season label goes through
  `fl_frontend/src/core/format.ts`**, and the current time is read through
  `fl_frontend/src/core/clock.ts :: now` alone. Parsing a given date is not reading the clock.
- **No string is rewritten for a screen about to change or go**: a change writes the strings of what
  it builds.

## I approve what a visitor navigates by

- **I approve this page, the `shared` section's vocabulary and every string a visitor navigates by**
  — a menu entry, a page title, an address. Draft each of those with options beside the screen it
  sits on, and never ship one I have not picked.
- **Everything else ships under this page**, and I flag what I dislike on the screen it sits on.

## Every sentence passes the one test

**If the sentence were deleted, would the reader do something wrong?** If not, delete it. Copy says
what to do or what to expect, never how the system works. A shared string replaces a detailed one
wherever it can.

## The voice is plain and says du

- **Plain, friendly and factual.** No jokes, puns or football metaphors on a system state.
- **„du“, lower case, everywhere**, mails and the administration included, and never „ihr“, even for
  a shared mailbox.
- **The league says „wir“ only where people act**; the system never speaks for itself („Nicht
  gespeichert“, never „Wir konnten … nicht speichern“); „die Verwaltung“ appears only where a specific
  administrator acts.
- **Neutral nouns first** („Kontaktperson“, „Team“); recast the sentence with „du“ so most person
  nouns disappear; the masculine only in a tight label.
- **A message is short and plain.** Readers are not technical, and an unexpected failure is logged,
  so it says only that something went wrong. A field message states what is expected, in one of the
  fixed patterns: no field name, since it sits under its field, no article, no „Bitte“, no full stop,
  never „ungültig“.
- **Numbers are digits**, in prose too („14 Tage“).
- **German words**: „Ranking“, „Matchday“ and „&“ in running text are replaced; „Infos“ stays.

## Each kind of string has a ceiling

A message is written short enough for the narrowest place it appears, since it must fit one line
there.

| Kind                    | Ceiling                                     | Shape                                                                                           |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Navigation label        | 1 to 2 words                                | a noun                                                                                          |
| Page or section heading | 4 words                                     | a noun phrase, no full stop; a sentence standing as a heading is a status or a consequence      |
| Field label             | 3 words                                     | a noun, no colon                                                                                |
| Button                  | 3 words                                     | a verb from the catalogue's closed set, with an object where needed („Team anlegen“)            |
| Field description       | 1 sentence, 90 characters, one visible line | says what the thing is; none where the label suffices; no field has a placeholder               |
| Tooltip                 | 5 words                                     | names an icon-only control, nothing more                                                        |
| Section info tip (ⓘ)    | 2 sentences, about 200 characters           | only where a named question needs it                                                            |
| Field error             | one phrase, one line, 80 characters         | a fixed pattern                                                                                 |
| Form or page error      | 2 sentences                                 | what happened, then the one repair; a failure no reason names, the one line `fehler.unerwartet` |
| Empty state             | 1 sentence plus at most one button          | which narrowing emptied it                                                                      |
| Toast                   | a title of 1 to 3 words, no body            | a past participle; a failure, the one line `fehler.unerwartet`                                  |
| Page or section intro   | none                                        | a page's title is its explanation                                                               |
| List-truncation banner  | none                                        | the load-more control instead                                                                   |
| Page title              | the page's catalogue title                  | followed by the one suffix „\| Frankfurt League“; a match is „{Heim} gegen {Gast}“              |
| Callout                 | a title plus at most 1 sentence             | a state or a consequence                                                                        |
| Team description        | three lines                                 | then „Mehr …“ opening the rest                                                                  |
| Mail subject            | 50 characters                               | what it is about first, no league name                                                          |
| Mail body               | about 90 words                              | more only where the law requires it on a first contact                                          |

## A recurring job takes its fixed pattern

Each pattern is an entry of `COPY.shared`; what the entry cannot say is when it applies.

- **A field message** is one of `feld`'s patterns. A real rule takes the same form („Höchstens 11 in
  der Startelf“) in its area. The address example is `feld.beispielAdresse`, a reserved domain, never
  a school's address.
- **A refusal a person can cause knowingly from the screen** gets its own sentence: the reason, then
  the one repair. Every other refusal takes a `fehler` line: `veraltet` for a stale page or a
  concurrent change, `abgelaufen` for an ended sign-in, `unerwartet` for anything else.
- **A saved record** shows `gespeichert` beside its save button, never as a toast.
- **A toast** is one of `toast`'s four titles, and only for an action that leaves nothing on the page
  to change.
- **A busy button** keeps its label and shows a spinner named `laedt`; no „Speichert …“.
- **An empty list** says `leer.suche`, `leer.filter` or `leer.noch` with its own plural;
  `leer.filter` only where the list keeps a filter.
- **A confirmation** asks `frage` with the verb, says one sentence of consequence, carries that verb
  on its button and `zurueck` as the way back; never „Ja“.
- **A page a mail opens** ends in one of `ende`'s states: done, already done saying what the person
  did and when, or `linkUngueltig`, one message for an expired, mistyped or tampered link alike.
  Each ends in one button to the logical next step: `verb.anmelden` after a confirmed seat or address
  change, `ende.zurStartseite` after anything else.
- **A Vorschau line** names the changed fields by their own labels; there are no change-list labels.

## Help text is one of three kinds

- **A field description**: one visible line under the field, saying what the thing is.
- **One ⓘ per section**, right after its title, opening help a person sometimes needs. Text the
  reader needs is never hidden behind it.
- **A callout**: one visible state or consequence.

Nothing else explains: no ⓘ on a page title or a side panel, no menu hints, no intros, no
placeholders, no truncation banners.

## Dates and numbers go through the formatting module

`fl_frontend/src/core/format.ts` holds each form beside the function writing it: a date in a list or
a field message, a date in a sentence or a mail, a time, a moment, a range, a number, an amount, a
score and a season. Two rules no function states:

- **A range is the only place a dash appears**, and the locale writes it, dropping what both ends
  share.
- **After a shoot-out** a score is each side's goals and shoot-out goals added, with
  `nachElfmeterschiessen` beside it.

A date field shows „tt.mm.jjjj“ and a time field „––:––“ while empty; the field's locale writes both.

## Punctuation is German and sparse

- **German capitalisation**, no English title case.
- **No full stop** after a heading, a label, a button, a tooltip or a one-phrase line; a full sentence
  ends with one.
- **Quotation marks „…“.** The ellipsis character „…“ only for truncation and in `mehr`; never three
  periods.
- **No „!“. No dash** except in a date range. **No semicolon** outside legal text.
- **Banned**: „Bitte“; „erfolgreich“, „leider“, „wirklich“; a reassurance tail („wurde automatisch
  gemeldet“); „und mehr…“; „z.B.“ and „z. B.“, recast instead; a noun phrase where a verb exists
  („Konto löschen“, never „Löschung deines Kontos“); the passive where there is an actor; a body
  repeating its title; a sentence opening with „Damit“, „So“, „Dadurch“ or „weil“ that explains the
  design; „Mannschaft“ and „noch einmal“.
- **One word per concept**, on screen, in the code's names and, for a glossary term, in the address:
  the word is the `shared` entry or the [glossary](../glossary.md)'s, never a synonym.

## A mail is one small set of data

- **Subject, preview, heading, paragraphs, facts, one button, one note**, nothing else. The heading
  repeats the subject and the hidden preview is the first sentence, so neither is written twice.
- **The greeting is „Hallo {Vorname},“** where the first name is known, otherwise „Hallo,“.
- **A „not you?“ line only on a sign-in, security or first-contact mail**; the objection line only on
  a first contact, in its one wording.
- **Replies go to the contact address**, so no mail says that nobody reads them.

## Legal text keeps its own rules

- **Semicolons are allowed here alone.**
- **A consent wording a stored record references stays as it was shown**, superseded or not.
