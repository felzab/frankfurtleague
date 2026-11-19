# Lens: privacy

**Question.** Do the record of processing and the published privacy notice still say what the site
does with a person's data once the change lands? Both are promises to the people the league holds
data on, and a change that collects, shows, sends, keeps or deletes data another way makes them
false with nothing failing.

**Read first.** `docs/datenschutz.md`, the record of processing and the deletion concept, and the
notice it is published as, `fl_frontend/src/app/(classic)/datenschutz/page.tsx`. Then each change
that stores, reads, shows, mails, logs, keeps or deletes a person's data.

**Checklist.**

1. Does the change collect a new datum about a person, or use a held one for a new purpose? Which
   processing activity of the record holds it, on which basis?
2. Does a page, a mail or a response now show a person's data to a reader, or in a form, that the
   record's section on what is published does not name?
3. Does an erasure still reach every store the change writes, as the record's section on erasure
   says?
4. Does a store the change adds or moves keep data past the bound the record's section on retention
   sets, and does the symbol that section names still enforce that bound?
5. Does a person's data now reach a processor or a third party the record's section on processors
   does not list: a script, a mail provider, a log sink, a hosted service?
6. Does a consent's wording, its age rule or its withdrawal differ from what the record's section on
   consent and the notice say?
7. Does each symbol the record names as performing a statement still exist and still perform it?
8. Where the change touches both, do the notice and the record still say the same?

Name each statement the change makes false by its section and the line that falsifies it. A
statement the record leaves to a Datenschutzexperte goes to the owner as a question, with no repair.

**Not its business.** Who can reach the data (`security`), whether a write leaves it consistent
(`data`), and whether the notice is sound law.

**Silent.** Yes: the record and the notice are prose no check reads against the code, and the people
they describe rely on them unseen.

**Applies.** paths `fl_backend/app/**`, `fl_frontend/src/**`, `nginx/**`, `docker-compose.yml`,
`docs/datenschutz.md` except `**/*.test.*`, `fl_frontend/src/test-support/**`.

**Run by.** auditor.
