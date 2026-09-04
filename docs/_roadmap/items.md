# Open items

**Purpose:** everything open on the product, the toolchain, the gate and the documentation corpus —
each entry carrying the analysis its decision needs. How an entry is authored, tagged and closed is
[`protocol.md`](protocol.md)'s.

| Section                                               | Answers                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| [What every entry carries](#what-every-entry-carries) | Which fields an entry states, and what each one may hold |
| [The items at a glance](#the-items-at-a-glance)       | Every item, its tags and its status                      |
| [The items](#the-items)                               | Each entry in full                                       |

## What every entry carries

An entry is a ``### `<token>` · <the claim>`` heading, then one table of the three fields below, then
the analysis, and it says what is wrong, why it matters and what done looks like. Analysis stays
only where it changes the approach — a rejected alternative written as a present constraint, or a
trap the implementer would otherwise walk into. Everything else goes to the body of the commit that
files the entry, which `git log -S` reaches.

| Field          | Holds                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tags**       | Every axis below that the paths the entry names fall under. Derived from the entry's own text, never chosen: a tag disagreeing with what is written is the failure this field exists to catch |
| **Status**     | One value from the closed set [`protocol.md`](protocol.md) derives                                                                                                                            |
| **Depends on** | The token of an entry here that blocks this one, or an em dash                                                                                                                                |

**A token is eight characters from `abcdefghjkmnpqrstuvwxyz23456789`, hyphenated after the fourth** —
no `i`, `l`, `o`, `0` or `1`, because a token is read aloud and typed into a commit trailer.
It is generated at random when the entry is filed rather than allocated from a sequence, checked for
collision with one `git grep`, and carries no order and no meaning. It is never reused, and a
closing commit's trailer names it.

**Tags come from three axes, and an entry carries every tag its own text earns.**

| Axis        | Vocabulary                                                                      | Derived from a path or symbol under                              |
| ----------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Surface** | `FE`                                                                            | `fl_frontend/`                                                   |
|             | `BE`                                                                            | `fl_backend/` whole, `tests/` included                           |
|             | `DB`                                                                            | a collection name, an index, `fl_backend/app/core/crud.py`       |
|             | `Ops`                                                                           | `scripts/`, `nginx/`, `.githooks/`, a compose file, a Dockerfile |
|             | `Docs`                                                                          | `docs/`, `.claude/`                                              |
| **Concern** | `gate`                                                                          | `scripts/gate/`, `scripts/checks/`, `.githooks/`                 |
|             | `ci`                                                                            | `.github/` whole, not its `workflows/` and `actions/` alone      |
|             | `tests`                                                                         | `scripts/tests/`, `fl_backend/tests/`, a `*.test.ts`             |
|             | `edge`                                                                          | `nginx/`, Cloudflare, a compose service definition               |
|             | `versions`                                                                      | a manifest, a lockfile, a pin, a digest                          |
| **Slice**   | the directory names under `fl_frontend/src/features/` and `fl_backend/app/api/` | a whole path segment matching one of them, anywhere in the path  |

**`BE` reaches the whole package rather than its `app/`**, because a backend test otherwise carries
`tests` and no surface at all, which hides a backend failure from a reader filtering on `BE`. `Docs` covers `docs/` and `.claude/` under one tag, and no second tag splits them: the two sets are
identical, so a split would state one fact twice (COR-2). `DB` and `versions` are the two a path
need not produce — a collection name and a manifest are named in prose — so either may stand where
no path derives it, and neither may be missing where one does.

**A slice matches a whole path segment and never a substring**, because German compounds a term into
a longer word meaning something else: `spiele` sits inside `spieler`, and both are live slices with
large trees, so a substring match tags every `spieler` path as the most-used slice in the repository.
The segment matches anywhere in a path rather than under the two roots alone, so
`fl_frontend/src/app/admin/aktionen/` earns `aktionen` from the route tree as well as from the
feature package. Eleven slices are spelled the same on both sides; `admin`, `auth`, `dashboard` and
`meta` exist on the frontend alone. **An entry naming no path carries no tag**, and that is a finding
rather than a default: an entry nobody can place is one whose subject is not stated.

**A status is derived, never chosen**, by the first matching row of
[`protocol.md`](protocol.md) — which is also where each value's meaning is fixed. A closure
re-derives every entry's, not only its own, because `Blocked` is a claim about another row.

**An entry may carry one `Lands with:` line** naming the tokens it shares a pass with. It is deleted
when any member of that batch lands, so it is either current or gone. Relatedness by subject is
never written there: the tags already answer it.

Some entries are seeded into an audit pass under `docs/_auditing/prompts/` as one of its starting
checks. Some are issue-shaped feature work parked here at my direction, so that one place holds what
is outstanding; everything else belongs here only while the reasoning, rather than the work, is the
deliverable.

## The items at a glance

| Token       | Item                                                                                                                        | Tags                                                                        | Status   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| `2qae-xcut` | A rule declared multi-document reads only the row its own endpoint writes                                                   | BE, spiele                                                                  | Open     |
| `2rz3-a754` | Deciding an application does not drain the queue, and duplicates are marked only across one read's rows                     | FE, BE, Ops, Docs, edge, admin, bewerbungen                                 | Open     |
| `32bs-nhzd` | Every write is recorded, and nothing restores one past the editor's fifteen seconds                                         | FE, BE, DB, Docs, spiele                                                    | Open     |
| `4enu-5xx9` | The junction editor replaces the whole contact block, reinstating a seat an erasure has just emptied                        | BE, DB, Docs, bewerbungen, kontakte, teams                                  | Open     |
| `6mch-qx2c` | A retention sweep that never runs looks exactly like one that found nothing                                                 | FE, Docs, bewerbungen                                                       | Open     |
| `8wd7-ff49` | The consent field has a schema and a ruled writer, and no flow that writes it                                               | FE, BE, Docs, meta, spieler                                                 | Blocked  |
| `8y7c-rstr` | No birthdate is stored, and every age rule guesses from `stufe`                                                             | FE, BE, DB, Docs, spieler                                                   | Blocked  |
| `anh6-etwn` | States the domain declaration reaches from neither of its two lists                                                         | BE, DB, Docs, tests, spiele, spieler, spieltage, teams                      | Open     |
| `buut-5cyw` | An undo restores a whole stored fixture from a list read before the save                                                    | FE, BE, Docs, admin, spiele                                                 | Open     |
| `ceqd-e4aq` | An admin table's declared floor can be wider than the viewport its layout starts at                                         | FE, Docs, tests                                                             | Open     |
| `cu59-4gqt` | Nothing announces that a season rollover is due                                                                             | Ops, Docs, ci                                                               | Standing |
| `duhh-xcsh` | Three identifiers say consent where the text says confirmation: `LIGA_EINWILLIGUNG`, `FLKontaktEinwilligung`, `erteilt_von` | FE, BE, Docs, bewerbungen, teams                                            | Standing |
| `ewf2-e2f3` | A confirmation or reminder link that bounces is written to the log and told to nobody                                       | FE, Docs, bewerbungen                                                       | Open     |
| `ex2m-qjkg` | The season's shape is offered wider than it can be saved, and two of its three fields have no contiguous legal range        | FE, BE, Docs, tests, saisons, spiele, teams                                 | Open     |
| `f3ar-m4qf` | Setting up a season is a hand-run sequence, and only an admin can enter a squad                                             | FE, BE, DB, Ops, Docs, edge, bewerbungen, kontakte, saisons, spieler, teams | Open     |
| `fau5-jtph` | The action log's page narrows one capped read, and a toast promises more than search can show                               | FE, BE, Docs, admin, aktionen                                               | Open     |
| `g7hr-c8bn` | The replace and the undraw judge their window from a capped read                                                            | BE, DB, Docs, saisons                                                       | Standing |
| `ggng-8m7v` | The confirmation link's two anonymous endpoints read a whole application unprojected                                        | BE, DB, Docs, bewerbungen                                                   | Open     |
| `hstg-rnqj` | The certainty walk never hypothesises a called-off fixture, and a call-off can move a placing                               | BE, Docs, spiele, teams                                                     | Open     |
| `huzh-hdfx` | A never-clause bounds what a stylesheet may say about a toast, and the stylesheet says more                                 | FE, Docs                                                                    | Decided  |
| `kwfu-48sm` | Two surfaces offer a squad-row return the season's cap will refuse                                                          | FE, BE, admin, spieler                                                      | Open     |
| `kyc4-75k5` | A pupil's consent is stored and served, and shown by nothing                                                                | FE, BE, Docs, spieler                                                       | Open     |
| `m4m3-hxmj` | The shared editor shell's widest layout step has never been rendered                                                        | FE, Docs                                                                    | Open     |
| `n56q-zu6n` | `Team` names a club and the people who run the league, and the public site renders both                                     | FE, Docs, meta, teams                                                       | Open     |
| `nadg-bnjb` | Every admin write states its success twice, and the second sentence cannot render                                           | FE, auth, spiele, spielorte, teams                                          | Open     |
| `njhn-pmtn` | Every call site writes a fallback for a failure message that always arrives                                                 | FE, Docs                                                                    | Open     |
| `nr85-vwnj` | A rule declares whether it reads a second document, and nothing resolves the claim                                          | BE, Docs, tests, bewerbungen, saisons                                       | Open     |
| `pa6f-ksu4` | A season id that is no year is refused nowhere, and first noticed by an hourly sweep failure                                | BE, DB, Docs, bewerbungen, saisons                                          | Open     |
| `pb66-krbw` | A fixture carries one date, and a play window cannot be expressed                                                           | FE, BE, spiele                                                              | Open     |
| `pt4h-b6tf` | Renaming an anonymised referee undoes the erasure, and nothing refuses it                                                   | BE, DB, Docs, schiedsrichter, spiele                                        | Open     |
| `pw5c-zps5` | A referee gets no consent record, where a contact person confirms their own                                                 | FE, BE, DB, Docs, meta, schiedsrichter, spieler, teams                      | Open     |
| `q7jv-hskm` | The replace and the undraw remove the same two collections, and sharing the removal leaves the write sweep                  | BE, DB, tests, saisons                                                      | Standing |
| `qp88-3t35` | A cached read's backend call joins to no render, and telemetry has nowhere to go                                            | FE, BE, Ops, Docs, versions                                                 | Open     |
| `qstz-dwrj` | Only the match editor tells an admin which empty field somebody is waiting on                                               | FE, BE, Docs, admin, spiele                                                 | Open     |
| `rt37-sv33` | A sort option nothing sends scans the archive it sorts                                                                      | FE, BE, DB, admin, bewerbungen                                              | Standing |
| `rtn3-sq85` | A state chip can be neutral gray, and the shared badge carries shape without tone                                           | FE, Docs, bewerbungen                                                       | Open     |
| `skyx-nrgh` | A refusal composes a repair the product refuses to perform                                                                  | FE, BE, Docs, tests, saisons                                                | Open     |
| `txef-hz2b` | Two referees reduced to one published name are one option in the fixture facet                                              | FE, BE, spiele                                                              | Open     |
| `vgk8-btxt` | What decides whether a module belongs in `core` or in `shared` is written nowhere                                           | FE, Docs                                                                    | Standing |
| `vyr6-uk2p` | The open-window read filters into arrays and subscripts whatever comes back                                                 | FE, BE, tests, bewerbungen                                                  | Open     |
| `w4tm-9khd` | A sweep reads a JSX opening tag by its first angle bracket, so attribute order decides its population                       | FE, tests, spieler                                                          | Open     |
| `wszt-rpmy` | Wiring the write path refuses stands unreported once it is in storage                                                       | FE, BE, DB, Docs, saisons, spiele                                           | Open     |
| `x7pk-g4bh` | Three entry refusals are rendered twice, and nothing holds either half to the other                                         | FE, BE, Docs, tests, bewerbungen, teams                                     | Open     |
| `xe5b-v4nu` | A fourth rendering of the retired-club refusal sits outside the helper that grades the other three                          | FE, tests, bewerbungen, teams                                               | Open     |
| `yjsf-uc2y` | Acceptance copies a school's postal address into the club, where an anonymous read serves it                                | FE, BE, DB, Docs, bewerbungen, teams                                        | Decided  |
| `z8nf-7nzd` | `typing` imports instead of `collections.abc`                                                                               | BE, Docs, versions                                                          | Decided  |
| `zp46-yt3p` | The certainty walk gives up in a group of six or more                                                                       | BE, teams                                                                   | Standing |
| `zr2y-4uwj` | A tie-break that provably cannot fire is what stops the index being walked                                                  | BE, DB, tests, bewerbungen, saisons, spiele, spieltage                      | Standing |
| `2d76-kydk` | A citation is resolved by asking the filesystem, so a mis-cased path fails only on the runner                               | Ops, Docs, gate, ci                                                         | Open     |
| `2eec-8qa9` | The hook fixture's builder writes into a directory it never creates, and reports success                                    | Ops, Docs, gate                                                             | Open     |
| `2pqm-yxyu` | The origin trusts every source inside Cloudflare's ranges                                                                   | Ops, Docs, edge                                                             | Open     |
| `2zah-pvu2` | The gate's binding unit costs more inside a run than it does alone                                                          | Ops, gate, tests                                                            | Open     |
| `3gag-st7h` | Invariant numbers are permanent per sheet and allocated as though one namespace held all three                              | Ops, Docs, gate                                                             | Open     |
| `3hb2-3d9q` | One test file dies under the gate's parallel load and names no cause                                                        | FE, Ops, gate, tests, saisons                                               | Open     |
| `3hdg-3r59` | The replace and the undraw each write the season's clearing, and each is proved separately                                  | BE, DB, Docs, tests, saisons                                                | Open     |
| `3s6w-kndn` | The gate saturates the machine, then idles through its tail                                                                 | BE, Ops, gate, tests                                                        | Open     |
| `54yr-fgun` | A changed citation target puts no page in front of the session                                                              | Ops, Docs, gate                                                             | Open     |
| `5h9m-nntd` | A formatter reshapes a comment before INC-9 measures it                                                                     | BE, Ops, Docs, gate, teams                                                  | Open     |
| `5qzd-ubrg` | A test's name counts the cases beside it, and the table has outgrown the count                                              | Ops, gate, tests                                                            | Open     |
| `5tnp-5uff` | A python constant's closing quotes open a comment run                                                                       | Ops, Docs, gate, tests                                                      | Open     |
| `645h-nj9q` | The linter runs a version past its end of life                                                                              | FE, Docs, versions                                                          | Standing |
| `6zuv-9tkx` | No check can render a Server Component, so the render-prop rule is unenforced                                               | FE, Docs, tests                                                             | Open     |
| `79y5-vdpq` | Two gate functions are rewritten in miniature inside the test that drives them                                              | Ops, gate, tests                                                            | Open     |
| `7wne-u6hm` | Three test modules each open a cache scope through the same React internal                                                  | FE, tests, saisons, spiele, teams                                           | Open     |
| `9r6p-z26g` | Five fixture repositories are copied out of a live directory                                                                | Ops, gate, tests                                                            | Open     |
| `aee2-vxqc` | A deprecated test-client dependency will end four modules' collection                                                       | BE, ci, tests, versions                                                     | Open     |
| `b3c5-avuj` | One uv version is pinned twice and compared by nothing                                                                      | BE, Ops, gate, ci, versions                                                 | Open     |
| `b732-rpvp` | Most of the database tier runs unconstrained                                                                                | BE, DB, tests                                                               | Open     |
| `bfs4-ax6a` | The fixtures' drift guard cannot see a database view                                                                        | BE, DB, tests                                                               | Open     |
| `bpve-vhag` | The fork exemption's ceiling is charged per block, and nothing caps the blocks one ancestor excuses                         | Ops, Docs, gate, tests                                                      | Open     |
| `c8rx-gqun` | An invariant citation resolves to a string, not to a definition                                                             | Ops, Docs, gate                                                             | Open     |
| `cckv-edvy` | The published document's drift check fails with the command that accepts the drift                                          | FE, BE, Ops, Docs, gate, tests                                              | Open     |
| `ckf7-7w58` | The frontend mirrors the backend's payload bounds by hand, and one of them is swept                                         | FE, BE, tests, bewerbungen, spiele, teams                                   | Open     |
| `crwn-qfp7` | The opening comment block of every file read as a shell script is measured by neither bound                                 | Ops, Docs, gate                                                             | Open     |
| `d5j8-js4n` | A real file in an unaccepted spelling reads as a missing file                                                               | Ops, gate                                                                   | Open     |
| `db2a-9qu3` | The local edge claims to mirror production, unchecked                                                                       | Ops, Docs, gate, edge                                                       | Open     |
| `eg48-8863` | Two db-tier runs at once fail in a way that names nothing                                                                   | BE, Ops, gate, ci, tests                                                    | Open     |
| `f38s-y3hj` | A sweep taking `.tsx` alone decides no test file, and the spelling keeping its fixtures out is refused by nothing           | FE, Docs, tests                                                             | Open     |
| `f4uf-jape` | A copy test pins what its own author wrote                                                                                  | FE, BE, Docs, tests, saisons, teams                                         | Open     |
| `fha5-k95h` | A projection's coupling is guarded in one direction only                                                                    | BE, tests, saisons                                                          | Open     |
| `g98z-k4cp` | Two hook watchdogs sit under a registration in another file, and nothing compares the pair                                  | Ops, Docs, gate                                                             | Open     |
| `gbjj-9wfh` | A test fixture asserts the type nothing else checks                                                                         | FE, tests, admin, saisons, spiele, spieltage, teams                         | Open     |
| `gkp4-q3q9` | The unique-index test pairs by ordinal position                                                                             | BE, DB, tests                                                               | Open     |
| `gm9c-2du4` | Every link the local stack mails points at production                                                                       | FE, Docs, bewerbungen                                                       | Open     |
| `gvyr-3nws` | Stylesheet comment blocks stand over INC-9's bound, quiet only while nobody lengthens one                                   | FE, Ops, Docs, gate                                                         | Standing |
| `h4wq-p7ct` | A block carried into a file the fork does not hold is charged to the branch                                                 | Ops, Docs, gate, tests                                                      | Open     |
| `hnx7-zbb9` | One field list is drift-guarded on one side only                                                                            | FE, BE, tests, saisons                                                      | Open     |
| `ja32-9rpv` | A call site's key tier is held to its route by nothing                                                                      | FE, BE, Docs, tests, bewerbungen, kontakte, spielorte                       | Open     |
| `jcpc-dee5` | Two routes on one path and method collapse to one                                                                           | BE, tests                                                                   | Open     |
| `jcs8-4ste` | An in-transaction read's session argument is untested                                                                       | BE, tests, saisons                                                          | Open     |
| `jky6-k3te` | The refusal-code table is held to the backend by nothing                                                                    | BE, Ops, Docs, gate                                                         | Open     |
| `kpkb-y5d8` | A refusal's meaning is written three times, unresolved                                                                      | FE, BE, Docs, tests, bewerbungen                                            | Open     |
| `mmcv-aa6g` | The comment-citation check reads two shapes of outside reference and INC-6 bars more                                        | Ops, Docs, gate, tests                                                      | Open     |
| `nce5-j467` | A comment claims two files hold one pattern, unchecked                                                                      | FE, BE, tests                                                               | Open     |
| `p2y9-p9za` | Four helpers every script calls are checked by nothing                                                                      | Ops, Docs, gate                                                             | Open     |
| `q2de-43qd` | A declared-permitted state's reason is checked by nothing                                                                   | BE, Ops, gate, tests                                                        | Open     |
| `qbzd-xrcu` | A scope sweep asserts against a rebuilt predicate rather than the gate's own                                                | Ops, Docs, gate, tests                                                      | Open     |
| `qg8u-tbd6` | One test module is named for a function and holds the cases of two others                                                   | FE, Docs, tests                                                             | Open     |
| `qw6j-scru` | The CSP's style directive is wider than it needs to be                                                                      | FE, Ops, Docs, edge                                                         | Open     |
| `r5xm-ac7m` | A hook probe reads the status only where the verdict was empty                                                              | Ops, Docs, gate                                                             | Open     |
| `s28h-m39z` | A moved vocabulary table is reported on the wrong branch                                                                    | Ops, Docs, gate, ci, tests                                                  | Open     |
| `spq6-zy2d` | A renamed file's comment blocks are never measured                                                                          | Ops, gate                                                                   | Open     |
| `sqwz-xyxg` | An enforcement claim is resolved in one direction only                                                                      | Ops, gate                                                                   | Open     |
| `srbc-6buy` | An allowlist row naming an absent file is passed over, not reported                                                         | Ops, Docs, gate, tests                                                      | Open     |
| `srec-8jxj` | Naming the image build's culprits costs a process per file                                                                  | Ops, Docs, gate                                                             | Open     |
| `suuz-dged` | Process-wide test hooks close the runner's one-process mode                                                                 | FE, tests, versions                                                         | Open     |
| `tc3c-nudr` | Nothing validates the contents of a restored `.env`                                                                         | FE, BE, Ops, Docs, edge                                                     | Standing |
| `tnvw-4cqz` | One bash guard runs its twin's scan with no watchdog under it                                                               | Docs                                                                        | Open     |
| `ua29-4s7q` | COR-6's checks read one spelling of a citation and one of a SHA, and the rule reaches past both                             | Ops, gate                                                                   | Open     |
| `uayf-u7g4` | Crawler policy split between robots.txt and Cloudflare                                                                      | FE, Ops, Docs, edge                                                         | Standing |
| `v48b-waa5` | A rule pattern reaches less than the rule it enforces                                                                       | Ops, gate                                                                   | Standing |
| `vspa-r35v` | One commit imports a module the commit after it adds                                                                        | FE, Docs, ci, tests, saisons                                                | Standing |
| `vy6b-ftj4` | The backend, db and frontend jobs have stepped up in wall clock                                                             | Ops, gate, ci                                                               | Open     |
| `w2c2-xc9j` | One tag strip repeats until it is done, and every other reader of markup as text makes a single pass                        | FE, tests, saisons                                                          | Open     |
| `y2bd-s7bf` | A width share floored at one worker sits below both measured widths                                                         | Ops, gate, ci, tests                                                        | Open     |
| `y3jf-vwrs` | No check enters the gate's serial or streaming run form                                                                     | Ops, Docs, gate, ci, tests                                                  | Open     |
| `z82x-us4y` | A contract sweep's caller set is every file naming the client, its own tests included                                       | FE, BE, tests                                                               | Open     |
| `z9gx-tekp` | A README enumerates a suite's subjects, and the tree has moved past the list                                                | Ops, tests                                                                  | Open     |
| `zp4w-tg6x` | No check selects by the trees the In-code Scope names, and its register stands on its tests alone                           | Ops, Docs, gate, ci, tests                                                  | Standing |

## The items

### `2qae-xcut` · A rule declared multi-document reads only the row its own endpoint writes

| Tags       | Status | Depends on |
| ---------- | ------ | ---------- |
| BE, spiele | Open   | —          |

**`fl_backend/app/core/domain.py :: Rule.multi_document` is true where a rule needs more than the
payload and its own document, and `REQ-RESULT-001` declares it while reading one row.**
`fl_backend/app/api/spiele/services.py :: find_result_removal_refusal` takes the season's whole
fixture set, resolves the row `spiel_id` names out of it through `:: stored_in_slice`, and judges
that row's two stored sides against the payload. It reads no other fixture. `REQ-STATE-002` and
`REQ-STATE-003` sit on the same endpoint, decide on the payload alone and declare `False`, so what
the endpoint may write is not what carries the value.

**Which unit decides the value is the open half.** Read as what the rule itself consumes, the row is
`False`. Read as what its caller must fetch to feed it, the season slice makes it `True` — and that
slice is assembled for `:: judge_spieltag_occupancy` and `:: find_wiring_refusal`, which need every
fixture, so the feed answers a question about the endpoint rather than about this rule. The commit
declaring `REQ-RESULT-001` argues the refusal and says nothing about the flag, so no decision is
being reopened here.

**Why it matters.** Nothing reads the field, so a wrong row costs nothing until somebody derives
from it — and a reader taking `REQ-RESULT-001` as the precedent declares `True` for every rule whose
caller happens to hold a set, which is most of them.

**Done when** `REQ-RESULT-001` carries the value that
`fl_backend/app/core/domain.py :: Rule.multi_document` gives it, and the unit that decides — the
rule's own reads, or its caller's — is written where the next declaration meets it.

### `2rz3-a754` · Deciding an application does not drain the queue, and duplicates are marked only across one read's rows

| Tags                                        | Status | Depends on |
| ------------------------------------------- | ------ | ---------- |
| FE, BE, Ops, Docs, edge, admin, bewerbungen | Open   | —          |

**The duplicate marking runs over the rows one read served.**
`fl_frontend/src/features/bewerbungen/duplicates.ts :: findBewerbungDubletten` walks the list the page was
handed, groups the `eingereicht` rows on season plus club or season plus Kürzel, and marks every member of a
group of two or more. `fl_backend/app/api/bewerbungen/router.py :: get_bewerbungen` serves at most
`fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT` rows and reports when its answer was cut. A
colliding pair split across that cut falls into no group, so neither half is marked and nothing names the pair
— the notice can say that a pair is unmarked and cannot say which.

**That is not cosmetic, because the marking is what the write's silence buys.** Uniqueness on an
unauthenticated form is itself a denial of service, so the write refuses no duplicate and the queue
shows them instead; a queue that shows them across part of its set honours that ruling across part
of its set.

**A decision leaves the row, so the working set never shrinks.**
`fl_backend/app/api/bewerbungen/admin_router.py :: ablehnen_bewerbung` sets `status` to `abgelehnt`
and stamps who decided and why; the row stays, deliberately, the submission being the record the
decision was taken against. The triage page sends no `status`
(`fl_frontend/src/app/admin/bewerbungen/page.tsx`), so a decided application of any season keeps its
place among the rows served. **An administrator who declines every one of them sees the list
unchanged**, and no endpoint removes an application, so nothing reachable from the product clears
the state.

**The obvious repair collides with the facet, and that collision is most of the effort.** Decided rows leaving
the default view means a `status` term on the server read. The panel then counts each option against the rows
it was handed — `fl_frontend/src/shared/utils/facets.ts :: countFacetOptions` over the loaded list — and
`fl_frontend/src/shared/components/ui/FilterPanel.tsx` disables an option standing at zero unless it is
already picked. Narrow the server read to `eingereicht` and both other statuses stand at zero, so both go dead
and the archive is unreachable from the control that hid it. The **admin** clause in
`.claude/rules/frontend.md` forbids withdrawing an option on a zero count, and disabling one arrives in the
same place by another route. **So the counts have to come from the server in the same change**, or the
narrowing has to be stated somewhere the facet does not read.

**Two answers are closed, and each looks right from the code alone.**

- **Per-school uniqueness on the write is refused by my ruling.** An index over unauthenticated
  input hands whoever fills the field first the power to own it, so a real school meets a refusal
  holding its own name and the rule meant to protect it locks it out. The marking is what the league
  has **instead** of that index, and the argument is recorded at `findBewerbungDubletten` and stated
  again in `docs/frontend/spec.md`.
- **Pagination is refused because a cursor splits the set the marking runs over.** Paging would
  remove the mechanism the ruling above rests on, and remove it silently, with no surface saying
  that a pair split across a page boundary goes unmarked —
  `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungenListResponse`'s own declaration records
  that the list is served whole for exactly this reason. It also lands in the facet the way the
  server-side filter does: a page holding one season's open applications leaves every other status
  and every other season at zero, so the archive and the cross-season view both go dead.

**Done is a third shape** — a narrowing the facet is told about rather than one it has to infer from
what arrived, with the marking's set decided by the server rather than by what a single read
happened to serve. **There is no bulk action**, so clearing a flood is one press per row, each with
its own confirmation and its own round trip; that is the cheapest of these gaps to close once the
read has somewhere to put a narrowing.

**What bounds the severity.** Reaching the state takes a deliberate flood: the ceiling is
`nginx/prod.conf`'s `bewerbung48` zone, whose own comment puts filling the list from a single
allocation at roughly three hours of sustained work, and closing the season's application window
stops new rows at once.

**What is read and what is not** (COR-9). Every gap above is read off a branch rather than measured:
`findBewerbungDubletten`'s loop, `ablehnen_bewerbung`'s `$set`, and the list `countFacetOptions` is
handed. **Nothing here was driven against a truncated queue.**

### `32bs-nhzd` · Every write is recorded, and nothing restores one past the editor's fifteen seconds

| Tags                     | Status | Depends on |
| ------------------------ | ------ | ---------- |
| FE, BE, DB, Docs, spiele | Open   | —          |

**The recording exists and the restore over it does not.** Every write funnels through
`fl_backend/app/core/crud.py` and is recorded with the actor, the request, the collection, the
document and the image the write replaced (`fl_backend/app/core/recording.py`); `/admin/aktionen`
lists the rows and narrows to one document's history. A row therefore holds what a replay needs, and
replaying one is a small change over the undo spine the entity editors already share
(`fl_frontend/src/shared/utils/undoDispatch.ts :: offerUndo`). What is missing is the control that
does it: a restore offered on a log row, past the editor's fifteen-second, browser-held undo — one
that survives a reload and reaches a write nobody was watching at the time.

**The write worth building it for is the one nobody asked for.** Applying a bracket advancement
clears the advanced fixture's `ergebnis`, its `elfmeterschiessen` and a no-show recorded on it
(`fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`), so correcting a quarter-final
deletes a semi-final scoreline that a person had entered, as a consequence of an edit somewhere
else. That destruction is recorded and attributable; recoverable past the fifteen seconds is what
this entry adds. Until it lands, an unrestorable write is recovered by hand from the row that
recorded it — slowly, which is the cost of leaving this open rather than a loss.

**What blocks it is a measurement.** `docs/frontend/spec.md` §1.3 admits a route handler for a
page-owned editor and refuses one for a row control, and a restore on a log row is a row control.
Whether Next's E592 reproduces on a page that stays mounted is what decides between a server action
and a route handler of its own, and nobody has measured it.

**Retention is built, and it is this entry's reach.** `docs/backend/spec.md :: I119` expires a stamped
log row twelve months after the write it recorded, and a restore reaches a write only while its row
stands, so the retention bound is the restore's reach. A row carrying no stamp is expired by
nothing, and its values leave at the once-only reset in `docs/datenschutz.md :: 3` instead.

**Two kinds of write sit outside what any restore could replay — a pupil's erasure, and taking a
season's draw away — and for different reasons.** The erasure keeps no image at all, the values
being what it destroys; the removal, whether a confirmed replace or an undraw that writes none back,
keeps an array of every removed document, and `/spiele` has neither a create nor a delete, so
nothing exists to replay one into (`docs/backend/spec.md :: I48`, `:: I26`). Both are records for a
person to read rather than anything a restore can reach, which is a bound on this entry rather than
work inside it.

**How far the log page can reach past its one read is not this entry's** — the filters it sends, the
client-side search and facets over the loaded rows, and the copy toast that promises more than
either can give are `fau5-jtph`.

### `4enu-5xx9` · The junction editor replaces the whole contact block, reinstating a seat an erasure has just emptied

| Tags                                       | Status | Depends on |
| ------------------------------------------ | ------ | ---------- |
| BE, DB, Docs, bewerbungen, kontakte, teams | Open   | —          |

**The contacts editor reads the stored block, composes a new one from it, and writes the block
whole.** `fl_backend/app/api/teams/admin_router.py :: patch_saison_team_kontakte` reads the row's
`kontakte` through `fl_backend/app/core/crud.py :: pull_one_from_db` outside any transaction, so that
a seat which has confirmed keeps its provenance, then `$set`s the composed block over the stored one.
`fl_backend/app/api/kontakte/admin_router.py :: erase_kontaktperson` is the other writer of that
block, and nulls every slot one address holds. An erasure landing between the editor's read and its
write is undone by the write: the person who asked to be forgotten is back on the row, and the action
log records an ordinary edit.

**The window is the whole-block `$set` and not the read, and narrowing the payload is not the
repair.** The editor sends all three slots because a payload accepting fewer would let an edit drop a
seat in silence, and every slot it sends is a claim about that seat rather than a field somebody
happened to touch. So the block the admin rendered is the block the endpoint stores, and any seat
changed underneath it is overwritten by definition.

**The confirmation write is the shape that closes it, in this same tree.**
`fl_backend/app/api/bewerbungen/einwilligung_router.py :: post_einwilligung` judges and writes inside
one session, reading the document it is about in-session so that a retry re-judges it, and its update
names field paths under one seat instead of replacing a block. Either half would answer here: the
editor's read moved inside the transaction that writes, or the update reduced to the paths the editor
actually changed.

**Done when** a concurrent erasure cannot be undone by a save — with the guarantee stated where a
reader with no code open meets it (`docs/backend/spec.md`), and a test that fails on the interleaving
rather than on the shape of the update.

### `6mch-qx2c` · A retention sweep that never runs looks exactly like one that found nothing

| Tags                  | Status | Depends on |
| --------------------- | ------ | ---------- |
| FE, Docs, bewerbungen | Open   | —          |

**The sweep writes a line only where a pass fails.**
`fl_frontend/src/features/bewerbungen/sweep.ts :: runBewerbungSweep` walks the seasons, and
`fl_frontend/src/features/bewerbungen/sweep.ts :: logSweepFailure` is the only thing on that path
which reaches the log at all (`FE-SWEEP-001`). A pass that reminds nobody and deletes nothing writes
nothing, and that is the ordinary case — so silence is what a healthy sweep and an absent one both
produce, and no operator can tell them apart.

**Three ways it can be absent, and none of them shows.** `fl_frontend/src/core/config.ts` reads
`BEWERBUNG_SWEEP`, so a server setting it off arms no timer at all;
`fl_frontend/src/instrumentation.ts :: register` is what arms it, so a deployment where that hook
does not run arms nothing; and the timer lives in the process that serves the site
(`docs/ops/spec.md :: I149`), so a process restarting before its first pass restarts the delay with
it. Each is a deadline nobody chases and an unconfirmed application nobody deletes, found when a
school asks why it heard nothing.

**Two answers, weighed and neither taken.** One info line per completed pass, carrying what the pass
did, makes the absence visible in the stream the failure already uses, at the cost of a line an hour
in production whose only reader is somebody already suspicious. An observable the system tier answers
on demand — when the last pass completed — costs a route and a caller, and is read only by somebody
who thinks to ask. The choice is which of those two costs is worth paying, not whether the gap is
real.

**Done when** an operator can tell a sweep that ran and did nothing from a sweep that did not run,
without reading the container's environment.

### `8wd7-ff49` · The consent field has a schema and a ruled writer, and no flow that writes it

| Tags              | Status  | Depends on  |
| ----------------- | ------- | ----------- |
| BE, Docs, spieler | Blocked | `f3ar-m4qf` |

Lands with: `8y7c-rstr`

**`einwilligung.bestaetigt_am` has a schema and no writer a person reaches.**
`fl_backend/app/api/spieler/services.py :: registration_einwilligung` composes one, writing
`erteilt_von` as `erziehungsberechtigt` and `bestaetigt_am` as the same day; its one caller,
`fl_backend/app/api/spieler/admin_router.py :: post_spieler`, sits on a router guarded by
`verify_access_admin`. So a pupil registered through the admin surface is stored as consented by a
guardian on the day of registration, and nothing distinguishes that row from one a guardian actually
filed. The comment at the line gives the reasoning as the guardian being the one filing it, which is
true of no caller the system has.

**The writer is ruled, and the flow that would be it does not exist.** `docs/datenschutz.md` §2
settles it: everyone signs up for themselves through the website and gives their own consent there,
from 16, and an administrator may neither create a player nor assume, enter or transcribe a consent
on anybody's behalf. There is no guardian workflow. So `registration_einwilligung` and its admin
caller go with the flow that replaces them, and the consent vocabulary then has to express a
person's own consent and a carried-over record and nothing else — `bestandsuebernahme` already marks
the second.

**What the ruling leaves standing.** The gate publishing nobody without a recorded consent may be
built before the flow ships, provided every pupil row standing today counts as fully consented:
those rows are deleted once at the end of this season (`docs/datenschutz.md` §3), and the gate must
not empty the public squad lists meanwhile. Today no read consults the stored field at all —
publication is gated on nothing — and the predicate is written into `docs/backend/spec.md`'s
read-rules table before any code.

**Done** is the sign-up flow writing a person's own consent, `registration_einwilligung` and its
caller gone with it, the vocabulary narrowed to what stays expressible, the publication gate reading
what the flow stores, and the notice's squad and referee publication rows
(`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`) moved off the legitimate
interest they rest on to the consent the flow collects.

### `8y7c-rstr` · No birthdate is stored, and every age rule guesses from `stufe`

| Tags                      | Status  | Depends on  |
| ------------------------- | ------- | ----------- |
| FE, BE, DB, Docs, spieler | Blocked | `f3ar-m4qf` |

Lands with: `8wd7-ff49`

**No `spieler` document carries a birthdate, so nothing can judge a pupil's age.** `stufe` is the
only signal and it is a proxy: it says which grade a pupil attends, not how old they are.

**Ruled: the birthdate is required at sign-up and stored** (`docs/datenschutz.md` §2). The minimum
age is 16 for everyone — the age at which a person consents for themselves under Art. 8 GDPR in
Germany — a sign-up below it is refused, and the check cannot run without the date.

**Optional is the rejected shape, and the reason it was rejected is the reason to keep it rejected.**
An optional field would leave the age check unrunnable for every row that declined it, which is a
rule that judges some people and not others. The tension the option was reaching for does not vanish
— a birthdate is more identifying than a `stufe`, which is the argument against storing one at all —
and what answers it is that the date is collected at sign-up and never backfilled: the pupil rows
standing today are deleted once at the end of this season (`docs/datenschutz.md` §3), so no existing
document is reached.

**The `volljaehrig` trap.** The consent vocabulary's `volljaehrig`
(`fl_backend/app/api/spieler/schemas.py :: FLEinwilligung`, mirrored in
`fl_backend/app/core/constraints.py`) pins no age in code and reads as 18. The threshold is 16, the
one number the tree already commits to for a contact person
(`fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_KONTAKT_MIN_AGE_YEARS`), so reading the enum
as the rule gets it wrong by two years.

**Done** is the field on the `spieler` model with its hand-written copies moved in the same commit —
the validator line in `fl_backend/app/core/constraints.py` and the Zod mirror in
`fl_frontend/src/features/spieler/schemas.ts` — the sign-up form's input, and the refusal below 16.
It is not a migration.

### `anh6-etwn` · States the domain declaration reaches from neither of its two lists

| Tags                                                   | Status | Depends on |
| ------------------------------------------------------ | ------ | ---------- |
| BE, DB, Docs, tests, spiele, spieler, spieltage, teams | Open   | —          |

**`fl_backend/app/core/domain.py` is the answer to "may this happen?", in two lists.** `RULES` names
every refusal the application implements, each pointing at the function that implements it and the
test that covers it; `UNENFORCED` names every state the application permits **and has decided to
permit**, each with the reason. `fl_backend/tests/core/test_domain.py` resolves `RULES` in both
directions — a refusal with no row fails, and a row naming no refusal fails.

**The gaps that sit in neither list:**

| The gap                                                                                                                                                                                                                                                                                                                                                                             | Where                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-CLASH-001` compares only fixtures sharing a calendar date, so two bookings of one venue at 23:30 and 00:30 are sixty minutes apart and both pass                                                                                                                                                                                                                               | `fl_backend/app/api/spiele/services.py :: find_clash_refusal`, whose loop skips a slot on `if slot.datum != datum`                                                     |
| A fixture given a **`sonderereignis` that frees its slot** is still judged against `REQ-CLASH-001`, so recording one on a fixture that clashes is refused and the admin has to move it first. The opposite direction is already right — the booking read matches `SONDEREREIGNIS_KEEPING_ITS_SLOT`, so a fixture called off, forfeited or annulled frees the ground and the referee | `fl_backend/app/api/spiele/admin_router.py :: patch_spiel_data`, where the clash block is entered on the payload's `datum` alone                                       |
| `advance_bracket_winners` writes both sides of a fixture without consulting `REQ-SPIELTAG-001`, so the resolution can create a Spieltag fielding one club twice. The state itself is declared, and every appearance of it is reported on `/admin/action_required` as a `fielded_twice` fault; what neither list reaches is the write that creates it, which consults no rule        | `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`; `judge_spieltag_occupancy` is reached from `patch_spiel_data` only                                     |
| `REQ-ENTER-003`'s count-then-insert is not transactional, so two concurrent entries can both pass a group's capacity check and take it over its cap                                                                                                                                                                                                                                 | `fl_backend/app/api/teams/admin_router.py :: post_saison_team`                                                                                                         |
| `REQ-DATE-008`'s neighbour read is not transactional either, so two matchdays of one phase dated at once can each pass against the other's absence and leave the phase out of order. Unlike the entry above, a session would not help: the two writes touch different documents, so nothing conflicts                                                                               | `fl_backend/app/api/spieltage/admin_router.py :: patch_spieltag`, at the two `find_one` neighbour reads                                                                |
| `REQ-SQUAD-003`'s count-then-insert is not transactional either, and it is reached from three endpoints while one of them carries the concession: a create, a transfer and a return to a squad each judge the season's `max_kadergroesse` from a count taken outside any session                                                                                                    | `fl_backend/app/api/spieler/admin_router.py :: _refuse_a_full_squad`, shared by `:: post_saison_spieler`, `:: patch_saison_spieler` and `:: reactivate_saison_spieler` |
| Two venues or two referees sharing a name. No unique index reaches either collection's `name` and no refusal covers it, so the state is reachable and declared nowhere. It is the one gap here still waiting on something that does not exist — a way to merge two rows — rather than on a decision                                                                                 | `fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`, which names neither collection                                                                                 |

**The concession with a date on it is recorded at more than one call site, and the date is this
year.** `fl_backend/app/api/teams/admin_router.py :: post_saison_team` accepts its race in a comment
at the count it reads: the single-admin surface makes the race a non-concern, and losing it costs
one team over a planning bound rather than corrupt data.
`fl_backend/app/api/spieler/admin_router.py :: post_saison_spieler` accepts the squad cap's race in
the same words and names that line for them, so the two stand or fall together. That reasoning is
sound and it rests entirely on there being one writer. A second person will be writing in the season
plan this year (confirmed 2026-08-12), and a self-registration page would put the squad cap's race
in front of strangers rather than colleagues — the only bound on a leaked registration link is the
cap that race defeats. When either lands the justification is gone and only the code is left, and
nothing joins the two: the concession lives at the call site rather than in `UNENFORCED`, where a
reader looking for what this system tolerates would find it.

**The declaration's own machinery is not what is left.** An entry in `UNENFORCED` is checked in full
from the day it is written — the refusal codes it sits near, the test that executes the state it
claims, and the surface it says a person can see it on, all resolved against the code and the
frontend tree ([`docs/domain.md`](../domain.md)). What no check can reach is the decision nobody
took, and that is the whole of this entry: a state permitted because somebody weighed it and a state
permitted because nobody looked still read identically until one of them is written down.

**Done is one of two answers per state: refuse it, or write it into `UNENFORCED` with the reason.**
Both are cheap, and choosing is the work — which is why they are one entry rather than one apiece.
The precedent is set: the duplicate squad number in one team and season was answered by declaring
it, because the live data already holds the state and refusing it would make those rows uneditable.

### `buut-5cyw` · An undo restores a whole stored fixture from a list read before the save

| Tags                        | Status | Depends on |
| --------------------------- | ------ | ---------- |
| FE, BE, Docs, admin, spiele | Open   | —          |

**A save on `/admin/spiele/[spiel_id]` can rewrite fixtures nobody opened, and the undo offered for it puts
each of them back as a whole document.** `fl_backend/app/api/spiele/admin_router.py :: patch_spiel_data`
resolves the bracket inside its transaction, so one save clears results on advanced fixtures and releases
sides on others. `fl_frontend/src/features/spiele/utils.ts :: buildUndoPayloads` then composes one payload per
moved fixture through `:: toPatchPayload`, which lists every field the endpoint takes because the update is a
wholesale `$set` — `fl_backend/app/api/spiele/schemas.py :: FLPatchSpielDataPayload` says so at each field,
and an omitted one is overwritten with nothing. So an undo writes back `datum`, `uhrzeit`, `notiz`, both
quellen and both sides of a fixture whose slot was the only thing that moved.

**The values come from a snapshot, and the snapshot is a different read from the write it
corrects.** The moved fixtures are picked out of the season list the admin context holds
(`fl_frontend/src/features/spiele/utils.ts :: listMovedSpiele`):
`fl_frontend/src/features/admin/components/providers/AdminContextWrapper.tsx` fetches it once per
page render through `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele`, and
`fl_frontend/src/features/admin/components/providers/AdminContextProvider.tsx` holds it for the life
of the mounted editor. That read is uncached, so the window is one page visit rather than a cache
lifetime — and inside it, anything another writer changes on a moved fixture is reverted by the
undo, silently, with nothing in the payload marking a field the resolution never touched.

**One half of the shape is closed, and the reason it is closed does not generalise.** A payload
built from that list alone would blank `mietpreis` and `payment`, which the season list does not
carry, so the editor reads each moved fixture's booking through
`fl_frontend/src/features/spiele/actions.ts :: readAdminSpielBookingsAction` after the write and
merges it in. That is sound for exactly one reason, stated at the line: the resolution rewrites
slots and results and never a ground or a referee, so the booking read after the write is the
booking that stood before it. **No other field has that property.**

**The response already names what it rewrote, and stops one step short of what a narrow restore
needs.** `fl_backend/app/api/spiele/schemas.py :: FLSpielAdvancement` and `:: FLSpielReleasedSide`
report per fixture the `voided_ergebnis`, `voided_elfmeterschiessen` and `voided_sonderereignis` a
rewrite destroyed, and which `side` was released. Neither carries enough to rebuild those fields: an
`ergebnis` is a formatted string rather than the goal counts a payload takes, and a released side
names its club rather than the `team_id` a payload takes.

**Two answers, and they are different sizes.**

- **Carry the prior values on the response and restore only the fields it names.** The write path
  then has to accept a payload naming fewer fields than `FLPatchSpielDataPayload` declares, which is
  the whole reason every field there is required — so the endpoint's contract,
  `fl_backend/openapi.json`, the Zod mirror checked against it and the payload builder all move in
  one change.
- **Restore over the action log instead.** `fl_backend/app/core/recording.py` keeps the document
  each write replaced, so a restore reading it is correct by construction and needs no prior value
  on the response at all. That is `32bs-nhzd`'s subject, and taking this route makes this entry a
  consumer of that work rather than a repair of its own.

**What may not move either way.** `.claude/rules/frontend.md` fixes two edges a repair may not
cross — the undo offer is scoped to the destructive save, and a route-handled undo may not sit
outside a page-owned editor — so what moves is the payloads rather than where the undo lives.

**Not measured:** whether a moved fixture has ever changed under a mounted editor. One person writes
today, so the window is a single administrator's page visit; a second writer arrives in the season
plan this year (confirmed 2026-08-12), which is what turns that window into a shape two people can
meet inside.

### `ceqd-e4aq` · An admin table's declared floor can be wider than the viewport its layout starts at

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| FE, Docs, tests | Open   | —          |

**Ruled: an admin table is never scrolled sideways to be read.**

**A table's floor is computed rather than chosen, and nothing compares it to the width it has.**
`fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts :: TABLES` is the roster — the admin
lists whose rows sit in a react-aria table — and for each one the test adds the widths its columns
declare to a free-text allowance per undeclared column, then requires the table's single `min-w-`
floor to equal that sum exactly. The controls column has its own derivation,
`fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts :: ACTIONS_WIDTH`, which grows with the
most controls one row can hold. Both are checks that the floor matches what the columns asked for.
Neither asks whether the viewport can give it.

**Below the floor the reader gets a scroll container, and the busiest table is the one it reaches
first.** Each table renders cards below Tailwind's `md` step and the table layout from it up, so the
narrowest viewport that shows a table is that step; a table whose controls and free-text columns push
its floor past that step is scrolled sideways for every width between the two. The scroll container
is deliberate as a last resort and says so at the line, deliberately keeping its bar visible — which
is the right behaviour for a table that overflows and the wrong outcome for a table that should not.

**The repair is a shared budget, not eight local trims.** Each table's floor is the sum of decisions
taken in that table — how many controls a row offers, how much room a free-text column is owed — so
narrowing one is a product decision about that list, and doing it eight times by hand leaves the
ninth table free to reintroduce the defect. What holds is a width no table may exceed, derived from
the step its layout starts at, with the per-table sums measured against it.

**Done when** no admin table declares a floor wider than the narrowest viewport its table layout is
shown at, and a check refuses one that does — extending the roster's existing sums rather than
adding a second reader of the same markup, with the bound recorded where a session adding a column
meets it (`docs/frontend/spec.md`).

### `cu59-4gqt` · Nothing announces that a season rollover is due

| Tags          | Status   | Depends on |
| ------------- | -------- | ---------- |
| Ops, Docs, ci | Standing | —          |

**Deferred until a rollover is actually missed** — my ruling, 2026-08-12, re-confirmed 2026-09-02
(`docs/datenschutz.md` §10). That miss is the trigger that turns it into work.

**Every step of a rollover has a page; the sequence has nothing.** `/admin/saisons` creates the
season, the team and player editors carry the junction rows, the Spielplan panel on
`/admin/saisons/[saison_id]` draws the matchdays and fixtures, each matchday's own editor dates it,
and the Umstellung panel on that same season page activates it. Each clears its own caches as it
saves. What no surface does is notice that the sequence has not started, or that it stopped
half-way: nothing prompts for a step that is skipped.

**The failure is silent in a specific way.** An omitted step leaves the site serving last season as
though it were this one, and every read of it is a correct read of stale data.

**A reminder is a scheduled job, not a surface** — nothing renders it, nobody navigates to it, and
it has to run when no admin is present. This repository runs **no application-level scheduler**:
there is no queue, no worker, each image's `CMD` starts its one server and nothing else, and nothing
`scripts/ops/deploy.sh` starts is a scheduler either. What runs on a clock here is
`.github/workflows/codeql.yml`, which carries a weekly `schedule: cron` and analyses source — so the
mechanism exists in CI and reaches nothing inside the running application. That, rather than the
message, is the actual scope.

**What has to be settled when it is worked:**

- **What triggers it.** A season's `end_date` is the obvious clock and is the wrong one on its own —
  a season is over when its fixtures are played, and an early rollover is legitimate. The honest
  trigger is probably a date approaching with the next season absent.
- **What runs it.** A container with a cron, a scheduled GitHub Actions workflow hitting a guarded
  endpoint, or the host's own crontab. The workflow needs no new runtime and is already proven here
  by `codeql.yml`, which neither the container nor the host crontab is; the container needs no
  public surface. The trade is where the credential lives.
- **What it says.** The value is the checklist, not the alarm: a reminder naming which steps are
  already done is a different message from one saying a date passed, and only the first is worth
  reading twice.

### `duhh-xcsh` · Three identifiers say consent where the text says confirmation: `LIGA_EINWILLIGUNG`, `FLKontaktEinwilligung`, `erteilt_von`

| Tags                             | Status   | Depends on |
| -------------------------------- | -------- | ---------- |
| FE, BE, Docs, bewerbungen, teams | Standing | —          |

**The product says confirmation and the schema says consent, about one record.** A contact person
opens their own link, the application carries `bestaetigungsfrist` and a `bestaetigungen` block, and
the seat is stamped `bestaetigt_am` — while the record holding that stamp is
`fl_backend/app/api/teams/schemas.py :: FLKontaktEinwilligung`, the wording it cites is
`fl_frontend/src/core/einwilligung.ts :: LIGA_EINWILLIGUNG`, and the field saying how it was obtained
is `erteilt_von`, written `administrativ` by
`fl_backend/app/api/bewerbungen/services.py :: compose_einwilligung` and `person` by the endpoint
that seat's own link reaches.

**Why it is not cosmetic.** `erteilt_von` is a stored key on two collections and on every image the
action log holds of them, so a rename is a migration rather than an edit, and it travels through a
`$jsonSchema` validator, a Zod mirror and `fl_backend/openapi.json`. A reader meeting `Einwilligung`
on a screen headed „Bestätigung“ reaches for the pupil vocabulary instead, where `erteilt_von`
answers an entirely different question (`docs/glossary.md :: Einwilligung`).

**The trigger is the legal basis, and it is not ours to pick.** The basis for holding a contact
person's details is with the Datenschutzexperte (`docs/datenschutz.md` §11). Ruled as consent, the
three names are right as they stand. Ruled as necessary processing, `bestaetigt_am` becomes an
address-verification stamp, `erteilt_von` says who acknowledged a notice, and consent proper narrows
to the optional WhatsApp channel — at which point the three describe the wrong thing on every screen
that reads them. **No field here is named for a legal category**, which is what lets one schema
survive either ruling and is the reason to rename nothing before the ruling lands.

**Done when** the basis is ruled and the three names are settled against it: recorded as correct
where the next reader meets them, or renamed together with the validator, the Zod mirror, the
published document and the stored keys, in one migration rather than three edits.

### `ewf2-e2f3` · A confirmation or reminder link that bounces is written to the log and told to nobody

| Tags                  | Status | Depends on |
| --------------------- | ------ | ---------- |
| FE, Docs, bewerbungen | Open   | —          |

**A refused send leaves a line that names no address, deliberately.**
`fl_frontend/src/features/bewerbungen/notifications.ts :: settleFanOut` settles every recipient and
writes `FE-MAIL-002` per failure carrying the operation and the error's name alone, because
`docs/logging/spec.md :: L9` keeps a submitted value off the stream. The address is meant to reach a
person by the other route:
`fl_frontend/src/features/bewerbungen/notifications.ts :: describeBewerbungMail` names who was not
reached, in the sentence an admin action appends to its report.

**The link messages have nobody standing at that route.** The submission's links go out from
`fl_frontend/src/app/api/bewerbung/route.ts` to a member of the public, the confirmation's two from
`fl_frontend/src/app/api/bestaetigung/route.ts` to a contact person, and the reminder from
`fl_frontend/src/features/bewerbungen/sweep.ts :: mailErinnerung`, which returns nothing at all. Each
discards the outcome, so a seat whose mailbox refuses its link stays outstanding for the whole span
and is then deleted with the application it belongs to — and the first anyone hears of it is a school
asking why nothing arrived.

**A reminder is spent whether or not it arrives.** `docs/backend/spec.md :: I152` stamps
`erinnert_am` and mints the fresh link before the caller mails, deliberately: mailing first would
re-send to a refusing address every day the sweep runs. The cost that ordering accepts is one person
one reminder — and because
`fl_frontend/src/features/bewerbungen/sweep.ts :: mailErinnerung` answers `void`, that cost is
uncountable as well as unreported. The clock will not chase that seat again, the seat is outstanding
still, and the deadline deletes the application on time.

**The counter-example is in the same file.**
`fl_frontend/src/features/bewerbungen/sweep.ts :: mailLoeschung` reads whether the deletion notice
was delivered and withholds the erasure where it was not, because erasing somebody who was never told
is the failure that clock exists to prevent. Nothing weighs a link mail the same way, and a seat
nobody can reach is the same kind of loss one step earlier.

**Done when** two things hold: an unreachable contact address reaches an administrator, the
application's own admin page being where the triage already stands; and a reminder whose send was
refused does not count as the one chase that seat gets. Neither is answerable by a log line, which
L9 forbids naming the address in.

### `ex2m-qjkg` · The season's shape is offered wider than it can be saved, and two of its three fields have no contiguous legal range

| Tags                                        | Status | Depends on |
| ------------------------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, saisons, spiele, teams | Open   | —          |

**`number_of_groups`, `qualifiers_per_group` and `teams_per_group` are `SaisonRuleNumberField` steppers in
both the create modal and the Regeln panel, and the combinations they accept are wider than the ones a season
can be saved in.** The **saisons** clause in `.claude/rules/cross-surface.md` bars exactly this — _offer in
the form wiring the write path refuses_ — and the three shape fields are where the product still does it. The
clearest instance needs no arithmetic at all:
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/spielplanShape.ts :: SHAPE_FIELDS`
gives `qualifiers_per_group` a `minValue` of 1 and **no maximum**, so the stepper walks upward without end
into a refusal.

**The legal set is small, and two of the three fields cannot be expressed by an interval.**
`fl_backend/app/api/saisons/schedule.py :: qualifier_count` is `number_of_groups ×
qualifiers_per_group`, and `REQ-RULES-001` requires that product to be a power of two in
`[2, MAX_QUALIFIERS]` — `:: knockout_phases_for` returns an empty tuple otherwise, and
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` turns that into the refusal.
`fl_backend/app/api/spiele/schemas.py :: MAX_QUALIFIERS` is `2 ** len(KNOCKOUT_PHASES)`, and
`:: PHASE_ORDER` names four knockout rounds, so the ceiling is 16. A product is a power of two only
where the group count is one, so **the legal group counts are 1, 2, 4, 8 and 16 — never 3, 5, 6 or
7** — and that holds at today's cap, not only at a raised one. `qualifiers_per_group` is bounded the
same way from the other side, and `REQ-RULES-007` adds that it may not exceed `teams_per_group`.

So `number_of_groups` and `qualifiers_per_group` want selects: their legal values are
**non-contiguous**, and a stepper with a floor and a ceiling is structurally incapable of stating a
set that skips. `teams_per_group` wants to stay a stepper, its legal values being a genuine range —
`max(2, qualifiers_per_group)` upward — with bounds derived from the other two rather than written
into `SHAPE_FIELDS` by hand. **The defect is not that a number field is the wrong control, it is
that two of these three fields do not describe intervals.**

**`SHAPE_FIELDS` is where the offer belongs.** Its own docstring says it is "One table for the
fields and the confirmation both, so no readout can label a number differently from the field above
it", so the redraw confirmation inherits a corrected offer for free.
`fl_frontend/src/shared/components/ui/refusableOption.ts :: pickIfOffered` and
`fl_frontend/src/shared/components/ui/RefusableSelect.tsx :: RefusableSelect` are the mechanism
already built for an option that closes, and they fix the repository's answer to a stored value the
offer does not hold: a closed option resolves to `null`. Where the stored value must stay visible
rather than clear, the pattern is the Herkunft picker's — keep the row only where it IS the current
choice, so it reads as a statement rather than an offer.

**The redraw panel gains the most.** `REQ-SPIELPLAN-004` demands that every offered group hold
exactly `teams_per_group` after a redraw, so that panel can offer only shapes whose group count
times team count equals the clubs already entered. That collapses three interacting fields into a
short reachable list, on the one panel where a wrong guess costs a failed draw rather than a refused
save.

**What selects can and cannot design out.** `REQ-RULES-001` and `REQ-RULES-007` are arithmetic on
the three numbers alone, so an offer can guarantee them. `REQ-RULES-002`, `REQ-RULES-003` and
`REQ-RULES-006` read the season's own occupancy and fixtures, and
`.../AdminSaisonEditForm/FormRegelnSection.tsx` is handed three freeze flags and no occupancy today.
Threading the group fill counts in would reach the first two, and it is cheaper than it sounds:
`REQ-RULES-011` freezes all three fields absolutely once a fixture exists, so the only editable case
is an undrawn season, where occupancy is the sole remaining stored constraint.

**No backend rule is removed, and this is written down so a later session does not reach for one.** The
selects eliminate a round trip, never a rule. A stale tab holds an offer derived from rules that have since
changed; the API is reachable without the form; and a derived offer is a further mirror of backend rules that
can drift — `fl_frontend/src/features/saisons/schemas.ts :: hasPlayableBracket` is already the second, and
`.claude/rules/cross-surface.md` holds the Zod mirror to presence, required, nullable, type and enum, so
`fl_frontend/src/core/apiContract.test.ts` compares no numeric bound and would not catch the drift. The offer
therefore needs a test of its own pinning it against the backend's rule functions;
`fl_frontend/src/features/saisons/recordedFactMirror.test.ts` is the precedent for parsing the Python side
rather than restating it. Where a rule should genuinely stop holding,
`fl_backend/app/core/domain.py :: UNENFORCED` is the mechanism and deletion is not.

**Raising the cap to 16 is my direction, and these are the hazards it turns live.** Each was read
2026-08-27 and none is reachable while the cap and the closed name set agree.

| Site                                                           | What it does                                                                                                                                                                                                                                                                                                    | Loud or silent                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `fl_backend/app/api/teams/services.py :: offered_gruppen`      | `get_args(FLGruppenNames)[:number_of_groups]` — a bare slice that returns four names for eight and raises nothing. `find_entry_refusal`, `REQ-SPIELPLAN-004` and `fl_backend/app/api/saisons/spielplan.py :: _squads` all inherit it                                                                            | **Silent.** Held shut today only by `fl_backend/tests/api/test_reference_models.py`, which asserts the cap equals the set size |
| `fl_frontend/src/features/teams/utils.ts :: buildGruppeOffer`  | The identical slice in TypeScript, so clubs could not be entered into the new groups at all                                                                                                                                                                                                                     | Silent                                                                                                                         |
| `fl_frontend/src/features/teams/schemas.ts :: FLGruppenSchema` | A `z.object` with four required keys, and `z.object` strips unknown ones — a fifth group is dropped on parse and the standings page renders four tables with no error                                                                                                                                           | Silent at runtime; `apiContract.test.ts` catches the drift                                                                     |
| `fl_backend/app/api/teams/services.py :: build_gruppen`        | Seeds from the name set rather than the season, so a wider set renders empty group cards on every smaller season. Changing it moves `docs/backend/spec.md :: I10`, the glossary's trap and `FLGruppenSchema`'s shape together                                                                                   | Silent                                                                                                                         |
| `.../AdminEditSpielDataForm/FormTeamPicker.tsx`                | Hardcodes the group list with `satisfies`, which type-checks against a wider union and quietly stops offering the new groups                                                                                                                                                                                    | Silent                                                                                                                         |
| `FormRegelnSection.tsx` and `AdminCreateSaisonForm.tsx`        | Two hand-written `maxValue={4}` steppers, pinned by no test                                                                                                                                                                                                                                                     | Silent                                                                                                                         |
| `fl_backend/app/api/spiele/admin_router.py` and `:: crud.py`   | Season-scoped fixture reads raise past `LIST_LIMIT_DEFAULT` (1024) as a 500 rather than a refusal. `fl_backend/app/api/saisons/schemas.py :: TeamsPerGroup`'s comment states its ceiling of 16 was chosen to keep the largest legal season inside that limit, so raising the group cap makes that comment false | Loud, as a 500                                                                                                                 |

Raising the group cap also adds seeding keys `fl_backend/app/api/saisons/spielplan.py :: BRACKET_SEEDING` does
not hold, which the comment at that table states.

**What is unexpectedly clean.** No layout anywhere is sized per group — every grid in
`fl_frontend/src` is card responsiveness, no tab strip or filter row carries one entry per group,
and no table has a column per group. Nothing on the frontend sorts group names, so the byte-order
hazard `docs/backend/spec.md :: I54` guards against does not reach this. The standings page stacks
one card per group and grows, which is a design question at sixteen groups rather than a breakage.

**Not verified.** Nothing here was seen rendering — no admin session is available to the sessions
that read it — so every claim about a control is read off source and class strings. The legal-set
arithmetic is derived from the rule functions rather than executed. `BRACKET_SEEDING` was not
re-measured here.

### `f3ar-m4qf` · Setting up a season is a hand-run sequence, and only an admin can enter a squad

| Tags                                                                        | Status | Depends on |
| --------------------------------------------------------------------------- | ------ | ---------- |
| FE, BE, DB, Ops, Docs, edge, bewerbungen, kontakte, saisons, spieler, teams | Open   | —          |

**My item, 2026-08-13.** The Saison create form becomes a guided workflow that takes an admin through a whole
new season — its dates, which clubs play it, which clubs are new, and the rules it runs under — and the season
is then built behind that flow, as automatically as it can be. Beside it, `/admin/kontakte` lists the school
and team representatives a season holds. An accepted application tells its own contacts
(`fl_frontend/src/features/bewerbungen/notifications.ts :: sendBewerbungMail`); what is still owed is that
message for a team entered by hand, and a link or a code to paste into that team's group chat. The link leads
to a page, also new, where the players of that team enter themselves with their position, squad number and the
rest — a returning player recognised rather than duplicated, a number clash raised rather than stored. The
Saison page and its editor change with it.

**It is a programme, and its parts are not one change.**

| Part                                                        | Needs first                                   | Could ship alone |
| ----------------------------------------------------------- | --------------------------------------------- | ---------------- |
| The guided creation flow, as a page over the create payload | —                                             | Yes              |
| Drawing the season from that flow rather than by hand       | the flow                                      | No               |
| Telling a representative entered by hand their team is in   | —                                             | Yes              |
| A shareable link or code, and what it authorises            | a ruling on the authorisation model           | No               |
| The public self-registration page                           | the link, and a public write path             | No               |
| Recognising a returning player                              | the registration page                         | No               |
| Raising a squad-number clash                                | the registration page; the reissue hole below | The hole, alone  |
| Rework of the Saison page and its editor                    | whichever of the above lands                  | Yes              |

**The season's structure is not this entry's to build.**
`fl_backend/app/api/saisons/schedule.py :: schedule_for` takes a season's rules and returns, per phase the
season actually plays, how many matchdays it takes and how many matches each holds; `:: expected_matches` is
what a matchday's `anzahl_spiele` reports, and a rules combination that cannot be played is refused
(`fl_backend/app/api/saisons/services.py :: find_rules_refusal`). The draw writes that answer out:
`POST /saisons/{saison_id}/spielplan` composes every matchday and every fixture of the season from those rules
and the clubs entered into it, in one transaction ([`docs/backend/spec.md`](../backend/spec.md) I46), and
`spiel_nr` is contiguous from 1 in playing order because the draw assigns it rather than a caller choosing
one. So the shape of a season is a pure function of what a create form collects, and the flow's structural
half is showing that function's answer while the admin is still choosing, then calling the draw once.

**What the flow owes the draw is the ORDER, not the arithmetic.** The draw refuses a season already
finished (`REQ-SPIELPLAN-003`) and a group holding anything but the teams its rules ask for (`-004`),
so every club still has to be entered before it runs, and a wizard reaching it early is refused
rather than left half-drawn. A season already holding a fixture or a matchday is refused too
(`-001`, `-002`) **unless the request confirms a replace**, which removes both lists and draws them
again inside the same transaction; `REQ-SPIELPLAN-005` holds that to a `future` season with nothing
recorded. The replace CARRIES the new shape rules and writes them in that same transaction, which is
what makes a season drawn from the wrong numbers repairable: a season's shape rules and its draw are
one fact, so `REQ-RULES-011` keeps them off the patch entirely rather than lifting. The draw is
therefore repeatable for as long as the setup lasts, and a flow that draws early and draws again
after a correction is a shape the API supports — at the price of a confirmation, because a replace
destroys the whole schedule rather than the part that was wrong, and nothing writes one back. **What
a replace reaches is the qualifier count**, the group shape being fixed by the clubs already
entered; `DELETE /saisons/{saison_id}/spielplan` undraws the season instead, which is the way back
from a group shape guessed wrong, and [`docs/domain.md`](../domain.md) carries the sequence. Today it
is a panel an admin presses on `/admin/saisons/[saison_id]` once the clubs are in
(`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx`),
which is the hand-run sequence this entry is about rather than a flow.

**Ending the flow by making the season live is the one thing it must not do.**
`POST /saisons/{saison_id}/activate` is the only code path in the system that writes `status`, a
created season is always `future`, and creating and activating are two steps **on purpose** — a
single "create it and make it live" call turns a typo in a four-character season id into a silent
rollover of the running season, produced by a form field. A guided workflow that finishes by making
the season current is exactly that call with a wizard in front of it. The flow ends at a season that
is ready and `future`; the rollover stays the panel on `/admin/saisons/[saison_id]`, where the
outgoing season's unfinished fixtures are listed rather than counted.

**A matchday follows from the rules rather than from a person, which is what makes generating a
season a consequence rather than a feature.** A phase takes exactly the matchdays its rules imply —
one per round, so a knockout round is one matchday and not several — and `position` and
`saison_phase` are the draw's, on no payload afterwards. `/admin/spieltage` lists what the draw
wrote, and a matchday's own editor sets the span the draw leaves null. What remains of the
structural half is therefore the flow that collects the rules, not a second writer of anything:
`spiele.spieltag_id` still has no fixture-level create or delete, and nothing needs one — the one
endpoint that removes a matchday removes that season's fixtures in the same transaction, so the
reference cannot dangle (`fl_backend/app/core/domain.py :: REFERENCES`).

**A public write into application data has two precedents, and neither inserts a person into the
league.** The application form's `POST /bewerbungen` is base-tier and stores what a school
submitted, decided by nobody until the triage reaches it
([`docs/backend/spec.md`](../backend/spec.md) §1.1); the confirmation page's
`POST /bewerbungen/einwilligung` writes one named contact person's own answer into that stored
application, authorised by an emailed token rather than by a session. Every other write that touches the league's own
data sits behind `verify_access_admin`, declared at router level and inherited by the endpoints
under it; the browser side of that is an email allowlist checked at sign-in and re-derived on every
session read (`fl_frontend/src/core/auth.ts`). The remaining public unauthenticated writes touch no
application data — the sign-in action, which triggers an outbound email and writes into the Auth.js
store alone, and `fl_frontend/src/app/api/client-error/route.ts`, which writes a log line — and each
public write has its own `limit_req_zone` in `nginx/prod.conf`, keyed so that only the POST is
limited. **A self-registration page is the first that inserts a person**, and the first whose text
reaches a public page with no decision standing between.

**Recognising a returning player has a shape already, and the tempting version of it is refused.**
`spieler` holds the person and the `saison_spieler` junction holds everything a squad list shows;
`uniq_spieler_id_saison_id` gives a person one row per season, so bringing back somebody who already
has a retired row for that season is `POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate` and
never a second create. Making a create idempotent on a natural key was rejected because a two-letter
shorthand cannot distinguish the same club returning from a different one wanting those letters, and
getting it wrong repoints history silently. **A typed name is a weaker key than a shorthand**, so the
same argument binds harder here: matching on a name has to propose a candidate rather than resolve
one, and the resolution belongs to somebody who can be wrong out loud. `is_nachgetragen` is the
field that already records a squad entry arriving after the season began, derived from the chosen
season's status rather than asked
(`fl_frontend/src/features/spieler/components/forms/AdminCreateSpielerForm.tsx`), and a
self-registration into a running season is precisely that case.

**Nothing refuses a shared squad number and nothing reports one, so this page inherits a question
rather than a pattern.** A shared shirt is a permitted state on every write path
(`fl_backend/app/core/domain.py :: UNENFORCED`). The squad editor's rail raises no banner about a
number
(`fl_frontend/src/features/spieler/components/forms/AdminSpielerEditForm/banners.ts :: buildSpielerBanners`),
and the create form judges `nummer` on its format alone; the editor's save routes through a
confirmation for any banner above `info`
(`fl_frontend/src/shared/components/ui/railBanner.ts :: resolveBlockingBanners`), and the only one it
raises is `spieler.team-changed` — a transfer rather than a shirt. A page where a whole team enters
itself multiplies those writes and has no admin reading them, so whether a self-registered player
may take a shirt somebody in the squad already wears — and who is told — is a product call this
entry owns, and no admin surface answers it first.

**What the Saison page and its editor inherit.** The create form is a dialog today
(`fl_frontend/src/features/saisons/components/modals/AdminCreateSaisonModal.tsx` over
`fl_frontend/src/features/saisons/components/forms/AdminCreateSaisonForm.tsx`), and what happens
when a form outgrows one is already fixed: it becomes a page at its own route, with panels per
section, a field judged when it is left, one save bar, a discard guard and an undo route handler. A
flow that also picks clubs and creates them passes that threshold by a distance, so the guided
workflow is a page rather than a larger modal, and the pattern to copy is on
`/admin/saisons/[saison_id]` —
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx` and
the panels beside it, the Spielplan draw among them. The editor is where a wrong answer from the
flow is corrected, so every field the flow collects has to be editable afterwards, and the narrowing
refusals `find_rules_refusal` performs are what the flow has to state while a value is still being
chosen — which is `ex2m-qjkg`'s subject, and building this flow before it means building that offer
twice.

**Where a representative's contact is kept is fixed, and the flow inherits it rather than choosing
it.** The block is embedded rather than given a collection of its own: on the `saison_teams`
junction (`fl_backend/app/api/teams/schemas.py :: FLSaisonTeamKontakte`) and on an application row,
both validated through one sub-schema (`fl_backend/app/core/constraints.py :: _KONTAKTE_PROPERTIES`),
so a role added to the block reaches both collections in the commit that adds it. `/admin/kontakte`
reads the junction's copy, and `fl_backend/app/api/kontakte/admin_router.py :: erase_kontaktperson`
is the one route that removes a person from either.

**What a failed notification does is fixed too** — a decision's message reaches every person the
application names and no failure to deliver it retracts the decision
([`docs/frontend/spec.md`](../frontend/spec.md) I39). What is local to this entry is how little of
that surface there is to copy from: `fl_frontend/src/core/mail.ts :: sendMail` has two callers
today, the triage's fan-out in `sendBewerbungMail` and the sign-in link through the Resend provider's
override in `fl_frontend/src/core/auth.ts`. Telling a representative entered by hand that their team
is in adds the third.

**Undecided, and each needs a ruling before the part depending on it starts:**

- **What the link authorises, and what a leaked one can do.** A code per team per season, or a
  signed URL; whether it expires with the registration window; whether it can be revoked and
  reissued; and whether it identifies the team alone or the team and the person. A link pasted into
  a group chat is a link that leaves the group chat.
- **Whether a self-registered entry is live on submission or waits to be admitted.** A squad list is
  a public page, so a public write that lands straight in one is public text written by an
  unauthenticated stranger — the trust `teams.description` and an `austritt`'s `grund` already
  carry, extended to somebody the league has not authenticated.
- **What the form may ask for, and where the notice saying so lives.** `stufe` is the Hessen
  Oberstufe, so the people typing into this page are school pupils. The public route group
  `fl_frontend/src/app/(public)/(meta)/` holds `about`, `kontakt` and `team`. Everyone signing up
  gives their own consent there and the minimum age is 16 (`docs/datenschutz.md` §2), so the flow is
  also where a consent text and a birthdate are collected.
- **Whether the flow may enter a club it has just created.** No junction row is ever removed —
  `saison_teams` has a POST, a PATCH and a replace, and no DELETE — but a club does leave a season
  two ways, and the WRONG club is the repairable one:
  `POST /teams/{team_id}/saisons/{saison_id}/replace` hands the row to the club that should have
  been entered, reseeding its identity copy and carrying the change into the season's fixtures,
  refused in a `past` season and once any of those fixtures has left a record (`REQ-REPLACE-001`,
  `-002`). What it does not reach is the club too MANY: a replacement brings one club in for one
  going out, and refuses a club the season already holds (`-003`), so a wizard that enters a club
  nobody should have entered still ends in an `austritt` — a public record with a reason on it,
  which is a heavy consequence for a step in a flow designed to be fast.
- **What a rate limit for this surface should be.** The zones that exist are sized for a person
  signing in, for a crashing browser, and for one school submitting one application; a whole squad
  filling a form in one break is a different shape of traffic on the same edge, so `zone=bewerbung`
  ([`docs/ops/spec.md`](../ops/spec.md) §1.3) is the nearest precedent rather than the answer.

### `fau5-jtph` · The action log's page narrows one capped read, and a toast promises more than search can show

| Tags                          | Status | Depends on |
| ----------------------------- | ------ | ---------- |
| FE, BE, Docs, admin, aktionen | Open   | —          |

**The page asks for one page of the log and narrows it by one key.**
`fl_frontend/src/app/admin/aktionen/page.tsx :: AktionenTable` composes its request from `document_id` alone,
so what arrives is `fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT` rows of the newest history
and nothing else. The endpoint is not the constraint:
`fl_backend/app/api/aktionen/admin_router.py :: get_aktionen` already takes `collection`, `operation` and
`correlation_id` and composes each into its query. Nothing sends them.

**Search and the facets then run over the rows that arrived.**
`fl_frontend/src/features/aktionen/facets.ts :: AKTIONEN_FACETS` reads every option's members off
the loaded list, and `fl_frontend/src/features/aktionen/components/views/AdminAktionenView.tsx`'s
`SEARCH_KEYS` matches the same rows, so both narrow within one read rather than within the log.
**Most of that is disclosed rather than silent.** Where the answer was cut, `AdminAktionenView`
raises a standing warning saying in as many words that the search and the filters reach the loaded
rows alone, and the `vollstaendig` flag it reads is `docs/backend/spec.md :: I45`'s shape.

**One surface promises otherwise, and it is the one an administrator is following.** Copying a row's
Vorgangsnummer raises a toast reading "Suche danach, um jede Zeile dieses Vorgangs zu sehen"
(`fl_frontend/src/features/aktionen/components/collections/AdminAktionenTable.tsx`). A Vorgang whose
rows straddle the cut is one that search cannot show whole, and the toast is unconditional where the
warning above it is not — so the instruction is given at the moment nothing is saying it may not
hold.

**Whether this grows or sits rests on a count nobody has taken.** Every admin write appends a row and
`docs/backend/spec.md :: I119` expires a stamped one twelve months later, so the log settles at a
year's recorded writes rather than climbing without end. Whether a year's writes pass
`fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT` decides whether this page's reach
falls at all, and nobody has counted them. `get_aktionen`'s own comment rests on the same premise:
the extra row it reads is what answers whether the cap was reached.

**Done** is the three terms the endpoint already takes being sent, and the facet counts coming from
the server rather than from the rows one read returned — the same collision `2rz3-a754` meets on the
application queue, so whatever answers it there is what this should follow rather than solve a
second time.

**What is read and what is not** (COR-9). Every claim here is read off the source rather than
measured: the request the page composes, the terms the endpoint accepts, the two client-side
narrowings, and the toast's copy. **Nothing was driven against a log past the cap**, and how many
rows the collection holds today was not counted, so how soon the state arrives is unknown.

### `g7hr-c8bn` · The replace and the undraw judge their window from a capped read

| Tags                  | Status   | Depends on |
| --------------------- | -------- | ---------- |
| BE, DB, Docs, saisons | Standing | —          |

**Both irreversible operations count what they must not destroy from one capped read.**
`fl_backend/app/api/saisons/admin_router.py :: generate_spielplan` and `:: undraw_spielplan` each
call `fl_backend/app/core/crud.py :: pull_many_from_db` on `spiele` filtered by `saison_id` with no
`limit` argument, which takes `fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT` as a
real ceiling on the cursor — `cursor.limit()`, as that helper's own docstring says. A `sum` over
`fl_backend/app/api/saisons/services.py :: holds_a_recorded_fact` across the returned list is then
what `REQ-SPIELPLAN-005` and `REQ-SPIELPLAN-006` are judged on. **A season holding more fixtures than
the ceiling has everything past it invisible to both refusals, and both operations then remove it.**
`len(stored_spiele)` feeds the replace's own `fixtures_drawn` in the same call, so its count is
capped too — while the matchday count beside it is a `count_documents` and is not.

**No season the API can draw comes close, and the ceiling that guarantees it is documented as existing for
this reason.** `fl_backend/app/api/saisons/schemas.py :: TeamsPerGroup` states at the line that its ceiling
"keeps the largest legal season inside `app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT`, past which a
season-scoped read truncates and its refusals cannot be trusted". So the exposure is not a season this API
produced. **It reopens on one thing alone: a season reaching the API whose fixtures were not drawn by it,
through an import, a hand-built season or a migration.**

**One entry rather than two, because the exposure is one read shape and both operations share it.**
They also share the repair: either the count is a `count_documents` on the same filter, which has no
ceiling and is what a refusal actually needs — the shape one argument above it already uses — or the
read asks for one row more than the limit and raises on getting it, which is what
`docs/backend/spec.md :: I45` fixes for a narrowing read and what
`fl_backend/app/api/saisons/visibility.py :: withheld_saison_ids` does. **The second is the closer
match**, because both call sites want the rows as well as the count: they project
`RECORDED_FACT_FIELDS` and iterate them.

**Why it stands rather than being open.** Fixing it costs almost nothing, and leaving it costs
nothing at all until a season arrives from outside the draw. What the entry buys today is that the
guarantee is written down as resting on a bound in one file rather than on the read being safe.

### `ggng-8m7v` · The confirmation link's two anonymous endpoints read a whole application unprojected

| Tags                      | Status | Depends on |
| ------------------------- | ------ | ---------- |
| BE, DB, Docs, bewerbungen | Open   | —          |

**Both endpoints load the document and answer with a closed handful of its fields.**
`fl_backend/app/api/bewerbungen/einwilligung_router.py :: get_einwilligung_ansicht` finds the
application through `fl_backend/app/api/bewerbungen/services.py :: build_token_filter` and answers a
state, a season, a school, a role, a first name and a wording label
(`docs/backend/spec.md :: READ-BEWERBUNG-002`);
`fl_backend/app/api/bewerbungen/einwilligung_router.py :: post_einwilligung` reads the same way
inside its transaction. Both are base-tier, and the document they load carries three people's email
addresses and telephone numbers, each seat's `token_hash`, and which schools were turned down.

**Nothing is served that should not be, and that is the whole of the guarantee.** The response models
declare their fields and no others, so this is depth rather than a leak. What it costs is that the
guarantee rests on the response model alone: a field added to a model, a debug line, or an error path
that renders what was loaded turns an unprojected read into a disclosure, on the one tier that
authenticates nobody.

**The projection habit exists here already, in the opposite shape.**
`fl_backend/app/api/bewerbungen/services.py :: WITHOUT_TOKEN_HASHES` keeps the hashes off the wire
for the admin reads, and is an exclusion because an inclusion list there would have to restate every
field an application holds. These two endpoints are the case that argues the other way: what they
answer with is a short closed list, and everything else on the document is what they must not carry.

**Done when** each anonymous read names the fields it needs, and a case fails where a field outside
that list reaches the handler.

### `hstg-rnqj` · The certainty walk never hypothesises a called-off fixture, and a call-off can move a placing

| Tags                    | Status | Depends on |
| ----------------------- | ------ | ---------- |
| BE, Docs, spiele, teams | Open   | —          |

**`fl_backend/app/api/teams/services.py :: _decide_one_gruppe` walks `product((1, 0, 2),
repeat=len(open_pairs))` — a win to one side, a win to the other, or a draw — and an outstanding
fixture has a fourth ending.** A `sonderereignis` of `ausgefallen` or `annulliert` awards nothing to
either club, and `fl_backend/app/api/spiele/schemas.py :: SONDEREREIGNIS_WITHOUT_A_RESULT` is the
set that both the walk's own open set and `fl_backend/app/api/teams/services.py :: _still_to_play`
exclude on. So a call-off does two things none of the three endings can express: it withholds points
the walk assumed one of three ways, and it lowers what a club still has to play — which is half of
`:: _may_hold_a_platz`, so a club that has played nothing and whose last outstanding fixture is
called off leaves `placeable` and stops holding a placing at all.

**What that reaches is the bracket rather than a table.** `fl_backend/app/api/spiele/crud.py` hands
each group's `by_platz` straight to the bracket resolution, so a placing the walk certifies is
seeded into a knockout slot. A later call-off that moves it is corrected on the next save, and
re-resolving an advancement clears the advanced fixture's stored result — the destruction
`32bs-nhzd` carries.

**Measured on 2026-08-21, against a ground-truth oracle enumerating four endings per open fixture.**
Across 3,500 randomised groups and 275,000 exhaustive ones, the shipped walk contradicts the
oracle's set in 1.4% to 6.9% of the groups that declare a placing at all — a spread across the
generated shapes rather than a confidence bound. **What validates the oracle rather than the walk is
the control:** the same comparison, with the oracle restricted to the three endings the walk already
knows, finds no contradiction anywhere.

**Two mechanisms produce it, and only one of them needs unusual rules.**

- **Points.** A call-off leaves both clubs exactly where they stood, and no branch of a three-ending
  walk does — a draw lifts both, a win lifts one. The run separates this mechanism only where
  `draw_points` is 2 or more, so a season scoring the conventional 3/1/0 does not meet it.
- **Placeability.** `_may_hold_a_platz` admits a club with a match that counts or still could, and a
  call-off removes the second half. Where a club has played nothing and its only outstanding fixture
  is called off, it leaves `placeable`, every club under it in the order moves up a number, and no
  table the walk built holds that ordering. This one is reachable at 3/1/0.

**Widening the alphabet is not the fix, and neither obstacle is arithmetic alone.** The enumeration is `3^n`
and would become `4^n`: measured at `fl_backend/app/api/teams/services.py :: CERTAINTY_FIXTURE_LIMIT` on
2026-08-21, the four-ending product takes 7.20 seconds against the three-ending 0.79, and that time is spent
once per referenced group, inside a transaction whose lifetime is bounded. The second obstacle is structural:
`placeable` and `settled` are derived once before the loop, from the fixtures as they stand, and a
hypothesised call-off changes both — so each would have to be recomputed per outcome vector, and the
deduplication by points table that keeps the walk affordable would identify none of the iterations
that may be skipped.

**What [`docs/backend/spec.md`](../backend/spec.md) I24a already says, and what it does not.** I24a
states that a placing is written into a bracket slot only when no combination of the group's
outstanding results could change who holds it, and it carves out one case: a fixture whose
`sonderereignis` awards nothing counts as never coming, so a no-show recorded on one later can
overturn a placing that was already final. That carve-out runs the other way — an already-called-off
fixture that later receives a result — while the direction measured here, an open fixture later
called off, sits inside the sentence the carve-out qualifies. **Whichever way this is answered, that
invariant moves with it.**

**Done rests on three answers rather than one:** which endings the walk enumerates, what a wider set
costs inside a write transaction, and how the invariant states the claim afterwards. It shares
`_decide_one_gruppe` with `zp46-yt3p`, which is the cap on how many outstanding fixtures the walk
enumerates at all where this is the set of endings it enumerates per fixture, so either one's
arithmetic moves the other's.

**Not measured:** whether the state has ever arisen in the live database, and what the walk
contradicts on this season's own shape rather than on generated groups. Against the season shape and
rules `zp46-yt3p` records, only the placeability mechanism above is reachable.

### `huzh-hdfx` · A never-clause bounds what a stylesheet may say about a toast, and the stylesheet says more

| Tags     | Status  | Depends on |
| -------- | ------- | ---------- |
| FE, Docs | Decided | —          |

**`.claude/rules/frontend.md` permits a toast to be styled from CSS at the shell and at the
frontmost close button, and `fl_frontend/src/app/globals.css` styles a surface past both.** The
block there sets `.toast` and each of its `--<variant>` modifiers, the close button under
`[data-frontmost]`, and the timer bar — its animation, and the pause the region's hover and focus put
on it.

**The same rule is stated in a wider place, and the wider statement is the one that fits the code.**
[`docs/frontend/spec.md`](../frontend/spec.md) I57 states it as a ban on adding — never a new
`.toast*` rule in a stylesheet — which names the surface rather than counting it. The **toast**
clause states it as a bound on what may be styled at all, and the bound it names falls short of what
the stylesheet holds. PRE-1's ladder puts the code above the spec sheet and the spec sheet above
`.claude/CLAUDE.md`, so the clause is the loser of both.

**Ruled: replace the clause's first half with the spec sheet's formulation and keep the second
half** (`docs/datenschutz.md` §10, 2026-09-02). That is a `.claude/CLAUDE.md`-governed edit only I
authorise, and I do; naming the surface the way I57 does — the toast rules a stylesheet may hold are
the ones markup cannot reach, and a new one is a breach — states the same bound without a figure
that goes stale the next time a rule is genuinely forced into CSS.

**Which parts are genuinely in question, verified against `@heroui/styles` 3.2.4 on 2026-08-20 by
enumerating the selectors its `toast.css` declares:**

- **The variant modifiers are the shell.** HeroUI writes `toast` and its `--<variant>` modifier onto
  one element, so a rule tinting that element's border styles the shell rather than something beside
  it. Every modifier the stylesheet overrides is declared by that file.
- **`toast-region` is never a rule's subject.** It occurs only as the ancestor in the selectors that
  pause the timer, and the property lands on the timer.
- **The timer bar is this app's own element, and its rules are what the clause does not name.**
  `toast.css` declares no `toast__timer` selector, and
  `fl_frontend/src/core/providers/AppToaster.tsx :: toastCard` is what puts the class on the
  element. Its keyframes and its paused state are keyed on an ancestor's hover and focus, which a
  utility on the element cannot express — so a stylesheet is the only route, which is the argument
  the close button's rule already rests on.

**What the change may not sweep in.** `table__column` and the secondary variant's row hover are
vendored selectors overridden in the same file, and no clause governs them. §1.11 of the frontend
spec sheet is what governs both cases, and it already asks a stylesheet rule to name the HeroUI
version it was written against.

### `kwfu-48sm` · Two surfaces offer a squad-row return the season's cap will refuse

| Tags                   | Status | Depends on |
| ---------------------- | ------ | ---------- |
| FE, BE, admin, spieler | Open   | —          |

**`REQ-SQUAD-003` refuses a reactivation, and neither surface that offers one can see it coming.**
`fl_backend/app/api/spieler/admin_router.py :: reactivate_saison_spieler` calls
`:: _refuse_a_full_squad`, whose docstring states the reason plainly — the cap is a property of the
destination squad, not of the verb — so create, transfer and reactivate are judged the same way. The
two front-end paths to that endpoint are the player editor's Kader section and the squad row's
restore control on the list, and **neither states the refusal before the press** — but what a gate
would cost the two of them is not the same.

**The editor already holds both facts the refusal is computed from.**
`fl_frontend/src/app/admin/spieler/[spieler_id]/page.tsx` reads every player's memberships for the season and
folds them per club through `fl_frontend/src/features/spieler/utils.ts :: collectHeldRollen`, so the live row
count is a fold away; the season it reads beside them carries `rules.max_kadergroesse`. `REQ-SQUAD-004` is the
worked precedent — a per-club, per-season fact computed on that page and raised in the rail as
`spieler.rolle-vergeben` before any press. **What the editor's half needs is that fold and a banner**, not new
page data.

**What an administrator gets is correct and late.**
`fl_frontend/src/features/spieler/actions.ts :: mapSquadRefusal` maps the code to a German sentence naming
both repairs — raise the cap in the season rules, or take another player out first — and the reactivate action
routes its 409 through it. So the press produces an accurate red toast rather than the generic conflict
message, which is the treatment the editor already gives every other squad refusal. **Matching that treatment
was the right call**: a second mechanism for one refusal would be the split this product keeps avoiding.

**What the list page's half would cost, which is the part worth writing down.** That page needs
neither the cap nor per-club counts for anything else it renders —
`fl_frontend/src/shared/components/ui/RowActions.tsx :: RowActionRestore` takes a `disabledReason`
and would use one, and its own comment states the principle, but nothing on that page computes it
today. Threading it means the season's rules and a live count per club reaching a list that is
otherwise a flat read, and keeping that count fresh across the writes the same page performs.
**That is a real page-data change for a refusal an administrator meets rarely.**

**Low severity, and the entry should not inflate it.** The endpoint refuses correctly, the message
is actionable, and no data is at risk. What it costs is one press and one toast, on a squad that is
already full.

### `kyc4-75k5` · A pupil's consent is stored and served, and shown by nothing

| Tags                  | Status | Depends on |
| --------------------- | ------ | ---------- |
| FE, BE, Docs, spieler | Open   | —          |

**`fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` records what a pupil agreed may be
published — its `umfang`, who gave it in `erteilt_von`, and the dates beside them — and no surface
in the product renders it.** `POST /spieler` composes one through
`fl_backend/app/api/spieler/services.py :: registration_einwilligung`;
`fl_backend/app/core/domain.py` declares the field `IMMUTABLE`, no payload carrying it, so a manual
database edit is the only other writer; `GET /spieler/memberships` serves it on
`fl_backend/app/api/spieler/schemas.py :: FLSpielerWithMemberships`; and
`fl_frontend/src/features/spieler/schemas.ts :: FLEinwilligungSchema` mirrors the shape. No
component under `fl_frontend/src` reads the field.

**Ruled: the player editor shows the stored consent, read-only, and it never gates publication**
(`docs/datenschutz.md` §10, 2026-09-02). An immutable record shown beside editable fields owes the
reader a word saying which it is, which is the whole of the remaining design.

**What it must not quietly become.** Rendering the field is not gating publication on it, not making
it writable, and not marking a backfilled consent as distinguishable from a collected one. The
publication gate is `8wd7-ff49`'s, and it is ruled to read what a sign-up flow stores rather than
what stands today.

**What it would show is uniform, measured against the live database on 2026-08-22:** each of the 362
stored pupils carries a consent, every one `umfang: kader_oeffentlich` and `erteilt_von:
bestandsuebernahme`, each with a confirmation date. That is a backfill rather than a collected
consent, and it is what makes the display worth something: a record nobody can see is a record
nobody can check. Those rows are deleted once at the end of this season (`docs/datenschutz.md` §3),
so what this shows is a population with an end date on it.

### `m4m3-hxmj` · The shared editor shell's widest layout step has never been rendered

| Tags     | Status | Depends on |
| -------- | ------ | ---------- |
| FE, Docs | Open   | —          |

**`fl_frontend/src/shared/components/ui/EditFormLayout.tsx :: EditFormLayout` declares a layout step
at the `2xl` breakpoint that nothing has ever exercised**, and every entity editor renders through
it. What has been rendered is the single column below `xl` and the grid inside `xl`, where it
resolves to `minmax(0px, 1fr) 340px` with the rail sticky at 24px. Past `2xl` — 96rem in the
installed Tailwind 4.3.3, the theme declaring no breakpoint of its own — the rail becomes 380px and
the gap widens, and nobody has looked at it.

**Read from the source, the step moves width the wrong way.** The rail gains 40px and the gap gains
8px, and both come out of the form column, so crossing that breakpoint narrows the fields by 48px
while the viewport grows. Whether the wrapper is at `--container-page`'s cap or short of it does not
change the transfer, only the widths either side of it. That arithmetic is derived from the class
list and the token rather than measured in a browser, and confirming it is the work's first step.

**The question is which way the step goes, not merely whether it is tested.** Either the wider rail
earns the width it takes at that size and the step stays, or it is a default nobody chose and the
shell keeps a single grid past `xl`. Both are cheap; neither is answerable without rendering it.

**Where it has to be rendered, and why that is not free.** Every editor sits behind the admin
sign-in, and the sidemenu takes its share of the viewport before the shell sees any of it, so the
breakpoint and the space the shell actually gets are different numbers.
[`docs/_auditing/lessons.md`](../_auditing/lessons.md) §6 records that a session cannot sign in, so
the honest scope is a look at one editor past 96rem, in a real browser, by somebody who can.

### `n56q-zu6n` · `Team` names a club and the people who run the league, and the public site renders both

| Tags                  | Status | Depends on |
| --------------------- | ------ | ---------- |
| FE, Docs, meta, teams | Open   | —          |

**[`docs/glossary.md`](../glossary.md) defines `Team` as a club, and `/team` is a page about the
people who run the league.** Its heading is `Frankfurt-League Team`
(`fl_frontend/src/features/meta/components/views/MetaTeamView.tsx :: MetaTeamView`), its metadata
title is the bare word, and the navigation renders it twice more — in
`fl_frontend/src/shared/components/layout/topnav/TopNav.tsx :: TopNav` and in
`fl_frontend/src/shared/components/layout/footer/Footer.tsx :: Footer`. The same navigation offers
`Saisonübersicht` beside it, and everything under that — the league table's column, the popover and
every fixture card — calls a club a `Team`.

**§1.12 of [`docs/frontend/spec.md`](../frontend/spec.md) states the rule from the other side** —
one German word per concept, and a club is a `Team`, never `Mannschaft`. That polices two words for
one concept. This is one word for two, which nothing can check: both senses are ordinary German, and
neither is a misspelling of the other. Leaving it undecided is what makes the next public string
naming either sense a coin toss.

**A season's squad is not a third sense**, which is what keeps this decidable. The squad is `Kader` everywhere
it is rendered — the public squad page's heading and metadata, and the entry beside `Team-Details` in
`fl_frontend/src/features/teams/components/ui/TeamPopoverMenu.tsx :: TeamPopoverMenu`. So the collision is
exactly two senses, and only one of them is the domain entity.

**Ruled: relabel the league's own people's page and keep its route** (`docs/datenschutz.md` §10,
2026-09-02). That is four strings — the heading, the metadata title and the two navigation links —
and nothing else. **Renaming the route was the alternative and it is not taken**: a published
address also moves `fl_frontend/src/app/sitemap.ts` and the page's own canonical, and that half is a
redirect and an indexed URL rather than a copy edit.

**Where the answer goes.** The glossary's `Team` entry is the club's, so the second sense belongs
either as a trap on that entry or as a row in the same page's `Terms that are not domain vocabulary`
table, which already holds the words that only look like domain vocabulary. Nothing under `docs/`
cites the route, so the corpus cost is the glossary line alone.

### `nadg-bnjb` · Every admin write states its success twice, and the second sentence cannot render

| Tags                               | Status | Depends on |
| ---------------------------------- | ------ | ---------- |
| FE, auth, spiele, spielorte, teams | Open   | —          |

Lands with: `njhn-pmtn`

**Twenty distinct German sentences stand ready for a success that will never render one of them —
24 occurrences across 23 files under `fl_frontend/src`, measured 2026-08-26.** Behind each of them
is an action whose terminal return sets `message`, and each of them writes a fallback beside the
value that always arrives.

Three shapes:

- **A fallback under a `success` guard**, twelve of them: `res.message ?? "Spielort reaktiviert"` and
  its like, in the tables and views that reactivate a row and in the two panels that add one to a
  season — for instance
  `fl_frontend/src/features/spielorte/components/collections/AdminSpielorteTable.tsx :: handleReactivate`
  and
  `fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.tsx :: handleEnterSaison`.
- **A `successMessage` prop**, nine of them.
  `fl_frontend/src/shared/components/ui/EntityForm.tsx :: EntityForm` and
  `fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx :: ConfirmDeleteModal` each raise
  `res.message || successMessage`, and the prop is required — so every create form and every
  retirement dialog supplies a sentence it cannot show.
- **Three one-offs**: the match editor's undo toast, the sign-in panel's confirmation, and
  `fl_frontend/src/shared/hooks/useSignOut.ts :: useSignOut`, whose one supplier is `signOutAction`.
  The sign-in one is the sharpest — `fl_frontend/src/features/auth/actions.ts :: neutralResult`
  composes the neutral sentence deliberately, and
  `fl_frontend/src/features/auth/components/forms/SignInForm.tsx :: SignInForm` writes the same
  sentence out again as the fallback beneath it.

**Why the runtime always wins.** `fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation`
answers a thrown error through `toActionErrorResult`, which sets `success: false`; a `success` of
true is therefore always the action's own terminal return, and at every site above, that return sets
its `message`. The match editor is the case that looks like an exception and is not:
`fl_frontend/src/features/spiele/actions.ts :: patchAdminSpielDataAction` composes its message
through `fl_frontend/src/features/spiele/utils.ts :: formatSpielUpdateMessage`, whose first sentence
is unconditional, so the empty string that would let its `||` through cannot be produced.

**Nine of the twenty say something different from what renders**, which is what makes this more than
dead weight. `successMessage="Spielort stillgelegt"` stands where the action sends `"Spielort
stillgelegt. Seine Spiele bleiben erhalten."`; `"Team aufgenommen"` where the season is named;
`"Gespeichert"` where the row's own verb is; and the match editor's `"Die Spieldaten wurden
aktualisiert."` where the same sentence arrives without the full stop and with the fan-out behind
it. So a copy pass can correct the wrong string, watch nothing change, and leave the rendered
sentence standing.

**Done is the type moving first.** `fl_frontend/src/shared/types/types.ts :: FormState` types
`message` as optional, so the checker requires each fallback and cannot be shown that none is
reachable — the same wall `njhn-pmtn` meets on `error`. Narrowing `FormState` into a union whose
succeeding member requires its `message` turns every fallback into a compile error rather than a
judgement per site, and the two shared components go with it: `successMessage` stops being required,
or stops existing.

**What must survive the sweep.** The undo toasts' fallbacks read the same way and are live:
`fl_frontend/src/shared/utils/undoDispatch.ts :: offerUndo` renders `message ?? fallback`, and the
`message` the entity editors pass is `undefined` on an ordinary save, so there the fallback is the
ordinary case. **Reading the `??` alone does not separate the two.**

### `njhn-pmtn` · Every call site writes a fallback for a failure message that always arrives

| Tags     | Status | Depends on |
| -------- | ------ | ---------- |
| FE, Docs | Open   | —          |

Lands with: `nadg-bnjb`

**Forty consumer sites under `fl_frontend/src`, across 28 files, spell `res.error ?? …` or
`res.error || …` for a value that always arrives** (measured 2026-08-26).
`fl_frontend/src/shared/types/types.ts :: FormState` types `error` as optional, so the checker
requires each one; whether any can run is a runtime contract rather than a type claim, and the
contract holds. `fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation` answers a thrown
error with `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`, whose every branch
sets `error`, and every failing return under `fl_frontend/src` carries an `error` beside it.

**Seventeen of those sites fall back to a sentence of their own rather than to the shared one**, in
eight files, and one family inside them is a second sentence with no home: the undo's outcome
`"Die Änderung steht weiterhin."` stands 20 times across 14 files (measured 2026-09-03) — the five
undo route handlers, the five slice `actions.test.ts` files reading them, `undoDispatch.ts` with its
test, `undoRoute.ts` and the public-route test — and no module owns it. **No page-owned editor
carries it**, which is worth saying because that is where a reader looks first. §1.12 of
[`docs/frontend/spec.md`](../frontend/spec.md) is where a refusal's vocabulary is fixed and it names
the two homes a new failure message is written from —
`fl_frontend/src/shared/utils/refusal.ts :: buildRefusal` for a refusal that can name a cause, and
`:: UNKNOWN_REFUSAL` for one that cannot.

**The type has moved half the way.** `fl_frontend/src/shared/types/types.ts :: ActionResult` is a
union now and `:: ActionFailure` is its failing member, so the shape this entry asked for exists.
`error` stays optional on that member, which is what keeps every fallback a judgement call rather
than a compile error. **Done is requiring it there**, which turns the rest into a mechanical sweep;
short of that, deleting one is an argument to be had at every site.

**What makes it more than deleting a token.** `fl_frontend/src/shared/components/ui/EntityForm.tsx`
and `fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx` reach the sentence through
`res.error || res.message || …`, and their `res` comes from a caller-supplied function rather than
from an action — so the narrowing has to reach the props those shared components declare, not the
actions alone. And the seventeen own sentences are a copy decision each: **a fallback that is dead
weight and a fallback that is the only sentence naming what did not happen read identically at the
`??`.**

**Not decided:** whether the shared sentence should stay generic at all. `toActionErrorResult`
states its own reason for one — the diagnosis is already in the server log, and what an admin needs
is whether retrying can help.

### `nr85-vwnj` · A rule declares whether it reads a second document, and nothing resolves the claim

| Tags                                  | Status | Depends on  |
| ------------------------------------- | ------ | ----------- |
| BE, Docs, tests, bewerbungen, saisons | Open   | `2qae-xcut` |

**`fl_backend/app/core/domain.py :: Rule.multi_document` is read by no code in the repository.** The
identifier appears in that module and in no other — no application code, no test. Every sibling
claim on the same dataclass is resolved: `fl_backend/tests/core/test_domain.py ::
test_every_rule_is_implemented_where_it_says` holds `implemented_by` to the constant carrying the
code, and `:: test_every_rule_is_tested_where_it_says` holds `tested_by` to a class asserting on it.
A row can be given either value and the whole default tier stays green.

**What a check would have to do.** Derive each rule's document reach from `fl_backend/app/api`
rather than from the declaration (`docs/_standard/standard.md :: PRE-4`), which means reading the
endpoint that calls the refusal, following which of its collection reads reach the arguments the
rule's own branch consumes, and comparing that against the collection the endpoint addresses.

**Three control-flow shapes defeat a reader that attributes arguments to a rule by its refusal's
enclosing tests alone, and any attempt starts by handling all three.** A guard returning `None`
before the refusal is part of that refusal's condition and its inputs belong to the rule
(`fl_backend/app/api/bewerbungen/services.py :: find_window_refusal`); a guard returning a
_different_ refusal is another rule's and its inputs do not, which matters because twelve rules share
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` and four of them are declared
`False` while sitting after guards that read the season's fixtures; and a refusal built inside a
`try`/`except` reaches its inputs through the exception rather than through a parameter
(`fl_backend/app/api/bewerbungen/services.py :: find_new_club_refusal`). Forty-three of the rules
share a refusal function with another rule, so a check that skips shared functions covers a minority
of the table.

**Done when** a check in `fl_backend/tests/core/test_domain.py` reads every rule, derives the reach
from `fl_backend/app/api` source, states in its own docstring which rules it does not reach and what
that makes permanent, and has been driven red against a row flipped in place.

### `pa6f-ksu4` · A season id that is no year is refused nowhere, and first noticed by an hourly sweep failure

| Tags                               | Status | Depends on |
| ---------------------------------- | ------ | ---------- |
| BE, DB, Docs, bewerbungen, saisons | Open   | —          |

**The id a season is created with is held to a width and never to a shape.**
`fl_backend/app/api/saisons/schemas.py :: FLPostSaisonPayload` is the one create payload carrying an
id, stripped and bounded to `fl_backend/app/shared/schemas/bounds.py :: SAISON_ID_LENGTH` characters
— which is a count of characters and not of digits — and
`fl_backend/app/api/saisons/admin_router.py :: post_saison` stores what that payload accepts.
`docs/backend/spec.md :: I5` states that width and nothing narrower, and the `saisons` validator in
`fl_backend/app/core/constraints.py` declares `_id` a bare string with neither length nor pattern. A
label that is not a year therefore reaches the collection by the front door, and every reader needing
a year from it has to cope.

**The retention sweep is where such an id is noticed, hourly and long after it was typed.**
`fl_backend/app/api/bewerbungen/services.py :: next_saison_id` reads a season id as a year to name
the season following it, which the accepted-application erasure and the contact block's clock both
depend on; an id it cannot read is refused rather than answered, so
`fl_backend/app/api/bewerbungen/sweep_router.py`'s pass for that season fails and the caller records
`FE-SWEEP-001` (`docs/logging/error-codes.md`), leaving the other seasons to run and retrying next
pass. That is the right thing for a sweep to do with an id it cannot trust, and the wrong place to
learn of it: whoever typed the id is long gone, the failure repeats every pass until somebody reads a
log, and the two clocks that season owes stand still meanwhile.

**The refusal that suggests itself first is already refused.**
`.claude/rules/backend.md :: widen one past types and enums` bars taking a `$jsonSchema` validator
past types and enums, so a pattern on `saisons._id` is not available and naming it as the fix sends
the next reader at a ratified clause. The write path is where a shape rule can live: the create
payload already strips the value and measures it, and a season id is read as a year everywhere it is
read at all.

**Done when** `fl_backend/app/api/saisons/admin_router.py :: post_saison` refuses an id that is no
year, declared on `fl_backend/app/api/saisons/schemas.py :: FLPostSaisonPayload` where the width
already sits, with a case pinning that refusal — `.claude/rules/backend.md`'s `db` clause read first,
so the repair is not looked for in the validator.

### `pb66-krbw` · A fixture carries one date, and a play window cannot be expressed

| Tags           | Status | Depends on |
| -------------- | ------ | ---------- |
| FE, BE, spiele | Open   | —          |

**A fixture's `datum` is a single day, so a match scheduled across a window cannot be recorded as
one** (my item, 2026-08-02). Implementing ranges is heavy in my scoping: it would change the match
editor's form
(`fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx :: AdminEditSpielDataForm`),
the schemas, and possibly logic and UI elements **across the board**.

**The Zod mirror is not a fourth place to keep in step by hand:** it is checked against the
published document, so one that falls behind `datum`'s new shape is a gate failure naming the field.

**Touchpoints to scope against when it is worked:** `datum` in each schema mirror and in the stored
documents; `computeSpielStatus`'s date comparisons and `formatSpielDisplay`'s labels, each in
`fl_frontend/src/features/spiele/utils.ts`, and the card layouts over them; the `datum` sort on
`GET /spiele` (`fl_backend/app/api/spiele/services.py :: build_spiele_sort`); `searchable_datum` in
the Spielsuche; and the `ausstehend` semantics, **where a filter selects and a label partitions** — a
range makes the ausstehend/heute/vergangen ternary genuinely harder, and the intent (a fixture whose
play window includes today is found by the upcoming filter and labelled `heute`) is what the range
arithmetic has to preserve. Working it re-derives both definitions under ranges.

### `pw5c-zps5` · A referee gets no consent record, where a contact person confirms their own

| Tags                                                   | Status | Depends on |
| ------------------------------------------------------ | ------ | ---------- |
| FE, BE, DB, Docs, meta, schiedsrichter, spieler, teams | Open   | —          |

**A referee's row holds a contact block and a school, and no record of anybody agreeing to either.**
`fl_backend/app/api/schiedsrichter/schemas.py :: _SchiedsrichterWritable` declares `kontakt` and
`schule` and no consent field, and the `schiedsrichter` collection's validator declares none either;
a referee is entered by an administrator through
`fl_frontend/src/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormKontaktSection.tsx`
and is asked nothing. A team's contact person holds the opposite: a record on
`fl_backend/app/api/teams/schemas.py :: FLKontaktEinwilligung` that only that person's own emailed
link can stamp.

**Ruled: referees get a consent record on the same terms as contact persons**
(`docs/datenschutz.md` §2). The two roles hold the same categories about the same pupils — a
telephone number, an email address and a school — so the asymmetry is in the mechanism rather than in
the sensitivity.

**Why it matters.** The privacy notice describes one rule for how the league obtains permission to
hold contact details, and that rule is true of a contact seat and false of a referee, with no field
on the referee to say which. `READ-CONTACT-001` keeps the block admin-tier, so nothing is published:
what is missing is the record, not a guard.

**Three things that shape the work.** The confirmation flow is built on an application — a token
block on the `bewerbungen` collection, a public router that resolves it, and a mail fan-out over
three seats — so reaching a referee is a second collection, a second write path and a second message
rather than a parameter, which is why this is an entry and not a fold-in. The vocabulary is a choice
between the two that exist and never a third: `FLKontaktEinwilligung` says only that details may be
held and used, `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` says what may be published,
and a referee is a pupil whose name is published on every fixture they officiate. And a referee's
removal is an anonymisation rather than a deletion, so whoever adds the record decides whether it
survives one.

**Done when** a referee has a consent record they gave themselves, its validator copy moved in the
same commit as the model, the admin editor rendering that record rather than offering it, and the
notice's referee publication row moved off the legitimate interest it rests on
(`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`) to the consent the flow
collects.

### `q7jv-hskm` · The replace and the undraw remove the same two collections, and sharing the removal leaves the write sweep

| Tags                   | Status   | Depends on |
| ---------------------- | -------- | ---------- |
| BE, DB, tests, saisons | Standing | —          |

**Both destructive paths make the same pair of removals, in the same order, for the same reason.**
`fl_backend/app/api/saisons/admin_router.py :: generate_spielplan` under its `replace` flag, and
`:: undraw_spielplan` unconditionally, each call `fl_backend/app/core/crud.py :: delete_many_from_db`
on `spiele` and then on `spieltage`, filtered on `saison_id` and carrying the session. Fixtures go
before matchdays at both, so that neither the log's rows nor a restore replaying them holds a fixture
whose matchday is already gone; the draw's own comment cites the undraw for that order rather than
restating it. A collection joining the season's draw is a change both sites take, which is the test
a shared removal would pass.

**Sharing it takes both removals out of the sweep that holds them to their session.**
`fl_backend/tests/core/app_source.py :: transactional_callbacks` reads a `with_transaction`
callback's own lexical body: it follows a helper declared inside the callback, and stops at one the
callback merely calls at module level, following those taking a call graph rather than a sweep. A
shared helper cannot be declared inside either callback and still be shared, so it sits at module
level, and both removals leave the population
`fl_backend/tests/core/test_write_shapes.py :: TestEveryWriteInsideATransactionCarriesIt` reads.
**The loss is silent**: the call handing `session=` on is excused as a hand-off to a helper of the
application's own, so nothing reports the narrowing, and
`fl_backend/tests/core/test_write_shapes.py :: TestWhatARemovalFilterMayName` keeps passing over both
removals inside the helper — it reads the filter and never the session. Drop `session=` from either
removal afterwards and the whole file stays green.

**No other home is open.** Every services module decides from its arguments and takes no database
handle (`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments`),
so `fl_backend/app/api/saisons/services.py` cannot hold a removal. A session-taking helper added to
`fl_backend/app/core/crud.py` fails
`fl_backend/tests/core/test_write_shapes.py :: test_every_crud_helper_taking_a_session_is_named_by_one_of_the_three_sets`,
whose assertion is an equality, until that test's own name sets are widened — which is the check
reshaped to fit the code.

**The removals are one of several pairs these two paths hold in parallel.** The in-session season
read is another, and so is the recorded-fact count, which sums
`fl_backend/app/api/saisons/services.py :: holds_a_recorded_fact` over an identically projected read
of `spiele` at both sites and is what `g7hr-c8bn` turns on. Extracting one pair leaves every other
parallel, so the two callbacks read alike in fewer places than they do now, and the next reader has
one indirection to follow and no rule saying which pairs took it.

**What reopens this:** a third site removing a season's drawn collections, which is the instance that
would make the shape worth naming; or `transactional_callbacks` learning to follow one hop, which
removes the cost above rather than paying it.

### `qp88-3t35` · A cached read's backend call joins to no render, and telemetry has nowhere to go

| Tags                        | Status | Depends on |
| --------------------------- | ------ | ---------- |
| FE, BE, Ops, Docs, versions | Open   | —          |

**Implement the industry-standard shape of the correlation scope this repository runs a subset of**
(my item, 2026-08-05). What runs today is **one id per request, propagated by an ordinary header,
written into each service's JSON stream**. The recognised standard for the same job is **W3C Trace
Context** — a `traceparent` header carrying a trace id, a span id and flags — usually implemented
through **OpenTelemetry**, which records not just an id but a _span per operation_ with parent
links, timings and attributes. Next.js documents `instrumentation.ts` as the hook for it and this
repository already has `fl_frontend/src/instrumentation.ts`; FastAPI/Starlette and pymongo have
maintained instrumentation packages. **Neither upstream claim has been re-verified here** (COR-9).

**What the standard buys over what exists**, in descending order of what it is worth here:

- **A cached read's backend call joins to the page render that triggered it.** This is the one the
  hand-rolled scope provably cannot reach: `"use cache"` forbids request APIs, so no application
  code can carry the request's id into a cache fill (`docs/logging/spec.md`, the cache-fill
  boundary). OpenTelemetry propagates through the framework's own internals instead. It covers every
  cached read; the uncached page-render reads already join.
- **Timings become a tree rather than separate numbers.** Today nginx reports
  `upstream_duration_s` and the backend reports `duration_ms`, and relating them is manual. A span
  tree shows where a slow request actually spent its time, including inside Mongo.
- **A vocabulary other tools already speak**, so a future collector, dashboard or alerting rule
  needs no bespoke parser.

**The question this entry exists to answer is not "which library" — it is where the telemetry
goes.** This repository has _no aggregation of any kind_: reading production logs is `ssh` plus
`docker compose logs`, and those logs are destroyed on every deploy because `scripts/ops/deploy.sh`
recreates the containers (`docs/logging/spec.md`). **OpenTelemetry with no collector behind it is
strictly worse than what exists** — a dependency on every surface, a heavier runtime, and the same
lost-on-deploy stream at the end of it. So the ordering is:

1. **Decide the destination first.** A self-hosted collector on the same box (Jaeger, Grafana
   Tempo/Loki, SigNoz), a hosted backend, or nothing. Each carries a resource cost on a server whose
   services are already capped by `docker-compose.yml`'s deploy limits, and a hosted one puts
   request metadata for a public site into a third party. Whichever answer wins, it lands in
   `docker-compose.yml` and in `scripts/`, which is where the stack is defined and deployed — so
   this step is an ops change before it is a code one.
2. **Only then instrument.** The libraries are the cheap half, and each of them is a new dependency:
   the backend's in `fl_backend/pyproject.toml`, the frontend's in `fl_frontend/package.json`.

**One cheaper thing that is a real improvement on its own**, and a legitimate answer of "not yet" to
the whole programme: **ship the logs off the host before they are lost.** A rotating copy, or a log
driver other than `json-file`. This is the gap that actually costs something today, and it is
independent of tracing. Shipping to a collector is itself ruled against for the access log —
`docs/datenschutz.md` §6 refuses one there, on the ground that it lengthens retention and adds a
processor receiving visitors' addresses — so a destination for traces has to answer that same
question rather than inherit an answer.

**The avoidable half of the propagation gap is already closed**, which is what bounds this entry:
`fl_frontend/src/shared/utils/correlationScope.ts :: runWithIncomingCorrelationId` seeds the scope
for every dynamic caller, the uncached page-render reads included. What is left for OpenTelemetry is
the half no application code can reach.

**What it would reverse.** That the identifier is a single id on a custom header. The reversal is
recorded where it will be read — a comment at the line it constrains, a `.claude/CLAUDE.md` §7 line
or a `.claude/rules/` clause, or an invariant on `docs/logging/spec.md` — and the argument for it
goes in the closing commit's body. What survives untouched is the stream contract, the error-code
system and the edge's refusal of a client-supplied id — **a `traceparent` from an untrusted client
carries exactly the same log-injection risk and must be validated or replaced the same way.**

**Not measured:** the runtime cost of the instrumentation packages on this application, and whether
a collector fits on the current host beside the capped services. Each is input to step 1 and neither
should be guessed.

### `qstz-dwrj` · Only the match editor tells an admin which empty field somebody is waiting on

| Tags                        | Status | Depends on |
| --------------------------- | ------ | ---------- |
| FE, BE, Docs, admin, spiele | Open   | —          |

**The Fehlt and Offen markers exist on the match editor alone, and putting them on the other entity editors is
a domain question before it is a UI one.**
`fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/ExpectedMarker.tsx :: ExpectedMarker`
renders a marker only where a field is empty **and** a triage category is waiting on it. Those categories are
`fl_frontend/src/features/spiele/types.ts :: ActionRequiredCategory`, each classifies a fixture, and
`fl_frontend/src/features/admin/utils.ts :: ACTION_REQUIRED_LABELS` is where each is spelled out with the
urgency it carries.

**The frontend half is already built.**
`fl_frontend/src/shared/components/ui/FieldLabel.tsx :: FieldLabel` takes an `extraMarker`, every
editor's label goes through it, and §1.14 of [`docs/frontend/spec.md`](../frontend/spec.md) records
the match editor as the one composer filling that slot — stating in terms that the rows behind it
are a concept no other entity has.

**What cannot be borrowed is the meaning.** For a club, a venue, a referee, a player, a squad row, a
matchday and a season, somebody has to say what "the competition is waiting on this field" means,
and whether an empty field there stops anything at all. **A marker that fires on emptiness alone is a
different feature wearing the same disc**, and it would say Fehlt about a description nobody needs.

**And the backend has nothing equivalent to read.**
`fl_backend/app/api/spiele/admin_router.py :: get_spiele_action_required` is the only route
answering "what needs attention", and its qualifying set is a fixture's. A marker on a club's editor
either derives its answer in the browser from what that page already holds, or asks for a route per
entity — and which of those it is decides whether this is a page change or a contract change.

**Nothing is wrong today**: the markers are absent rather than misleading, and every other editor
already says what it needs through its required fields and the rail's Hinweise. What it waits on is
a product ruling per entity, and that cost does not grow while it waits.

### `rt37-sv33` · A sort option nothing sends scans the archive it sorts

| Tags                           | Status   | Depends on |
| ------------------------------ | -------- | ---------- |
| FE, BE, DB, admin, bewerbungen | Standing | —          |

**Not a defect today, and what makes it harmless is that nothing reaches it.**
`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungenSortOptions` offers `saison_id` beside
`eingereicht_am`, and every read that names it plans a blocking sort: no index over `bewerbungen` leads with
`saison_id` as a sort key, the three in `fl_backend/app/core/constraints.py :: SUPPORT_INDEXES` all ending in
`eingereicht_am` then `_id` (measured 2026-08-30 at 60,000 rows, across every combination of the season and
status filters with each order; the reads narrowing on neither filter scan the collection whole). **No caller
sends it.** `fl_frontend/src/app/admin/bewerbungen/page.tsx` sends `order` alone, and no other surface reads
this endpoint, so the option is reachable only by composing the request by hand against an admin-guarded API.

**Both exits are wrong, which is what makes this a decision rather than a repair.** Two more indexes
would buy a sort nobody performs and would be carried, applied at every boot and re-read by every
future reader of `SUPPORT_INDEXES`, for no caller. Narrowing `FLBewerbungenSortOptions` to the one
option that is used is a wire change: it moves `fl_backend/openapi.json` and the hand-written Zod
mirror, and it takes an offered capability away rather than adding one. **Which is right depends on
whether sorting the archive by season is a thing this product means to offer, and that has not been
asked.**

**The discriminator this entry adds.** A blocking sort is judged on whether anything bounds the
collection, not on whether it blocks. Here the bound is absent — `bewerbungen` grows with every
submission and no path removes a row — and the read is harmless anyway, because **nothing reaches
it**. So a blocking sort is judged on two questions before its plan matters: what bounds the
collection, and what reaches the read.

**Trigger to revisit:** any surface gaining a season sort over this list, which turns the option
from unreachable into the ordinary path and makes the plan above the one an administrator waits on.

**What was measured and what was not** (COR-9). The plans were measured, at a row count the
collection does not hold. That no caller sends `sort_by` was read off the page and the absence of
another consumer rather than proven by instrumenting the endpoint.

### `pt4h-b6tf` · Renaming an anonymised referee undoes the erasure, and nothing refuses it

| Tags                                 | Status | Depends on |
| ------------------------------------ | ------ | ---------- |
| BE, DB, Docs, schiedsrichter, spiele | Open   | —          |

**`fl_backend/app/api/schiedsrichter/admin_router.py :: patch_schiedsrichter` takes a whole `name`
and fans it into every match the referee officiated** — the embedded copy is
`fl_backend/app/api/spiele/schemas.py :: FLSpielSchiedsrichterField` on the `spiele` collection
(`docs/backend/spec.md :: I13`) — and it weighs nothing about what the row holds now. An anonymised referee whose row reads the label is one PATCH away from carrying a person's name
again, on the row and on every past fixture, and the administrator making that edit is told a rename
succeeded.

**The rename reaches every season, where a club's stops.** A referee is not season-scoped
(`docs/glossary.md :: Schiedsrichter`), so the fan-out carries no `past` bound of the kind a club's
has (`docs/backend/spec.md :: I13`): one unrefused rename puts the name back on the fixtures of
closed seasons, which are the copies nobody edits again and so the ones that keep it.

**The erasure's own guard does not reach it.** `REQ-ANONYMISE-001` refuses a re-entry landing WHILE
an anonymisation runs, judged from a read taken outside the session
(`docs/backend/spec.md :: I118`); a rename a week later meets nothing at all.

**A refusal on the PATCH is not obviously the answer, which is why this is an entry rather than a
fix.** A referee anonymised by mistake has no other way back, and an erasure the administration
cannot undo at all is a different complaint from the one above. What the entry buys is that the
choice is made rather than defaulted into, and it covers the archive as well as the current season.

### `rtn3-sq85` · A state chip can be neutral gray, and the shared badge carries shape without tone

| Tags                  | Status | Depends on |
| --------------------- | ------ | ---------- |
| FE, Docs, bewerbungen | Open   | —          |

**Ruled: no chip or badge is neutral gray, and a state chip wears the tone its meaning dictates.**

**The shared badge is shape alone, so every tone is a slice's own string.**
`fl_frontend/src/shared/components/ui/badges.ts :: LABEL_BADGE` sets the pill — its size, radius and
weight — and says at the line that colour stays the caller's, so a tone arrives as a second class
string written beside it. Per-slice maps supply those strings, and nothing holds them to one
vocabulary or refuses a member of it. The state that is neutral today is
`fl_frontend/src/features/bewerbungen/constants.ts :: BEWERBUNG_STATUS_TINT`'s `abgelehnt`, and the
comment above that map argues for the choice in as many words: a decline is a decision the league
took rather than a fault anybody has to act on. **The ruling overrides that argument**, so whoever
tones the chip rewrites the comment in the same commit, or leaves a reason standing for a colour the
file does not carry (CUR-2).

**The sites are named by a selector, and the obvious selector is too wide.** What the ruling reaches
is a `LABEL_BADGE` pill whose tone class is `bg-muted text-foreground-muted`. A bare `bg-muted` sweep
across the tree also returns the admin tables' `Table.Column` headers, which are chrome rather than
chips and stay exactly as they are — so reading the ruling off that sweep rather than off the pill is
how a table loses its header treatment to a rule about state.

**What the ruling does not settle is met on the first file.** A pill naming a state and a pill naming
a category are the same `LABEL_BADGE`: a season number, a collection name, a seat's role and
„Bestehendes Team“ carry no state for a tone to follow, while „Stand gesichert“ reads as one. A tone
set obliged to answer for every pill ends up assigning colours to nouns. Which pills are state chips
is the question to settle before the variants are named, and this entry does not answer it.

**Done when** tone is a named variant of the shared badge rather than a string each slice writes —
one set whose members mean what they say — with every state chip taking one and a check refusing a
neutral tone on a state chip; the boundary above settled first, and `docs/frontend/spec.md` carrying
whichever rule that check enforces.

### `skyx-nrgh` · A refusal composes a repair the product refuses to perform

| Tags                         | Status | Depends on |
| ---------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, saisons | Open   | —          |

**`REQ-RULES-011` names an undraw whose window is narrower than the refusal's own.**
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` composes a repair per moved field, and the one
for `number_of_groups` and `teams_per_group` tells an admin to undraw the Spielplan, change the entries, then
draw it again. `fl_backend/app/api/saisons/services.py :: find_undraw_refusal` permits that undraw only while
the season is `future` and no fixture carries anything recorded against it; every other season is answered
`REQ-SPIELPLAN-006`. **The refusal itself is under no such window** —
`fl_backend/tests/api/test_rules_refusal.py :: TestADrawnSeasonKeepsTheShapeItWasDrawnFrom` pins it holding
whatever the season is doing — so on a running season, and on a planned one carrying a result, the repair
names a write nothing will perform. `REQ-RULES-012`'s own window sits inside that set and is not the size of
it: a played knockout fixture is a recorded one, and so is a called-off group fixture in a season nobody has
activated.

**What an admin meets is a closed control rather than a second refusal.**
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/blockedReasons.ts :: spielplanUndrawBlockedReason`
mirrors the same window and answers _"Zurücknehmen lässt sich der Spielplan nur, solange die Saison geplant
ist."_, which contradicts the sentence that sent them there. [`docs/frontend/spec.md`](../frontend/spec.md)'s
copy standard exempts the continuation of a repair a refusal has already started, on the ground that a loop
broken at its second step leaves an admin exactly where the refusal sent them; **this is that loop broken at
its second step.**

**Ruled: narrow the refusal's sentence to the window in which the undraw it recommends is possible**
(`docs/datenschutz.md` §10, 2026-09-02). A season past that window is told plainly that the two
numbers are fixed for the rest of its life. **Widening the undraw instead is the rejected half** — a
season that has drawn and recorded nothing being arguably still in setup whatever `status` says is a
domain call about what an `active` season may become, and the ruling does not take it.

**The claim is repeated where it is not owned**, so the narrowing moves those with it:
[`docs/domain.md`](../domain.md)'s reading of what an undraw opens,
[`docs/logging/error-codes.md`](../logging/error-codes.md)'s draw-freeze paragraph and
[`docs/frontend/spec.md`](../frontend/spec.md)'s undraw loop each state it as the way back from a
group shape guessed wrong — true in the planning window it was written for, and in no other.

**The German is a hand-written second copy** (`fl_frontend/src/features/saisons/actions.ts`, its
`REQ-RULES-011` arm), so a repair that stops at the backend leaves an admin reading the old
instruction.

### `txef-hz2b` · Two referees reduced to one published name are one option in the fixture facet

| Tags           | Status | Depends on |
| -------------- | ------ | ---------- |
| FE, BE, spiele | Open   | —          |

**`fl_frontend/src/features/spiele/facets.ts` labels a referee option with the name the read served
and keys it on `schiedsrichter_id`**, so two referees the base tier reduces to one string give a
public visitor two options reading alike. The keys differ, so both filter correctly; only the label
is ambiguous, and a visitor cannot tell which is which.

**An anonymised referee makes it certain rather than unlikely.** Every one of them publishes the same
label, so a season with two reads as two identical options on every public fixture page.

**Widening the reduction is refused here**: `fl_backend/app/api/spiele/schemas.py :: public_referee_name`
exists to keep the surname off the base tier (`READ-REFEREE-001`), and a disambiguator built from
the surname publishes what the rule withholds.
Done is a facet whose options are distinguishable without it.

### `vgk8-btxt` · What decides whether a module belongs in `core` or in `shared` is written nowhere

| Tags     | Status   | Depends on |
| -------- | -------- | ---------- |
| FE, Docs | Standing | —          |

**One rule holds the two folders apart, and it is a direction rather than a membership test.**
`docs/frontend/spec.md :: I9` and `docs/frontend/overview.md :: How it is organised` fix that
`fl_frontend/src/core` imports neither `fl_frontend/src/shared` nor `fl_frontend/src/features`, and
that `fl_frontend/src/shared` does not import `fl_frontend/src/features`, enforced by ESLint. Every
module importing nothing above it satisfies both readings, so which of the two folders a new module
goes in is settled by whoever writes it.

**The two have drifted apart in kind while the rule stayed a direction.**
`fl_frontend/src/core/einwilligung.ts`, `fl_frontend/src/core/mail.ts` and
`fl_frontend/src/core/logging.ts` sit beside `fl_frontend/src/shared/utils/refusal.ts` and
`fl_frontend/src/shared/components/ui/ConfirmReveal.tsx` — one set is what the server process does,
the other what a rendered page is built from. That distinction is real and is stated on neither page,
so a reader deriving the rule from the import direction alone arrives somewhere else.

**A reorganisation is its own pull request, and is bounded before it starts.**
`.claude/CLAUDE.md :: structure` refuses a barrel file, an unrequired default export and a second
nesting level, so grouping either folder into subfolders is not the cheap half of this; and every
module moved is an import path rewritten at each call site, which makes the diff wide and the review
shallow exactly where a mistake is a runtime failure. **Naming the rule is separable from acting on
it**, and is the half worth doing first: a rule that answers where a module goes stops the drift
without moving a file.

**Done when** the rule says what belongs in each folder rather than only what may import what,
written where a session adding a module reads it —
`docs/frontend/overview.md :: How it is organised` — with `docs/frontend/spec.md :: I9` keeping the
direction it already holds.

### `vyr6-uk2p` · The open-window read filters into arrays and subscripts whatever comes back

| Tags                       | Status | Depends on |
| -------------------------- | ------ | ---------- |
| FE, BE, tests, bewerbungen | Open   | —          |

**`fl_backend/app/api/bewerbungen/public_router.py :: get_offenes_fenster` selects the season with a
dotted query — `bewerbung.offen`, `bewerbung.von`, `bewerbung.bis` — and hands
`open_seasons[0]["bewerbung"]` straight to `:: _fenster`, which subscripts all three by name.** A
dotted path in a MongoDB filter matches into an array of embedded documents, so a season storing
`bewerbung: [{offen, von, bis}]` — the window wrapped in a list — satisfies every term of the query
and reaches `_fenster` as a list. `bewerbung["offen"]` on a list raises `TypeError`, and
`GET /bewerbungen/fenster` answers **500 on the public tier**. It is the one malformed shape the
query lets through: a string or a number has no `bewerbung.offen` to match, and an object short of a
field fails the term that names it, so neither reaches the subscript on this route.

**The sibling route is guarded and this one is not.** `:: _pull_window`, behind
`GET /bewerbungen/fenster/{saison_id}` and the colour read, passes the stored value through
`fl_backend/app/api/bewerbungen/services.py :: recorded_window` and answers 404 where it is not a
mapping carrying all three fields; the comment at that call says why — `_fenster` subscripts, so a
shape check alone would 500. `get_offenes_fenster` takes the shape from a query that already asserts
the three fields exist, and **array matching is exactly what breaks that inference.**
`:: window_is_running` inside `_fenster` carries the same guard, and `_fenster` subscripts before it
gets there.

**Why nothing produces it today.** `fl_backend/app/core/constraints.py :: _SAISON_BEWERBUNG` types
the field as a nullable object with the three keys required, and the collection runs under
`validationLevel: strict` with `validationAction: error`, so no write through the driver stores a
list there. The field and its validator landed in one commit
on 2026-08-28, so no season carried the key before the rule existed. What remains is a write past the validator — a
`bypassDocumentValidation` write, a dump restored from elsewhere, the validator dropped and
re-applied — the class of document `wszt-rpmy` files against, and the one
`fl_backend/tests/api/test_bewerbung_public_read.py :: MALFORMED_WINDOWS` already names for the
per-season reads, its list-wrapped case included.

**What it costs when one does arrive.** The read is made by
`fl_frontend/src/features/bewerbungen/components/ui/BewerbungOffenBand.tsx` on the public start page and the
contact page, and `fl_frontend/src/features/bewerbungen/queries.ts :: getOffenesBewerbungFenster` turns a 404
into "no window" and rethrows everything else — so the 500 is thrown inside a server component rather than
rendered as the band's absence.

**Done is the guard on this path and the case that pins it.** `get_offenes_fenster` passes
`open_seasons[0]["bewerbung"]` through `recorded_window` and answers the 404 an empty result already answers:
a season whose stored window cannot be read is one taking no applications, which is what the route's docstring
promises for "none". And
`fl_backend/tests/api/test_bewerbung_public_read.py :: TestAStoredWindowThatIsNotAnObject` drives the
list-wrapped case against `GET /bewerbungen/fenster` beside the two per-season paths in `:: WINDOW_READS`. On
this route that case is the only non-vacuous member of `MALFORMED_WINDOWS`, the other two never passing the
query, and the test's own comment already claims the class it belongs to.

**Established by reading, not driven** (COR-9). The array matching, the `TypeError` and the band's
rethrow were read off the query, `_fenster`, the filter semantics and the two frontend files; no
list-wrapped season was seeded and no request was made against `/fenster`, and what the start page
renders on that throw was not exercised. The commit dating the validator was read from `git log -S`.

### `w4tm-9khd` · A sweep reads a JSX opening tag by its first angle bracket, so attribute order decides its population

| Tags               | Status | Depends on |
| ------------------ | ------ | ---------- |
| FE, tests, spieler | Open   | —          |

**`fl_frontend/src/core/schemaGerman.test.ts :: requiredNamesIn` cuts each candidate at
`indexOf(">")` and reads the mark and the field name out of what is left.** Anything standing between
the `<` and the tag's real close therefore truncates the read, and a JSX attribute value is allowed to
contain a `>` — an arrow function most commonly. The sweep exits 0 either way, so what is lost is a
schema's assertion that it refuses an empty value, not a test.

**Today it holds by attribute order alone.**
`fl_frontend/src/features/spieler/components/forms/AdminCreateSpielerForm.tsx` renders a control whose
`onChange={(key) => …}` sits after `isRequired` and `name`, so the cut lands past both. Moving that
attribute above them — a reformat, an alphabetisation, a prettier setting — drops the field from the
population and takes every schema asserted through it. Nothing forbids the move and no check sees it.

**Why a comment cannot be the answer.** The same reader is what
`fl_frontend/src/shared/components/ui/SaisonSelect.tsx` keeps a literal `isRequired` for, and the note
explaining that had to be moved above its own tag for exactly this reason: written inside the tag, one
`>` in the sentence disarmed the sweep the sentence was defending. A convention that cannot be stated
inside the construct it governs is one the next reader breaks.

**Done when** the reader finds a tag's real close rather than its first `>` — comments and attribute
values skipped, so attribute order carries nothing — and has been driven against a control whose
arrow function is written first.

### `wszt-rpmy` · Wiring the write path refuses stands unreported once it is in storage

| Tags                              | Status | Depends on |
| --------------------------------- | ------ | ---------- |
| FE, BE, DB, Docs, saisons, spiele | Open   | —          |

**I27's shapes and I28's faults do not line up, and the difference is what nothing states.**
`fl_backend/app/api/spiele/services.py :: find_wiring_refusal` judges each side on the source the
save moves, which is what keeps a fixture wired out of rule editable in every other respect — and it
leaves the read path as the only thing that could name a shape already in storage.
`fl_backend/app/api/spiele/services.py :: resolve_bracket` derives a fault for two of I27's shapes: a
`spiel` source naming no match in the season, and a chain of references that closes on itself.

**What falls between them.** A `quelle` on a Gruppenphase fixture, a `spiel` source naming a
Gruppenphase match, and a group placing seeding a round past the one this season's bracket opens on
each resolve cleanly, so the walk reaches no fault and the triage page has nothing to show. Two more
are covered only in part: a source not strictly earlier in the running order is named only where it
closes a cycle, and one outcome feeding two slots only where both slots sit on one fixture — and
then as `same_team`, which states that two sources resolve to one club
(`fl_backend/app/api/spiele/schemas.py :: FLBracketFaultSpiel`) rather than that one source is read
twice. One shape is faulted and misnamed: a placing in a group the season does not run reaches
`gruppe_too_small`, true of the arithmetic — an unrun group stands nobody — and wrong about the
cause, which is that the group is not in the season at all.

**Only a hand edit puts a fixture in that state, and that is what bounds the cost.** The draw
composes its wiring from the bracket's own shape rather than from a caller
(`fl_backend/app/api/saisons/spielplan.py :: draw_spielplan`), and a save that INTRODUCES a shape is
refused, so neither product path reaches one. What stands in the gap is a row written into the
database directly — the route [`docs/backend/spec.md`](../backend/spec.md) §4 already assumes when
it asks for `python -m app.core.constraints --check` after a hand edit to `spiele`, and the case an
operator repairing by hand has the least help with.

**A variant costs more than a `reason` string.** A fault is a member of
`fl_backend/app/api/spiele/schemas.py :: FLBracketFault`, a case in
`fl_backend/app/api/spiele/services.py :: _fault_order`, a mirror in
`fl_frontend/src/features/spiele/schemas.ts` that `.claude/rules/cross-surface.md` holds to
hand-writing, a published property in `fl_backend/openapi.json`, and a German sentence in each of
`fl_frontend/src/features/spiele/utils.ts :: formatBracketFault` and `:: describeBracketFaultOnCard`.
**Both switches are exhaustive, so the compiler names them; nothing names the German.** I28's own
enumeration moves in the same commit.

**Done is the two lists agreeing** — every shape the write path refuses either reported by the read
path or written down as one it deliberately does not report — with `gruppe_too_small`'s misnaming
corrected at the same time.

### `x7pk-g4bh` · Three entry refusals are rendered twice, and nothing holds either half to the other

| Tags                                    | Status | Depends on |
| --------------------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, bewerbungen, teams | Open   | —          |

**`REQ-ENTER-001`, `-002` and `-003` each reach an administrator through two mappers, and the German
differs in every pair.** `fl_backend/app/core/domain.py` declares all three against
`POST /teams/{team_id}/saisons` and against `POST /bewerbungen/{bewerbung_id}/annehmen`, acceptance
reusing the season's own entry services rather than restating them. So each code has two frontends:
`fl_frontend/src/features/bewerbungen/actions.ts :: mapTriageRefusal`, which answers for the
application being triaged, and `fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal`, which
answers for the three club-editor write paths that create a club into a season, enter an existing
one, or move one between groups — `postTeamAction`, `postSaisonTeamAction` and
`patchSaisonTeamAction`, measured 2026-08-28.

| Code            | `mapTriageRefusal` renders                                                                                                       | `mapEntryRefusal` renders                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `REQ-ENTER-001` | A `buildRefusal` pair: the application's season has left planning, entry being into a planned one, then „Lehne die Bewerbung ab" | A written-out pair: „Diese Saison läuft schon oder ist abgeschlossen. Nimm das Team in eine geplante Saison auf." |
| `REQ-ENTER-002` | A `gruppe` field message naming „die Saison der Bewerbung"                                                                       | The same field message naming „die gewählte Saison"                                                               |
| `REQ-ENTER-003` | „Diese Gruppe ist voll. Wähle eine andere."                                                                                      | „Diese Gruppe ist schon voll."                                                                                    |

**Two of the three are a surface addressing its own reader**, which is what makes this a ruling
rather than a correction. `-002` says which season is meant, and the two readers stand on different
ones. `-001` is the sharper pair: the triage states the rule, the club editor enumerates the two
statuses that failed it. [`docs/frontend/spec.md`](../frontend/spec.md) §1.12 asks for the rule
rather than the situation that met it — and the club editor's own neighbours, the
`team.not-in-saison-*` bodies in
`fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/banners.ts :: buildTeamBanners`,
enumerate the same two statuses in nearly the same words. So either that enumeration is the
surface's settled house style, or three sentences move together.

**`-003` is the one that can leave an administrator with nothing named to do.** §1.12 holds that a refusal
names the repair wherever one exists, and that one shortened past its second sentence has become a dead end;
the club editor's stops at the state. The rule pulling the other way is in the same section: the FIELD
register declared at `fl_frontend/src/shared/utils/adminMutation.ts :: VALIDATION_FAILED` keeps a field
message to one sentence about the value, and both of these render under the `gruppe` picker, which is itself
the way out. §1.12's own precedence line — the worked example outranks the generalisation drawn from it, and
the rule is what gets amended — is why this is a ruling to take rather than a defect to fix.

**One half is composed and the other is written out.** The triage builds its FORM message through
`fl_frontend/src/shared/utils/refusal.ts :: buildRefusal`, which is what guarantees the two-sentence
shape and frames the panel name inside the helper. `mapEntryRefusal` returns its FORM strings as
literals, so nothing holds their shape, and an assertion spanning a pair has to read two
constructions.

**What nothing does today is hold a pair together.**
`fl_frontend/src/features/bewerbungen/actions.test.ts :: renderingsOf` is built for exactly this: it
cuts every branch answering one code out of the sources it is handed and grades them as one set —
the state word, the neuter agreement „Team" forces, and the imperative a repair is written in. It is
called once, on `REQ-ENTER-005` (measured 2026-08-28).
`fl_frontend/src/features/teams/actions.test.ts` asserts that `mapEntryRefusal` answers every code
the entry endpoint declares and then grades the replacement mapper's German in detail; it reads none
of the entry mapper's own sentences. **So an edit can move either half of any of these three pairs
and leave the other standing, and the gate stays green.**

**Three routes, and this entry picks none.** Rule each pair to one sentence and assert the halves
equal, which is the cheapest thing to check and the likeliest to be wrong about `-002`. Or keep each
surface's wording and widen `renderingsOf`'s call to these three codes, asserting only what must
agree across a pair — the state word, the agreement, the imperative, and that a repair stands
wherever one exists — which is the shape the helper was written for and the harder set of assertions
to word. Or record at each branch, as a comment, why its wording is its own, and leave the pairing
to a reader.

### `xe5b-v4nu` · A fourth rendering of the retired-club refusal sits outside the helper that grades the other three

| Tags                          | Status | Depends on |
| ----------------------------- | ------ | ---------- |
| FE, tests, bewerbungen, teams | Open   | —          |

**`REQ-ENTER-005` is rendered in four places and graded as three.**
`fl_frontend/src/features/bewerbungen/actions.test.ts :: renderingsOf` collects every branch
answering one refusal code and holds them to one vocabulary and one grammar — „stillgelegt" rather
than an austritt's words, „Team" as the noun, the neuter determiner and pronoun that noun forces,
and an imperative wherever a repair is written. It is handed the triage's mapper and
`fl_frontend/src/features/teams/actions.ts`, whose two mappers answer this code about different
clubs, and it asserts that it found three branches before judging any of them. The fourth is the
`team.not-in-saison-retired` banner in
`fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/banners.ts :: buildTeamBanners`,
which renders the same stored `teams.inactive_since` state as one body per season status: the
reactivation and the entry for a `future` season, and for the other two a sentence saying the
reactivation alone would not open one.

**The code is at that branch, and in the one form the helper cannot see.** The banner names
`REQ-ENTER-005` in a `//` comment, and `renderingsOf` splits on the double-quoted literal; its
comment-stripping step would drop that comment before any assertion read it, so **a comment can
never be the anchor.** The cut is shaped for a mapper besides — it runs from the literal to the next
`case`, the next `serverErrorCode ===`, a `default:`, or a `}` at column zero, and `banners.ts`
carries none of the first three, so a slice taken there would run from the anchor to the end of the
function and sweep the austritt banners' German in with it.

**The four say the same thing today, so this is a coverage hole rather than a defect** (read
2026-08-28). The banner calls the club „das stillgelegte Team", stands „es" in for it a clause
later, and writes its repair as an imperative, so it holds the vocabulary and the agreement the
three graded branches are held to.

**One rule inside that battery would refuse it even so.** `renderingsOf`'s callers require the
object of „Reaktiviere" to be exactly „es", and the `future` body writes „Reaktiviere das
stillgelegte Team" — correct German, and the sentence `mapEntryRefusal` names as the source of its
own words. That rule was drawn from three sentences that had each named the club already, so
pointing it at a fourth which names the club inside the imperative means widening it to a neuter
phrase rather than the bare pronoun. **The reach is therefore not the whole of what is missing.**

**The banner's own module carries part of the vocabulary.**
`fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/banners.test.ts` pins
„stillgelegte" as the state word, pins that neither „Austritt" nor „ausgeschieden" appears, and pins
that only the `future` body promises the entry control. Of the agreement and imperative battery it
carries nothing, and it compares the banner against no other rendering.

**The coupling is already written down, at the branch that depends on it.** `mapEntryRefusal`'s
`REQ-ENTER-005` arm says in a comment that its words are `buildTeamBanners`'s, because the mapper
fires only while the page still believes the club is active and the banner is what the same panel
shows once the page catches up. So the two are meant to read alike, one of them is graded, and which
one that is was settled by where a string literal happens to sit.

**Two fixes, and each costs something.** A `"REQ-ENTER-005"` literal at the banner would put the
code where the helper's split already looks — but `buildTeamBanners` renders state and never a
server code, so a literal there asserts a coupling the runtime does not have, and the cut would
still have to learn where a branch ends inside an object literal. Or `renderingsOf` takes the banner
as a source of its own, with an extraction that reads a built banner's `body` and `title` rather
than a slice of text — the honest shape, costing the helper a second mode, and the only one that
reaches the title at all, a template literal being invisible to a match written for quoted
sentences. **Either route pays for the „Reaktiviere" rule's widening**, and neither may skip it: a
battery pointed at this banner unchanged fails on a sentence that is right.

### `yjsf-uc2y` · Acceptance copies a school's postal address into the club, where an anonymous read serves it

| Tags                                 | Status  | Depends on |
| ------------------------------------ | ------- | ---------- |
| FE, BE, DB, Docs, bewerbungen, teams | Decided | —          |

**`fl_backend/app/api/bewerbungen/admin_router.py :: annehmen_bewerbung` builds a club out of the
school's own block and inserts it into `teams`, the address included.**
`fl_backend/app/api/bewerbungen/services.py :: compose_new_club` maps the school's `address`
straight into the club document through `_CLUB_FIELDS_FROM_SCHULE`, beside `team_name`, `full_name`,
`shorthand`, `schulform` and `website_url`, and the acceptance writes that document inside its
transaction.

**Ruled 2026-08, Datenschutzexperte consulted: the address stays public, and the form says so where
it is asked for** (`docs/datenschutz.md` §4). The rule stands at the read that serves the field
(`fl_backend/app/api/teams/schemas.py :: _TeamWritable`), the application form states beside its
address block that the address will stand on the public team page
(`fl_frontend/src/features/bewerbungen/components/forms/BewerbungForm/FormSchuleSection.tsx`), and
`docs/backend/spec.md`'s known-open row records the crossing as accepted. **The alternatives —
narrowing the public model, or not copying the field at acceptance — are rejected by that decision**,
so neither is to be proposed again without overturning it.

**What remains is the crossing itself, and a second place the sentence belongs.** The read registry
answers for both ends: `READ-CONTACT-001` withholds the application that carries the school's
address, and `READ-ADDRESS-002` declares a club's public. Each governs ONE read and the acceptance
sits between them, so whether a school's correspondence address is the league's to copy into a club
is a question about the write, which no read rule can answer — and the registry holds no write rule
that says. The same sentence also belongs on the acceptance screen, where the administrator takes
the action that publishes it (`docs/datenschutz.md` §4, ruled 2026-09-01); the admin club forms need
none.

**Done** is a write rule in the registry saying the acceptance may copy the field, and the sentence
on the acceptance screen. Nothing in it reopens the decision.

### `z8nf-7nzd` · `typing` imports instead of `collections.abc`

| Tags               | Status  | Depends on |
| ------------------ | ------- | ---------- |
| BE, Docs, versions | Decided | —          |

Several backend modules import `Mapping`, `Sequence`, `Optional` and `Callable` from `typing` —
aliases deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed
piecemeal:** modernising one module while the rest keep the old spelling is worse than uniformity.
The decision is to enable ruff's `UP` rules and migrate in one pass, which is why
`fl_backend/pyproject.toml`'s ruff selection leaves that family out.
[`docs/_auditing/prompts/backend/4-architecture.md`](../_auditing/prompts/backend/4-architecture.md)
carries the typing check that owns the migration.

### `zp46-yt3p` · The certainty walk gives up in a group of six or more

| Tags      | Status   | Depends on |
| --------- | -------- | ---------- |
| BE, teams | Standing | —          |

**Not a defect today, and the numbers say why** (found 2026-08-05, reviewing the bracket).
`fl_backend/app/api/teams/services.py :: _decide_one_gruppe` walks every combination of outcomes for
a group's outstanding fixtures and reports a placing only when the same team holds it in all of
them. The walk is capped per group by `:: CERTAINTY_FIXTURE_LIMIT` — ten outstanding fixtures when
it was measured on 2026-08-05 — and past the cap it reports no placing at all, which is the safe
direction and, at ten unplayed matches, the honest one.

**The cap is a group size in disguise**, because a group played out in full has one fixture per
pair:

| Teams in a group | Fixtures to play | Against the cap      |
| ---------------- | ---------------- | -------------------- |
| 4                | 6                | walks                |
| 5                | 10               | walks, exactly at it |
| 6                | 15               | **reports nothing**  |

Season 2026 holds 16 teams in groups of four, six fixtures apiece (measured 2026-08-06) —
comfortably inside it. **A group of six would silently stop that group from seeding the bracket at
any point in its life**, and the symptom would be an empty knockout slot with nothing said about it,
because a placing that is merely undecided is deliberately reported to nobody (invariant I24c).

**Raising the constant is not the fix.** The enumeration is `3^n`, so each fixture past the cap
triples the work — a group of six is `3^15` against `3^10`, 243 times as much — and it runs once per
referenced group inside `PATCH /spiele/{spiel_id}`'s transaction. The walk already deduplicates by
the points table each outcome set produces and stops the moment no placing survives every table, so
the ranking work is bounded by the distinct tables — but the `3^n` enumeration itself is not pruned,
which is what the cap guards.

**Nor is a cleverer algorithm the fix, and the reason was settled on 2026-08-06.** The question this
walk answers — is a team's placing the same however the remaining fixtures go — is the complement of
the classical sports elimination problem. That problem has an efficient exact solution by network
flow **only under a win/draw scheme where a match distributes a fixed number of points**; under the
three-points-for-a-win rule a win creates a point that a draw does not, and deciding elimination
becomes NP-complete (Bernholt, Gülich, Hofmeister and Schmitt, _Football Elimination Is Hard to
Decide Under the 3-Point-Rule_, 1999). Season 2026 scores 3/1/0 through `FLSaisonRules`, and
`win_points` is configurable per season, so the hard case is the one this system has to serve.
**There is therefore no polynomial exact replacement to write**, and the honest options are the cap
that exists, an approximation that would sometimes seed a placing a later result overturns, or a
person.

**The textbook fallback is a person, and this system deliberately does not have one.** Established
platforms do not infer finality at all: a group's standing becomes available to seed the next stage
only when the organiser **validates** it, and validation also locks the group's matches. So if a
group ever does grow to six, the cheap answer is an explicit "this group is final" control feeding
the same `DecidedStanding`, not a faster walk.

**Not measured:** how long the walk takes at the cap. Groups of four make it `3^6` = 729 raw
iterations per group, which is unmeasurable; at the cap it is `3^10` = 59,049 per group — cheap per
iteration once deduplicated, but inside a transaction, whose lifetime is bounded.

**Trigger to revisit:** a season drawn with six or more teams in any group, or any change to how
groups are sized.

### `zr2y-4uwj` · A tie-break that provably cannot fire is what stops the index being walked

| Tags                                                   | Status   | Depends on |
| ------------------------------------------------------ | -------- | ---------- |
| BE, DB, tests, bewerbungen, saisons, spiele, spieltage | Standing | —          |

**Not a defect today, and the bound rather than the plan is why.**
`fl_backend/app/api/spiele/services.py :: build_spiele_sort` appends `datum` to a `spiel_nr` sort.
That tie-break can never fire: `fl_backend/app/core/constraints.py :: UNIQUE_INDEXES` carries
`uniq_saison_id_spiel_nr` over `(saison_id, spiel_nr)`, so within the one season the read has
already resolved, no two fixtures share a `spiel_nr`. Appending it is nonetheless what stops MongoDB
walking the index, because a compound sort it cannot satisfy from an index key is completed in
memory (measured 2026-08-30, at 500 documents):

| The sort                                       | The plan                       |
| ---------------------------------------------- | ------------------------------ |
| `spiel_nr` then `datum`, which the code builds | `SORT` over `FETCH`, `IXSCAN`  |
| `spiel_nr` alone, as a control                 | `LIMIT` over `FETCH`, `IXSCAN` |

Every other sort the endpoint can build blocks the same way, and
`fl_backend/app/api/spieltage/services.py :: build_spieltage_sort` has the shape too, over a
collection holding a season's matchdays.

**What makes it harmless is that nothing lets the collection grow.** `GET /spiele` resolves a season before it
reads — `fl_backend/app/api/spiele/router.py` fills an absent `saison_id` from
`fl_backend/app/api/saisons/crud.py :: pull_current_saison_id` — so every read is season-scoped, and a
season's fixture count is capped by its shape validators.
`fl_backend/app/api/saisons/schemas.py :: TeamsPerGroup` records that ceiling's purpose at the line: it keeps
the largest legal season inside `fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT`. So the
in-memory sort is over a set with a ceiling on it, and nothing in the product moves that ceiling.

**The pattern is the reason to record this, and the instance is not.** The mechanism recurs wherever
a sort chains a tie-break onto its leading key: the chained key is what puts the sort outside the
index written for that read. `aktionen`, `spiele`, `spieltage` and `bewerbungen` each build one, and
each was answered differently. `aktionen` got an index whose key is the read's whole sort, `at` then
`_id`, because `fl_backend/app/core/constraints.py :: SUPPORT_INDEXES` states at the line that the log
holds twelve months of writes and so cannot be left to a scan. `bewerbungen` got neither an
index nor a removal: `fl_backend/app/api/bewerbungen/services.py :: build_bewerbungen_sort` turns
the tie-break to follow the request, so the pair is the existing index's key or its exact inverse.
`spiele` and `spieltage` got nothing, and are this entry. **So the discriminator is not whether the
sort blocks — it is how much the bound on the collection admits**, and a reader who finds a blocking
sort
and asks only the first question will either panic at this one or dismiss the next `aktionen`.

**Trigger to revisit:** the season narrowing in `fl_backend/app/api/spiele/router.py` being removed,
or any read of `spiele` being allowed to span seasons. Either removes the bound, at which point this
collection is `aktionen` and the sort needs the index rather than the argument. `g7hr-c8bn` rests on
the same bound, so whatever removes it reopens both.

**Why it is filed rather than fixed.** `:: build_spiele_sort` carries a decision at the line it
governs: its order is defined by that code under PRE-1, and moving it is its own change rather than
a side effect of one. Taking it quietly inside a branch about something else is what that comment
exists to prevent.
`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments` keeps
`fl_backend/app/api/spiele/services.py` free of an `await` and a collection, and the repair needs
neither.

**What was measured and what was not** (COR-9). The plans above were measured; the uniqueness, the
season resolution and the shape ceiling were read off `UNIQUE_INDEXES`, `pull_current_saison_id` and
`TeamsPerGroup` rather than executed. **The explain was not re-run for this entry**, so the two rows
stand on that measurement rather than on anything the gate repeats.

### `2d76-kydk` · Every site resolving a citation asks the filesystem, so a mis-cased path passes here and fails on the runner

| Tags                | Status | Depends on |
| ------------------- | ------ | ---------- |
| Ops, Docs, gate, ci | Open   | —          |

**Five call sites decide whether a cited path is real, and each asks the filesystem rather than
git.** `scripts/checks/docs_gate/checks.py :: _resolve` tries `REPO_ROOT / file_part` directly;
`:: check_file` asks `.exists()` of every backticked repository path, and again of every link target
it has already resolved; `:: check_bare_paths` asks it of the token under the repository root and
under every parent directory of the file holding it; `:: _continuations` asks it of a file named
after `::` and expected beside its antecedent. Each carries its own base, so there is no single line
to change — and all five lean on `scripts/checks/docs_gate/kernel.py :: repo_path`, which asks the
same question a sixth time and is what `checks.py :: _named_paths` derives an entry's tags
through.

**The filesystem answers that question differently on the two platforms.** A path spelled
`DOCS/readme.MD` resolves on this machine and does not on the Linux runner, so a citation whose case
has drifted is green through the whole local gate and red in CI with a `path`, `link` or `citation`
finding naming the token.

**The listing that answers identically on both platforms is git's, unfiltered.**
`kernel.py :: _listed` called with no pattern, merged with `:: _untracked_paths` — the merge
`:: scanned_files` already performs, because the gate runs before the commit and a file the branch
has yet to stage is corpus rather than an absence.

**`kernel.py :: tracked_files` is the wrong listing, and the cost of reaching for it is measured.**
It is `:: _of_kind`-filtered to `.md`, `SCANNED_SUFFIXES` and `OPS_FILENAMES`, which drops 28 of the
976 tracked paths in this repository — every stylesheet, icon and manifest image, and
`.github/gate-wall-clock.tsv`, which `docs/ops/spec.md`, `docs/backend/spec.md` and
`.claude/rules/ops.md` all cite. Resolved against it, each of those citations becomes a dead-path
finding.

**The bare-filename arm has to move in the same change.** `checks.py :: _resolve` falls back to
`kernel.py :: _tree_index` and `:: _untracked_index`, both keyed by `os.path.normcase` of a file's
name — a no-op on Linux and a lowercasing on Windows, which is the same divergence at a second site.
A change that swaps the existence tests and leaves that keying alone narrows the defect rather than
closing it.

**What this costs today is a loud failure rather than a silent one**, the platform that diverges
being the one that fails in CI naming the finding, which is why it is filed rather than taken as a
cycle's closing act.

**Done when** every site deciding a citation's target answers from one unfiltered listing built off
git, and the bare-filename lookup keys against that same listing.

### `2eec-8qa9` · The hook fixture's builder writes into a directory it never creates, and the failure reaches nobody

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, gate | Open   | —          |

**`scripts/gate/selfcheck.sh :: build_hook_fixture` writes every file its list puts under a
`scripts/` subdirectory into a parent its own `mkdir -p` never makes, and the caller is told the
build succeeded.** The builder is a subshell run as the condition of an `if !`, and bash ignores
errexit for everything a compound command in that position runs, the subshell's own `set -e`
included. Each of those redirects fails, the loop carries on to the files after it, the subshell's
last command decides its status, and `note_fail` never fires. The hook probes then run against a
fixture missing the paths those probes name as the tracked file a write must be refused for.

**Rearming errexit inside the subshell is not the repair, because it is already rearmed there.** Run
on its own the same function exits non-zero, so only the calling position changes the answer, and the
write's status has to be carried out of the loop deliberately rather than left to `set -e`.

**Nothing fails today, and what keeps it quiet is that no guard asks whether the path exists.**
`.claude/hooks/guard-branch-bash.sh` places each candidate path and denies it unless git calls it
ignored, and `git check-ignore` answers for a path nobody wrote. The trap is a probe added later for
a hook that reads the file its payload names rather than the payload —
`.claude/hooks/guard-stale-type-class.sh` is already one — where an absent file yields a verdict the
table then records as the expected one.

**Done when** the loop makes each file's parent before writing it, and a builder that cannot write
one of its files reaches `note_fail`.

### `2pqm-yxyu` · The origin trusts every source inside Cloudflare's published ranges, so the visitor's name is whatever the request says it is

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, edge | Open   | —          |

**`nginx/prod.conf` lists Cloudflare's published address ranges as `set_real_ip_from`, which is every
Cloudflare customer's egress rather than this account's**, and `nginx/prod.conf :: real_ip_header` then names
the visitor from a header any of them can send. That address becomes `$remote_addr`, which every
`limit_req_zone` in the file keys on — through `nginx/prod.conf :: map $remote_addr $client_net` and its wider
twin `nginx/prod.conf :: map $remote_addr $client_net48` — and which the `client` field of
`nginx/prod.conf :: log_format` records, so a forged value per request is a fresh bucket per request: the rate
limits count nothing and the access line names whoever the sender chose. **The wide key caps nothing here**,
which is worth saying because it looks as though it should: `$client_net48` bounds a walk across a real
allocation, and an invented address lands in a fresh bucket in both keys at once.

**Ruled: Authenticated Origin Pulls is the cheapest real fix, and a tunnel is the strongest**
(`docs/datenschutz.md` §10, 2026-09-02). The three below are ranked rather than open, so what is
owed is the account and host access rather than the choice.

**Done when the origin stops trusting a range list to name the visitor, and none of the three
remedies is a change to this repository.** Authenticated Origin Pulls is the smallest — an
`ssl_client_certificate` and `ssl_verify_client` pair here, plus a certificate and a per-hostname
account setting — and the ports stay open, so it is worth only what `ssl_verify_client` enforces. A
Cloudflare Tunnel is the strongest and the largest: the origin stops listening publicly, at the cost
of a container, a credential, and the published ports leaving `docker-compose.yml`. A host firewall
admitting only Cloudflare's ranges touches this repository not at all and makes the range list
load-bearing twice. Each needs account or host access.

**`real_ip_recursive on` would not improve matters and is not the fallback.** With the whole range
trusted, the leftward walk steps past any trusted address into entries the client wrote, so a genuine
visitor whose own address falls inside those ranges would have the walk continue into what the client
sent. `nginx/prod.conf :: real_ip_recursive off` has no such failure mode.

**A second party may be able to name the visitor too, and it turns on one untested fact.** Exercised
2026-08-30 with one value pair and the header name as the only variable, a client's header arriving
ahead of the proxy's **wins** under `CF-Connecting-IP` and loses under `X-Forwarded-For` — so if
Cloudflare appends its header rather than replacing it, the party naming the visitor is any visitor
at all. That is untestable from here: one request through the real edge decides it, and the absence
of any report of such a flaw is a strong prior that the header is replaced, never a proof.

**What is inferred rather than measured** is that an arbitrary third party can reach the published
ports from inside those ranges, read off how the platform works. The consequence was measured; the
availability of the source was not.

**The access line cannot catch it, which is not obvious from reading the line.**
`nginx/prod.conf :: log_format` records `client` and `x_forwarded_for` while the address is taken
from the header `real_ip_header` selects, and that header reaches no log field — so the value that
set the key is absent from the line it produced, and the `x_forwarded_for` beside it is a header this
edge does not read. Nothing else stands in front of the origin: `docker-compose.yml` publishes 80 and
443 on the nginx service, and no Authenticated Origin Pulls, Cloudflare Tunnel or host firewall is
named in [`docs/ops/spec.md`](../ops/spec.md), [`docs/ops/overview.md`](../ops/overview.md),
[`docs/ops/runbooks.md`](../ops/runbooks.md), `docker-compose.yml` or `scripts/ops/deploy.sh`,
searched 2026-08-30.

### `2zah-pvu2` · The unit that sets the gate's wall clock costs substantially more inside a full run than it costs alone, and nothing establishes why

| Tags             | Status | Depends on |
| ---------------- | ------ | ---------- |
| Ops, gate, tests | Open   | —          |

**`scripts/gate/selfcheck.sh` binds the `scripts` section and that section binds a full-form run**,
with the pytest run over `scripts/tests/` — `scripts/gate/verify.sh :: do_pytest` — close enough
behind it to become the wall the moment the self-check moves. Every reading of the self-check that
exists was taken with something else running and they disagree with one another, so the gap between
its in-run and its alone cost is settled in direction and unknown in size. **Which repair is correct
turns entirely on that answer**: if what the unit spends is contention, what pays is reducing what
the run competes for; if it is not, what pays is splitting the self-check into units a pool can place
or removing work from it, both reaching the file that owns the gate's exit contract. **Naming a cause
before measuring sends the next reader at the wrong repair**, and contention is exactly what must not
be assumed while every reading carries a different amount of it.

**There is no concurrency left to add at either level**, which is the reflex to head off: the
sections run beside one another in one pool, `scripts/gate/verify.sh :: start_steps` queues the
self-check beside `ruff`, `pyright` and the pytest run, and `scripts/gate/selfcheck.sh :: par_run`
fans each queued group out over `:: PAR_WIDTH`. No schedule reaches inside the unit either — it is
one process to the pool. **`scripts/gate/gate_pool.py :: TYPICAL_MS` is not the missing
alone-figure**: its own comment records that its numbers were taken on a contended machine and are
upper bounds, which puts them outside the comparison altogether.

**The `scripts/` reorganisation did not cause this.** The self-check was read inside a full run
immediately before that move and immediately after it, and the readings sit within noise of each
other — a standing property of the check rather than a regression to go looking for.

**`y2bd-s7bf` is the neighbouring question about the same budget rather than this one**: that entry
is how a declared width is DIVIDED among the pool's consumers, where the width this unit takes is
kept out of that division altogether. Neither answer settles the other.

**Done when** the gap has a size and an explanation, in that order: the unit read on a machine with
nothing else in flight, the disagreeing readings already taken reconciled against it, and the in-run
cost separated into what the unit spends working and what it spends waiting on the rest of the run,
with the cause established rather than inferred. The optimisation that follows is not this entry's
subject.

### `3gag-st7h` · Invariant numbers are permanent per sheet and allocated as though one namespace held all three

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, gate | Open   | —          |

**OUT-4 makes an `I<n>` permanent within its own sheet and has a citation crossing sheets name the
sheet; the sheets are numbered as though one namespace held them.** `docs/backend/spec.md` and
`docs/frontend/spec.md` each define low numbers the other defines too, while each sheet's later rows
sit in a band no other sheet touches. Two conventions are live at once, nothing records which one the
next row follows, and `scripts/checks/docs_gate/checks.py :: invariant_ids` is written for the rule
rather than for the practice: it maps a number to every sheet defining it and treats the overlap as
ordinary.

**Nothing reports the ambiguity where it is created.** `:: check_invariant_tables` refuses one number
twice on one sheet and goes no further. `:: check_invariant_citations` fires on a bare id two sheets
define, in a comment alone, and only where no surface word stands in the same block — so the cost
falls on whoever writes the citation, after the row has been numbered, and never on whoever numbered
it.

**Neither convention is wrong, and each costs something.** Per sheet is what OUT-4 states and what the
low numbers already are, and it makes every cross-sheet citation carry its sheet. One namespace is
what the high bands already are, and it makes a bare id unambiguous everywhere, at the price of an
allocator reading three files.

**Done when** one convention is stated where somebody adding a row will read it, and the next free
number is derived rather than counted off three pages by hand.

### `3hb2-3d9q` · One test file dies under the gate's parallel load and names no cause

| Tags                          | Status | Depends on |
| ----------------------------- | ------ | ---------- |
| FE, Ops, gate, tests, saisons | Open   | —          |

**A file the branch does not touch can fail the frontend section of `scripts/gate/verify.sh` at file
level, with no case named under it.**
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/undrawSpielplan.test.ts` is
the file it has happened to. Run on its own it passes, repeatedly; the whole suite run beside it
passes with every case green; and a second full gate run is green. What separates the failing run
from the passing ones is the load the section runs its suite under.

**A file-level failure is the shape that hides the cause.** `node --test` reports a file whose
process exits non-zero as a single failing test named for the path, so a worker killed under memory
pressure, a module that never loaded and a case that never reported all arrive as one line with the
same text. Nothing in the output tells them apart, which leaves another full gate run as the only
available diagnosis — the most expensive one there is, and green more often than not.

**Which half this is has not been established.** Whether it is this file interacting with the load —
the frontend section runs the suite beside a type check, a lint and a formatter — or a runner-level
fault that would land on whichever file was unlucky is unknown, and treating it as either is a guess.
The entry is filed against the diagnostic rather than against the file for that reason: whichever
half it turns out to be, the run that produces it has to say so.

**Done when** a file-level failure in the frontend section carries something a reader can act on —
the worker's exit status and its stderr, or the runner's own diagnosis — so the next occurrence is
read off the run that produced it rather than off a rerun.

**What is read and what is not** (COR-9). The passes are runs: the file alone, and the whole suite
after it. The failure is one gate run's report, not reproduced since. Nothing was instrumented, no
worker's exit status was captured, and no second file has been seen to fail this way, so the
population this reaches is unmeasured.

### `3hdg-3r59` · The replace and the undraw each write the season's clearing, and each is proved separately

| Tags                         | Status | Depends on  |
| ---------------------------- | ------ | ----------- |
| BE, DB, Docs, tests, saisons | Open   | `q7jv-hskm` |

**Two endpoints spell one removal.**
`fl_backend/app/api/saisons/admin_router.py :: generate_spielplan` clears the season inside its
`replace` branch, and `:: undraw_spielplan` writes the same two
`fl_backend/app/core/crud.py :: delete_many_from_db` calls — same filter, same session, same order.
The comment at the first sends a reader to the second for the ordering, which is the coupling
written down and held by nothing.

**The order is the half that fails quietly.** Fixtures go before matchdays so that neither the log's
rows nor a restore replaying them names a matchday already gone (`docs/backend/spec.md :: I46` and
`:: I48`). Reversed at one site alone both endpoints still answer and both still record, and what
breaks is a restore nobody runs until they need it.
`fl_backend/tests/api/test_undraw_execution.py` and `fl_backend/tests/api/test_spielplan_execution.py`
each prove that ordering for their own endpoint, so the duplication is paid a second time in the
estate.

**Extracting the removal is refused, and `q7jv-hskm` is where that is argued.** A shared helper
cannot be declared inside either transaction callback and still be shared, so both removals leave the
sweep that holds a write to its session — silently, and the whole file stays green afterwards. What
is left here is the coupling rather than the duplication.

**Done when** one assertion reads both callbacks' removal sequence and fails when they diverge,
rather than the two per-endpoint tests each proving the order for their own. The comment at the
replace sends a reader to the undraw for that order, so the two are already written as one decision;
nothing fails when they stop being one.

### `3s6w-kndn` · The gate saturates the machine, then spends its whole tail unable to use it

| Tags                 | Status | Depends on |
| -------------------- | ------ | ---------- |
| BE, Ops, gate, tests | Open   | —          |

**Nothing passes `--width`, so `scripts/gate/gate_pool.py` opens one slot per scope, every scope starts at
once, and what remains of the wall clock is the longest section itself.** Measured across one full-form run on
2026-08-26: the machine is pinned at 100% through roughly the first thirty seconds with seven sections
competing, and the last forty-odd seconds are the `db` section by itself at six to twenty per cent —
single-threaded, waiting on replica-set round trips through `session.with_transaction` against the single-node
replica set `fl_backend/tests/conftest.py :: mongo_replica_set_url` starts. **Adding cores or memory buys
nothing**: the machine holds 8 physical cores, 16 logical and 31 GB, `~/.wslconfig` sets neither a processor
nor a memory key, and the tail already cannot use the ones there are — that idle capacity is precisely what
concurrency inside the tier would consume.

Three levers, each recorded with what stands in front of it:

1. **Distribute the database tier — built, and owed the measurement that says what it was worth.** It
   is aimed at the tail the trace shows, and latency-bound work overlaps rather than divides. No
   timing taken so far is trustworthy, the machine having been contended throughout, and a db-tier
   figure counts only as a pair of runs within a fifth of a second of each other on an idle machine
   (`eg48-8863`). Two questions ride with it: what `auto` should be, sixteen workers sharing one
   `mongod` being a guess rather than a finding, and whether the shared server becomes the new tail
   once the workers stop waiting on their own. **`WriteConflict` at a wider width is plausible and
   unproven**, and it belongs inside the width question rather than beside it.
2. **Distribute the fixture net — a lever on one scope, not yet on the gate.**
   `scripts/tests/test_check_docs.py :: _load` copies `scripts/` into a throwaway repository and
   imports the gate from the copy, `:: _STATE` memoising it so the build is paid once per process. It
   binds its own scope, but what it gives back reaches the gate's wall clock only once the unit ahead
   of it moves, which is `2zah-pvu2`'s — and a worker is a process, so it carries lever 1's second
   problem in miniature, as many fixture builds as workers.
3. **Distribute the default tier — last, and probably never.** Recorded here so it is rejected
   against the profile rather than reached for as the obvious first move: the section running it
   closes well inside `db`, and a tier with no database and no container spends a real fraction of
   itself in interpreter startup, which a worker pays again per process.

**Two scopes writing one `__pycache__` is not a coupling, and a chain must not be added on that
reasoning.** `docs` and `scripts` have shared two of those directories unconstrained since the pool
was written: CPython writes a bytecode file to a temporary name and renames it, nothing in this
repository reads pytest's `nodeids`, and `lastfailed` is written only when its value changes and
steers only `--lf`, which the gate never passes. The argument in full is in the commit that left the
two scopes sharing those directories, which `git log -S` on `__pycache__` reaches, and it is worth
reading before any scope here is made to wait on another.

**What a change to any of this owes.** `scripts/gate/selfcheck.sh` owns the four-code exit contract's
classifier, so anything reaching that file re-opens the contract's measured rank, finding and exit
combinations; anything reaching how the probes execute owes a before-baseline, a verdict-set diff and
a required zero, **because a probe that has stopped firing looks exactly like a probe that passes**. A
db-tier change owes the harder version of the same: those verdicts are what a branch rests on, and a
worker that silently cleared a neighbour's seeds fails somewhere else entirely.

**Done when** lever 1 has been taken or rejected against a re-taken profile of the same shape, levers
2 and 3 are re-judged against whatever binds the run once the tail moves, and any figure quoted
carries its spread and its run count. Seven consecutive full-form runs on one tree gave 88 to 95
seconds, mean 91.9, **so a lever worth taking has to beat the spread rather than one sample inside
it**. **How a start is read off a run rather than inferred:** sample `ps` while a full-form run is
going and record when each worker's process first appears, which separates a scope that is slow from
one that started late — a per-scope duration cannot, a section reported at two seconds being two
seconds of work at the end of a wait the closing table never names.

### `54yr-fgun` · A branch changes what a page cites, and nothing puts that page in front of the session

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, gate | Open   | —          |

**Nothing mechanical asks a branch to re-read the pages describing what it changed.** CUR-2's
same-commit rule is answered by the author, and the author here is almost always an assistant
session — the writer most likely to update the code it is touching and to miss the prose it is not.
The repair is the retired restamp cascade's arming computation without the stamps: intersect each
documentation page's resolved citations with the branch's materially changed files, the classifier in
`scripts/checks/check_scope.py` already deciding what counts as material, and print the pages whose
subjects moved.

**A list to read, never a failure.** The hard-failing version was satisfiable by ritual, one stamp
move clearing a branch for good, so failing was the wrong verdict rather than the wrong idea. It
lands beside the branch-scoped checks in `scripts/checks/docs_gate/branch.py`, in the same tier as
`history`: no line to falsify, no bookkeeping to go stale, nothing to suppress. The
gate's output lands in the session transcript, which is exactly where the author is; the review reads
the same list in the run the pull request records, and `.claude/commands/docs/audit-pr.md` consumes
it once it exists.

**Done when** that list is produced and proven against a planted violation first (PRE-4): a fixture
page citing a fixture source file, the source materially edited on the branch, the page named in the
report — together with the negative, a comment-only edit to the cited file arming nothing.

### `5h9m-nntd` · The formatter rewrites a comment between the author and the checker, so the shape INC-9 measures is not the shape anyone wrote

| Tags                       | Status | Depends on |
| -------------------------- | ------ | ---------- |
| BE, Ops, Docs, gate, teams | Open   | —          |

**`ruff format` removes a blank line inside an argument list and keeps one at statement level.**
Exercised 2026-08-30 through `ruff format -` on two inputs differing only in where the blank line
sat: between two comment paragraphs inside a call it is stripped and the paragraphs become
contiguous, and between the same two paragraphs in a function body it survives. So a comment written
as several paragraphs inside a call reaches `scripts/checks/docs_gate/kernel.py :: comment_runs` as
one block, and INC-9's bound is applied to that. **The obvious way round it does not work either**: a
bare `#` between paragraphs survives the formatter, but `comment_runs` yields it as an empty entry
INSIDE the run rather than ending the run, so the block stays one block and only its character count
is unchanged. **The author's instinct and the formatter's behaviour fail in the same direction, and
nothing tells them so** — anyone writing a long comment inside a call produces a block INC-9 refuses,
learns nothing at the time, and, if the block is wholly theirs, is failed by a measurement of a shape
they did not write.

**The live instance is invisible, and by a decision that is right.** The comment at
`fl_backend/app/api/teams/admin_router.py :: patch_saison_team`'s replacement write measures 443
characters against the 250-character cap, read through the gate's own functions on 2026-08-30;
`scripts/checks/docs_gate/branch.py :: check_comment_length` measures a block only where every one of
its lines is in the branch's added set, and its docstring records why — failing a branch for a word
changed inside an older block is what gets a check suppressed, and a partly rewritten block is
`/docs:audit-pr`'s under CUR-6. That reasoning holds; the consequence is that the one place the trap
has already bitten is the one place nothing will report.

**Done when** one of three answers is taken. Teach `comment_runs` that a run the formatter collapsed
is several, which needs a rule for what separates them and the formatter has removed the evidence. Or
measure comment length over the whole file rather than the added lines, which finds every old block
at once and gives up the reason the added-set narrowing exists. **Or rest on the trap now recorded at
INC-9** — [`docs/_standard/standard.md`](../_standard/standard.md) states the blank-line rule and the
move-above-the-statement answer, which is what the one author who met this did. The third costs
nothing further and leaves the measurement wrong; the first two are a mechanism. **Deciding that a
written-down trap is sufficient is a real answer**, and this entry exists because that is a judgement
rather than a defect.

### `5qzd-ubrg` · A test's name counts the cases beside it, and the table has outgrown the count

| Tags             | Status | Depends on |
| ---------------- | ------ | ---------- |
| Ops, gate, tests | Open   | —          |

**`scripts/tests/test_selfcheck_guards.py :: test_the_reader_lexes_seven_constructs_it_used_to_get_wrong`
states a count in its name, and its docstring splits that same count two ways.** The table it
iterates has since grown, so both numbers are wrong and the run is green: nothing reads a count in a
name, and the case that is missing is exactly the one the number hides.

**The name is what a failure prints**, so a reader who arrives at a red run takes the count for the
population and stops short of the cases past it. What selects the set is the constant the test loops
over, which answers the size question in seconds and stays right on its own (COR-4).

**Done when** neither the name nor the docstring carries a number, the name saying instead what the
constructs have in common — every one a shape the call-site reader in
`scripts/gate/selfcheck.sh` once mis-lexed.

### `5tnp-5uff` · A python constant's closing delimiter opens a comment run, so code is measured as prose

| Tags                   | Status | Depends on |
| ---------------------- | ------ | ---------- |
| Ops, Docs, gate, tests | Open   | —          |

**`scripts/checks/docs_gate/kernel.py :: comment_runs` reads python by line rather than by token, and
`:: PY_DOCSTRING_OPEN_RE` matches `"""` at the start of any stripped line.** A module-level
triple-quoted CONSTANT opens on a line the pattern cannot match — the quotes sit after `NAME = ` —
and closes on a line holding the delimiter alone, which the pattern matches exactly, so the CLOSING
delimiter is read as an opening and every line below it up to the next `"""` is collected as prose
and measured against INC-9's bound.

**What it costs is a wrong REFUSAL, which is the expensive direction.** A run over the bound is a
failing finding, so a branch is refused over a line nobody wrote as a comment, against a rule its
author cannot satisfy by editing any comment; and the quiet half is wrong in the same way, a genuine
comment following such a constant being measured joined to the code above it and graded on a length
it does not have. One instance stands in the tree and it is under the bound by luck:
`scripts/tests/test_copy_corpus.py` closes its `MEASURE` constant on such a line, the run that opens
there swallows the `def` beneath it and that function's docstring, and it measures 151 characters
against a bound of 250 — **nothing the checker does keeps it there**, a longer signature or a
two-sentence docstring putting it over.

**The repair changes what the runs ARE for every python file in the corpus**, which is why this is
not an afternoon: deriving a file's runs from `tokenize` re-measures the whole corpus, and a block
that has been passing because it was mis-split becomes a real finding the moment the split is right.
Those must not be confused with the pre-existing INC-9 blocks `.claude/commands/docs/audit.md`
already owns.

**Done when** `comment_runs` reads python through a tokenizer, the corpus is re-measured and every
verdict that moved is read and dispositioned, and `scripts/tests/test_check_docs.py` plants a
module-level triple-quoted constant with a long function beneath it and asserts that nothing is
found.

### `645h-nj9q` · The linter runs a version past its end of life, and the documentation for it describes another

| Tags               | Status   | Depends on |
| ------------------ | -------- | ---------- |
| FE, Docs, versions | Standing | —          |

**eslint 9.x reached end of life on 2026-08-06, and `fl_frontend/package.json` declares `^9.39.5`** —
a caret range spanning a line that will publish nothing further, so `pnpm update` cannot move it and
reports nothing that would say it is frozen. Confirmed 2026-08-26 against eslint's own
version-support page, and re-confirmed 2026-08-31, when the registry served 10.9.1 as `latest` and
9.39.5 as the whole of its `maintenance` channel. The linter takes no further fix of any kind,
security or otherwise, and it is still the only check in the toolchain that catches some things at
all: `fl_frontend/eslint.config.mjs`'s own comment beside `better-tailwindcss/no-unknown-classes`
records that tsc, the Prettier plugin and the browser each accept an unresolvable class in silence.
**A defect in a frozen linter fails in the direction of passing.** What bounds the exposure is where
it runs — the gate's frontend scope and a developer's machine, never the production image — so this
is a toolchain exposure rather than a product one.

**`eslint-plugin-jsx-a11y` is the direct blocker and it is dormant.** Measured 2026-08-31 against the
installed packages and the npm registry: its newest release is the one installed, 6.10.2, published
2024-10-26, its eslint peer range stops at `^9`, and two upstream pull requests adding v10 support
sit open with nothing merged and nothing released behind them. `eslint-config-next` compounds it —
its own peer range admits v10 while it carries that plugin beside `eslint-plugin-import` and
`eslint-plugin-react` as plain dependencies, each on a newest release whose peer range stops at
`^9` — so the framework config cannot run supported on v10 either. Flat configuration, the larger
half of a v9-to-v10 migration, is already in use. **Forcing the install past the declared peer ranges
is not the move**: a linter defect fails in the direction of passing, and an unsupported combination
makes that one direction likelier.

**The consequence to act on until the move lands is the sharper one for anyone reading.**
`eslint.org/docs/latest` serves v10, and `.claude/CLAUDE.md` §4 holds a reference authoritative only
while it is official **and** current with the installed version in it as a documented release — which
the current documentation is not for 9.39.5. So the repository's own reflex, reading the project's
own docs, answers about a major version this repository does not run, with nothing in the reading to
mark the gap. **An eslint API claim here has to come from a version-pinned page or from the installed
package under `fl_frontend/node_modules`, and has to say which.**

**Trigger to revisit:** an `eslint-plugin-jsx-a11y` release whose peer range admits eslint 10, under
an `eslint-config-next` whose bundled `eslint-plugin-import` and `eslint-plugin-react` admit it too.

**Not verified:** which v10 changes bite here once the set moves — the migration guide was not read
against the configuration, no move shipping while the walk holds it, and a plugin that does move may
carry a changed rule default under it, which [`docs/frontend/spec.md`](../frontend/spec.md) is where
it lands. The move also re-answers the cache key and threading decision
[`docs/ops/spec.md`](../ops/spec.md) §1.6 records.

### `6zuv-9tkx` · Nothing here can render a Server Component, so no check reaches the boundary rule the repository already states

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| FE, Docs, tests | Open   | —          |

**`.claude/rules/frontend.md` states that a Server Component may not pass a function to a Client
Component and names the reason no tool catches it**, and a rule stated and enforced by nothing is
worse than a gap nobody has written down, because it reads to every later reader as a guarantee
somebody is keeping. Each layer misses it for its own reason and the reasons do not overlap: a prop
typed `readonly Facet<Row>[]` is correct, the type system having no notion of the serialisation
boundary, so a function is a good value on both sides of it; `next build` never renders a dynamic
route, so the failure has no build-time moment; and no test renders an async Server Component, whose
markup exists only once its own awaits have resolved. **So the three things a branch is cleared by are each right and each blind to
the same defect** — which surfaced instead as a flash and a German error on an admin page, found by a
person opening it.

**What exists now closes one shape rather than the class**, which its author said plainly. Two
source-level assertions in `fl_frontend/src/shared/utils/facets.test.ts` hold that no module under
`fl_frontend/src/app/` lacking `"use client"` imports a facets module, and that no `Admin*View.tsx`
takes `facets` as a prop — both reading source text rather than rendering anything. They are proxies
for a runtime property, chosen because the runtime property is out of reach, and they cover the facet
shape alone: the next render prop to cross that boundary will be a different name in a different
file.

**Done when the repository has chosen which of two things it wants, and the honest answer may be the
smaller one.** A harness rendering each admin page's server half would test the property itself
rather than a spelling of it, and would catch a boundary crossing nobody predicted — at the cost of a
second runner, a React server runtime, and fixtures for pages that read a database. **Or source-level
proxies per known shape are accepted as the ceiling**, in which case what is owed is a place that
lists which shapes are covered, so the render-prop rule stops reading as though all of it were held.
**Choosing the second is a real answer**; leaving the choice unmade is what currently reads as the
first.

**The shared render harness is not its answer.** `fl_frontend/src/shared/testing/renderTest.ts`
compiles a `.tsx` and renders it synchronously, which reaches a Client Component and no async Server
Component ([`docs/frontend/spec.md`](../frontend/spec.md) §1.9), so what that harness buys leaves
this entry where it stands.

### `79y5-vdpq` · Two gate functions are rewritten in miniature inside the test that drives them

| Tags             | Status | Depends on |
| ---------------- | ------ | ---------- |
| Ops, gate, tests | Open   | —          |

**`scripts/tests/test_worker_handoff.py :: PARENT_SCRIPT` and `:: _worker_script` are hand-written
miniatures of `scripts/gate/verify.sh :: replay_scope` and `:: gate_exit`**, each saying so where it
stands, and nothing compares either against the function it is standing in for. What every case in
that module is graded against is the copy, so the gate's own replay can lose a row, mis-rank a scope
or stop emitting a ledger at all and the module still passes — the false green its own header says
it exists to catch.

**The repair is already written twice in the same directory.**
`scripts/tests/test_unit_replay.py` builds its parent by lifting functions out of
`scripts/gate/verify.sh` and laying down the pool state they read, and
`scripts/tests/test_selfcheck_guards.py` lifts the same way — both for the reason the estate records
where it lifts: a copy passes while the gate's own regresses.

**Done when** both are driven by the functions themselves. `replay_scope` is nested and reads the
pool directory and the status map — the state `test_unit_replay.py`'s parent already writes before
it lifts anything, which is what makes the lift the smaller change rather than the larger one.

### `7wne-u6hm` · Three test modules each open a cache scope through the same React internal

| Tags                              | Status | Depends on |
| --------------------------------- | ------ | ---------- |
| FE, tests, saisons, spiele, teams | Open   | —          |

**`fl_frontend/src/features/saisons/queries.test.ts`,
`fl_frontend/src/features/spiele/queries.test.ts` and
`fl_frontend/src/features/teams/queries.test.ts` each import React's `react-server` build and
install a memo table on the internals object whose exported name says it may not be used**, and each
carries its own assertion that the build still exposes it. What the three prove is that one render
pass memoizes a filtered admin read, which is what a page relies on; what they rest on is React's
private surface, so a release moving it fails three modules at once and the same repair is written
three times.

**Done when** one module opens the scope and the three take it from there. It has to be reached by a
static import, the modules under test by `await import`: the opener installs itself as it evaluates,
and a module already resolved by then gets the real cache rather than the harness's.

### `9r6p-z26g` · Five fixture repositories are copied out of a live directory behind five hand-written denylists, and one of them already differs

| Tags             | Status | Depends on |
| ---------------- | ------ | ---------- |
| Ops, gate, tests | Open   | —          |

**Five modules build their fixture repository by copying `scripts/` into a temporary directory and
importing the gate out of the copy**, each with its own `shutil.ignore_patterns` denylist beside the
call: `scripts/tests/test_check_docs.py :: _load` is the original shape, and
`scripts/tests/test_branch_checks.py`, `scripts/tests/test_kernel_gitignore.py`,
`scripts/tests/test_platform_checks.py` and `scripts/tests/test_scope_decisions.py` each carry it
again. **The copy is what makes the seam work** — the checker derives its repository root from its
own location, so importing the copy is what points every check at the planted corpus rather than at
this repository — and that part is right and asserted at the call. What is hand-written is which
names the walk skips, and the five lists have already diverged: four name `__pycache__`, `tests`,
`.ruff_cache`, `.pytest_cache` and `.mypy_cache`, and the one in
`scripts/tests/test_scope_decisions.py` omits `.mypy_cache`. Nothing in this toolchain writes that
directory, pyright being the type checker, so the difference costs nothing today — **and the next
name added reaches four fixtures and not the fifth**.

**The list is load-bearing because the directory is live while it is walked.** The scripts scope
starts `selfcheck.sh`, `ruff`, `pyright` and the pytest suite together, and that suite distributes
over `-n auto --dist loadfile`, so several copies walk `scripts/` at once while two other tools read
it. `shutil.copytree` raises on a path that disappears between the directory listing and the copy, so
the denylist is correct only while it enumerates every directory anything else writes under
`scripts/`, and the run that meets a name nobody listed reports a `shutil` error against a temporary
file, in a scope whose findings are otherwise about the corpus.

**Done when** one helper builds every fixture repository in `scripts/tests/`, its file set comes from
git rather than from a denylist written at each call, and the five modules take it.
`scripts/checks/docs_gate/kernel.py :: gitignored` already answers a whole set of tokens in one batch
and memoises the run, and a fixture built from git's own answer keeps an untracked new module the
suite must still test. **A shared builder with one list is the smaller version** and closes the
divergence without closing the class.

### `aee2-vxqc` · Starlette has deprecated the httpx its test client is handed, and the four modules using that client stop collecting when the fallback goes

| Tags                    | Status | Depends on |
| ----------------------- | ------ | ---------- |
| BE, ci, tests, versions | Open   | —          |

**Every backend pytest run already prints the warning, and it is raised at import rather than in a
test.** Starlette's test client module imports `httpx2` under its own name, falls back to `httpx`
with a `StarletteDeprecationWarning`, and raises `RuntimeError` naming `httpx2` when neither is
installed. Read 2026-09-02 from a `pytest --collect-only` over `fl_backend/`, against the starlette
`fl_backend/uv.lock` resolves. **The fallback is what the dev group rests on**:
`fl_backend/pyproject.toml`'s dev group declares `httpx`, and the comment there records that
`fastapi.testclient.TestClient` imports it eagerly so the tests fail at collection without it. Four
modules import that client — `fl_backend/tests/api/test_actor_binding.py`,
`fl_backend/tests/api/test_admin_guard.py`, `fl_backend/tests/api/test_bewerbungen_read.py` and
`fl_backend/tests/api/test_error_responses.py` — so what a removal costs is four collection errors in
the default tier, not a failing assertion anyone can read as a product defect.

**The clock is a scheduled bump nobody watches.** `fl_backend/pyproject.toml` declares starlette by a
floor rather than a pin, and `.github/dependabot.yml` puts the `uv` ecosystem on `/fl_backend`
monthly with minor and patch grouped — so the version moves on its own, and the release that drops
the fallback arrives as a bot pull request whose whole diff is a version bump.

**Done when** the dev group takes `httpx2` in place of `httpx`, which is the remedy starlette's own
message names. **Not verified:** whether `httpx2` is a drop-in for what those four modules ask of
`TestClient`, and whether pyright needs it installed to keep starlette's own `TYPE_CHECKING` import
of it resolving.

### `b3c5-avuj` · One uv version is pinned at two sites, a bot moves one of them on a schedule, and nothing compares the pair

| Tags                        | Status | Depends on |
| --------------------------- | ------ | ---------- |
| BE, Ops, gate, ci, versions | Open   | —          |

**`fl_backend/pyproject.toml :: required-version` pins uv exactly, and `fl_backend/Dockerfile`'s
first stage pins the same version again in its `FROM ghcr.io/astral-sh/uv` line.** The comment at the
key says the pair moves together and that nothing compares it, which is the whole of the guard.
**Only one of the two sites is on a schedule**: `.github/dependabot.yml` puts the `docker` ecosystem
on `/fl_backend` monthly and a `FROM` line is exactly what that ecosystem rewrites, while the `uv`
ecosystem beside it reads `fl_backend/uv.lock` and reaches no `[tool.uv]` key at all.

**What a mismatch does is refuse rather than resolve.** The builder stage copies the image's uv and
runs `uv sync --frozen` against the `pyproject.toml` it has just copied, so a bumped image meets a
`required-version` it does not satisfy and exits 2 at start-up, naming the required version and the
running one — **and the image build is where that lands**, on a bot pull request whose author has no
reason to look in a manifest. The same refusal reaches a development machine from the other
direction: `scripts/gate/verify.sh`'s `--backend` scope runs `uv lock --check`, and a machine whose
uv is not the pinned one is refused before the lockfile is read, observed 2026-09-02.

**Dropping one site is not the cheap way out.** Every `astral-sh/setup-uv` step in
`.github/workflows/verify.yml` and `.github/workflows/pr-body.yml` passes
`version-file: fl_backend/pyproject.toml`, because that action's own default search covers the
repository root alone, where no manifest lives. So the key is what gives CI its uv, the `FROM` line
is what gives the image its uv, and both have to say the same thing.

**Done when** one check reads both sites and fails naming them, in a scope a change to either file
selects — `scripts/gate/scope_map.sh` already turns on `images` for either file, and the manifest
turns on `backend` and `scripts` beside it, so the check's home is the decision the work starts from.

### `b732-rpvp` · Most of the database tier runs against collections production would not accept

| Tags          | Status | Depends on |
| ------------- | ------ | ---------- |
| BE, DB, tests | Open   | —          |

Lands with: `bfs4-ax6a`, `gkp4-q3q9`

**Every shared database fixture yields a bare database, so unconstrained is the default rather than a
decision.** `fl_backend/tests/database.py :: a_clean_database` defaults `constraints` to `False` and
`fl_backend/tests/conftest.py :: mongo_database` applies nothing at all, so
`fl_backend/app/core/constraints.py :: apply_constraints` is opt-in per suite — and most of the db
tier declines it, inserting into collections that in production carry a `$jsonSchema` validator and,
for some, a unique index. **A document MongoDB would refuse on the server therefore passes in the
tier meant to prove the server's behaviour.**

**Some of those suites hold seeds the shipped validators would refuse outright**, found by comparing literal
seed dictionaries against the `required` tuples in
`fl_backend/app/core/constraints.py :: COLLECTION_VALIDATORS` rather than by running them:
`fl_backend/tests/api/test_spieler_write_execution.py` seeds a `saison_teams` row and a `saison_spieler` row
each missing required keys, and `fl_backend/tests/api/test_spieltage_write_execution.py` seeds a `spiele`
document missing more. **That is a floor rather than a total** — the comparison sees only dictionary literals
passed straight to an insert, and most suites seed through factory helpers it cannot follow.

**Unconstrained is sometimes right, and the fix is not "constrain everything".**
`fl_backend/tests/core/test_constraints_execution.py` already models the shape the answer wants:
`:: on_the_shipped_schema` is the constrained default and `:: on_an_unconstrained_database` a helper
a call has to name, with a stated reason at each unconstrained body.

**Done when** constrained is what the shared fixture gives and unconstrained is an argument somebody
has to write down. The flip itself is one line — `a_clean_database`'s `constraints` default — so the
work is the seeds it exposes: turning one suite constrained costs more lines than it removes, because
a seed written against no validator omits fields the shipped one requires, and **every seed it
corrects is a seed that was quietly describing a document the product cannot hold**. What it buys is
that the database tier stops being able to prove behaviour over impossible data, which is the one
thing that tier exists for.

### `bfs4-ax6a` · The database fixtures' drift guard cannot see a view, so a body that creates one has a safety net that is not there

| Tags          | Status | Depends on |
| ------------- | ------ | ---------- |
| BE, DB, tests | Open   | —          |

Lands with: `b732-rpvp`, `gkp4-q3q9`

**`fl_backend/tests/database.py :: a_clean_database` builds a database's schema once and holds every
later caller to it.** `:: _moved` compares what the database now carries against the baseline the
build left, and `:: _clear` empties the collections in that baseline; a body that narrows a validator
or moves an index is required to say so by passing `mutates_schema=True`, and the refusal
`:: _DRIFT_SYNC` spells out why — what left the database ran EARLIER, and the test the failure names
only inherited it.

**Both halves read `:: _data`, which keeps only the entries `listCollections` types as a
collection**, and a MongoDB view is typed `view`, so it enters neither the baseline nor the
comparison. **The exclusion is right for the reason its docstring gives** — a view answers neither a
validator nor a `delete_many` — and the consequence is the part nothing states: the guard cannot
report a view, so a body that creates one is neither refused nor asked for `mutates_schema=True`.

**One body creates a view today and is safe by its own choice rather than by the guard.**
`fl_backend/tests/core/test_constraints_execution.py` proves that the startup apply fails on an
unattached validator by creating `teams` as a view, and it runs through `:: on_a_database`, which
passes `mutates_schema=True` and therefore rebuilds on every call. The same body written against
`:: on_the_shipped_schema` or `:: on_an_unconstrained_database` — the two helpers whose databases are
built once and reused — leaves a view the clear never empties and the comparison never reports, and
where the view takes the name of a collection the baseline holds, the next caller's `delete_many` is
run against a view and fails: **the test that fails is the one after the one that moved the schema**,
with nothing in the output pointing back.

**Done when** `fl_backend/tests/database.py :: _moved` counts a namespace that is not a collection as
enforcement the session did not build and reports it under the message that already exists, and
`fl_backend/tests/database.py :: _data` states that its filter answers what carries a validator and
never what the database holds — so the next reader does not take the exclusion for coverage.

### `bpve-vhag` · The fork exemption's ceiling is charged per block, and nothing caps the blocks one ancestor excuses

| Tags                   | Status | Depends on |
| ---------------------- | ------ | ---------- |
| Ops, Docs, gate, tests | Open   | —          |

Lands with: `h4wq-p7ct`, `spq6-zy2d`

**`scripts/checks/docs_gate/branch.py :: _fork_ceiling` hands one ancestor's word count to every
current block overlapping it, and nothing records that the ancestor has already been spent.** A block
the fork held over INC-9's bound, split in two, gives each half that whole count as its ceiling: both
halves pass at the original's length, so the pair passes at twice it. `docs/_standard/worked-examples.md` states
the consequence for a writer, and nothing refuses it.

**The same unit problem reaches a pair no fork produced.**
`scripts/checks/docs_gate/kernel.py :: comment_runs` closes a run at `*/` and at a blank line, so two
blocks stacked above one statement are two measurements where a reader meets one comment. INC-9's own
third question asks whether a block constrains more than one line and splits it where it does, which
leaves the evasion and the compliance identical at the checker's rung.

**Charging the ceiling against the sum of the blocks matching one ancestor closes the first half and
not the second**, which has no ancestor to charge against: that one needs adjacent runs joined before
either bound is read, changing what `comment-length` reports over every file rather than over a fork
alone. Whether the two are one repair or two is the decision.

**Deliberately not taken beside the matching rule it sits on.** A logic change stacked on
`scripts/checks/docs_gate/branch.py :: _fork_ceiling`'s overlap match would reach the gate before that
match has refused anything, so a defect in either would be attributed to the other.

**Done when** the checker measures what a reader counts as one block, and
`scripts/tests/test_branch_checks.py` carries a scenario that splits an over-bound block and one that
stacks two blocks above a single line.

### `c8rx-gqun` · A citation naming an invariant is proved by a substring, so one resolving to a sheet that does not define it passes

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, gate | Open   | —          |

**`scripts/checks/docs_gate/checks.py :: _check_citation` proves a symbol is DEFINED where the cited file's
language can be read for definitions (`scripts/checks/docs_gate/kernel.py :: defined_symbols`), and falls back
to whether the anchor appears anywhere in the file where it cannot.** A markdown sheet is the case that
cannot, so a citation naming a spec sheet and an invariant id is still proved by a substring — **which proves
the id's characters are somewhere in the sheet and nothing more**, whether or not the sheet defines an
invariant by that number and whether or not that invariant means what the citing page says it means. **The
live demonstration is already in the corpus:** `docs/frontend/spec.md` defines no invariant in the forties and
mentions backend invariants from that range in its prose, so a citation naming that sheet and one of those ids
resolves cleanly against a definition it does not hold.

**Two failure modes, and the second is the dangerous one.** The first is containment: a shorter id is a
substring of a longer one, so a citation to an invariant a sheet does not define passes as long as one
starting with the same digits does. The second is collision: a new invariant given a number the sheet already
uses resolves perfectly, from both directions, while the sheet now defines one number twice. **Nothing detects
the duplicate either** — `scripts/checks/docs_gate/checks.py :: invariant_ids` walks `:: INVARIANT_ROW_RE`
over every sheet and appends a sheet to an id's home list only where the sheet is not already in it, so a
sheet defining one id in two rows is indistinguishable from a sheet defining it once.

**Done when** a citation whose anchor is exactly an invariant id requires the cited sheet to be among
that id's homes rather than testing for a substring, and a duplicate row within one sheet is reported
as a finding of its own. The machinery already exists and is already passed in:
`scripts/checks/check_docs.py` computes the invariant homes and hands them to the per-file check,
which uses them for `scripts/checks/docs_gate/checks.py :: check_invariant_citations`. **The
substring fallback stays** for what no reader can index — a shell symbol, a markdown heading, a
config key — so this narrows the check for one anchor shape rather than replacing the fallback, and
`scripts/checks/docs_gate/checks.py :: INVARIANT_CITE_RE` is the pattern that already recognises that
shape.

### `cckv-edvy` · The published document's drift check fails with the command that accepts the drift

| Tags                           | Status | Depends on |
| ------------------------------ | ------ | ---------- |
| FE, BE, Ops, Docs, gate, tests | Open   | —          |

**`fl_backend/tests/api/test_openapi_document.py :: test_the_committed_document_is_the_one_the_service_publishes`
compares the tracked `fl_backend/openapi.json` with what the models publish, and the message it fails
with names the command that overwrites the document.** `scripts/gate/verify.sh` prints the same
instruction beside its own `--check` run of `fl_backend/tests/openapi_document.py`. Following either
turns the run green, the document now saying whatever the models say — so a check whose stated remedy
is to accept what moved cannot separate a document left behind by an intended change from a model
change nobody meant to make.

**Some narrowings have nowhere else to fail.** A field's `pattern` can be tightened so that every
value its own tests accept is still accepted and every value they refuse is still refused, while the
published string changes: a house number's charset is such a constraint, and
`fl_backend/tests/shared/test_addresses.py` names values on both sides of it that a pattern
additionally requiring a leading digit would decide exactly as they are decided now. What the reader
gets in that case is the closing line of
`fl_backend/tests/api/test_openapi_document.py :: summarize_drift`, which says a field inside one of
the components changed and cannot say which — and then the instruction to accept it.

**Nothing objects afterwards**, because every other reader takes the committed file rather than the
models: `fl_frontend/src/core/apiContract.test.ts` reads the document that was just rewritten, and
the `--check` run compares the rewritten document with the models it was built from.

**Widening the frontend's comparison is refused already and is not the repair.**
`.claude/rules/cross-surface.md`'s **openapi** clause holds the Zod mirror to presence, required,
nullable, type and enum, so a narrowed pattern is not that comparison's to catch.

**Done when** the failure separates the two readings it now collapses — naming the field whose value
moved rather than reporting that one did, and offering the rewrite for a change the session meant
while saying that the repair for one it did not mean is in the models.

### `ckf7-7w58` · The frontend mirrors the backend's payload bounds by hand, and one of them is swept

| Tags                                      | Status | Depends on |
| ----------------------------------------- | ------ | ---------- |
| FE, BE, tests, bewerbungen, spiele, teams | Open   | —          |

**Four frontend modules declare themselves mirrored from `fl_backend/app/shared/schemas/bounds.py`,
and one number in one of them is compared to its source.**
`fl_frontend/src/features/bewerbungen/actions.test.ts` reads that file as text and matches
`BEWERBUNG_GRUND_MAX_LENGTH` on both sides. Every other mirror —
`fl_frontend/src/features/bewerbungen/constants.ts`'s kit, squad, preferred-opponent and contact-age
bounds, `fl_frontend/src/features/teams/constants.ts`'s club fields,
`fl_frontend/src/features/spiele/constants.ts`'s note ceiling, and
`fl_frontend/src/shared/schemas.ts`'s address and email ceilings — is held to its source by a comment
saying that it mirrors one.

**The numbers agree today (2026-09-03)**, so what is missing is the guard rather than a repair to make.
What the guard buys is written at the sites themselves: past the backend's ceiling the API answers a
bare `REQ-VAL-001` carrying no field detail, so a frontend bound set too high marks no box and the
person filling the form is told nothing at all.

**A sweep keyed on the identifier would pass while skipping the pairs that most need it.** The contact
age span, the fixture note, the club description and the club's short code each carry one name on the
frontend and another in `fl_backend/app/shared/schemas/bounds.py`, so a reader matching by name
reports green over exactly the pairs whose drift nothing else would show. The pairing has to be
declared somewhere a checker reads it.

**Done when** every constant a frontend module says it mirrors is compared to
`fl_backend/app/shared/schemas/bounds.py`, the pairing is declared rather than inferred from a name,
and a mirror the declaration does not name fails rather than passing unread.

### `crwn-qfp7` · The opening comment block of every file read as a shell script is measured by neither bound

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, gate | Open   | —          |

**`scripts/checks/docs_gate/kernel.py :: comment_runs` steps over a `#`-styled file's leading run
before it yields a block, and `scripts/checks/docs_gate/checks.py :: HEADER_SCOPES` admits `.sh` under
`scripts/` alone.** `scripts/checks/docs_gate/kernel.py :: comment_style` sends every kind carrying no
source suffix to the `#` reader — a hook, a Dockerfile, a workflow, a manifest, a compose file — so
each one's opening block is skipped as a module header by INC-9's checker and then declined as out of
scope by INC-2's. Each bound leaves it to the other.

**The gap is the opening block and no more.** A second block further down the same file comes back
through `comment-length` like any other, which is why nothing about these files looks unguarded.

**Measured over the tracked corpus on 2026-09-03: eighty opening blocks are measured by nothing**,
twenty-two of them past INC-9's forty words and three past INC-2's 175. Twelve of the twenty-two sit
in `.claude/hooks/` and `.githooks/`, which the In-code scope of `docs/_standard/standard.md` already claims;
`.claude/hooks/guard-local-compose.sh` carries the longest of them.

**Widening `scripts/checks/docs_gate/checks.py :: HEADER_SCOPES` is the decision, and it is prose work
rather than a checker change.** The blocks it would start measuring were written against no bound, so
the widening fails the first branch to touch any of them, and the three past INC-2's bound are
contracts at the wrong rung rather than passages to shorten.

**Done when** the scope reaches the kinds `scripts/checks/docs_gate/kernel.py :: comment_style` sends
to the `#` reader, with those blocks brought under a bound in the same change — or the exemption is a
decision `docs/_standard/standard.md` states rather than the residue of two scopes not meeting.

### `d5j8-js4n` · A citation naming a real file in an unaccepted spelling is reported as a file that does not exist

| Tags      | Status | Depends on |
| --------- | ------ | ---------- |
| Ops, gate | Open   | —          |

**`scripts/checks/docs_gate/checks.py :: _resolve` refuses a slashed token that is neither
repository-relative nor package-root-relative, and never reaches the name index behind it.** The
function tries the repository path, then `scripts/checks/docs_gate/kernel.py :: repo_path`, then a
bare-name lookup — but the bare-name route is guarded by a test for a `/` in the token, so a token
holding one returns the empty list rather than falling through. Exercised 2026-08-30 over one real
file written four ways: the repository path, the package-root-relative spelling and the bare filename
all resolve, and the intermediate spelling — the file's path from inside its own package's source
root, without that root — resolves to nothing.

**The finding it produces names the wrong fault.** An empty resolution is reported as `cited file not
found`, so a citation whose file is present and whose symbol is right is reported as naming a file
that is not there. **The reader is sent to look for a deleted file when what is wrong is a
spelling**, and the shortest route out of the finding — deleting the citation — is the one repair
that loses a true claim. This holds whether or not the file is tracked: the fault is the spelling
rather than the listing the name is looked up in.

**Done when** the decision is taken, and it is not obvious which way. COR-6 asks for an anchored path
and refusing a spelling the standard does not sanction is defensible —
`scripts/checks/docs_gate/kernel.py :: repo_path`'s own docstring records that existence is what
keeps a token naming a KIND of file out of the check — so the answer may be to keep refusing and say
so, in a message that names the spelling rather than the file, which costs one line and teaches the
rule at the point of failure. The alternative is to let the package-root fallback that already serves
a token like `src/core/...` serve a deeper one too, which resolves more spellings and weakens the
pressure toward the one COR-6 asks for.

### `db2a-9qu3` · The local edge claims to mirror production, and nothing reads either half of the claim

| Tags                  | Status | Depends on |
| --------------------- | ------ | ---------- |
| Ops, Docs, gate, edge | Open   | —          |

**`nginx/local.conf` opens by claiming the same routing, rate limits and security headers as
`nginx/prod.conf`, and its `/api/admin/` block says it must stay identical to production's or the
local stack cannot catch a routing mistake — and nothing reads either sentence.**
`scripts/gate/verify.sh` runs `nginx -t` in its ops scope against `nginx/prod.conf` alone. The local
file is parsed — `nginx/redaction_test.sh` serves it in the pinned image in that same scope, so a
typo in it fails the gate — but what stands unread is the comparison.
`scripts/checks/check_compose_mirror.py` compares `docker-compose.yml` against
`docker-compose.local.yml` and stops there, the two nginx files appearing in it only as the mount
paths `:: DECLARED_DELTAS` names as an allowed difference: the checker knows both files exist, knows
they deliberately differ, and reads neither. **The argument for the check that exists is the argument
for the missing one, word for word** — the compose comparison reasons at the line that both files
parse whatever they say, so nothing else holds the local stack to production's shape and a setting
production gains and local does not is a difference local can never catch.

**What the gap costs is the value of every local verification.** `.claude/CLAUDE.md` §5 requires a
browser check against the local stack rather than a dev server, on the grounds that `next dev`
exercises neither the standalone build nor nginx — which holds only while the nginx the local stack
mounts is the nginx production runs. The two directions fail differently: a block present in
production and missing locally shows up at the desk as a route that works on the server, and a block
present locally and missing in production shows up in production. **The two files agree today**,
which is what makes this a guard rather than a repair.

**A byte comparison is the wrong answer, and the deliberate differences are why**:
`nginx/local.conf`'s own header names them — no TLS, no `www` redirect, a 421 catch-all where
production rejects the handshake. What `scripts/checks/check_compose_mirror.py` does instead is parse
both files, compare at a declared grain and carry the allowed differences as a list with a reason on
each; nginx has no parser in this toolchain, so the equivalent is a directive-level reader for the
subset the two files actually use — `location` paths, `limit_req_zone` names and rates, `proxy_pass`
targets, the `add_header` set — built against the same kernel the other checkers share. **A second
`nginx -t` over `local.conf` is a different question and a much cheaper one**: it proves the file
parses and proves nothing about the pair. Both are worth having, and that one is the half that could
ship on its own.

### `eg48-8863` · Two db-tier runs at once fail in a way that names nothing

| Tags                     | Status | Depends on |
| ------------------------ | ------ | ---------- |
| BE, Ops, gate, ci, tests | Open   | —          |

**Starting `./scripts/gate/verify.sh --db` while a `pytest -m db` is already running produces a wall
of unrelated failures, and nothing in the output says why.** Observed 2026-08-22: one run reported
147 failed and 71 errors, while two immediately subsequent runs of the identical command, with
nothing else changed, reported 411 passed. The failures land on validators and unique indexes, which
`fl_backend/tests/core/test_constraints_execution.py` applies to the database it is given — so the
first reading available to whoever hits it is that their own change broke the schema. **What it costs
is a wrong conclusion rather than a wait**: the gate is the evidence a branch rests on, and a db-tier
result anything running beside it can corrupt is a result nobody can quote, the green one included,
which is the half that does not announce itself.

**The mechanism is unestablished, and finding it is the first half of this entry**, ahead of choosing a
repair. Almost every db-marked suite names its own database, and the two names that are shared — the one the
suites seeding through pymongo's synchronous client take from `fl_backend/tests/config.py :: CORPUS_DATABASE`,
and the `fl_test` that `fl_backend/tests/conftest.py :: mongo_database` hands out — now carry the worker that
chose them (`fl_backend/tests/worker.py :: worker_database`), which separates two workers of ONE run and does
nothing for two runs, every worker of which draws the same suffix. A run starts its `mongo:8` containers
through testcontainers with no reuse flag set anywhere in the tree, so two runs are not obviously sharing a
server either. **What to eliminate, in order:** testcontainers' Ryuk reaper, which is one container per Docker
host and removes on a reconnection timeout; contention on the Docker daemon while two runs each pull an image,
start a container and elect a single-node replica set; and any fixture reaching a fixed address rather than a
container's mapped port.

**Two `AutoReconnect` occurrences stay separate, and the port exhaustion does not account for the
earlier one.** Across 25 db-tier rounds on 2026-08-26 — twelve beside the rest of the gate, seven
alone, the remainder under a full-form run — one round failed two tests on `connection pool paused`,
a failed connect to the container's published port. **It is not attributed and one occurrence in 25
is not evidence of a flaky tier**; the controls point away from load, the tier alone having been
green six times and the full gate seven under heavier contention. On 2026-09-01, with roughly a dozen
agents driving db-tier suites on one Windows machine, `AutoReconnect` surfaced with `WinError 10048`
while 12,000 to 15,900 sockets machine-wide stood in `TIME_WAIT`: the host ran out of ephemeral
ports, and a run started once `TIME_WAIT` had drained below 7,000 was green. **That is a property of
the host under a dozen concurrent agents, not of the harness or the driver**, and the driver half was
measured rather than assumed — three hundred `fl_backend/tests/database.py :: a_clean_database`
client lifecycles, polled through `serverStatus`, held `connections.current` flat at 3 while
`totalCreated` climbed linearly to 903, so no pool the driver holds accumulates connections to
reconnect over.

**Width is a second contributor to the same socket pressure, and any repair has to survive it.** A
db-tier run at `-n auto --dist loadfile` left 799 more sockets in `TIME_WAIT` than it found, where a
serial run of the same 769 tests on the same machine went net negative. The mechanism is structural
rather than a leak: a worker is a pytest session of its own, so each opens its own clients against
the two shared servers, `fl_backend/tests/conftest.py :: mongo_database` and
`fl_backend/tests/database.py :: shared_client` being per process rather than per run. **Count the
state with `Get-NetTCPConnection -State TimeWait`**: a localised Windows `netstat` prints the state
in the host's own language, so a grep for `TIME_WAIT` reads zero on a machine holding thousands.

**Done when** the mechanism is known and one of three answers is taken — a database name carrying the
run's own identity, a lock that makes the second run wait, or a check that refuses to start while
another run holds whatever the collision is over. **Only the last keeps a single result trustworthy
without changing what the suites do, and it is also the only one that says out loud what happened**,
and `scripts/gate/verify.sh`'s db step is what it would sit in front of.
This entry also fixes what a db-tier figure has to be to count at all: a pair of runs within a fifth
of a second of each other on an idle machine.

**Not measured:** whether the collision can reach CI at all. `.github/workflows/verify.yml` runs one
`verify.sh` scope per job and each job takes its own runner, so two db-tier runs would have to land
on one host — which a hosted runner is not.

### `f38s-y3hj` · A sweep taking `.tsx` alone decides no test file, and the spelling keeping its fixtures out is refused by nothing

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| FE, Docs, tests | Open   | —          |

Lands with: `z82x-us4y`

**Every sweep collecting `.tsx` alone hands `fl_frontend/src/core/treeWalk.ts :: filesUnder` a
predicate that decides no test file**, where the sweeps collecting `.ts` as well call
`fl_frontend/src/core/treeWalk.ts :: isTestFile`, which reads either spelling. What holds the first
set clean is that the estate spells every test file `.test.ts`, so a `.tsx` predicate drops them by
accident rather than by decision.

**The failure is a rename away, and a sweep is already sitting on it.**
`fl_frontend/src/shared/components/ui/formSubmit.test.ts` collects the `.tsx` files whose text names
`<ConfirmSaveModal` and holds the result to a floor — and it writes that literal itself, as the
needle it searches for. Under the other spelling it would be swept into its own answer and counted
among the editors it measures. The rest carry the same shape: what each searches for is text it also
contains. Whether such a file would run is a separate question from whether it is swept, because the
walk reads the directory and nothing about the runner's collection reaches it.

**Nothing stands behind the rule that already names this.** `.claude/rules/frontend.md`'s **sweeps**
clause bars taking a test file's fixtures as the production text a sweep asserts over; no gate check,
lint rule or hook refuses the `.test.tsx` spelling, so what holds the clause here is the tree's
current habit.

**A blanket exclusion is not the repair.** `fl_frontend/src/core/mail.test.ts` sweeps the tree and
asserts against a set naming its own file, so a sweep may legitimately want the test files. What
none may do is leave the answer to whichever suffix it happened to want.

**Done when** every sweep's predicate states its own answer to the test-file question, so the
population each walks is the one it chose rather than the one the tree's current spelling gives it.

### `f4uf-jape` · A copy test compares source text against a literal its own author typed

| Tags                                | Status | Depends on |
| ----------------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, saisons, teams | Open   | —          |

**[`docs/frontend/spec.md`](../frontend/spec.md) §1.9 calls the frontend's `readFileSync` tests one
kind — sweeps that hold a rule no linter can express — and they are two.** Each of one kind has an
authority somewhere other than the test: `fl_frontend/src/core/apiContract.test.ts` and
`fl_frontend/src/core/apiRequests.test.ts` compare the tree against `fl_backend/openapi.json`,
`fl_frontend/src/features/saisons/actions.test.ts` requires every refusal code
`fl_frontend/src/core/refusalRegister.ts :: declaredCodes` reads out of
`fl_backend/app/core/domain.py` to reach a `case` in the German mapper, and
`fl_frontend/src/core/refusalPaths.test.ts` and
`fl_frontend/src/shared/components/ui/formSubmit.test.ts` hold structural rules across the tree.
**The other kind regexes a component's German out of its own `.tsx` and asserts that it matches a
literal** — `fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/teamErsatz.test.ts`
is the clearest, with `:: undrawSpielplan.test.ts`, `:: spielplanReplace.test.ts` and
`:: oneWayGuards.test.ts` beside it — and can only restate what its author believed when they wrote
the component, in the same commit, then defend that belief against every later reader.

**Demonstrated rather than hypothesised.** The replacement panel's own copy test once required the
panel to say a replaced club's players were _stillgelegt_ and forbade _ausgetragen_, under a comment
arguing that wording it as a removal would mislead. **Both halves were the wrong way round** — the
endpoint stamps `saison_spieler` and touches no `spieler` document, so the forbidden word was the
correct one. The suite was green throughout, and the test was what would have had to be edited before
the defect could be fixed.

**Rendering the panel does not close it.** An assertion over the markup
`fl_frontend/src/shared/testing/renderTest.ts :: renderMarkup` produces fails in precisely the same
way, because the fault is in what the assertion compares against rather than in how it reads the
component.

**Done when** the vocabulary has an authority and a test reads it — the pair of verbs declared once
in [`docs/glossary.md`](../glossary.md), which today describes `inactive_since` as "the day something
left" for every subject and fixes no German for any of them, and the consequential sentences composed
by an exported function, as `fl_frontend/src/features/teams/utils.ts :: describeReplacementUmfang`
and `fl_frontend/src/features/saisons/utils.ts :: describeSpielplanUmfang` already are, so the
assertion is over a value rather than over a file's bytes. **What the answer must not be is a rule
banning the shape outright**: several of these tests hold the only line there is under a real rule,
and [`docs/frontend/spec.md`](../frontend/spec.md) §1.9 is right that a sweep is how such a rule is
held. **The line to draw is the authority, not the mechanism** — a sweep that compares the tree
against something outside itself is sound, and one that compares it against a literal in the same
commit is a note about intent wearing a test's clothes.

### `fha5-k95h` · A projection and the predicate reading it are coupled in one direction, and the open one fails quietly

| Tags               | Status | Depends on |
| ------------------ | ------ | ---------- |
| BE, tests, saisons | Open   | —          |

**`fl_backend/app/api/saisons/services.py :: RECORDED_FACT_FIELDS` is the projection that decides whether a
season's draw may be destroyed, and the couplings around it are guarded unevenly.** Two of the three are held:
every field the fixture patch writes is in the projection or named as no record
(`fl_backend/tests/core/test_write_shapes.py :: TestEveryFieldAPatchWritesIsWeighedOrNamed`, against
`:: NOT_A_RECORD`), and every path in the projection is read by the predicate
(`fl_backend/tests/api/test_spielplan_refusal.py :: TestWhatCountsAsRecordedAgainstAFixture`, a case per
projected path). **Nothing holds every key the predicate reads to being fetched by the projection.**

**The open direction is the one that fails silently, and it fails toward destruction.** A predicate
that began reading a key the projection does not fetch would see `None` on every fixture every time —
in production the driver returns the projected keys and nothing else, and in the test the fixture
_is_ a projection document — so no assertion fails, the branch never fires, the author believes the
window closes on that field, and what stands on the far side of the window is a replace that deletes
every matchday and fixture the season holds. The guarded direction's failure is the harmless one by
comparison: a projected field nobody reads costs a wasted fetch.

**The obvious guard is refused, and that refusal is the whole difficulty.** The mechanism available
is an AST sweep of the two functions for the string constants they subscript, which is the technique
`fl_backend/tests/core/test_write_shapes.py :: _model_copy_keys` already uses — and its limitation is
the one that bites here, that it sees `ast.Constant` and nothing else.
`fl_backend/app/api/saisons/services.py :: _a_side_is_off_the_draw` composes both bracket-source keys
as `f"{slot}_quelle"`, so a constant sweep misses both and needs an allowlist to compensate. **An
allowlist is exactly the fragility the guarded direction was built without** — that test's fixture is
the projection document, so it needs no second list to stay true — and adding one here would trade a
guard that cannot go stale for one that can, which is worse than the gap it closes.

**Done when** one of two answers is taken. The clean closure is to stop composing those two keys —
spell them as constants beside the projection, and a sweep needs no allowlist at all — which is **a
small edit to production code made to serve a test, and a trade worth stating out loud rather than
making quietly**. The alternative is to accept the direction as open and say so in the predicate's
own docstring, so the next author reads the constraint where the code is rather than inferring it
from the guards around it.

**The gap is not overstated.** `fl_backend/tests/core/test_write_shapes.py :: NOT_A_RECORD` names
`datum` and `uhrzeit` as what a save may move while nothing counts as recorded, so those two are
covered by name, and every key `fl_backend/app/api/saisons/services.py :: holds_a_recorded_fact` and
`:: _a_side_is_off_the_draw` read today is fetched by the projection. What is missing is anything
holding them to it.

### `g98z-k4cp` · Two hook watchdogs sit under a registration in another file, and nothing compares the pair

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, gate | Open   | —          |

Lands with: `tnvw-4cqz`

**`.claude/hooks/guard-credential-shell.sh` and `.claude/hooks/guard-branch-bash.sh` each decide in a
child under a kill budget of their own and deny on anything but that child's answer**, and each
states at the line that its budget has to stay under the hook's own registration in
`.claude/settings.json`. A hook the harness kills prints nothing, and a hook that prints nothing has
allowed the command — so a registration lowered to the child's budget or below hands the kill to the
harness, and the guard falls silent on the write to `main` or the command reaching credential
material that it was written to refuse.

**Nothing reads either relationship.** The numbers sit in two files, the failure leaves no trace in
the transcript, and every probe that drives these guards runs them directly rather than through the
harness, so all of them stay green. Changing a registration is also the cheapest edit on the page:
whoever lowers one is tuning a timeout, not touching a guard.

**Done when** one check reads both files and refuses a registration that does not stand clear of the
budget beneath it. `scripts/gate/selfcheck.sh` already refuses a declared pair that has drifted
apart, so what is missing is the comparison rather than a place to put it.

### `gbjj-9wfh` · A test fixture asserts its own type, and the assertion is the only thing holding it to the model

| Tags                                                | Status | Depends on |
| --------------------------------------------------- | ------ | ---------- |
| FE, tests, admin, saisons, spiele, spieltage, teams | Open   | —          |

**Object literals across the frontend suite are cast to `FLSpiel` or `FLSpielAdmin`, and a cast is
what stops the compiler comparing the literal against the model.**
`fl_frontend/src/features/spiele/utils.test.ts` holds most of them, with one apiece in
`fl_frontend/src/features/admin/utils.test.ts`,
`fl_frontend/src/features/spiele/draftStatus.test.ts`,
`fl_frontend/src/features/spieltage/utils.test.ts` and
`fl_frontend/src/features/teams/utils.test.ts`. **Some go through `as unknown as`**, which discards
even the weak excess-property check a plain `as` keeps. The thinnest stand three fields in for the
whole model: `fl_frontend/src/features/spieltage/utils.test.ts :: makeSpiel` returns a `spiel_nr` and
the two `quelle` fields, where `fl_frontend/src/features/spiele/schemas.ts :: FLSpiel` is inferred
from `:: FLSpielSchema`, a mirror of a document in which none of those fields may be missing.

**Nothing is wrong today, and the entry opens by saying so.** Both thin factories feed wiring
functions — `fl_frontend/src/features/spieltage/utils.ts :: orderRoundsByWiring` and
`fl_frontend/src/features/spiele/utils.ts :: quelleKey` — which read the fixture's `spiel_nr` and its
two `quelle` fields and nothing else, so every fixture supplies what its consumer asks for. **This is
a hazard with no defect behind it.**

**What makes it a hazard rather than a style note is the direction a predicate grows.** The functions
these fixtures feed are exactly the ones that gain a clause: a wiring reader that later consults
`sonderereignis`, a status derivation that later reads `elfmeterschiessen`. On the day one does, the
fixture answers with an absent field — a value the model forbids and no stored document can hold —
and the assertion written against it passes, describing behaviour over a document that cannot exist.
**`tsc` cannot report it, because the cast is the author telling it not to.**

**Done when** a stand-in can be checked. **Deleting the casts is not the fix** — a partial literal
standing in for a large model is legitimate in a test and is why the casts are there — and
`satisfies` does not reach it, verifying what is present and leaving the absent fields absent. **The
shape that does is a factory building a complete, valid fixture and taking overrides**, validated
once at construction through the Zod mirror already in the tree, so the fields nobody names are real
values and a fixture that has drifted from the model fails where it is built rather than wherever it
is eventually read; `fl_frontend/src/features/saisons/utils.test.ts` already works this way, its
`spiel` helper spreading a complete base. The size is why it is an entry rather than a fix taken in
passing: a few thousand lines across those files, none of it connected to whatever change happens to
expose the question.

**One thing this entry does not claim** (COR-9). A cast is not what makes a fixture describe the
wrong state. A complete, type-correct literal can still represent something the domain does not
produce, and no type-level mechanism reaches that — not a cast's removal, not a factory, not
`satisfies`. What catches it is a reader, or a predicate that eventually disagrees with it. The two
failures share a file and nothing else.

### `gkp4-q3q9` · A unique index and the case proving it are paired by position, and only a count holds them

| Tags          | Status | Depends on |
| ------------- | ------ | ---------- |
| BE, DB, tests | Open   | —          |

Lands with: `b732-rpvp`, `bfs4-ax6a`

**`fl_backend/tests/core/test_constraints_execution.py :: test_each_unique_index_refuses_the_second_document`
is parametrized over a hand-written list of document pairs, labelled with `ids` taken from the names in
`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`.** That labelling is the only coupling between the
declaration and the cases meant to prove it: the ids are labels no assertion reads, and the pairing between
the n-th index and the n-th document pair is positional.

**What the coupling catches, it catches by accident.** Removing an index leaves fewer ids than
parameter sets and pytest fails at collection with a message naming counts and no index — one that
prevents the tests from running at all rather than reporting which rule went unproven. Adding one
fails the same way. Verified on the installed pytest on 2026-08-25 by running both shapes over probe
files outside the tree.

**One correction to how this is first read.** An emptied `UNIQUE_INDEXES` does defeat the labelling
check, because pytest carves out an empty id list, and the same probe confirms the parameter sets
collect and pass under it. **It does not slip past the test**: `:: apply_constraints` would then
build no unique index, the second insert in each case would land, and every assertion would fail on
the document being accepted rather than rejected. So the loud failure is there; it comes from a
different mechanism than the one meant to hold the pairing.

**The mutations nothing catches are the reason for the entry.** Reordering `UNIQUE_INDEXES` re-labels
every case without changing any outcome, so a case reported under one index's name is exercising
another and every one still passes. And an index whose keys change keeps its name and its
hand-written pair, so whether that pair still proves the narrowed or widened rule is checked by
nobody — two sibling tests happening to cover two of those cases are not a general answer.

**Done when** the document pairs are keyed by index name and the parametrize list is built by walking
`UNIQUE_INDEXES` and looking each name up: a missing key is then a `KeyError` naming the index, a
reorder is inert, and the id is derived from the same value the case is. The precedent is one file
away — `fl_backend/tests/api/test_rules_refusal.py` asserts its own case list against the imported
field tuple at module level, so an unpaired field fails at import.

### `gm9c-2du4` · Every link the local stack mails points at production

| Tags                  | Status | Depends on |
| --------------------- | ------ | ---------- |
| FE, Docs, bewerbungen | Open   | —          |

**`fl_frontend/src/core/brand.ts :: SITE_URL` is a module constant, and every absolute link is built
from it.** `fl_frontend/src/app/api/bewerbung/route.ts` and
`fl_frontend/src/features/bewerbungen/sweep.ts` each spell a confirmation link from it, and
`fl_frontend/src/app/layout.tsx`, `fl_frontend/src/app/robots.ts` and
`fl_frontend/src/app/sitemap.ts` build the site's own absolute URLs the same way. The origin that
does move is `AUTH_URL`, which `fl_frontend/src/core/config.ts` validates at startup and
`docker-compose.local.yml` points at loopback — so the local stack answers on one origin and mails
links on another.

**What it costs is the browser pass.** Every confirmation, reminder and deletion notice the local
stack sends carries a link to the live site, so exercising the flow end to end means lifting each
token out of a message and putting it on localhost by hand, once per seat and again per re-send.
That is the one part of this flow nobody can walk through as its reader would.

**The two origins are not one setting, which is what makes this a decision rather than an edit.**
`AUTH_URL` is validated as the public origin and refused unless it is https or loopback, while
`SITE_URL` is also what `metadataBase`, the crawl policy and the sitemap publish — and a published
origin read from the environment is one a misconfigured deploy can put in front of a crawler. Making
the mail links follow the serving origin while the published metadata stays fixed, and making both
follow one variable, are different changes with different blast radii.

**Done when** a link a message carries points at the stack that sent it, with whatever holds the
published metadata to the real origin written where a deploy would otherwise break it
(`docs/frontend/spec.md :: 1.7 Environment`).

### `gvyr-3nws` · Stylesheet comment blocks stand over INC-9's bound, quiet only while nobody lengthens one

| Tags                | Status   | Depends on |
| ------------------- | -------- | ---------- |
| FE, Ops, Docs, gate | Standing | —          |

**Not a defect today, and what keeps it quiet is the fork each branch measures against.**
[`docs/_standard/standard.md`](../_standard/standard.md#in-code)'s In-code Scope reaches
`fl_frontend/src/app/globals.css` by kind, and blocks in it run past INC-9's forty words.
`scripts/checks/docs_gate/branch.py :: check_comment_bounds` measures only a block the branch in hand
added a line to, and `:: _fork_ceiling` keeps one that was already over at the fork for as long as
nothing lengthens it. **The trigger is a branch that adds a word to such a block**, which then fails
on prose it did not write, its author the first person to read that block against a bound.

**How far a block runs past the bound is not the finding, and a pass driven by that is the wrong
pass.** INC-9 lets a single line's irreducible constraint stand over the bound, so a block past it
raises COR-14's questions rather than settling them: whether the block is a contract at the wrong
rung, which moves to an invariant row, and whether it constrains more than one line, which makes it
more than one constraint. Neither is answered by compression, and the runs recording a contrast
ratio or citing a WCAG criterion are the longest in the file, so a shortening pass reaches them
first. A measurement is INC-1's clearest case: nothing in the declaration beside it re-derives the
number.

**Done when** every block past the bound in that file has been read once against COR-5 and COR-14 —
each one carrying more than one constraint split to the lines it is about, the rest left standing as
INC-9 permits — so that no later branch meets that question for the first time in a red gate.

### `h4wq-p7ct` · A block carried into a file the fork does not hold is charged to the branch that only moved it

| Tags                   | Status | Depends on |
| ---------------------- | ------ | ---------- |
| Ops, Docs, gate, tests | Open   | —          |

Lands with: `bpve-vhag`, `spq6-zy2d`

**INC-9 matches a block to its earlier self by the lines the two versions share, and
`scripts/checks/docs_gate/branch.py :: check_comment_bounds` offers `:: check_comment_length` the
candidates from one path.** It passes `partial(_blob_at, fork, rel)`, so a file the branch adds has no
fork version at all, `:: _fork_ceiling` is handed an empty candidate list, and every block in that
file already over the bound is reported as one the branch wrote.
[`docs/_standard/standard.md`](../_standard/standard.md#in-code) and
[`worked-examples.md`](../_standard/worked-examples.md#a-block-over-the-bound-can-be-finished-already)
both describe the candidates as the blocks the fork held over the bound and name no path, so what is
narrow here is the implementation and not the rule.

**What it costs is the file split, not the prose.** Moving a group of cases out of a long module is
the repair available where the suite distributes over `--dist loadfile` and sends each module whole
to one worker; with the check as it stands, the region that may move is bounded by which blocks
happen to sit under the bound rather than by which cases belong together. Compressing them instead
is the repair INC-9 names as wrong, and what an over-bound docstring in a test module carries is
INC-8's own content — which case is load-bearing, and the failure the name cannot state — which
COR-5 refuses to cut.

**`bpve-vhag` is the same function failing the other way**: there one ancestor's count is handed to
every block matching it, here no ancestor is offered at all. Widening the candidate pool multiplies
that double-spend, and closing `spq6-zy2d` on its own turns a rename's silence into this entry's
charge over every block that rename carried, the fork holding the old path and not the new one —
which is why the three are settled in one pass.

**A git spawn per file is what the current shape buys, and what a widening spends.** The fork blob is
read lazily, and only for a file whose touched blocks already stand over the bound; a pool drawn from
the fork's tree pays once per run instead. Whether that pool should be the whole tree or only the
paths this branch deleted from is the decision the pass takes.

**Done when** a block carried unchanged into a file the fork does not hold keeps the ceiling it had,
and `scripts/tests/test_branch_checks.py` carries a scenario that moves an over-bound block to a path
the fork has no version of and reads the silence back.

### `hnx7-zbb9` · One field list is drift-guarded on the backend and hand-written on the frontend

| Tags                   | Status | Depends on |
| ---------------------- | ------ | ---------- |
| FE, BE, tests, saisons | Open   | —          |

**`REQ-RULES-011`'s repair is composed per moved field on the backend and enumerated by hand in the
German.** `fl_backend/app/api/saisons/services.py :: find_rules_refusal` builds its message from the
fields that actually differ, against `:: SHAPE_RULES_FIELDS`, and
`fl_backend/tests/api/test_rules_refusal.py` carries one row per field in `:: SHAPE_REPAIR_CASES` and
asserts at module level that the row's field tuple equals the imported constant, so a further shape
field fails at import rather than going untested. **That guard reaches the backend and stops there** —
nothing outside `fl_backend/` names the constant. The frontend's arm is one static string:
`fl_frontend/src/features/saisons/actions.ts`, in its `REQ-RULES-011` case, maps the repairs onto the
qualifiers and onto the group shape by hand, with a different route for each half. **It is correct
and complete for the fields that exist, and it cannot fail in the dangerous direction** — it can
never collapse to a single repair, which is the defect the backend's guard exists to catch. What it
can do is go quietly incomplete if a further shape field is ever added, naming a repair for some of
them.

**Severity is genuinely low and the entry should say so rather than inflate it.** A further shape field is
unlikely — the ones that exist are what `fl_backend/app/api/saisons/schedule.py :: schedule_for` is a function
of — and the failure is an incomplete sentence rather than a wrong instruction. **What makes it worth an entry
is the asymmetry**: one message has a structural guard on one side and none on the other, and a rule and its
German being two sites is a shape that has already reached an administrator here as a generic message with the
whole gate green.

**Nothing else already reaches it, checked rather than assumed.** Several frontend tests do read
backend declarations at test time — the per-feature `actions.test.ts` files reach
`fl_backend/app/core/domain.py` through `fl_frontend/src/core/refusalRegister.ts` — but they couple
at the level of refusal codes, not fields: `fl_frontend/src/features/saisons/actions.test.ts` asserts
that every code `PATCH /saisons/{saison_id}` declares reaches a `case` in the mapper, `REQ-RULES-011`
included, and reads nothing about what that case's message must name.

**Done when** a table in `fl_frontend/src/features/saisons/actions.test.ts` keyed by shape field is
asserted equal to the field tuple parsed out of `fl_backend/app/api/saisons/services.py`, with each
entry's German required to appear in the `REQ-RULES-011` arm — so a further field fails the frontend
suite the same day it fails nothing on the backend. **This is the concrete instance of `f4uf-jape`'s
general case**, filed separately because its fix is one assertion and that one's is a convention;
folding it in is a reasonable call and this is the half to fold.

### `ja32-9rpv` · A call site declares which key tier it sends, and nothing holds the declaration to the route it reaches

| Tags                                                  | Status | Depends on |
| ----------------------------------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, bewerbungen, kontakte, spielorte | Open   | —          |

**`fl_frontend/src/core/api.ts :: apiClient` takes the key tier as an option and defaults it to
`base`, so a call naming no `authType` is authorized as the public app.** `getFetchHeaders` puts the
base key on the request, and the actor header rides on the admin tier alone, so an omission also
sends the call unattributed.

**The omitting direction is loud.** An admin router is guarded whole by
`fl_backend/app/core/security.py :: verify_access_admin`, so a base key reaching one is refused with
`REQ-AUTH-004` and the read or the write fails outright rather than succeeding under-authorized, and
`fl_backend/tests/api/test_admin_guard.py` holds that backend half by comparing guards by identity.
**Nothing ships silently broken in this direction**: the cost of an omission is a failure an
administrator meets, not data reaching somebody it should not.

**The over-declaring direction is the silent one.** `authType: "admin"` on a call a public route
would have answered succeeds exactly as the narrower tier would, and the only differences are the
admin key on the wire and the actor header attached to a read that needed neither. Nothing reads a
call site to say its tier is wider than the route requires, and `.claude/rules/frontend.md`'s ban on
caching an admin-scoped read makes the tier a decision with consequences past authorization.

**What exists is per-slice and hand-written.** `fl_frontend/src/features/bewerbungen/queries.test.ts`
and `fl_frontend/src/features/spielorte/queries.test.ts` each assert the tier on a recorded call, and
`fl_frontend/src/features/kontakte/actions.test.ts` matches `authType:` in its own mutations source;
every other feature's queries and mutations declare their tiers with nothing reading them, measured
2026-08-28. The two audit prompts that pair the halves end to end —
`docs/_auditing/prompts/crosscut/1-contracts-and-seams.md` and
`docs/_auditing/prompts/frontend/4-security.md` — do it by reading, on a schedule.

**Done when** the decision is taken: whether a mechanical pairing is worth building against a failure
mode that is loud in one direction and, in the other, costs a wider key on a request that would have
succeeded anyway. **What makes a mechanical pairing non-trivial is that neither side publishes the
tier** — `fl_backend/openapi.json` describes one `HTTPBearer` scheme and marks an operation as
needing a bearer token or not, where which key it wants is a router-level dependency the document
does not carry — so a check would have to derive the backend half from the routers themselves and the
frontend half from the call sites, and **that derivation, not the comparison, is the work**.

### `jcpc-dee5` · Two routes sharing a path and a method collapse to one before the guard sweep reads them

| Tags      | Status | Depends on |
| --------- | ------ | ---------- |
| BE, tests | Open   | —          |

**`fl_backend/tests/api/test_admin_guard.py :: ROUTES_BY_OPERATION` maps `(path, method)` to the
route serving it, walking every mounted `APIRoute` to build it.** A dict keeps the last value
written, so where two mounted routes share that pair the later one replaces the earlier and every
case built on the mapping — the mutation sweep and the one-guard sweep alike — inspects whichever
route won. **The route that lost is never checked for a guard at all.** The key is the path with its
convertor stripped (`:: strip_convertors`), so two routes differing only in a parameter's convertor
collapse together as well.

**Nothing else in that file reports the collapse.**
`:: test_the_published_surface_and_the_mounted_routes_are_the_same_set` compares the published
operations against the mapping's keys as sets, and a collapsed pair satisfies that comparison exactly
as a single route does, the published document keying on the same pair.

**Done when** an assertion beside the mapping holds that no two mounted routes share the pair. It
needs no change to how the routers mount, no testing-only API, and it names the colliding pair at
collection time; `fl_backend/app/main.py` is untouched by it.

**The bound has to be stated rather than left to be assumed (COR-9): the nearest candidate for such a
pair is not one.** The admin single-fixture read and the public one do not collide —
`fl_backend/app/core/routing.py :: by_id` constrains the id parameter to an ObjectId so a static
segment cannot be read as an id, the admin route carries a static `/admin` after that parameter, and
`fl_backend/tests/api/test_spiele_admin_read.py :: GUARD_CASES` already proves which router answers
each of the two paths by the guard that refuses the wrong key. This entry is about the sweep's blind
spot in general, not about that route.

### `jcs8-4ste` · An in-transaction read's session argument is held to its comment by nothing

| Tags               | Status | Depends on |
| ------------------ | ------ | ---------- |
| BE, tests, saisons | Open   | —          |

**`fl_backend/app/api/saisons/admin_router.py :: judge_and_write_the_rules` opens on a read carrying
`session=session` under a comment stating why it must**: the read goes through the session, as the
draw's reads do, so that a retry after a write conflict judges the season as it stands then.
**Dropping that argument reportedly leaves the whole database tier green.** The guard is therefore
deletable by anyone, for any reason, with nothing to say so — and it is that way already rather than
by anything a branch did. **The same comment sits on four sibling reads in that file**, one per
transactional callback, each held by the same nothing.

**Why the isolation suite does not reach it.**
`fl_backend/tests/api/test_saison_patch_isolation.py :: TestADrawLandingMidPatchIsJudgedAgain` is built for
this route's retry: a hook runs a complete draw inside the update call, and `season_reads == 2` asserts the
callback judged twice rather than once. What the second judgement then refuses on is `REQ-RULES-011`, decided
by the season's fixture count, read from the fixtures collection through a call keeping its own `session=`.
**So the case proves that the retry happened and proves a refusal, and neither fact passes through the season
document's read**, which supplies `status` and `rules` while the plant moves neither.

**What the argument buys, and therefore what a case has to move.** With it, the season row is judged
from the same snapshot as the entries, fixtures, matchdays and squad rows the same judgement reads;
without it, one document in that judgement comes from outside the snapshot and the rest from inside,
so a commit landing between them is half-seen and the patch is refused, or allowed, against a season
that stood in neither state.

**Done when** a case exists that fails without the argument. **It has to move the season document
itself, between that read and the in-session ones** — a plant point the existing hook, which sits on
the update call, does not reach. Whether the case is written once for this site or once as a shape
over all five is the design question inside the entry, and writing it for this site alone leaves four
guards deletable.

**Not verified here:** the database tier was not run for this entry. That dropping the argument
leaves it green is a report; the mechanism above is what the code says would allow it.

### `jky6-k3te` · Every refusal code is written twice, and nothing resolves one spelling against the other

| Tags                | Status | Depends on |
| ------------------- | ------ | ---------- |
| BE, Ops, Docs, gate | Open   | —          |

**[`docs/logging/error-codes.md`](../logging/error-codes.md) is where a refusal code's meaning and its
HTTP status are stated, and the codes themselves are string literals in the backend** — named
constants in the `services.py` of every slice that refuses, and inline at the raise in
`fl_backend/app/core/security.py` and `fl_backend/app/core/exception_handlers.py`. It is the one
document a reader opens to learn what a code an admin surface just received means.

**Nothing resolves the two spellings.** No file under `scripts/` opens the page, and the gate's
identifier check reaches the documentation standard's own rule ids and stops:
`scripts/checks/docs_gate/checks.py :: RULE_ID_RE` is a closed alternation of the standard's
prefixes, and `v48b-waa5` records that it is closed **on purpose**, so that a backend error code —
which carries an extra segment — can never be read as a rule id. A code added, renamed or retired in
the backend and missed in the table is therefore a silent divergence, and a row for a code nothing
raises is the same divergence read from the other end. **The two sides agree today**, compared
2026-08-28, which is what makes this cheap rather than urgent — and the unwatched event is frequent,
because a branch adding a refusal adds a row by hand and nothing reads the pair.

**Done when** a set comparison runs in both directions between the codes the table's rows carry and
the codes the backend spells, hosted in `scripts/checks/check_docs.py`, which already reads both of
the trees such a check needs. `scripts/checks/docs_gate/kernel.py :: roadmap_ids` is the precedent: a
set derived from the tables defining it rather than matched by shape. **The published document is not
the second source** — measured 2026-08-28, `fl_backend/openapi.json` names seven of them, the rest
reaching a caller without an endpoint ever declaring them, so the constants under `fl_backend/app/`
are the only complete side. Every code is a whole string literal on both sides, so a comparison needs
no tolerance for a partly-spelled code; what a check reading the backend by SHAPE rather than by
declaration would have to tolerate is a glob in prose — `fl_backend/app/core/domain.py` writes
`REQ-STATE-*` inside an `Unenforced` reason, naming the pair rather than a code the table could carry
a row for.

### `kpkb-y5d8` · A refusal code's meaning is written three times in prose, and nothing resolves any pair of them

| Tags                             | Status | Depends on |
| -------------------------------- | ------ | ---------- |
| FE, BE, Docs, tests, bewerbungen | Open   | —          |

**One refusal code carries its meaning in three written statements, and no check reads any of them.**
`fl_backend/app/core/domain.py :: RULES` gives each rule a `summary`;
[`docs/logging/error-codes.md`](../logging/error-codes.md) gives each code a row stating what it
refuses and with which status; and the frontend turns the code into the German sentence an admin or
an applicant actually reads, naming it as a string literal in each slice's `actions.ts`, in
`fl_frontend/src/shared/utils/actionError.ts`, and in
`fl_frontend/src/features/bewerbungen/utils.ts` for the public application form.

**What the checks that exist do reach.** `fl_backend/tests/core/test_domain.py` resolves each rule's
`implemented_by` and `tested_by` and asserts the code appears in both; it opens no `summary`. On the
frontend the assertions are that a code maps to something at all and which field path it lands on,
`fl_frontend/src/core/refusalPaths.test.ts` holding that path to a rendered input. **Not one of them
compares a sentence with the condition the backend refuses on**, so a sentence describing a
neighbouring fact passes every test, ships, and is read by the person the refusal is for. **How close
those facts sit is recorded in the code itself**: the comment above
`fl_frontend/src/features/bewerbungen/utils.ts :: mapBewerbungSubmitRefusal`'s arm for a club already
in the season warns that a second application and a club already playing read alike and only one of
them is what the backend refused.

**No figure is quoted for how many, deliberately**: every branch that adds a refusal adds to all
three listings and has no reason to open this page, so a dated count here is stale by the branch
after the one that takes it — and the three listings named above ARE the count, each a grep from a
reader who wants it. The three sets agree today, which is what makes this a class rather than a
defect.

**Done when** the decision is taken about what a repair can reach. A check can hold the three sets
together — every rule's code takes a row, every code a surface renders takes a sentence — and that is
`jky6-k3te`'s shape extended by one side. **What it cannot do is judge a meaning**, so the rest is a
place where the three statements are read side by side and a rule about when they are re-read: a
fourth column on the table, or a generated comparison a reader walks.
`docs/_auditing/prompts/crosscut/1-contracts-and-seams.md`'s sixth check already asks a pass to trace
each error class through to the German it renders, so the reading exists and happens when a programme
runs rather than when a refusal changes. **Choosing between those is the work**, and the entry is
here rather than decided because the cheapest of them is also the one nothing enforces.

**Why this files beside `jky6-k3te` rather than widening it.** That one's repair is a set comparison
between two enumerations: complete, mechanical, and an afternoon. This one has no such form — nothing
decides whether a German sentence states the fact a predicate tests. Under one id the cheap half
would close the entry and the half that matters would leave with it. Taken in that order, a check
written for that one enumerates the codes this one needs.

### `mmcv-aa6g` · The comment-citation check reads two shapes of outside reference and INC-6 bars more

| Tags                   | Status | Depends on |
| ---------------------- | ------ | ---------- |
| Ops, Docs, gate, tests | Open   | —          |

**`scripts/checks/docs_gate/branch.py :: check_added_citations` refuses exactly two shapes, and a
pointer to a numbered ruling or to a session register's own label is neither.**
`scripts/checks/docs_gate/branch.py :: REVIEW_REF_RE` matches a session named by position — this,
last, previous or earlier, and an ordinal before review, sweep or session — while
`scripts/checks/docs_gate/branch.py :: LOOSE_ID_RE` matches a roadmap token's shape and then resolves
it against the roadmap's own table. A comment closing on a decision's number, or on the label a
programme filed it under, matches neither, passes the docs scope, and reaches a reader with no way to
resolve it.

**`docs/_standard/standard.md :: INC-6` is wider than what is caught.** It bars an audit id, a ledger
row, a roadmap id, a session and an issue number alike, on the ground that the tracker sits outside
this repository's history — and a ruling number and a register label are that same thing under other
names. Two of those members are enforced and the rest are review's, which is exactly the pair of
questions `docs/_standard/standard.md :: CUR-8` asks of the machinery: who enforces it where the gate
cannot, and when that last happened.

**A list of vocabularies is the wrong shape for the repair.** Each programme invents its own label,
so a pattern per vocabulary is a list somebody has to keep current, and the property every such
reference actually shares is that it resolves to nothing in the repository. Reading that instead — an
authority offered for a decision with no path, symbol or rule id beside it — is a population derived
independently of the property asserted, which is what `docs/_standard/standard.md :: PRE-4` asks of a
new check.

**Done when** an added comment offering an unresolvable reference as its authority fails the gate,
the check proven first against a violation planted in its real position, with its own case in
`scripts/tests/test_branch_checks.py`.

### `nce5-j467` · A comment claims two files hold the same pattern, and nothing holds them to it

| Tags          | Status | Depends on |
| ------------- | ------ | ---------- |
| FE, BE, tests | Open   | —          |

**The two ends of the wire are resolved against each other in exactly one place, and patterns are
outside it on purpose.** `fl_frontend/src/core/apiContract.test.ts` converts every exported Zod
schema to JSON Schema, pairs it with its component in the committed `fl_backend/openapi.json`, and
compares presence, required, nullable, primitive type and enum members;
`fl_frontend/src/core/apiContract.test.ts :: FieldFacts` states the boundary in terms, that patterns,
lengths, bounds and messages are deliberately not compared because the two sides diverge there by
design and comparing validation policy produces failures nobody can act on. **This entry does not
propose moving that boundary.**

**What nothing checks is a narrower claim, made in prose and legible from one side only.**
`fl_frontend/src/shared/schemas.ts` opens by stating that each schema there mirrors a constraint in
`fl_backend/app/shared/schemas/custom.py`, that looser makes the message a lie, and that a pattern is
outside the contract comparison entirely. That sentence is the whole written record of the
`PHONE_REGEX` pair, it is a comparison nothing performs, and it reads only from the frontend:
`fl_backend/app/shared/schemas/custom.py :: PHONE_REGEX` explains its own character class to whoever
edits it, and points at no twin.

**The two patterns agree today, and nothing holds them there.** They last diverged on the character
class — a literal space on one side against `\s` on the other, which in JavaScript absorbs a trailing
newline so `$` still matches — with the frontend the looser end, so the failure mode was a form
accepting a value the API answers with a 422 that nothing in the interface can explain rather than a
bad value being stored. **It survived a review, a commit body asserting the two were identical, and a
contract test that does not look at patterns.** The phone pair's blast radius is nil, since no
referee holds a phone number at all, which is exactly what would make a recurrence invisible.

**`hausnummer` is a second hand-mirrored pair, and it does not share that mercy.**
`fl_backend/app/shared/schemas/addresses.py :: HAUSNUMMER_PATTERN` and
`fl_frontend/src/shared/schemas.ts :: HAUSNUMMER_REGEX` are the two ends, each named on its own side
so the read model and the payload cannot drift within a side, and nothing compares them across the
wire. The alphabets agree today, `\d` inside a JavaScript class being `[0-9]`, but every club, venue
and referee form carries a house number, so a divergence here is visible to an admin on the first
address they type. **The prose record is weaker here than for the phone pair**: the mirroring comment
names `custom.py`, where these two ends live in `addresses.py`, so a reader following that comment
never arrives at them.

**Done when** one of three answers is taken, and they are not equivalent. **Check the declared
pairs** — a list of `(python symbol, typescript symbol)` pairs whose patterns must be byte-identical,
compared in the frontend suite that already reads across the boundary; it says nothing about the
pairs not on the list, which is what keeps it inside that boundary. **Drop the claim** — delete the
mirroring sentence, let the two ends diverge like every other validation policy, and accept the 422
as the contract; cheapest, and it gives up the one property that makes the frontend message
trustworthy. **Generate one end from the other** — refused for the mirror as a whole, and refusing it
for one constant is the same argument at a smaller scale.

### `p2y9-p9za` · Four helpers every script calls are single words no table names, so nothing holds them to `_lib.sh`

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, gate | Open   | —          |

Lands with: `s28h-m39z`

**`scripts/gate/selfcheck.sh` step 4 proves a helper by two routes, and each has a bound it states.**
The call-site reader walks every runnable script and reports every UNDERSCORED name in command
position that neither `scripts/lib/_lib.sh` nor the script itself defines; **it stops at underscored
names because a single word collides with a program name, and telling a helper from a program needs
`PATH`, which would make the verdict depend on which tools a machine has.** The vocabulary route
recovers the single-word verbs from a different source, the output-standard table in
[`docs/ops/spec.md`](../ops/spec.md) §1.7, each of whose verbs is looked up in `_lib.sh`'s
definitions. **`quietly`, `usage`, `verbose` and `worker` fall through both** — each is a single word
and the table names none of them, the sheet describing two of them in prose the step's reader never
opens and the two predicates nowhere. Every runnable script calls at least one of the four.

**What a lost definition costs differs by helper, and the two predicates are the quiet ones.**
`quietly` gone makes every `|| die` arm behind it fire with a message about the tool it wrapped —
"the stack could not be stopped", for a helper that was never there. `usage` gone fails step 5's
`--help` probe. But `verbose` and `worker` are read in conditions — `if verbose`, `if ! worker` — and
**a condition is where `set -e` and the ERR trap look away by design**: a missing definition is one
line on stderr and a false answer, and the run goes on. `--verbose` stops streaming, and a pool
worker that reads itself as the parent never reaches `scripts/lib/_lib.sh :: end_worker` and ends as
a parent would, over scopes it never ran.

**Done when** the four are named in a table step 4 reads, step 4 counts them among the documented
helpers, and a `_lib.sh` with one of them renamed fails step 4 on the branch that renamed it rather
than at a later step, a pool worker or a deploy. **Adding them to the output-standard table is the
half-honest route the entry does not take**: `DEFINED` is built from every `name()` line in `_lib.sh`
and all four are defined in that shape, but that table is one output vocabulary, one verb per
meaning, and two of the four print nothing — a reader would learn that `worker` is a way of saying
something. The remedy is a second table on the same sheet, under its own bold lead-in, for the
helpers a script leans on that are not output verbs, with step 4's reader arming on both lead-ins.
**Resolving every single-word command word against `PATH` instead is the route the reader's bound
exists to avoid, and this entry does not reopen it.**

### `q2de-43qd` · A declared-permitted state carries its reason in prose, and no checker reads it

| Tags                 | Status | Depends on |
| -------------------- | ------ | ---------- |
| BE, Ops, gate, tests | Open   | —          |

**`fl_backend/app/core/domain.py :: UNENFORCED` is the repository's record of states it permits on
purpose**, and each entry argues why in a `reason=` string — often naming an index, a validator or a
call site as the thing that makes refusing the state expensive or impossible.

**Those arguments are held by review alone.** `scripts/checks/check_docs.py` scans comments and
docstrings, and a `reason=` is neither, being a data string inside a tuple;
`fl_backend/tests/core/test_domain.py` resolves `near`, `surfaced_by` and `proven_by`, and reads
`reason` only for being non-empty — `:: test_every_declaration_carries_its_reason` asserts
`entry.reason.strip()` and never what the string claims. An index name inside one can be replaced
with a name that exists nowhere and every check still passes.

**Why it is worth closing rather than accepting.** An `UNENFORCED` entry exists to stop a later
reader re-litigating a decision, so a reason that has drifted is worse than none: it argues
confidently from something false, and the states it covers are the ones nobody revisits.

**Done when** every anchor and every index name a `reason=` mentions is resolved the way the three
neighbouring fields already are, in `fl_backend/tests/core/test_domain.py`, which already walks
`UNENFORCED` and so has both a host and a precedent.

### `qbzd-xrcu` · A scope sweep asserts against a rebuilt predicate rather than the gate's own

| Tags                   | Status | Depends on |
| ---------------------- | ------ | ---------- |
| Ops, Docs, gate, tests | Open   | —          |

**`scripts/tests/test_scope_agreement.py :: _bounded_of` rebuilds
`scripts/checks/docs_gate/branch.py :: _bounded` out of the registers that function reads**, and the
sweep walking the In-code Scope's trees for a file of a kind the gate cannot read asserts against
the rebuild rather than against the gate's own answer.

**Two guards bound the shapes it can follow silently**: the rebuild refuses a `_bounded` reading more
than one suffix register, and one selecting by tree. Neither catches a condition added to `_bounded`
that widens what it bounds — the rebuild then bounds less than the gate does, the sweep finds nothing
and passes, and a file the gate hands to the `#` reader goes unreported. Widening in the other
direction fails loudly, so the quiet half is the one to close.

**Importing it is what the constraint rules out, and not driving it.**
`scripts/tests/test_check_docs.py` runs a copy of that package under the same names, so a module
cached here would decide which of the two trees either file measures — which a subprocess leaves
alone.

**Done when** the sweep asks `_bounded` itself. `docs/_standard/standard.md`'s In-code Scope is the
other half of what this module holds together, so its own reading of the register survives whichever
route is chosen.

### `qg8u-tbd6` · One test module is named for a function and holds the cases of two others

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| FE, Docs, tests | Open   | —          |

**`fl_frontend/src/shared/hooks/focusFirstRefusal.test.ts` is named for one export of
`fl_frontend/src/shared/hooks/useServerFieldErrors.ts`**, covers that module's other exports beside
it, and then covers `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts` as well — which already
has `fl_frontend/src/shared/hooks/useDraftFieldErrors.test.ts` of its own.

**Colocation is what says where a module's tests are** ([`docs/frontend/spec.md`](../frontend/spec.md)
§1.9), and here it says the wrong thing twice: a session changing `useServerFieldErrors.ts` finds no
test file beside it and reads that as untested, and one changing `useDraftFieldErrors.ts` finds one
of its two files and stops.

**Done when** each module's cases sit in the file named for it.

### `qw6j-scru` · The style directive concedes more than the reason recorded for it needs

| Tags                | Status | Depends on |
| ------------------- | ------ | ---------- |
| FE, Ops, Docs, edge | Open   | —          |

**`nginx/prod.conf` sends `style-src 'self' 'unsafe-inline'`, and the narrower pair that serves the
same purpose is `style-src 'self'` with `style-src-attr 'unsafe-inline'`.**
[`docs/ops/spec.md`](../ops/spec.md) §1.4 records why the directive keeps the concession — a
runtime-computed inline `style` attribute, for which CSP offers neither a nonce nor a hash — and
records the narrowing as an nginx change rather than a documentation one. **What it buys** is
dropping the element half: `'unsafe-inline'` on `style-src` also admits an injected `<style>`
element, which is a real capability — exfiltration by attribute selector, and interface redress — on
a policy whose `script-src` half is already conceded and compensated by `react/no-danger`
([`docs/frontend/spec.md`](../frontend/spec.md) §1.8).

**The premise needs re-measuring before a line is written.** That section states that nothing else in
the application sets an inline style attribute.
`fl_frontend/src/shared/components/ui/FilterPanel.tsx` sets one, carrying the custom properties its
overlay's width is computed from, and the component library sets one on every portalled overlay,
react-aria's popover writing its resolved position and its trigger width as an inline style. PRE-1
puts the code above the spec sheet, so that sentence is the loser and moves in the same change
(CUR-2). **None of it changes the candidate**, because `style-src-attr 'unsafe-inline'` covers a
style attribute wherever it comes from. What it changes is the residual risk, the population under
that directive being far larger than the page implies.

**The residual risk, stated rather than hidden, and unverified here (COR-9).** The narrowing rests on
a client applying `style-src-attr` in place of `style-src` to a style attribute; where a client does
not implement the attribute directive, the fallback leaves `style-src 'self'` governing attributes as
well — and on that client every overlay loses its computed position and the toast's timer bar loses
its duration. Neither the fallback rule nor the client population has been checked at a source here,
so confirming both is the work's opening step rather than an assumption inside it. That the
prerendered HTML carries no inline `<style>` block is the spec sheet's claim rather than this entry's
measurement, and it is worth re-checking beside the one above it.

**Done when** the pair ships and the deploy is watched. An nginx change runs the gate in its full
form with the images built ([`docs/ops/spec.md`](../ops/spec.md) §1.6), and the config is mounted
read-only with nginx waiting on both upstreams being healthy — so a bad block takes the site down
rather than turning something red.

### `r5xm-ac7m` · A hook probe reads the status only where the verdict was empty

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, gate | Open   | —          |

**`scripts/gate/selfcheck.sh :: unit_probe` grades a hook by matching its stdout first**, and asks
the child's exit status only in the branch that stdout left empty. The contract it names at that
branch is that every deciding path exits 0 with JSON on stdout — so a guard printing a correct
refusal and then dying is graded by the refusal, and the crash is invisible to the one thing driving
these guards.

**The same function fails a correct answer the other way round.** The payload reaches the hook
through a pipe, under `pipefail`, and a guard can reach its verdict without reading stdin at all —
`.claude/hooks/guard-branch-bash.sh` stands down off `main` before it looks. Once a payload
outgrows the pipe buffer, the writer dies of SIGPIPE, the pipeline carries that status, and a silent
allow is reported as a crash. Nothing today comes near the buffer, so this half is latent rather
than live, and it turns live on whichever probe first carries a long command.

**Done when** the status is read whatever stdout said, and the payload reaches the hook from a file.
`scripts/gate/selfcheck.sh :: prepush_drive` already drives its own fixture that way, and records
the SIGPIPE reading as the reason.

### `s28h-m39z` · A moved vocabulary table is a skip on the next `scripts` branch, and nothing on the branch that moved it

| Tags                       | Status | Depends on |
| -------------------------- | ------ | ---------- |
| Ops, Docs, gate, ci, tests | Open   | —          |

Lands with: `p2y9-p9za`

**`scripts/gate/selfcheck.sh` step 4 reads the output vocabulary out of
[`docs/ops/spec.md`](../ops/spec.md) by shape.** Its reader arms on the line opening `**The output
standard.**`, takes the first table below it, and keeps each row whose first cell is a backticked
lowercase name. Reword the lead-in, put a paragraph between it and the table, or drop the backticks
from that column, and the reader yields nothing.

**Yielding nothing is a ledgered skip, and that grade is right.** `scripts/gate/scope_map.sh` maps
`docs/ops/spec.md` to `docs` and `format` and never to `scripts`, and
`.github/workflows/verify.yml` runs its `scripts` job only on that output, so a finding there would
redden a job the editing branch cannot run, on the next unrelated branch that selects `scripts`.

**What the right grade leaves is a report on the wrong branch.** The branch that moved the table
passes `--docs --format` with nothing said. The next branch selecting `scripts` carries a skip it did
not cause and cannot clear without editing a page outside its change. And the vocabulary arm is not a
check until somebody with a reason to open a documentation branch restores the shape — during which a
verb the sheet documents and `_lib.sh` has dropped is found by nothing.

**Done when** rewording the lead-in or un-backticking the first column of that table fails `python
scripts/checks/check_docs.py` on the branch that did it — a check in
`scripts/checks/docs_gate/checks.py`, registered in `scripts/checks/docs_gate/kernel.py :: CHECKS`,
reading the same shape — `scripts/tests/test_check_docs.py` plants both, and step 4's skip arm is
reached only by a sheet the documentation gate has already refused. **The definition half stays in
step 4**: a `scripts/lib/_lib.sh` edit selects the full form so that half already reports on its own
branch, and `scripts/checks/docs_gate/kernel.py :: defined_symbols` reads python alone, so the
documentation gate could take it only with a bash reader it has no other use for. **Two readers of
one shape is the doubt this leaves**, and what holds the awk and the python to one another is the
closing session's decision; the cheap form is the check owning the lead-in as a constant and a
`scripts/tests/` case asserting the step's reader carries the same literal.

### `spq6-zy2d` · A file that arrives as a rename brings its comment blocks in as context, so INC-9 measures none of them

| Tags      | Status | Depends on |
| --------- | ------ | ---------- |
| Ops, gate | Open   | —          |

Lands with: `bpve-vhag`, `h4wq-p7ct`

**`scripts/checks/docs_gate/branch.py :: check_comment_length` reads a block only where the branch
touched a line inside it, and a rename puts no line of a carried block in the branch's added set.**
`scripts/checks/docs_gate/branch.py :: _added_by_file` derives that set from `git diff -U0` against
the fork point, deliberately without a pathspec so git has something to detect a rename against — its
own docstring says so — and a detected rename emits hunks for the edited lines alone, so every
comment block that came across untouched is context and INC-9 measures nothing in it at any length.
Verified 2026-08-28 by replaying that parse over a commit that renamed a 27-line
component, where it yields ten added lines and the rest of the file, comments included, is context under the
new path.

**The fork-side exemption does not reach this case.** Its ground is that a branch must not be failed
for prose it did not come to change. A file the branch moved is the branch's at its new path, and no
line of a carried block is one the branch declined to touch — every line arrived with the move.

**Turning rename detection off is not the repair.** `:: _added_by_file` also feeds
`scripts/checks/docs_gate/branch.py :: branch_additions`, which `check_history_phrases` reads, so a
moved file counted as wholly added would report every history phrase inside it as the branch's own
prose.

**Done when** the narrower question is decided: whether `check_comment_length` alone should treat a
rename's destination as added while the set the other branch-scoped checks read stays as it is.

### `sqwz-xyxg` · An enforcement claim is resolved in one direction only

| Tags      | Status | Depends on |
| --------- | ------ | ---------- |
| Ops, gate | Open   | —          |

**`scripts/checks/check_docs.py :: check_enforced_by` fails a rule naming a gate check that does not
exist, and nothing resolves the opposite direction.** A rule may omit a check that enforces it, and a
rule may state something a parser can decide while its field reads that it is unenforced. **Either
shape leaves the field claiming less than the gate delivers, which is the reading nobody verifies** —
and the field is where the standard says what is mechanically defended.

**The clear instance is `anchor`.** It is emitted in the same pass as `link`, over a markdown page
and over a source comment alike, and it is what resolves the heading a link's fragment names. INC-6
names `link` and stops there; COR-6 names `citation`, `path`, `rule-id` and `line-citation` and stops
there. A reader of either rule learns that a link's target is verified and never that its anchor is.
**The clear unenforced clause is OUT-7's.** It fixes what a diagram may be, and part of that is
decidable by reading the page — a fence naming a diagram language that is not mermaid, and a `[`
inside a quoted node label — while the level clause is not decidable in general; its `Enforced by`
field claims review judgment for the whole rule, so the part a parser could settle is settled by
nobody.

**This direction cannot be closed by requiring every check to be claimed.** Most of what no rule
claims defends the gate itself rather than a rule — its own registry, its inputs, the repository's
line endings — and that is correct.

**Done when** each rule's `Enforced by` names every check that enforces it, the clauses a parser can
decide carry one, and the direction the gate does not resolve is either mechanised or written down as
deliberate. PRE-4 closes that field's vocabulary at checks, commands and linters, so a check added
for OUT-7 lands with the field that claims it.

### `srbc-6buy` · An allowlist row naming a file outside the population the check read is passed over, so an excuse stands with nothing to excuse

| Tags                   | Status | Depends on |
| ---------------------- | ------ | ---------- |
| Ops, Docs, gate, tests | Open   | —          |

**`scripts/checks/docs_gate/platform.py :: PLATFORM_ALLOW` excuses a named site from the platform
clauses, and it is held to the tree in one direction only.** Each row is keyed `<file> :: <anchor>`
and carries the reason that branch is deliberate, so writing one is a diff a reviewer reads rather
than an `if` nobody re-opens. `scripts/checks/docs_gate/platform.py :: _resolve` reports a row whose
anchor its file does not spell, and a row that shields no site — **but a row whose FILE is absent
from the population the check just read is passed over by `if rel not in present: continue`**, so a
row naming a deleted or renamed file sits inert for as long as the allowlist lives, and nothing says
so.

**What that costs is an excuse nobody can see is dead.** [`docs/ops/spec.md`](../ops/spec.md) §1.6
states without qualification that a row the tree does not bear out is itself a finding, so the corpus
reads as though the guard holds in both directions. And an inert row is worse than wasted: a file
written again at that path — a hook restored, a rename walked back — arrives already excused, with no
diff for anyone to read, which is the one thing the allowlist exists to produce.

**The rule cannot be written at this layer, and the reason is standing rather than incidental.** The gate's
own fixture suites import a copy of `scripts/` built by `scripts/tests/conftest.py :: copy_scripts`, whose
`:: IGNORED` list strips `tests` out of the copy, and each fixture plants a small corpus of its own instead of
this repository's tree. Those fixtures' drivers merge the real `PLATFORM_ALLOW` into every run, so its rows
for `scripts/tests/test_gate_pool.py` and `.githooks/pre-commit` name files the fixture trees do not hold. Any
criterion that turns such a row into a finding therefore fires inside the fixtures rather than in this
repository — absence from disk, absence from the scanned population and absence from git's index alike, and
the last two reach every row, because each fixture's copied gate sits at a path that fixture's own
`.gitignore` names.

**Done when** a row naming a file outside the population is reported the way a row with an unresolvable anchor
is; `scripts/tests/test_check_docs.py`, `scripts/tests/test_check_docs_cases.py` and
`scripts/tests/test_platform_checks.py` each run the platform check over an allowlist their own fixture can
answer for; `scripts/tests/test_platform_checks.py :: test_an_allow_row_is_held_to_the_tree_it_excuses`
asserts the new verdict; and a drive plants a row naming a file its corpus does not hold and reads the finding
back. **The repair gives up an assertion that is deliberate today**: that test asserts a row naming an absent
file is green, and the comment at `:: GIT_HOOK` records that its corpus holds `.githooks/commit-msg` rather
than a `pre-commit` precisely so the real row for the latter meets no file of that path. What that choice
exercises has to be replaced rather than dropped.

**`9r6p-z26g` moves the constraint rather than lifting it**: a copy taken from git's answer carries
`scripts/tests/` into the fixture, which changes what absence from disk reaches there and leaves what
git lists exactly as it is. Neither remedy is in the other's file.

### `srec-8jxj` · Naming the files that required the image build costs a process per file

| Tags            | Status | Depends on |
| --------------- | ------ | ---------- |
| Ops, Docs, gate | Open   | —          |

**`scripts/checks/check_scope.py :: images_culprits` runs `scripts/gate/scope_map.sh` once for every
material path**, to learn which of them is the reason the images scope is required, so the cost
scales with how many files a branch touched rather than with what is in them.

**It is the last per-file spawn in this checker, and it sits on the failure path alone.** The passing
path reads every earlier version through one `git cat-file --batch`, and answers every TypeScript
pair through as few `scripts/checks/ts_normalize.mjs` batch processes as one command line holds, both
driven from `scripts/checks/check_scope.py :: material_paths`. What is left is therefore charged only
to a run already ending in the images refusal.

**Done when** the answer costs less without changing what it says. `scripts/gate/scope_map.sh`
answers for a file list, not for a file, so nothing it prints says which member of the list turned a
scope on — asking it once per path is what buys that. The alternatives are a per-file mode in the
mapping script, which puts a second output shape in the one file every workflow reads, or halving the
list until each culprit is isolated, which is more machinery than a failure path deserves.

**What must not change.** The refusal has to keep naming the files, and keep naming all of them: an
answer that reports one culprit, or none, removes the only thing telling an author which change asked
for the image build. `.claude/CLAUDE.md` §7 holds separately that the comment classifier must never
give a CI job a way to shrink itself, so nothing here may narrow the set of paths the mapping is
asked about.

**Not measured:** what the spawn actually costs, and how much of a failing gate run is attributable
to it. The mechanism above is read from the code; the magnitude is not.

### `suuz-dged` · Frontend test modules hook their whole process, so the runner's one-process mode is closed and nothing says so

| Tags                | Status | Depends on |
| ------------------- | ------ | ---------- |
| FE, tests, versions | Open   | —          |

**`fl_frontend/package.json`'s `test` script runs Node's own test runner, which gives every test file
its own process**, and the suite counted 116 modules on 2026-09-02. The installed Node offers
`--test-isolation=none`, which runs the whole suite in one process instead — **the one lever on this
scope that removes work rather than moving it**.

**The modules that stand a double in for another module make that mode unsafe, and they do it
deliberately.** Each calls `registerHooks` from `node:module` to answer a `resolve` or a `load` for
the whole process, standing a double in for a module the code under test imports —
`fl_frontend/src/core/mail.test.ts` is the clearest, replacing `fl_frontend/src/core/config.ts` and
`fl_frontend/src/core/logging.ts` because the test script stands that config's gate down without
supplying a provider key, while the send is asserted by the header that key spells. That module also
replaces `globalThis.fetch` outright. **A hook registered for the process is
registered for every file in it**, so under one process those doubles reach modules that never asked
for them, and the replaced `fetch` is every other test's `fetch` too. **The per-test-file recorder
globals are not the obstacle**: each carries a name of its own, so no two collide.

**Done when** one of two things is chosen. Either those modules are reshaped so that a double is
installed and removed around the module that needs it — **which is a different testing style, not a
smaller one** — or the mode stays closed and a sentence somewhere says why, so the next session
reading `--test-isolation` in Node's help does not spend an afternoon discovering it. **Choosing the
second is a real answer**, and it is the cheaper one; what is wrong today is that neither has been
chosen and nothing records the constraint. What it costs is unmeasured and measuring it is half the
work — each module pays a process start, the alias hook's registration and its own TypeScript load,
all but one of which would go, and the suite already runs while the flag is one word.

### `tc3c-nudr` · Nothing validates the contents of a restored `.env`

| Tags                    | Status   | Depends on |
| ----------------------- | -------- | ---------- |
| FE, BE, Ops, Docs, edge | Standing | —          |

**Found 2026-08-01, the hard way, during a server re-clone.** `scripts/ops/deploy.sh` checks that
`fl_backend/.env`, `fl_frontend/.env`, `nginx/prod.conf` and `certs/` all **exist** before it pulls
anything, and Compose refuses to start a service whose `env_file` is missing. **Nothing checks that a
value inside those files is well-formed**, and each `.env` is gitignored — so every server restore
recreates them by hand from the password manager, unverified, and a malformed value surfaces as a
container that never becomes healthy.

**What that cost.** The restore produced a `MONGODB_URI` whose host had been truncated, most likely a
shell redirection swallowing part of the string as the file was written. Every preflight passed: file
present, key present, URI syntactically parseable. pymongo then resolved an SRV record that cannot
exist, the startup ping raised `ConfigurationError`, the backend crash-looped, nginx never started
because it waits on `service_healthy`, and the site was down until the truncation was found by
reading a stack trace.

**What the deploy already does about an unhealthy build, and why none of it reaches this.**
`scripts/ops/deploy.sh :: roll_back` restores the previous pair by image id wherever the run recorded
a target, and a re-clone records no rollback target, so there is nothing to put back; and the value
that broke is the backend's `MONGODB_URI`, which the startup gate parses no further than its scheme
(`fl_backend/app/core/config.py :: validate_mongodb_uri`), the unhealthy ending pointing the operator
at the frontend's gate (`fl_frontend/src/core/config.ts`) instead. Each bounds the window on an
ordinary bad deploy, which is the ground the trigger below stands on.

**The options, none obviously right.** Leaving it unchecked catches nothing automatically and costs
zero: the failure is loud, contained and quick to diagnose once recognised. A name-presence preflight
in `deploy.sh` catches a missing key and is small, and **would not have caught this incident** — the
key was present and merely wrong. Resolving the Mongo SRV record in `deploy.sh` before `up` catches
exactly this class plus a dead cluster, and adds a network dependency to a deploy step, so a DNS blip
becomes a refused deploy. **The trade to weigh** is that resolving the SRV record is the only option
that would have helped and it makes deployment fail for reasons unrelated to the deployment; given
the failure is already contained — nginx serves nothing rather than serving something broken — the
honest question is whether a faster diagnosis is worth a new way for `deploy.sh` to refuse.

**Trigger to revisit:** the second time a restore breaks this way, or a move to a setup where the
site cannot tolerate a restore that produces an unusable value on a host with no previous build to
fall back to. Ops audit pass O1 (`docs/_auditing/prompts/ops/1-build-deploy.md`, check 4) covers
script failure modes and owns this.

### `tnvw-4cqz` · One bash guard runs its twin's scan with no watchdog under it

| Tags | Status | Depends on |
| ---- | ------ | ---------- |
| Docs | Open   | —          |

Lands with: `g98z-k4cp`

**`.claude/hooks/guard-standard-bash.sh` carries the write-shape scan byte for byte from
`.claude/hooks/guard-branch-bash.sh`, parses its payload through node and asks git for the
repository root — and runs all of it in the hook process.** Its twin runs the same work in a child
under a kill budget and denies on anything but an answer; this one has no child, and its
registration in `.claude/settings.json` is the shorter of the two.

**The twin records at that budget that its child came close to exhausting it under full core
occupancy** — a child doing more than the shared scan, and already a duration above this hook's
whole registration. The twin also reaches its scan on `main` alone, while this guard reaches its
scan on every branch and every shell command. A hook the harness
kills prints nothing, and for a guard whose only verdict is a question, silence is the write to
`docs/_standard/standard.md` going through without one being asked.

**Done when** the asymmetry is decided either way — a child with its own budget and a refusal on
anything else, or the reason this guard needs none recorded where the twin records the opposite.
Factoring the shared scan into one file is not on the table: `.claude/CLAUDE.md` §7 keeps the two
copies deliberately.

### `ua29-4s7q` · COR-6's checks read one spelling of a citation and one of a SHA, and the rule reaches past both

| Tags      | Status | Depends on |
| --------- | ------ | ---------- |
| Ops, gate | Open   | —          |

**`scripts/checks/docs_gate/kernel.py :: BACKTICK_RE` and `:: BACKTICK_SPAN_RE` exclude a newline
from a code span, so a citation a line wrap splits matches neither.** A renderer turns the soft break
into a space, so the citation reads correctly on the page while staying invisible to `citation`,
`path` and `anchor`, which take their subjects from those two patterns and from nothing else. A
wrapped citation naming a file that has gone is as green as one naming a file that is there, and
`scripts/checks/docs_gate/checks.py :: _named_paths` misses it too, so an entry on this page whose
only path is wrapped derives no tag from it.

**`scripts/checks/docs_gate/branch.py :: PROSE_SHA_RE` reaches the backticked spelling alone, where
COR-6 bans a SHA in any form.** An unbackticked one in prose or in a comment passes untouched, and
`scripts/checks/docs_gate/branch.py :: check_prose_shas`' own docstring reads as though the check were
exhaustive: it promises every SHA and not only a dangling one, which answers the resolution question
it was written for and says nothing about which spellings it sees. A reader of that docstring stops
looking.

**Each narrowing carries an argument, and they are different arguments.** The comment beside
`:: PROSE_SHA_RE` records that the backticks are what stop a short run of hex matching inside an
action's pin or an image's `sha256:` digest — and measured over the tracked corpus on 2026-09-03, the
bodies `scripts/checks/docs_gate/kernel.py :: _scan_body` hands these checks hold neither, a pin and a
digest both being code rather than prose or comment, so a boundary-anchored pattern finds nothing
there to be wrong about. `scripts/checks/docs_gate/checks.py :: check_bare_paths` scrubs backticked
spans out of a body and then reports offsets into what is left, and the comment beside it states that
a span holding no newline is what keeps an offset on its own line, so widening the span pattern moves
every line number that check reports.

**In a comment the wrapped citation fails loudly and wrongly rather than silently.** The span
survives the scrub, so its path reaches `:: check_bare_paths`, which reports a dead one as
unbackticked — telling an author to add backticks that are already there.

**Both spellings are clean in the corpus today (2026-09-03)**, so what this buys is the guarantee
rather than a repair to make. The sibling for the unmarked spelling already exists on the path side:
INC-6 has the gate read an unbackticked path, on the ground that an unmarked path is how a dead one
survives a green gate, and nothing reads an unmarked SHA.

**Done when** each pattern's reach either matches the rule it enforces or is stated in the check's own
docstring, `:: check_bare_paths`' reported line numbers are proved unmoved by whichever route the span
pattern takes, and each spelling has driven its check red from a violation planted in a real
position.

### `uayf-u7g4` · The crawler policy is split between robots.txt and Cloudflare, and neither knows about the other

| Tags                | Status   | Depends on |
| ------------------- | -------- | ---------- |
| FE, Ops, Docs, edge | Standing | —          |

**Found 2026-08-01 while diagnosing a missing WhatsApp link preview.**
`fl_frontend/src/app/robots.ts` disallows a named list of AI crawlers, `meta-externalagent` among
them, and **that file is a request**: robots.txt is advisory and a crawler chooses whether to obey
it. Cloudflare is separately enforcing something stronger — measured against the live site on
2026-08-01, `WhatsApp/2.x`, `facebookexternalhit/1.1` and `Twitterbot/1.0` each collected 200 for a
page and for an image while `meta-externalagent/1.1` collected 403 for both, the 403 carrying
`Server: cloudflare` and a `CF-RAY` where `nginx/prod.conf` contains no user-agent or `deny` rules.
**The block is an edge setting, made in a dashboard this repository does not configure and does not
record, and it is invisible from the codebase.**

**Why it matters, and why it is not urgent.** Link previews on Meta's products are fetched by
`facebookexternalhit`, which is served normally, so nothing is broken today. The risk is
consolidation: if preview fetching ever moves behind `meta-externalagent`, every WhatsApp and
Facebook preview for this site stops working, the failure is silent, and nothing in the repository
would explain it.

**What a rework has to decide rather than assume:** whether the AI opt-out belongs in robots.txt, at
the edge, or both — and if both, which one is the source of truth when they disagree, since they
already disagree in kind, one asking and one enforcing; whether blocking an agent Meta also uses for
product features is the intended trade, the opt-out having been aimed at training rather than at
previews; and whether the edge configuration should be recorded here at all, given
[`docs/ops/overview.md`](../ops/overview.md) states that this repository does not configure
Cloudflare — a setting that can break a user-visible feature and leaves no trace in the repo being
the argument for writing it down somewhere.

**Trigger to revisit:** any Cloudflare bot-protection change, or a report of broken previews.
Re-running the measurement takes one `curl` per agent and distinguishes an edge block from a markup
problem immediately.

### `v48b-waa5` · A rule pattern in the documentation gate reaches less than the rule it enforces

| Tags      | Status   | Depends on |
| --------- | -------- | ---------- |
| Ops, gate | Standing | —          |

**Not a defect today, and the corpus is why.** Each pattern below matches everything the repository
currently holds. Each is also narrower than the rule it serves, and where it falls short the gate
answers with silence rather than a finding.

**The rule families are spelt into the patterns.** `scripts/checks/check_docs.py :: RULE_ID_RE` carries the
standard's prefixes as a closed alternation, and `scripts/checks/docs_gate/checks.py :: RULE_HEAD_RE` and
`:: RULE_INDEX_LINE_RE` repeat the same list. A rule family added under a prefix none of them carries falls
outside all of them at once: citations of its rules resolve to nothing and dangle unreported, and its rules
are not held to PRE-4's anatomy. **Widening the alternation by hand is not the answer**, because the list is
closed so that the backend's error codes — which carry an extra segment — can never be read as rule ids. A
pattern whose prefixes disagree with the standard is a divergence the gate could resolve on its own, the way
`scripts/checks/check_docs.py :: roadmap_ids` derives the roadmap's ids from the tables defining them instead
of matching a shape.

**The metadata pattern is anchored at column 0.** `scripts/checks/check_docs.py :: METADATA_LINE_RE` requires
its bold label to open the line, so `scripts/checks/check_docs.py :: check_metadata_breaks` cannot see a
metadata block nested inside a list item or a blockquote, and COR-8's hard break goes unchecked there.
`scripts/checks/check_docs.py :: RULE_FIELD_RE` is that pattern with the anchor relaxed and no check calls
it, so what it admits reaches nothing: it shows the shape an answer takes rather than being one.
**Widening the anchored pattern is not free**: this is a discovery pattern run across every page, an
indented bold label is a shape ordinary prose also takes, and a check that reports prose is a check that
gets ignored. What an answer has to find is a way to reach the indented block without reaching indented
prose.

**Trigger to revisit:** a rule family added to the standard under a prefix the patterns do not carry,
or the first page that needs a metadata block indented.

### `vspa-r35v` · One commit imports a frontend module the commit after it adds

| Tags                         | Status   | Depends on |
| ---------------------------- | -------- | ---------- |
| FE, Docs, ci, tests, saisons | Standing | —          |

**`fl_frontend/src/features/saisons/actions.test.ts` imports
`fl_frontend/src/core/refusalRegister.ts`, and one commit on `main` holds that test file without
the module**, the commit directly after it being the one that adds the module.
`git log -S refusalRegister -- fl_frontend/` names the pair, which is how this entry has to be
read: COR-6 keeps a hash out of the corpus because this history has been rewritten before and can
be again, so a hash written here would go dead with nothing saying so. TypeScript answers that specifier with `TS2307: Cannot find module
'../../core/refusalRegister.ts'`, reproduced 2026-08-26 under the resolution options
`fl_frontend/tsconfig.json` sets, and both frontend commands reach it. **Not verified by checkout** —
the tree at that commit was read rather than built, so that both commands fail there is taken from
the absent module and the diagnostic, neither having been run at it.

**One commit and one specifier, measured rather than assumed (2026-08-26).** Every relative and
`@/`-aliased specifier in each `.ts` and `.tsx` file under `fl_frontend/src` was resolved against its
own commit's tree, across a run of consecutive commits — 1850 specifiers at the last of them. That
one commit is the only one carrying an unresolved specifier, and that import is the only one it
carries.

**Nothing is red, and a red build is not the symptom to look for.**
`.github/workflows/verify.yml` triggers on `pull_request` and on a push to `main`. Both judge a
tip — the pull request's merge result, and `main` after the merge commit — and neither checks out a
commit in between, so no CI run visits it. **What it costs is a `git bisect` over the frontend**,
which lands there and answers with a failure unrelated to whatever is being hunted;
[`docs/_git/spec.md`](../_git/spec.md) §1.4 permits merge commits alone, so the commit reaches `main`
verbatim and this does not age out.

**Recognise it and skip it, which is the whole of the action.** git's documented shape for a revision
that cannot be built is exit code 125 from a `git bisect run` script, marking it untestable. The
residual is the one the manual names — skipping a commit adjacent to the culprit leaves git unable to
say which of them was first bad — and this commit's entire frontend delta being one test file is what
settles that by reading the diff. **`.git-blame-ignore-revs` does not reach it**: that file feeds
`blame.ignoreRevsFile` and moves line attribution, where the attribution here is right and is
nobody's complaint. git offers no in-repository list a bisect consults, so this entry is the whole of
the durable warning — and a bisect stands at a detached `HEAD`, so
`git show main:docs/_roadmap/items.md` is what reads this page from wherever it has stopped.

**Rewriting the history is the repair, and it was declined.** Carrying
`fl_frontend/src/core/refusalRegister.ts` one commit earlier means rewriting a pushed branch with a
pull request open against it, which moves every line a review comment is anchored to; weighed against
a bisect that skips one commit, the gap was taken — **so this entry records a decision rather than an
outstanding repair**, and the window in which the fix was cheap closed at the push.

**Trigger to revisit:** a second commit reaching `main` in this shape. One is a skip; a pattern is
the argument for a per-commit resolution check, and the sweep above is what it would be built from.

### `vy6b-ftj4` · The backend, database and frontend jobs have taken a step up in wall clock that no report named

| Tags          | Status | Depends on |
| ------------- | ------ | ---------- |
| Ops, gate, ci | Open   | —          |

**The measurement.** Read 2026-09-01 from the runs API over every `verify.yml` run on a push to main:
a job's span is its first step's start to its last step's end, and each figure is the median of the
last twelve completed runs against the twelve before them. `backend-db` moved 52.0 s to 67.5 s
(+29.8%), `backend` 32.0 s to 38.0 s (+18.8%), and `frontend` 107.0 s to 120.5 s (+12.6%).

**The reshuffle floor is what makes those three a finding rather than three numbers.** Shuffling the
same twenty-four samples at random and re-cutting them into two windows moves each median by 24.3%,
15.6% and 9.7% respectively at p95 — so a delta under that is the cut and not a change. All three sit
above their own p95, and no other job does.

**The figures are understated rather than generous.** The floor is computed from the same twenty-four
samples that contain the shift, which inflates it; and the population is successful runs only, so a
run slow enough to fail or to reach `timeout-minutes` is outside the sample entirely. **What it is
not:** these runs are GitHub-hosted, so no local machine's load reaches them; queue time is out of the
span by construction; and the direction is consistent across three independent jobs rather than one,
which a runner-pool artefact would not be.

**It has a clock, which is what makes it more than a cost entry.**
[`.github/gate-wall-clock.tsv`](../../.github/gate-wall-clock.tsv) is calibrated on a tree that
already carries the step, so until this is judged the report treats the higher figure as normal; and
the window that identifies the cause is on record now — the runs API prunes, and the candidate
commits stop being few.

**Done when** the three are attributed to one cause or three — the jobs share
`scripts/gate/verify.sh` and little else, the backend pair pointing at test count or collection time
and `frontend` at the build — and `.github/gate-wall-clock.tsv` is re-measured and rewritten, its
figures being the ones this entry says are too high.

### `w2c2-xc9j` · One tag strip repeats until it is done, and every other reader of markup as text makes a single pass

| Tags               | Status | Depends on |
| ------------------ | ------ | ---------- |
| FE, tests, saisons | Open   | —          |

**`fl_frontend/src/shared/testing/renderTest.ts :: textOf` repeats its replacement until the string
stops moving, and every other reader of markup as text in the estate makes one pass.** One pass over
`<a<b>>` leaves `<a` standing for the caller to read as text, which is the shape
`js/incomplete-multi-character-sanitization` names. The single-pass readers are
`fl_frontend/src/core/authEmail.test.ts :: readable`,
`fl_frontend/src/core/bewerbungEmail.test.ts :: readable`,
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/spielplanReplace.test.ts :: gelesen`
and
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/teamErsatz.test.ts :: gelesen`.

**No residue reaches any of them, and that is not what this asks about.** Each is handed markup its
own module rendered or built, and the email shell escapes every interpolation through
`fl_frontend/src/core/emailShell.ts :: escapeHtml` — read off the call sites rather than exercised,
so an input that defeats one of them is not established either way. What the estate holds is one
operation written in more than one shape, with nothing in the tree saying which is the answer, so
the next reader copies whichever they open first.

**One helper for all of them would be wrong.** The `readable` helpers strip `<style>` blocks and
decode entities around the tag pass, so that shape is theirs. Each `gelesen` helper is `textOf`
followed by a whitespace collapse, and can delegate.

**Done when** no reader of markup as text stops after a single pass: the helpers whose shape the
harness already serves delegate to it, and the ones it does not repeat their own strip until the
string stops moving.

### `y2bd-s7bf` · A consumer's share of the gate's concurrency is floored at one worker, so a machine smaller than the gate's demand is handed widths already measured to be slower

| Tags                 | Status | Depends on |
| -------------------- | ------ | ---------- |
| Ops, gate, ci, tests | Open   | —          |

Lands with: `3s6w-kndn`, `eg48-8863`

**`scripts/gate/verify.sh :: gate_width` divides one concurrency budget between the gate's parallel
consumers, and a consumer's share cannot fall below one worker.** Each width-taking tool declares the
width its own work was measured at — `scripts/gate/verify.sh :: GATE_WIDTH_SCRIPTS_PYTEST` at 8 for
the scripts suite and `scripts/gate/verify.sh :: GATE_WIDTH_DB_PYTEST` at 6 for the database tier —
the parent sums the ones this run enables into a demand, the budget it is divided against is the
machine's core count, and the share is `want * budget / demand` in integer arithmetic, floored at 1
and short-circuited to the declared width whenever the budget covers the demand or either quantity is
absent.

**On the development machine the short-circuit fires on every call.** Demand is 14 — those two
consumers and nothing else — against 16 cores, and no module under `scripts/tests/` names the
function at all (searched 2026-09-02). Below 14 cores the division starts answering, and its first
answers are already under both declared widths: at 8 cores a full-form run gives the scripts suite 4
and the database tier 3; at 4 cores, 2 and 1. **Those are arithmetic rather than readings** — no run
has been taken on such a machine.

**What the readings agree on is the direction the share moves in.** Measured 2026-09-02 on a shared
machine, each set an ordering and never a number to quote — the scripts pair were taken interleaved,
and the database row is a single reading per width that does not meet `eg48-8863`'s rule for a
database-tier figure — the database tier is flat between 4 and 6 workers and worse either side of
that pair, and the scripts suite is worse at 4 than at 8 by a third of its own duration. So a machine
at 8 cores is handed 4 and 3: one width on the wrong side of the readings, and the other below every
width anybody has timed.

**The defect is the floor rather than the division.** A floor of 1 encodes "any width is better than
none", which holds for a budget and fails for a test runner: below its measured minimum a run gets
slower rather than merely narrower, because a worker pays its own process start and its own
interpreter before it collects anything, and in the scripts suite its own fixture repository —
`scripts/gate/verify.sh :: do_pytest` distributes over `--dist loadfile` to keep that build to one
per module for exactly that reason. **The number belonging at the bottom of a share is that
consumer's own measured minimum.**

**Done when** each width-taking tool declares a floor beside its optimum, `gate_width` uses that
floor in place of 1, and what a consumer does when the budget cannot reach even that is decided
rather than defaulted — take the minimum anyway and let the two sections overlap into it, or leave
the pool and run in sequence at a width that works. The per-width readings the choice rests on have
to be re-taken on an idle machine under `eg48-8863`'s rule. **A fixture over `gate_width` at several
budgets is the only thing that can show the change works**, the machine it is written on never
reaching the division.

**Nothing in CI reaches any of this.** `.github/workflows/verify.yml` runs one scope per job, so the
two consumers never share a pool there and the demand a job sums is its own scope's alone — against
which a proportional share is the whole budget, which is what `-n auto` would have resolved to
anyway. The population is a local full-form run on a development machine smaller than the one this
was written on.

### `y3jf-vwrs` · The run forms a failing gate is read through are entered by no check, so either can stop reaching a verdict while the page stays green

| Tags                       | Status | Depends on |
| -------------------------- | ------ | ---------- |
| Ops, Docs, gate, ci, tests | Open   | —          |

**`scripts/gate/verify.sh` documents `--serial` and `--verbose` in its own help block, and each drops
the run to the level where a check runs in place rather than as a pooled process**
(`scripts/gate/verify.sh :: STEP_JOBS`). [`docs/ops/spec.md`](../ops/spec.md) §1.6 gives that level
its meaning — the serial form is what a pooled run's output is measured against — and §1.7 makes the
streaming form how a tool's own output is seen as it arrives rather than replayed out of a capture
afterwards.

**The level itself is exercised, and by something other than these flags.**
`scripts/tests/test_unit_replay.py` lifts `scripts/gate/verify.sh :: unit_replay` out of the file and
drives its no-pool arm; `scripts/tests/test_image_assertions.py` runs `scripts/gate/verify.sh`
through the images scope with `--serial` against a stubbed docker; and a machine with no interpreter
at the checkers' floor reaches the same level through `scripts/gate/verify.sh :: POOL_FALLBACK`. **So
what nothing enters is a flag's route into serial execution, never serial execution itself** — the
distinction that stops a session reading a fault here as a reason to rewrite the model underneath it.

**`--verbose` is entered by nothing at all.** Every fixture under `scripts/tests/` that runs a script
strips `VERBOSE` out of the environment it hands it — `scripts/tests/conftest.py` does it for the
shared fixture and each module building its own environment repeats it — and nothing sets it, so the
streaming arm of `scripts/lib/_lib.sh :: quietly` is never taken under test, and neither is the run
shape `--verbose` gives the script.

**The identity the spec attributes to a green run is asserted rather than measured.**
[`docs/ops/spec.md`](../ops/spec.md) §1.6 makes byte-identity between the serial and the pooled output
a property a green run has, and nothing under `scripts/tests/` compares the output of the forms at
all. **An oracle nobody consults is an oracle only for as long as it happens to be right.**

**The gate's own self-check reads that help block for scope flags and for nothing else.**
`scripts/gate/selfcheck.sh` compares what `scripts/gate/verify.sh :: add_scope` declares against the
flags `.github/workflows/verify.yml` hands the script in a `run:` line, so a declared scope no CI job
runs is a finding — while a documented form that is not a scope is read by no check anywhere. That is
the route by which a form named in the help text stops working with every check on the page green.

**Why it matters is when a person reaches for these forms.** They are what a section's failure sends
someone to when the captured report is hard to read, so a break in either is met at the moment the
run is least affordable to repeat, and the advice that would otherwise apply — run it again and watch
it — is the thing that is broken.

**Done when** each form runs the gate to a verdict under a check that fails when it does not, and the
identity §1.6 claims between the forms is measured rather than asserted.
`scripts/tests/test_image_assertions.py` shows what makes that affordable: a scope whose tools are
stubbed, driven through the forms, rather than a fixture paying for a real gate run.

### `z82x-us4y` · A contract sweep's caller set is every file naming the client, its own tests included

| Tags          | Status | Depends on |
| ------------- | ------ | ---------- |
| FE, BE, tests | Open   | —          |

Lands with: `f38s-y3hj`

**`fl_frontend/src/core/apiRequests.test.ts` builds its caller set by walking the source tree for
every `.ts` and `.tsx` whose text names the client**, and nothing in that walk decides a test file.
Several of the files it takes are tests, and the sweep is green only because each of them names the
client inside a string or a comment rather than calling it. Every comparison the module makes
against `fl_backend/openapi.json` reads that one set.

**A fixture calling the real client against an unpublished path would fail as though production
had**, naming a test file to a reader who then goes looking for a broken route — and a fixture
written to exercise a refusal is exactly the shape that calls an unpublished path on purpose.

**Done when** the walk decides the test files for both suffixes it collects. Deciding one suffix
where the walk takes two leaves a `.test.tsx` in the set and reads, from the code, as though the
question had been settled.

### `z9gx-tekp` · A README enumerates a suite's subjects, and the tree has moved past the list

| Tags       | Status | Depends on |
| ---------- | ------ | ---------- |
| Ops, tests | Open   | —          |

**`scripts/README.md` answers the `scripts/tests/` row's Purpose column with a prose enumeration of
what that suite covers**, and the directory holds modules the enumeration does not reach. A reader
taking the row for the suite's scope is told less than the tree holds, and the row is accurate only
while somebody keeps paying for it.

**COR-4 asks what selects a set rather than what is in it**, and an enumeration survives only where
the gate resolves every member; nothing resolves this one. Adding the missing subjects re-buys the
same debt on the next module.

**Done when** the row says what the suite is for and leaves membership to the directory, which
answers it in seconds.

### `zp4w-tg6x` · No check selects a file by the trees the In-code Scope names, and the register spelling them is held in place by its own tests

| Tags                       | Status   | Depends on |
| -------------------------- | -------- | ---------- |
| Ops, Docs, gate, ci, tests | Standing | —          |

**`scripts/checks/docs_gate/branch.py :: INCODE_SCOPES` spells six trees, and nothing in the gate
reads it to decide anything.** `:: _bounded` selects by kind alone — a suffix in
`scripts/checks/docs_gate/kernel.py :: SCANNED_SUFFIXES`, or a whole name in `:: OPS_FILENAMES` —
because a tree admits kinds the gate cannot read, and `kernel.py :: comment_style` hands an
unrecognised kind to the `#` reader, which measures a CSS id selector as a comment run.

**The two tests differ in both directions, which is what the decision turns on.** Of the 951 files
`kernel.py :: scanned_files` reaches, 849 sit under one of the six trees; two of those are markdown
READMEs the kind test leaves alone, and 35 files it does bound sit under no named tree at all —
`.github/workflows/verify.yml` and its neighbours, and `.claude/settings.json` among them. The In-code
Scope in `docs/_standard/standard.md` already states the kind as the selector and the trees as where those
files mostly sit, so the rule and the code agree; what is left over is a register naming a population
nothing selects by.

**Retiring it takes two sweeps' population with it.** `scripts/tests/test_scope_agreement.py` reads
the register three times: to compare its folders against the Scope line's, to assert every tree it
names is a path this repository holds, and to walk each tree for a file of a kind the gate does not
read and prove `_bounded` leaves that file alone. The last asserts its own population is non-empty,
so it fails loudly rather than passing over nothing — but only while there are trees to walk.
`docs/ops/spec.md` §1.5 cites the register as its example of a sweep pinned to this repository rather
than to a fixture.

**Done when** I have decided whether the register and the Scope's tree list stay, and, if they go,
what population the unread-kind sweep walks instead.
