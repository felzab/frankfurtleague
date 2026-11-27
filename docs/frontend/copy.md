# Frontend — copy standard

**Purpose:** how every string a visitor reads on the site or in a mail is written. Read it before
you write one; the strings themselves live in the catalogue, under `fl_frontend/src/core/copy/`.

| Section                                                                   | Answers                                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [The five rules](#five-rules-hold-every-string)                           | What every string obeys                                                      |
| [Where a string lives](#a-string-lives-in-the-catalogue-and-nowhere-else) | Which file a string, a date or the current time comes from                   |
| [Who decides](#every-string-ships-under-this-page)                        | How a string ships                                                           |
| [The one test](#every-sentence-passes-the-one-test)                       | Whether a sentence is written at all                                         |
| [Voice](#the-voice-is-plain-and-says-du)                                  | Address, who speaks, gendering, how a message reads                          |
| [Lengths](#each-kind-of-string-has-a-ceiling)                             | How long a label, a button, a message or a mail may be, and what may explain |
| [Fixed patterns](#a-recurring-job-takes-its-fixed-pattern)                | Which catalogue entry a recurring job takes, and when                        |
| [Formats](#dates-and-numbers-go-through-the-formatting-module)            | How a date, a time, a number or a score is written                           |
| [Punctuation](#punctuation-is-german-and-sparse)                          | Quotation marks, the ellipsis, the banned words                              |
| [Mail](#a-mail-is-one-small-set-of-data)                                  | What a mail holds and how its lines are written                              |
| [Legal text](#legal-text-keeps-its-own-rules)                             | What the privacy notice and the consent pages may do                         |

## Five rules hold every string

1. **Every string a visitor reads comes from the catalogue**: no one-off is typed into a page, a
   module or a component.
2. **Under a field stands only one of `COPY.shared.field`'s patterns**, filled with the rule's
   bounds: one phrase, no full stop, no article, no field name, at most 80 characters.
3. **A new pattern is added only where it serves many fields.**
4. **Everything else stands on the status line or in a callout** as one short declarative catalogue
   sentence saying what is so, never why it is so or how to repair it.
5. **The sign-in follows the same rules**: its code boxes show a pattern-form phrase, and every
   other refusal stands on its status line. Its address view alone says no `template.checkFields`,
   [as the refusal pattern says](#a-recurring-job-takes-its-fixed-pattern).

## A string lives in the catalogue and nowhere else

- **One typed catalogue, German only, keyed by who reads it, with one module per audience**. The
  frozen consent wordings stand beside it, and the association's fixed facts are in
  `fl_frontend/src/core/brand.ts`. A bundler keeps the whole of an object that a client module
  imports, so each audience's words are a constant of their own under `fl_frontend/src/core/copy/`,
  and a page's bundle carries only the audiences its modules import. The five constants are:
  - `shared.ts :: COPY`, which holds what several audiences read and which any module may import;
  - `public.ts :: PUBLIC_COPY`, for the public forms, the sign-in and the landing;
  - `account.ts :: ACCOUNT_COPY`, for Konto and the mailed pages that act on it;
  - `area.ts :: AREA_COPY`, for the pages under `/area`;
  - `admin.ts :: ADMIN_COPY`, for the administration.
- **No barrel joins the five modules.** `fl_frontend/src/core/copy.ts` holds what they share: the
  `Copy` brand, `catalogue`, the helpers, and the plain words that more than one audience builds its
  entries from.
- **`COPY`'s `shared` section comes first** and holds what several areas read. A record's words that
  several areas read stand under the record's noun in `COPY`: a club's in `team`, a match's in
  `spielplan`, a squad row's in `kader` and a line-up's in `aufstellung`. Each other audience's
  constant holds only what that audience alone reads. A module imports `COPY` and the constants of
  the audiences whose pages it serves.
- **`ADMIN_COPY` is imported only by the administration.** Lint refuses an import of `copy/admin`
  outside `fl_frontend/src/app/admin`, the modules the ban's allow list names, and `SERVER_COPY`
  (`fl_frontend/eslint.config.mjs :: importBan(ADMIN_CATALOGUE, …)`).
- **A string has one key.** No test hunts duplicate text, so review is what keeps a second
  „Gespeichert“ out.
- **A string only the server reads stands in the server's own object**,
  `fl_frontend/src/core/serverCopy.ts :: SERVER_COPY`, so that no client bundle carries it. A mail,
  a refusal's sentence and a page's description are such strings.
- **A group indexed by a union the backend serves names that union** in a `satisfies Record<…>` on
  its literal, so an entry for a member the backend no longer serves fails the type check.
- **A component's text prop takes `fl_frontend/src/core/copy.ts :: Copy`, or a record's own data as
  `{ record }` (`Words`)**, so a string typed into a page does not compile, and lint refuses a
  literal inside a `{ record }`. A prop holding a block, such as a door's act, takes a
  `ReactElement`, which a bare string is not. An `as Copy` assertion outside the catalogue defeats
  that and is never written.
- **A parameterised entry is a typed function** taking data or another entry, never a sentence or a
  string to pass through. The plural of an empty state is the list's own entry, a date is a stored
  `YYYY-MM-DD` day, and a year a range ends on is `{ year }`. A name that may be the catalogue's or
  a record's is `Words`, and lint refuses an entry returning its argument as it came.
- **Every date, time, number, amount and score goes through `fl_frontend/src/core/format.ts`, and
  every season's name through `COPY.shared.saisonName`, or `COPY.shared.saisonNameBound` inside a
  phrase binding a word to it**, and the current time is read through
  `fl_frontend/src/core/clock.ts :: now` alone. Parsing a given date is not reading the clock.
- **No string is rewritten for a screen about to change or go**: a change writes the strings of what
  it builds.

## Every string ships under this page

A string a visitor navigates by, such as a menu entry, a page title or an address, ships like any
other. The owner flags what they dislike on the screen it sits on.

## Every sentence passes the one test

**If the sentence were deleted, would the reader do something wrong?** If not, delete it. Copy says
what is so or what to expect, never why it is so, how to repair it or how the system works. A shared
string replaces a detailed one wherever it can, and one sentence serves every place that means the
same thing. A reason stands on its own only where the reader would not think of it and can act on
it, in as few words as say it.

## The voice is plain and says du

- **Plain, friendly and factual.** No jokes, puns or football metaphors on a system state.
- **„du“, lower case, everywhere**, mails and the administration included, and never „ihr“, even for
  a shared mailbox.
- **The league says „wir“ only where people act**; the system never speaks for itself („Nicht
  gespeichert“, never „Wir konnten … nicht speichern“); „die Verwaltung“ appears only where a
  specific administrator acts.
- **Neutral nouns first** („Kontaktperson“, „Team“); recast the sentence with „du“ so most person
  nouns disappear; the masculine only in a tight label.
- **A message is short and plain.** Readers are not technical, and an unexpected failure is logged,
  so it says only that something went wrong.
- **Numbers are digits**, in prose too („14 Tage“).
- **German words**: „Ranking“, „Matchday“ and „&“ in running text are replaced; „Infos“ stays.

## Each kind of string has a ceiling

A message is written short enough for the narrowest place it appears: one longer than its field
wraps and takes a second line, which moves what stands below it.

| Kind                    | Ceiling                                                         | Shape                                                                                                               |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Navigation label        | 1 to 2 words                                                    | a noun                                                                                                              |
| Page or section heading | 4 words                                                         | a noun phrase, or the one act a page exists for („Anmelden“), no full stop; a sentence is a status or a consequence |
| Field label             | 3 words                                                         | a noun, no colon                                                                                                    |
| Button                  | 3 words                                                         | a verb from the catalogue's closed set, with an object where needed („Team anlegen“)                                |
| Field description       | 1 sentence, 90 characters                                       | says what the thing is, or which other value closes it; none where the label suffices; no field has a placeholder   |
| Option note             | one phrase                                                      | why a disabled choice cannot be made, only where it says more than the muted entry does                             |
| Box description         | 1 sentence or phrase, one visible line at 360 px, 42 characters | says what a Konto box holds, under its title; on „Deine Einträge“ a noun phrase adding to the title, no full stop   |
| Tooltip                 | 5 words                                                         | names an icon-only control, or says why a locked act cannot run                                                     |
| Section info tip (ⓘ)    | 2 sentences, or a key of short lines; about 200 characters      | one per section, after its title, only where a named question needs it; a key, „Mark: meaning“                      |
| Field error             | one phrase, 80 characters                                       | a fixed pattern                                                                                                     |
| Form refusal            | 1 short sentence, the status line's two lines on a phone        | a plain fact about the whole form, or about a field no pattern words, naming that field                             |
| Failure line            | 1 short sentence, the status line's two lines on a phone        | what happened, never the repair; an unworded refusal reads `failure.stale`, an outage `failure.unexpected`          |
| Empty state             | 1 sentence, and a muted line where a list has nothing yet       | which narrowing emptied it                                                                                          |
| Toast                   | a title of 1 to 3 words, or 1 short sentence; no body           | done, a past participle or the act's note; refused, its own sentence or its `failure` line                          |
| Page or section intro   | none                                                            | a page's title is its explanation                                                                                   |
| List-truncation banner  | none                                                            | the load-more control instead                                                                                       |
| Page title              | the page's catalogue title                                      | followed by the one suffix „\| Frankfurt League“; a match is „{Team 1} vs. {Team 2}“                                |
| Callout                 | a title plus at most 1 sentence                                 | a state or a consequence                                                                                            |
| Team description        | three lines                                                     | „Mehr“ inside the text at the third line's end, no „…“ before it, opening the rest                                  |
| Mail subject            | 50 characters                                                   | what it is about first, no league name                                                                              |
| Mail body               | about 90 words                                                  | more only where the law requires it on a first contact                                                              |

Help text is a field description, a box description, one ⓘ per section or a callout, and text the
reader needs is never hidden behind an ⓘ. A Konto box is the one section carrying a line under its
title, since Konto's boxes are one shape whatever each holds. Nothing else explains: no ⓘ on a page
title or a side panel, no menu hints, no intros, no placeholders, no truncation banners.

## A recurring job takes its fixed pattern

Each pattern is an entry of `COPY.shared`; what the entry cannot say is when it applies.

- **A field message** is one of `field`'s patterns, whether the form's own check or the backend's
  rule refused the value, filled with the bounds the rule names („Höchstens 11“ under the Startelf's
  box). The address example is `field.exampleAddress`, a reserved domain, never a school's address.
- **A refusal is worded wherever the catalogue has words for it**, on every screen that can place
  them. One that a pattern of `field` words shows on its field's box, and the status line says
  `COPY.template.checkFields`, save on the sign-in's address view: a page of one field, whose box
  takes the focus on a refusal so that a screen reader reads it with its phrase, and whose status
  line stays empty, since it would only point at the box already in focus. One about the whole form,
  or about a field no pattern words, takes the status line: one short sentence that fits its two
  lines on a phone, naming its field where it has one. A field phrase never stands on the status
  line, since it has no subject there, so a phrase whose field the screen shows no box for counts as
  unworded. A catalogue sentence states the fact and never why it holds or how to repair it.
- **Every other refusal takes a `failure` line.** `stale` answers every refusal of the request the
  catalogue does not word, since the page read again shows the record as it stands. `signInExpired`
  answers an ended sign-in, and `tooManyAttempts` every limit on tries, whatever it counts.
  `unexpected` answers an outage, a fault inside the system, a bot check that did not run, and a
  request the API does not serve, such as one missing its credential.
- **An editor's save** shows its note, else `saved`, on its save bar, beside the save button, never
  as a toast. The save bar is the one place a done act stays on a line, since its line is a fixed
  row that moves nothing as it speaks.
- **A toast** answers every other done act: a closed question, a closed dialog with fields, a
  section's act in an editor, a Konto box, a page that is one question, and an act that leaves
  nothing on the page to change. Its title is the act's note, else its verb's past participle from
  `toast.done` or another of `toast`'s titles, in the warn tone where the act partly happened
  (`fl_frontend/src/kit/Toast.tsx :: toastAnswer`). A done act's toast leaves by itself unless it
  brings a note; a note, a refusal or a partial outcome stands until it is closed.
- **A refusal** keeps its line beside what it names: the question's, the dialog's, the box's or the
  section's, never a toast, since only a done act closes its question or its dialog. An act behind
  the passkey touch keeps its dialog, which stands aside for the browser's prompt alone and stands
  again for the answer, so a field's refusal takes its box's phrase there as anywhere.
- **A busy button** keeps its label and shows a spinner named `loading`; no „Speichert …“.
- **An empty list** says `empty.search`, `empty.filter`, `empty.none`, `empty.skipped` or
  `empty.unrecorded` with its own plural; `empty.filter` only where the list keeps a filter,
  `empty.skipped` only where a person left every row out of a run, `empty.unrecorded` only where a
  closed record's list holds none and none is to come, such as a finished season's. A list that is
  one record named by a masculine or neuter noun, a team's „Kader“, says `empty.noneOne` with that
  noun, or `empty.unrecordedOne` where its record is closed, and a list of open work with nothing
  waiting, such as an Übersicht card, says `empty.nothingOpen`, naming no plural.
- **A confirmation** asks `question` with the verb, says one short sentence of consequence, carries
  that verb on its button and `back` as the way back; never „Ja“. `back` stays where a way back
  opened the question, as the discard question an editor's or a dialog's „Zurück“ raises over
  unsaved changes: there „Zurück“ keeps the person where they are, beside „Verwerfen“, so a
  question's way back is one word on every screen. What the sentence rests on stands under it as
  facts rows, never inside it: a move's old and new slot, the season a switch leaves and takes, the
  counts an act removes, and whom the act mails.
- **A status card** is a mark, a title and its way on, with no sentence: a not-found, an error, a
  state with nothing to show yet, and every end of a page a mail opens. An error card's way on is
  `verb.retry`, which draws the failed page again in place; where no frame stands around the card,
  `end.toHome` stands beneath it as the quieter way. In a rail frame the title stands once. A page
  with a name of its own keeps that name in the strip, and its card carries the end's title, as the
  referee's Spielbericht for a match with no date says „Termin offen“. A boundary with no page of
  its own, the not-found and the error page, has its title in the strip, and its card holds no
  second one.
- **A page a mail opens** ends in a status card: done, already done titled with what the person did
  and the day (`end.doneOn`), or `template.linkInvalid`, one title for an expired, mistyped or
  tampered link alike. Each ends in one button to the logical next step: `verb.signIn` after a
  confirmed seat or address change, `end.toAccount` where Konto is the one place to change what was
  done and for an address change's or a deletion's link that no longer holds, `end.toHome` after
  anything else. The deletion's done page adds the privacy notice beneath it as a quieter link.
- **A column a narrow box leaves out** holds no fact the row shows nowhere else: where the row
  itself opens no page or dialog holding it, the row's phone line carries it, after its column's
  label where the value alone would not say what it is („Gültig bis Saison 2027“). An act's question
  is no such place, since nobody opens a removal to read a date.
- **A Vorschau line** says a fact about the record as it is stored, such as a match's pairing, its
  day and its result or „Noch kein Ergebnis“; never the unsaved changes, which the save bar counts.
- **A lock is said once, in an editor's lock line**, muted under its title: the reasons alone, each
  once and short enough that the line never wraps on a 360-px phone, „Gesperrt seit Saisonbeginn und
  durch Spielplan.“ (`COPY.template.lockLine`). Each locked field shows the lock mark at its label,
  so the line names no field. A closed record's reason stands in its place, and no box carries a
  lock note: the warn hue is for what a change being made will cause.

## Dates and numbers go through the formatting module

`fl_frontend/src/core/format.ts` holds each form beside the function writing it: a date in a list or
a field message, a date in a sentence or a mail, a time, a moment, a range, a number, an amount and
a score. A season's name is the catalogue's `COPY.shared.saisonName`, since its id is its year and
needs no formatting. Inside a phrase binding a word to it, such as „Gültig bis Saison 2027“, it is
`COPY.shared.saisonNameBound`, whose space is a no-break space, so a line never parts the word from
its year; a mail's subject, a tab's title and words a person matches as typed keep the plain space.
A moment in a list's form, „07.11.2026, 18:04“, is one fact the same way: `formatInstantShort` binds
its date to its time. Two rules no function states:

- **A dash appears in three places**: a range's, which the locale writes, dropping what both ends
  share; a value not there yet, `noValue`; and between a pairing's two sides where no score stands,
  `versus`.
- **After a shoot-out** a score is each side's goals and shoot-out goals added, with
  `afterElfmeterschiessen` beside it.

A date field shows „TT.MM.JJJJ“ and a time field „––:––“ while empty: the field's locale writes
both, and the kit sets the date's letters in capitals
(`fl_frontend/src/kit/fieldStyles.ts :: dateSegment`).

## Punctuation is German and sparse

- **German capitalisation**, no English title case.
- **No full stop** after a heading, a label, a button, a tooltip or a one-phrase line; a full
  sentence ends with one.
- **Quotation marks „…“.** The ellipsis character „…“ only for truncation; never three periods.
- **No „!“. No semicolon** outside legal text.
- **Banned**: „Bitte“; „erfolgreich“, „leider“, „wirklich“; a reassurance tail („wurde automatisch
  gemeldet“); „und mehr…“; „z.B.“ and „z. B.“, recast instead; a noun phrase where a verb exists
  („Konto löschen“, never „Löschung deines Kontos“); the passive where there is an actor; a body
  repeating its title; a sentence opening with „Damit“, „So“, „Dadurch“ or „weil“ that explains the
  design; „ungültig“, „Mannschaft“ and „noch einmal“.
- **One word per concept**, on screen, in the code's names and, for a glossary term, in the address:
  the word is the `shared` entry or the [glossary](../glossary.md)'s, never a synonym.

## A mail is one small set of data

- **Subject, preview, heading, paragraphs, facts, one button, one note**, nothing else. The heading
  repeats the subject and the hidden preview is the first sentence, so neither is written twice.
- **The greeting is „Hallo,“** on every mail, and the paragraph after it begins small (Duden, D
  132): the catalogue writes each opening as the sentence it is, and
  `fl_frontend/src/core/emailShell.ts` lower-cases its first letter unless the mail's `opensOnNoun`
  says it opens on a noun, a record's value run never being re-cased.
- **A „not you?“ line only on a sign-in, security or first-contact mail**; the objection line only
  on a first contact, in its one wording. The ban's notice is a first communication without the
  first-contact „not you?“, which would promise a deletion a ban does not make, so its builder sets
  the objection as its own last paragraph.
- **Replies go to the contact address**, so no mail says that nobody reads them.
- **A mail states no later act the code does not perform**, since its reader waits for it and passes
  it on.

## Legal text keeps its own rules

- **A consent's label is its whole sentence**, past a field label's 3 words, because the sentence is
  what the person agrees to.
- **A consent wording stays as it was shown**, because a stored record cites its words by label: it
  lives outside the catalogue, in `fl_frontend/src/core/consentWordings.ts :: CONSENT_WORDINGS`,
  where new words are a new label beside it. The one exception is the paste the deploy of the
  current wordings owes, which re-points every stored record's label to its consent's current
  wording. A record stamped before that deploy therefore cites words its person was not shown
  ([the `Fassung` entry](../glossary.md#fassung--wording--one-frozen-consent-wording-a-person-was-shown-under-its-label)).
