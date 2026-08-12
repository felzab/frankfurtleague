# ADR-0064 — The commit gate exempts one bot identity from three rules it cannot satisfy

**Status:** Accepted\
**Date:** 2026-08-10\
**Surface:** ops\
**Supersedes:** —\
**Superseded by:** —\
**Source:** My decision of 2026-08-10, taken while rebuilding the checkers after every Dependabot
pull request had arrived red on a required check.

## Context

`.github/dependabot.yml` opens grouped monthly update pull requests, and `scripts/check_commits.py`
reads a pull request's own commits in CI. The two could not both hold. Dependabot's generator wrote
a message this repository's convention refuses, in three ways at once:

- **the body was never wrapped** — the sentence introducing the update table runs past
  `scripts/check_commits.py :: LINE_MAX`, while the table's own rows are released by
  `scripts/check_commits.py :: UNWRAPPABLE` for the URLs they carry;
- **the message closed with a sign-off**, `Signed-off-by: dependabot[bot] <support@github.com>`,
  where the convention carries no trailers at all;
- **the body recorded no verification**, because a generator has nothing to record.

None of that was configurable. `.github/dependabot.yml`'s `commit-message` keys reach the subject
and stop there. So every update pull request
arrived red, and the programme that file exists for was dead: a patch reaching this repository
needed its commit rewritten by hand, on a branch Dependabot rebases on its own schedule.

The reflex fix — release anything whose author looks like a bot — is what made this a decision
rather than a repair. An author field is written by whoever writes the commit, so a test that is
one character wider than it needs to be releases the convention for anybody willing to type that
character.

## Decision

**The exemption is granted on an exact identity, and it drops three named rules.**

- **The identity is a pair, read from the commit and matched whole** — the author name and the
  author email together (`scripts/check_commits.py :: BOT_IDENTITIES`). Not a substring, not a
  domain, not either half on its own.
- **Three rules are dropped and no more:** the body's line-wrap maximum, the `Signed-off-by`
  trailer — by name in `scripts/check_commits.py :: BANNED` and by shape in
  `scripts/check_commits.py :: trailer_block` — and the verification-record advisory
  (`scripts/check_commits.py :: VERIFIED_HINT`).
- **Everything else answers for a bot as for anyone:** the subject's shape, every length tier, the
  scope vocabulary, the emoji ban, the AI-signature ban, every trailer but the sign-off, and the
  requirement that a message carry a body at all.
- **A scope Dependabot sets is in the vocabulary rather than exempt from it.** Each
  `commit-message.prefix` in `.github/dependabot.yml` is a row in
  `scripts/check_commits.py :: KNOWN_SCOPES`, so a bot's subject passes the same test as mine.
- **The exemption is never granted in the `commit-msg` hook**
  (`scripts/check_commits.py :: check_message_file`). That path runs on the machine writing the
  commit, where the author field is whatever the author set it to, and a bot does not run this
  repository's hooks.

The pull-request body's half of the same question is `scripts/check_pr_body.py :: BOT_AUTHORS`, and
ADR-0029 settled it there. The two answers differ deliberately, and the reason is below.

## Consequences

**The check cannot prove authorship, and this decision does not pretend otherwise.** A person who
sets both halves of their identity to Dependabot's pair is exempted by it. What that buys is exactly
three rules — an unwrapped body, a sign-off, and a body recording no verification. The subject's
shape, the scope vocabulary, the emoji ban and the AI-signature ban all still refuse, and the
`commit-msg` hook grants nothing, so the machine where such a commit would be written releases
none of it. The narrowness of the exemption is its whole argument, which is why it is a pair rather
than a pattern.

**A second bot is a second pair**, added deliberately. Adding one is the moment to re-read this
decision rather than to widen the match to cover both.

**A bot's message stays unwrapped in the log.** Commit bodies are this repository's record of
itself, and this admits a class of body that does not follow the form — permanently, on every merged
update. That is the price of the update programme running at all.

## Alternatives considered

**Match `[bot]` as a substring of the author name.** The common answer, and the cheapest to write.
Rejected because `user.name` is a local setting: a substring test releases anyone who types those
five characters into it, and matching half an address releases a domain. The exemption is only ever
as narrow as the thing it matches.

**Skip a bot's commits whole.** One line, and it is what the pull-request checker does on the other
surface. Rejected here because the two surfaces are not the same question. A pull request body is
written to a template that ADR-0029 says does not reach a bot at all, so there is nothing left to
check; a commit message is a permanent entry in the log, and the rules a generator satisfies
effortlessly — the subject's shape, the scope, the bans — are precisely the ones worth keeping. This
alternative also inverts the security argument, since skipping everything makes a forged author
field worth forging.

**Configure the generator instead.** Rejected because it does not exist.
`.github/dependabot.yml`'s `commit-message` keys reach the subject and stop there, and nothing in
that file addresses the body, the sign-off, or the missing verification record.

**Rewrite each bot commit by hand before merging.** Rejected: Dependabot rebases its own branches,
so a hand-written message survives until the next rebase, and the work recurs monthly per ecosystem
for as long as the programme runs.

**Drop the check in CI and keep it in the gate.** Rejected because the gate reads the branch checked
out on the machine running it, and a Dependabot branch is never checked out here. This removes the
check from the only place that can see a commit written anywhere but this machine.
