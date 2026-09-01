"""SCRIPTS · the commit message gate and the pull request body gate.

Both decide with a regular expression, and a pattern that stops matching turns its rule off, prints
nothing and exits 0. That failure is invisible from the outside, so the coverage tests below hold
every reporting site in either checker to a case that reaches it rather than counting the cases.
"""

from __future__ import annotations

import ast
import importlib
import os
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parents[1]

# Withdrawn again, kernel dropped from the cache with it: `test_check_docs.py` runs the gate from a
# throwaway copy of scripts/, and a `checker_kernel` cached here would root its checks here too.
sys.path.insert(0, str(SCRIPTS))
try:
    commits = importlib.import_module("check_commits")
    body_gate = importlib.import_module("check_pr_body")
finally:
    sys.path.remove(str(SCRIPTS))
    sys.modules.pop("check_commits", None)
    sys.modules.pop("check_pr_body", None)
    sys.modules.pop("checker_kernel", None)

# Built rather than typed, so no byte of this file is one: the ban's own finding quotes the subject
# it found the character in.
ROBOT: Final = chr(0x1F916)

CLEAN_BODY: Final = "The four endings are executed rather than compared, and the run returned exit 0."
LONG_LINE: Final = "the gate ran and " * 8


def _subject(length: int) -> str:
    """A well-formed subject of exactly `length` characters, so a case tracks the bound it names."""
    lead = "Ops: the gate "
    return lead + "x" * (length - len(lead))


def _message(subject: str = "Ops: the gate proves its own exit contract", *paragraphs: str) -> str:
    return "\n\n".join((subject, *(paragraphs or (CLEAN_BODY,))))


# --- the cases -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Case:
    """One message and every finding it may raise, as (severity, a fragment of the detail).

    `expected` is paired one-to-one with what the checker produced, so a case that trips a second
    rule fails rather than passing on the rule it was written for.
    """

    name: str
    text: str
    expected: tuple[tuple[str, str], ...] = ()
    is_bot: bool = False


MESSAGE_CASES: Final[tuple[Case, ...]] = (
    Case("a message the convention accepts", _message()),
    Case("a subject with no scope", _message("gate proves its own exit contract"), (("fail", "subject is not"),)),
    Case("a scope nothing recorded", _message("Kitchen: the sink is replaced"), (("report", "is not in the recorded vocabulary"),)),
    # `SUBJECT_SHAPE` admits the `+` because a combined scope is real, so the vocabulary has to be
    # asked about each half rather than about the whole.
    Case("a combined scope the vocabulary holds", _message("Backend + Frontend: the two halves land together")),
    Case(
        "a combined scope with one half unrecorded",
        _message("Backend + Kitchen: the sink lands"),
        (("report", "is not in the recorded vocabulary"),),
    ),
    Case(
        "a subject past any readable length",
        _message(_subject(commits.LINE_MAX + 1)),
        (("fail", "characters - unreadable in every view"),),
    ),
    Case(
        "a subject past the truncation target",
        _message(_subject(commits.SUBJECT_TARGET + 1)),
        (("report", "GitHub truncates a title at"),),
    ),
    Case("a subject ending in a period", _message("Ops: the gate proves its own exit contract."), (("fail", "subject ends in a period"),)),
    Case(
        "a second line that is not blank",
        "Ops: the gate proves it\nstraight into the body\n\n" + CLEAN_BODY,
        (("fail", "line 2 is not blank"),),
    ),
    Case("a message with no body at all", "Ops: the gate proves its own exit contract", (("fail", "no body"),)),
    Case("a body paragraph nobody wrapped", _message("Ops: the gate proves it", LONG_LINE), (("fail", "the paragraph was never wrapped"),)),
    # One long unbroken token is a URL or a path, and wrapping it would break it.
    Case("a body line nothing could wrap", _message("Ops: the gate proves it", CLEAN_BODY + "\nhttps://example.com/" + "x" * 90)),
    Case(
        "a body recording no verification",
        _message("Ops: the gate proves it", "The two halves land together and the table now has a row for each."),
        (("report", "the body records no verification"),),
    ),
    Case(
        "a Co-authored-by trailer",
        _message("Ops: the gate proves it", CLEAN_BODY, "Co-authored-by: Someone <someone@example.com>"),
        (("fail", "a Co-authored-by trailer"),),
    ),
    Case(
        "a Signed-off-by trailer from a person",
        _message("Ops: the gate proves it", CLEAN_BODY, "Signed-off-by: Someone <someone@example.com>"),
        (("fail", "a Signed-off-by trailer"),),
    ),
    Case(
        "an AI-authorship signature",
        _message("Ops: the gate proves it", CLEAN_BODY, "Generated with [Claude Code](https://claude.com/claude-code)"),
        (("fail", "an AI-authorship signature"),),
    ),
    Case(
        "an issue-closing keyword",
        _message("Ops: the gate proves it", "The change closes #12, and the run returned exit 0."),
        (("fail", "an issue-closing keyword"),),
    ),
    Case(
        "a trailer block the convention does not carry",
        _message("Ops: the gate proves it", CLEAN_BODY, "Refs-Item: OPS-1"),
        (("fail", "the convention carries no trailers"),),
    ),
    Case("an emoji anywhere in the message", _message("Ops: the gate proves it", CLEAN_BODY + " " + ROBOT), (("fail", "an emoji"),)),
    # A revert's subject is git's, so its shape and its length are excused and nothing else is --
    # which only holds while the body half of the pair is read too.
    Case("a revert git composed", _message('Revert "Ops: the gate proves it"', "This reverts commit abc1234def.")),
    Case(
        "a revert-shaped subject with no revert body",
        _message('Revert "Ops: the gate proves it"', CLEAN_BODY),
        (("fail", "subject is not"),),
    ),
    # The bot exemption drops the sign-off alone, that being the one thing dependabot's generator
    # cannot leave out. The same message from a person keeps every rule.
    Case(
        "a bot signing off",
        _message("Backend deps: bump httpx from 1.0 to 1.1", "Bumps httpx.", "Signed-off-by: dependabot[bot] <support@github.com>"),
        is_bot=True,
    ),
    Case(
        "the same message from a person",
        _message("Backend deps: bump httpx from 1.0 to 1.1", "Bumps httpx.", "Signed-off-by: dependabot[bot] <support@github.com>"),
        (("fail", "a Signed-off-by trailer"), ("report", "the body records no verification")),
    ),
    Case(
        "a bot carrying a Co-authored-by trailer",
        _message("Backend deps: bump httpx from 1.0 to 1.1", "Bumps httpx.", "Co-authored-by: Someone <someone@example.com>"),
        (("fail", "a Co-authored-by trailer"),),
        is_bot=True,
    ),
)


CLEAN_PR_BODY: Final = (
    "The branch proves the gate's own exit contract.\n\n**Verified** `./scripts/verify.sh --scripts --docs --format`, exit 0.\n"
)


def _pr_body(*extra: str) -> str:
    return CLEAN_PR_BODY + "\n" + "\n".join(extra)


@dataclass(frozen=True)
class BodyCase:
    """One pull request body, the findings it may raise, and the login GitHub reports as its author."""

    name: str
    text: str
    expected: tuple[tuple[str, str], ...] = ()
    author: str = ""


BODY_CASES: Final[tuple[BodyCase, ...]] = (
    BodyCase("a body the form accepts", CLEAN_PR_BODY),
    BodyCase("an empty body", "", (("fail", "the body is empty"),)),
    BodyCase("a body of whitespace", "   \n\n  \n", (("fail", "the body is empty"),)),
    BodyCase("a body with no Verified paragraph", "The branch proves the gate's own exit contract.\n", (("fail", "no Verified paragraph"),)),
    BodyCase(
        "a body indexing its own commits",
        _pr_body("- `abc1234` the first", "- `bcd2345` the second", "- `cde3456` the third"),
        (("fail", "it never indexes its commits"),),
    ),
    BodyCase(
        "a summary past any reading of two paragraphs",
        "word " * (body_gate.SUMMARY_MAX + 1) + "\n\n**Verified** exit 0.\n",
        (("fail", "past any reading of"),),
    ),
    # The summary is what sits above the form's first named section, so prose below one is not
    # measured however long it runs.
    BodyCase("a long body under a short summary", _pr_body(*["word " * 20] * 15)),
    BodyCase(
        "a summary past the target",
        "word " * (body_gate.SUMMARY_TARGET + 1) + "\n\n**Verified** exit 0.\n",
        (("report", "the form asks for one or two paragraphs"),),
    ),
    # The pull request half of the same exemption as `check_commits.py :: BOT_IDENTITIES`: a
    # generated body is refused by every rule here and by none of them once the author is a bot.
    BodyCase("a bot's body", "Bumps httpx from 1.0 to 1.1.\n", author=min(body_gate.BOT_AUTHORS)),
) + tuple(
    # One case per template fragment, generated from the tuple itself: a fragment added by hand and
    # covered by hand is a fragment that can be added and not covered.
    BodyCase(f"the template fragment {index}", _pr_body(fragment), (("fail", "the template's own placeholder prose"),))
    for index, fragment in enumerate(body_gate.TEMPLATE_FRAGMENTS)
)


# --- matching what a case declares against what a checker produced ----------------------------------


@dataclass
class Outcome:
    """What one case actually produced, kept so the coverage tests re-read it rather than re-running."""

    produced: list[tuple[str, str]] = field(default_factory=list)
    mismatches: list[str] = field(default_factory=list)


def _match(name: str, expected: tuple[tuple[str, str], ...], produced: list[tuple[str, str]]) -> Outcome:
    """Pair each declared fragment with one finding, and report anything left over on either side."""
    outcome = Outcome(produced=list(produced))
    unpaired = list(produced)
    for severity, fragment in expected:
        hit = next((row for row in unpaired if row[0] == severity and fragment in row[1]), None)
        if hit is None:
            outcome.mismatches.append(f"{name}: nothing raised a {severity} saying {fragment!r}")
        else:
            unpaired.remove(hit)
    outcome.mismatches += [f"{name}: raised an undeclared {severity}: {detail}" for severity, detail in unpaired]
    return outcome


def _message_outcomes() -> dict[str, Outcome]:
    return {
        case.name: _match(
            case.name,
            case.expected,
            [(finding.severity, finding.detail) for finding in commits.check_message(case.text, "0000000", is_bot=case.is_bot)],
        )
        for case in MESSAGE_CASES
    }


def _body_outcomes() -> dict[str, Outcome]:
    return {
        case.name: _match(
            case.name, case.expected, [(finding.severity, finding.detail) for finding in body_gate.check_body(case.text, case.author)]
        )
        for case in BODY_CASES
    }


# --- the reporting sites, read out of the source ----------------------------------------------------


def _longest_literal(node: ast.expr) -> str:
    """A message expression's longest literal run, which is its identity whatever it interpolates."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return max((part.value for part in node.values if isinstance(part, ast.Constant) and isinstance(part.value, str)), key=len, default="")
    return ""


def _function(module: str, name: str) -> ast.FunctionDef:
    source = (SCRIPTS / module).read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{module} no longer defines {name}")


def _sites(module: str, function: str, callee: tuple[str, ...], severity_arg: int) -> set[tuple[str, str]]:
    """Every place `function` records a finding, as (severity, the literal that identifies it).

    Read out of the source because the details are interpolated: a site nothing reaches is a rule
    switched off, and only the source knows how many there are.
    """
    found: set[tuple[str, str]] = set()
    for node in ast.walk(_function(module, function)):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in callee):
            continue
        # Either the callee names the severity (`fail`, `report`) or an argument spells it, which is
        # what the negative index selects between.
        severity = node.func.id if severity_arg < 0 else _longest_literal(node.args[severity_arg])
        found.add((severity, _longest_literal(node.args[severity_arg + 1])))
    return found


def _resolve(severity: str, detail: str, sites: set[tuple[str, str]]) -> tuple[str, str] | None:
    """The site a finding came from -- the longest literal of that severity the detail carries."""
    hits = [site for site in sites if site[0] == severity and site[1] in detail]
    return max(hits, key=lambda site: len(site[1])) if hits else None


# --- the tests -------------------------------------------------------------------------------------


def test_every_commit_message_case_raises_exactly_what_it_declares() -> None:
    """A message written for one rule that trips a second is a case proving the wrong thing."""
    wrong = [line for outcome in _message_outcomes().values() for line in outcome.mismatches]
    assert not wrong, "\n".join(wrong)


def test_every_pull_request_body_case_raises_exactly_what_it_declares() -> None:
    wrong = [line for outcome in _body_outcomes().values() for line in outcome.mismatches]
    assert not wrong, "\n".join(wrong)


def test_a_combined_scope_no_longer_draws_the_vocabulary_advisory() -> None:
    """Every component is resolved on its own, so a scope the vocabulary holds twice over is silent."""
    assert not commits.unknown_scope("Backend + Frontend: the two halves land together")
    assert not commits.unknown_scope("Backend + Frontend + Docs: three of them")
    assert not commits.unknown_scope("Backend deps: bump httpx")
    assert commits.unknown_scope("Kitchen: the sink is replaced")
    assert commits.unknown_scope("Backend + Kitchen: the sink lands")


def test_the_guarded_vocabularies_are_not_empty() -> None:
    """An emptied tuple makes both the rule and every loop over it iterate nothing and pass."""
    assert commits.BANNED
    assert commits.KNOWN_SCOPES
    assert body_gate.TEMPLATE_FRAGMENTS
    assert body_gate.BOT_AUTHORS
    assert commits.BOT_IDENTITIES


def test_every_reporting_site_in_either_checker_is_reached_by_a_case() -> None:
    """A site nothing reaches is a rule that can stop matching in silence, which is the whole failure mode."""
    for module, function, callee, severity_arg, outcomes in (
        ("check_commits.py", "check_message", ("fail", "report"), -1, _message_outcomes()),
        ("check_pr_body.py", "check_body", ("Finding",), 0, _body_outcomes()),
    ):
        sites = _sites(module, function, callee, severity_arg)
        assert sites, f"{module} :: {function} records no finding at all"
        assert all(literal for _, literal in sites), f"{module} :: {function} has a site with no literal to identify it by"
        reached = {
            site
            for outcome in outcomes.values()
            for severity, detail in outcome.produced
            if (site := _resolve(severity, detail, sites)) is not None
        }
        assert reached == sites, f"{module} :: {function} sites no case reaches: {sorted(sites - reached)}"


def test_every_banned_pattern_and_template_fragment_is_named_by_a_case() -> None:
    """The vocabularies are data, so a row added to either without a case would look covered."""
    said = [detail for outcome in _message_outcomes().values() for _, detail in outcome.produced]
    unnamed = [what for _, what, _ in commits.BANNED if not any(what in detail for detail in said)]
    assert not unnamed, f"no case trips: {unnamed}"
    bodies = [case.text for case in BODY_CASES]
    missing = [fragment for fragment in body_gate.TEMPLATE_FRAGMENTS if not any(fragment in text for text in bodies)]
    assert not missing, f"no case plants: {missing}"


def test_the_bot_exemption_drops_the_sign_off_and_nothing_else() -> None:
    """Every other banned pattern still binds a bot, which is what keeps the exemption from being a way past the convention."""
    still_binding = [what for _, what, binds_a_bot in commits.BANNED if binds_a_bot]
    assert len(still_binding) == len(commits.BANNED) - 1
    assert "a Signed-off-by trailer" not in still_binding


# --- the outer layer: what git hands the rules, and what the hook hands them ------------------------

# The gate resolves a bot by the AUTHOR pair git records, so the layer above `check_message` needs a
# repository with real commits in it. Nothing below writes to this one's own.


def _run_git(root: Path, *args: str, author: tuple[str, str] | None = None) -> str:
    environment = dict(os.environ)
    if author is not None:
        for role in ("AUTHOR", "COMMITTER"):
            environment["GIT_" + role + "_NAME"], environment["GIT_" + role + "_EMAIL"] = author
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", env=environment, check=False)
    if done.returncode != 0:
        raise RuntimeError("git " + " ".join(args) + " failed: " + (done.stderr.strip() or done.stdout.strip()))
    return done.stdout.strip()


def _fixture_repository(root: Path) -> None:
    """A repository with nothing inherited: no signing key, no hooks path, no ident from the machine."""
    _run_git(root, "init", "-q", "-b", "main")
    for key, value in (("user.name", "A Person"), ("user.email", "person@example.com"), ("commit.gpgsign", "false"), ("core.hooksPath", "")):
        _run_git(root, "config", key, value)


def _commit(root: Path, message: str, author: tuple[str, str]) -> str:
    """An empty commit: the subject under test is the message and the ident, and a diff decides neither."""
    _run_git(root, "commit", "-q", "--allow-empty", "-m", message, author=author)
    return _run_git(root, "rev-parse", "HEAD")


@contextmanager
def _rooted_at(root: Path) -> Iterator[None]:
    """The checker's repository root pointed at a fixture.

    `git` is the kernel's, and it reads REPO_ROOT out of the kernel's own globals at each call, so
    the function object is the handle: the module itself was withdrawn from the cache at import.
    """
    globals_ = commits.git.__globals__
    real = globals_["REPO_ROOT"]
    globals_["REPO_ROOT"] = root
    try:
        yield
    finally:
        globals_["REPO_ROOT"] = real


SIGNED_OFF: Final = "Ops: bump the pinned action" + chr(10) * 2 + CLEAN_BODY + chr(10) * 2 + "Signed-off-by: A Bot <bot@example.com>"


def test_a_bot_is_resolved_by_the_exact_pair_git_recorded() -> None:
    """Every row of the register is driven, and so is a near miss on each half: half an address would release a domain."""
    wrong: list[str] = []
    with tempfile.TemporaryDirectory() as scratch:
        root = Path(scratch)
        _fixture_repository(root)
        for name, email in sorted(commits.BOT_IDENTITIES):
            cases = (
                ("the pair itself", (name, email), False),
                ("its name beside another address", (name, "someone@example.com"), True),
                ("its address under another name", ("A Person", email), True),
            )
            for what, author, refused in cases:
                sha = _commit(root, SIGNED_OFF, author)
                with _rooted_at(root):
                    found = [finding.detail for finding in commits.check_commit(sha)]
                signed = [detail for detail in found if "Signed-off-by" in detail]
                if bool(signed) is not refused:
                    wrong.append(f"{name}: {what} gave {signed or 'no finding'}, and the exemption {'binds' if refused else 'releases'} it")
    assert not wrong, chr(10).join(wrong)


def test_a_commit_git_will_not_read_is_failed_rather_than_skipped() -> None:
    """A message nothing read is indistinguishable from a clean one, so the unread commit is the finding."""
    with tempfile.TemporaryDirectory() as scratch:
        root = Path(scratch)
        _fixture_repository(root)
        _commit(root, _message(), ("A Person", "person@example.com"))
        with _rooted_at(root):
            found = commits.check_commit("0" * 40)
    assert len(found) == 1, found
    assert "never judged" in found[0].detail, found[0].detail


def test_the_hook_reads_the_message_git_has_yet_to_strip() -> None:
    """git strips its comment block only AFTER this hook runs, so an unstripped line is what the rules would judge.

    The planted line is past the body's hard maximum: a comment breaking no rule passes whether
    it is stripped or not, which decides nothing.
    """
    with tempfile.TemporaryDirectory() as scratch:
        root = Path(scratch)
        _fixture_repository(root)
        path = root / "COMMIT_EDITMSG"
        with _rooted_at(root):
            explain = "Lines starting with it are ignored, and an empty message aborts the commit."
            commented = f"{commits.comment_char()} Please enter the commit message for your changes. {explain}"
            assert len(commented) > commits.LINE_MAX, "the planted comment breaks no rule, so stripping it decides nothing"
            path.write_text(_message() + chr(10) + commented + chr(10), encoding="utf-8", newline=chr(10))
            clean = commits.check_message_file(path)
            path.write_text("no scope here." + chr(10) * 2 + CLEAN_BODY + chr(10), encoding="utf-8", newline=chr(10))
            refused = commits.check_message_file(path)
    assert clean == 0, "a clean message was refused, so the comment block reached the rules"
    assert refused == 1, refused


def test_a_message_git_is_composing_is_not_the_author_s_to_answer_for() -> None:
    """A merge or a revert leaves the ref behind, which is what parts it from anyone typing the same subject."""
    with tempfile.TemporaryDirectory() as scratch:
        root = Path(scratch)
        _fixture_repository(root)
        first = _commit(root, _message(), ("A Person", "person@example.com"))
        with _rooted_at(root):
            assert not commits.git_is_composing()
            (root / ".git" / "MERGE_HEAD").write_text(first + chr(10), encoding="utf-8", newline=chr(10))
            assert commits.git_is_composing()
            path = root / "COMMIT_EDITMSG"
            path.write_text("no scope here." + chr(10), encoding="utf-8", newline=chr(10))
            assert commits.check_message_file(path) == 0, "a message git wrote was judged as an author's"


def test_the_comment_marker_is_git_s_own_answer() -> None:
    """`auto` picks per message and cannot be resolved here, so it has to read as the default rather than as the word."""
    with tempfile.TemporaryDirectory() as scratch:
        root = Path(scratch)
        _fixture_repository(root)
        with _rooted_at(root):
            assert commits.comment_char() == "#"
            _run_git(root, "config", "core.commentChar", ";")
            assert commits.comment_char() == ";"
            _run_git(root, "config", "core.commentChar", "auto")
            assert commits.comment_char() == "#"


def test_a_branch_with_no_commits_is_parted_from_a_listing_git_refused() -> None:
    """None is not an empty list: a refused listing is every message on the branch passing unread."""
    with tempfile.TemporaryDirectory() as scratch:
        root = Path(scratch)
        _fixture_repository(root)
        _commit(root, _message(), ("A Person", "person@example.com"))
        with _rooted_at(root):
            assert commits.branch_commits("HEAD") == []
            assert commits.branch_commits("no-such-ref") is None
