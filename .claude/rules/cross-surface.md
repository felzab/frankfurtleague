---
paths:
  - "fl_backend/**/*"
  - "fl_backend/**/.*"
  - "fl_frontend/**/*"
  - "fl_frontend/**/.*"
  - "scripts/**/*"
  - "scripts/**/.*"
---

# Traps — the seams between surfaces

Each fails silently. The ratified decisions for the seams are in `docs/decisions.md`.

- A backend refusal and its German are two sites: `fl_backend/app/core/codes.py :: Code` spells the
  code and a rule's `PydanticCustomError` its kind and bounds, and the catalogue words them where
  the docstrings of `fl_frontend/src/core/ruleMessage.ts :: PATTERNED`, for a field's phrase, and of
  `fl_frontend/src/core/serverCopy.ts :: SERVER_COPY`'s `refusalLine` and `ruleLine`, for a
  sentence, place them. A refusal the catalogue does not word, and its action does not catch, reads
  the stale-page line on every screen (`fl_frontend/src/core/action.ts :: refused`), naming no
  reason, save `actor_not_admin`, which reads the grant's loss (`COPY.shared.failure.accessGone`);
  on a save it sends the person to read the page again, and where that page still offers the act, to
  meet the same refusal. A code for a credential the request lacked, a route or a method the API
  does not serve, the store or the server failing, or a write whose outcome is unknown refuses
  nothing the request asked, so it joins `fl_frontend/src/core/action.ts :: NOT_A_REFUSAL` instead,
  which reads the shared failure line. A code saying the record already holds an end, the one the
  request asked or another, refuses the act the request asked, so it is a refusal and never joins
  that set, whose shared failure line would send the person to repeat an act the standing end
  refuses. An end is an answer, a decision or an erasure the record keeps. A page a mail opens has
  its action catch every such code and reach one of the page's end states, as
  `fl_frontend/src/kit/MailedPage.tsx :: MailedState` says. On every other page the catalogue words
  such a code, the end asked or another, in one sentence true on every screen whose write answers
  it; where none is, the backend splits the code, since an action's catch would word it outside the
  catalogue. On such a page the writer may leave the code to the stale-page line only where three
  hold: a save writes that end, as one landing outside a save leaves a cached page offering the act
  for the cache's lifetime (`fl_frontend/src/core/siteCache.ts :: SITE_CACHE_TAG`); no page read
  after it offers the act; and the page that sent it, read again, shows the end. A writer leaving it
  there names in its report every page that offers the act, each with the line of its source that
  hides the act once the end holds.
- A bound the backend moves without naming it where its check answers leaves a frontend line stale
  in silence: a box's bound on its `FieldFault`, a path gate's on its `Subject`, which is no fault
  (each in `fl_backend/app/core/exceptions.py`), a validator's in the rule's context; and the phrase
  or sentence wording it reads the bound it is handed rather than stating its own. A form that
  checks a bound itself before sending reads it, on the server, from the generated zod schema of the
  body's field and is handed it, since that module is server-only; or, for a constant the frontend
  states, through a `Literal` alias in `fl_backend/app/main.py :: MIRRORED_CONSTANTS` that the
  constant `satisfies`; a bound typed into the frontend any other way fails no check when the
  backend moves it.
- `fl_backend/openapi.json` lists every code once and names none per endpoint, so which codes an
  endpoint answers is read from the service that raises them.
- A test invents an address, a site or a telephone number only from values set aside for it: a
  domain under `example.com`, `example.net` or `example.org`, the top-level `.example`, `.test` or
  `.invalid` (RFC 2606), `localhost` (RFC 6761), or the league's own domain; a German number inside
  a range the Bundesnetzagentur keeps for media productions, (0)69 90009 000 to 999, (0)171 39200 00
  to 99 or (0)176 040690 00 to 99. A domain anyone may register, or a number a carrier may assign,
  names a stranger in a log line, a stored row and this public repository.
