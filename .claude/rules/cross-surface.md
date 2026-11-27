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
  sentence, place them. A refusal the catalogue does not word reads the stale-page line on every
  screen (`fl_frontend/src/core/action.ts :: refused`), naming no reason; on a save it sends the
  person to read the page again, and where that page still offers the act, to meet the same refusal.
  A code for a credential the request lacked, a route or a method the API does not serve, the store
  or the server failing, or a write whose outcome is unknown refuses nothing the request asked, so
  it joins `fl_frontend/src/core/action.ts :: NOT_A_REFUSAL` instead, which reads the shared failure
  line. A code saying the record already holds an end, the one the request asked or another, refuses
  the act the request asked, so it is a refusal and never joins that set, whose shared failure line
  would send the person to repeat an act the standing end refuses. The catalogue words it unless
  only a page read before that end held can send it and that page, read again, shows the end, which
  the stale-page line sends the person to. A page a mail opens is not one: its first answer forgets
  the link in that browser (`fl_frontend/src/core/mailedLink.ts :: forgetMailedLink`), so the page
  read again there shows the link as invalid.
- A bound the backend moves without naming it in the rule's context or the refusal's bounds
  (`fl_backend/app/core/exceptions.py :: APIError`) leaves a frontend line stale in silence.
- `fl_backend/openapi.json` lists every code once and names none per endpoint, so which codes an
  endpoint answers is read from the service that raises them.
- A test invents an address, a site or a telephone number only from values set aside for it: a
  domain under `example.com`, `example.net` or `example.org`, the top-level `.example`, `.test` or
  `.invalid` (RFC 2606), `localhost` (RFC 6761), or the league's own domain; a German number inside
  a range the Bundesnetzagentur keeps for media productions, (0)69 90009 000 to 999, (0)171 39200 00
  to 99 or (0)176 040690 00 to 99. A domain anyone may register, or a number a carrier may assign,
  names a stranger in a log line, a stored row and this public repository.
