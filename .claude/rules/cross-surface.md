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
  refuses. An end is an answer, a decision or an erasure the record keeps. A code saying the link is
  spent or lapsed is about the link, so whatever stands behind it the page reaches the link no
  longer valid (`fl_frontend/src/kit/mailedLinkState.ts :: linkInvalid`). A page a mail opens ends
  in an end state (`fl_frontend/src/kit/MailedPage.tsx :: EndState`), and its action catches a code
  saying the end the request asked already holds and reaches that end, as
  `fl_frontend/src/app/(classic)/confirm/kontakt/answerKontakt.ts :: ended` catches
  `bewerbung_seat_already_answered` and reaches the done page of the answer pressed. The end asked
  is the answer's kind, never the choices it carried: a done page names the kind alone, so it stays
  true whichever press's choices stand, and the account's entries page shows those. Where another
  end stands, the page reaches an end state naming the end that stands, read off the link's view
  where the code names neither, and worded by the catalogue, as `ended` reaches the link opened
  again (`fl_frontend/src/app/(classic)/confirm/linkView.ts :: alreadyDone`). Elsewhere the
  catalogue words every other such code, an end other than the one asked included, in one sentence
  true on every screen whose write answers it; where none is, the backend splits the code, since an
  action's catch would word it outside the catalogue. It is left to the stale-page line only where
  no page read after that end held offers the act, and the page that sent it, read again, shows the
  end; the writer leaving it there names in its report every page that offers the act, each with the
  line of its source that hides the act once the end holds. A page a mail opens never qualifies: its
  first answer forgets the link in that browser
  (`fl_frontend/src/core/mailedLink.ts :: forgetMailedLink`), so the page read again there shows the
  link as invalid.
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
