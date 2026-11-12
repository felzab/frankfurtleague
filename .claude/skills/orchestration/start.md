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
5. Write the register's landing order from the map, one ordering constraint a line.
6. Decide now, with the reason, which lenses of the session's one lens round read silently failing
   behaviour, and which of its areas change what a person sees: each of those has its board, built
   with the programme's shared board tool, which the owner reviews once. Where the session builds a
   mechanism meant to change what people write — a rule set, a prompt, a linter — run an A/B as
   well: the same writing task to two read-only agents, one given the mechanism and one denied it,
   both outputs read against the rules.
7. A check that reads the whole corpus runs against the real tree before it is wired into anything,
   its findings classified rather than counted.
8. Enumerate the ending in the register's ending section, so the dispatch floor has something to
   count.
9. Write the register ([register-template.md](register-template.md)) with the branch, the scratch
   path, the checkout you own and this session's id, then send the owner every question as one batch.
10. Read [modes.md](modes.md): the session runs at full speed, attended or not, until the owner's
    word changes its `Mode:`, and a stretch nobody will answer is prepared by `/away`.
