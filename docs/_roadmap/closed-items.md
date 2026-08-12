# Closed items

**Verified against:** `84d43da`, 2026-08-10

Every item that has left [`open-items.md`](open-items.md) has a row here. This is a log: nothing in
it is waiting for anything, and a regression is a new item with a new ID rather than an edit to a
row.

**An ID is never reused**, and a new item takes the next free number in its prefix, retired IDs
counted. A row is cited by its ID, and its position carries no meaning. What each column holds — and
the rule that the row is a pointer while the closing commit's body is the record — is in
[`protocol.md`](protocol.md#the-closed-row).

**`OPS-8` is in neither roadmap file and nothing records what it was.** Nothing takes that number.

## The log

| ID    | Item                                                                                               | Surfaces    | Effort | Depended on                  | Closed in                                                             |
| ----- | -------------------------------------------------------------------------------------------------- | ----------- | ------ | ---------------------------- | --------------------------------------------------------------------- |
| F5    | A backend module that was empty and imported by nothing                                            | BE          | S      | —                            | [`6535247`](https://github.com/felzab/frankfurtleague/commit/6535247) |
| F6    | A comment deferring a granular cache tag to a route that already existed                           | FE          | S      | —                            | [`6535247`](https://github.com/felzab/frankfurtleague/commit/6535247) |
| OPS-1 | Container images published to Docker Hub, and where they should live                               | Ops         | M      | —                            | [`b2e80f2`](https://github.com/felzab/frankfurtleague/commit/b2e80f2) |
| DB-1  | Review the database structure against the models, and decide what is stored                        | DB, BE      | L      | —                            | [`75c0ce4`](https://github.com/felzab/frankfurtleague/commit/75c0ce4) |
| F4    | Team statistics were written to `teams` and read from `saison_teams`                               | BE, DB      | M      | DB-1                         | [`65be39a`](https://github.com/felzab/frankfurtleague/commit/65be39a) |
| FB-1  | The Saisontabelle counted playoff results as league results                                        | FE, BE      | M      | —                            | [`3a460d7`](https://github.com/felzab/frankfurtleague/commit/3a460d7) |
| BE-11 | Nothing executed the derived league table's pipeline against a database                            | BE          | S      | —                            | [`e506762`](https://github.com/felzab/frankfurtleague/commit/e506762) |
| DB-3  | Seventeen `saison_teams` rows still carried the `statistik` the derivation orphaned                | DB          | S      | —                            | [`1acfc49`](https://github.com/felzab/frankfurtleague/commit/1acfc49) |
| DB-2  | Nine collections with no validator and no index beyond `_id_`, hand-edited daily                   | DB, BE, Ops | M      | —                            | [`5c017f8`](https://github.com/felzab/frankfurtleague/commit/5c017f8) |
| BE-4  | Six reference collections could only be read; edits went straight into MongoDB                     | BE, FE, Ops | L      | —                            | [`3d7f701`](https://github.com/felzab/frankfurtleague/commit/3d7f701) |
| OPS-4 | Script terminal output varied by script, with no recorded standard                                 | Ops         | M      | — (batched with OPS-5)       | [`f4b99ae`](https://github.com/felzab/frankfurtleague/commit/f4b99ae) |
| OPS-5 | Every pull request ran the full gate and both CodeQL analyses, whatever it touched                 | Ops         | M      | — (batched with OPS-4)       | [`f4b99ae`](https://github.com/felzab/frankfurtleague/commit/f4b99ae) |
| OPS-6 | Whether a pull request body should index its commits, when their bodies say it                     | Ops         | S      | —                            | [`e31d187`](https://github.com/felzab/frankfurtleague/commit/e31d187) |
| OPS-7 | Nothing checked the gate scope a run was given against the diff it was given                       | Ops         | S      | —                            | [`501e450`](https://github.com/felzab/frankfurtleague/commit/501e450) |
| LOG-1 | Logging was surveyed, then standardised: one correlation id, one stream per service                | FE, BE, Ops | L      | —                            | [`87ce77c`](https://github.com/felzab/frankfurtleague/commit/87ce77c) |
| F2    | The Pydantic models and their Zod mirror were hand-maintained with nothing comparing them          | FE, BE      | M      | —                            | [`a9bbc71`](https://github.com/felzab/frankfurtleague/commit/a9bbc71) |
| BE-9  | An unresolved playoff opponent was a real team document named "TBD"                                | BE, FE      | L      | —                            | [`ca63cd9`](https://github.com/felzab/frankfurtleague/commit/ca63cd9) |
| FB-4  | The playoff bracket had no seeding check and advanced no winner when a result was entered          | FE, BE      | M      | — (slot model: ADR-0034)     | [`f023414`](https://github.com/felzab/frankfurtleague/commit/f023414) |
| FB-10 | The first knockout round could not be seeded, because nothing could say who finished second        | FE, BE, DB  | L      | — (batched with FE-4)        | [`aebf43d`](https://github.com/felzab/frankfurtleague/commit/aebf43d) |
| FE-4  | The Saisontabelle marked nobody as holding a playoff place                                         | FE, BE      | M      | — (batched with FB-10)       | [`aebf43d`](https://github.com/felzab/frankfurtleague/commit/aebf43d) |
| FB-8  | A knockout that ended level had nowhere to record how it was decided, so the bracket stalled       | FE, BE, DB  | M      | — (clock: the playoffs)      | [`ab20403`](https://github.com/felzab/frankfurtleague/commit/ab20403) |
| FB-12 | A knockout slot with no team and no source was maintained by nobody and reported by nobody         | FE, BE      | S      | — (clock: the playoffs)      | [`6331791`](https://github.com/felzab/frankfurtleague/commit/6331791) |
| FB-13 | Two bracket faults lived in one toast and three more were contained without a word                 | FE, BE      | M      | — (surface: ADR-0038)        | [`125f1cc`](https://github.com/felzab/frankfurtleague/commit/125f1cc) |
| FB-14 | The seeding, advancement, edit and feedback surfaces measured against established practice         | FE, BE, DB  | L      | — (owned FB-9's verdict)     | [`0fae7b4`](https://github.com/felzab/frankfurtleague/commit/0fae7b4) |
| FE-10 | The match editor was a dialog with no URL, 311px of width and a round-trip per error message       | FE          | L      | — (ADR-0041 landed on it)    | [`efed00a`](https://github.com/felzab/frankfurtleague/commit/efed00a) |
| FE-11 | A toast could not be dismissed without a hover, and every message shared a four-second clock       | FE          | S      | — (ADR-0041 shaped it)       | [`cc55487`](https://github.com/felzab/frankfurtleague/commit/cc55487) |
| FE-12 | An eight-section accordion ordered by how the categories happened to be declared                   | FE          | M      | — (its links had a target)   | [`68ac42d`](https://github.com/felzab/frankfurtleague/commit/68ac42d) |
| FB-2  | A team could only **be** disqualified, with no record of why or from when                          | FE, BE, DB  | M      | —                            | [`3669cc7`](https://github.com/felzab/frankfurtleague/commit/3669cc7) |
| FB-5  | The Spiel cards were the one surface a disqualification could not reach                            | FE, BE      | S      | — (FB-2 shaped the field)    | [`3287df2`](https://github.com/felzab/frankfurtleague/commit/3287df2) |
| FB-11 | A season's bracket wiring had no view, and was editable only one match at a time                   | FE, BE      | L      | —                            | [`dfec0fa`](https://github.com/felzab/frankfurtleague/commit/dfec0fa) |
| FE-13 | Two admin tables still scrolled sideways on a phone                                                | FE          | S      | — (teams table templated it) | [`7c506e5`](https://github.com/felzab/frankfurtleague/commit/7c506e5) |
| FB-3  | The admin panel could edit no team and no player; both were hand-edited in MongoDB                 | FE, BE      | L      | — (ADR-0040's patterns)      | [`5518774`](https://github.com/felzab/frankfurtleague/commit/5518774) |
| FB-6  | The rollover was done by hand against endpoints that already existed, with no page calling one     | FE, BE      | L      | — (ADR-0026 settled it)      | [`fa5832a`](https://github.com/felzab/frankfurtleague/commit/fa5832a) |
| FE-5  | The Spielsuche could only be searched, not narrowed, and Spielhistorie duplicated it               | FE          | M      | — (F1 informed it)           | [`9a0f3b5`](https://github.com/felzab/frankfurtleague/commit/9a0f3b5) |
| F7    | The landing page's season badge was a literal that no rollover would have moved                    | FE          | S      | — (clock: the rollover)      | [`9cb426d`](https://github.com/felzab/frankfurtleague/commit/9cb426d) |
| FE-9  | User-facing copy mixed the capitalised Du with lowercase, and no recorded rule said which          | FE          | S      | —                            | [`4ff9af6`](https://github.com/felzab/frankfurtleague/commit/4ff9af6) |
| BE-10 | The season document was read from Mongo on every request that resolved or scored with it           | BE          | S      | —                            | [`c26c3e3`](https://github.com/felzab/frankfurtleague/commit/c26c3e3) |
| FE-8  | The compact card's metadata row could not wrap, and crushed its info button on phones              | FE          | S      | — (overlaps FE-3)            | [`b86e282`](https://github.com/felzab/frankfurtleague/commit/b86e282) |
| FE-7  | The delete confirmation's second step turned the blurred backdrop flat as it animated in           | FE          | S      | —                            | [`69c506f`](https://github.com/felzab/frankfurtleague/commit/69c506f) |
| FB-9  | A manual knockout slot accepted a disqualified team silently, and a matchday could field one twice | FE, BE      | M      | — (ADR-0042 settled it)      | [`4d35788`](https://github.com/felzab/frankfurtleague/commit/4d35788) |
| BE-13 | A malformed id answered 404 in a path and 422 in a query, and no rule said the split was meant     | BE          | S      | —                            | [`4fcb250`](https://github.com/felzab/frankfurtleague/commit/4fcb250) |
| F1    | The server's `ausstehend` included today and the client's excluded it, with the intent unsaid      | FE, BE      | S      | — (latest with FE-1)         | [`2ea28e0`](https://github.com/felzab/frankfurtleague/commit/2ea28e0) |
| OPS-9 | The assistant hooks gated every session and nothing linted or executed any of them                 | Ops         | S      | —                            | [`1d98034`](https://github.com/felzab/frankfurtleague/commit/1d98034) |
| FE-2  | A match had nowhere to carry a sentence about itself, and the editor nothing to write one with     | FE (+BE)    | S      | — (batch with FB-7, FE-1)    | [`0efa98e`](https://github.com/felzab/frankfurtleague/commit/0efa98e) |
| FE-6  | The error page logged everything and offered its reader no way to say what they were doing         | FE          | S      | —                            | [`11497ba`](https://github.com/felzab/frankfurtleague/commit/11497ba) |
| DOC-1 | A stamp-only markdown edit re-armed the branch-impact check on every page citing the restamped one | Docs        | S      | —                            | [`e578e0e`](https://github.com/felzab/frankfurtleague/commit/e578e0e) |
| BE-6  | `CustomObjectId` accepted any string in JSON mode and converted one in Python mode                 | BE          | —      | —                            | [`f8d9955`](https://github.com/felzab/frankfurtleague/commit/f8d9955) |
| FE-3  | The team page's progress line named no milestone, and nothing public said why a team was out       | FE          | M      | —                            | [`43cd0ae`](https://github.com/felzab/frankfurtleague/commit/43cd0ae) |
