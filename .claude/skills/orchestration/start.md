# Starting a session

Run once, in this order, before the first agent goes out. Every step is the core's planning rules
applied to the whole session.

1. Read the starter prompt's files in the order it gives, before any work.
2. Cut the session's one branch (`.claude/CLAUDE.md` §2) before the first read of the tree, and
   check that the Docker engine the database tier needs answers (`docker info` exits 0).
3. Enumerate the population from the tree by command, and tick every slice off against that listing:
   a slice nobody listed is one nobody considers. Measure duplication across the whole set in the
   same pass.
4. Build the file-ownership map from every file each slice writes, hubs and leaves marked, and name
   the couplings and shared contracts that are not file edges.
5. Fill the register's landings table from the map, with its ordering constraints.
6. Decide each slice's cycle now, with its reason, by whether a wrong result would be silent. A slice
   whose output a person looks at carries the owner's browser pass beside its rounds; that pass is
   its audit. Where the session builds a mechanism meant to change what people write — a rule set, a
   prompt, a linter — give one slice an A/B instead: the same writing task to two read-only agents,
   one given the mechanism and one denied it, both outputs read against the rules.
7. A check that reads the whole corpus runs against the real tree before it is wired into anything,
   its findings classified rather than counted.
8. Enumerate the ending in the register's ending section, so the dispatch floor has something to
   count.
9. Write the register ([register-template.md](register-template.md)) with the branch, the scratch
   path, the checkout you own and this session's id, then send the owner every question as one batch.
10. Where a stretch nobody will answer is coming, prepare it now ([unattended.md](unattended.md)).
