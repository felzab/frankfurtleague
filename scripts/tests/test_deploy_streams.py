"""SCRIPTS · what `scripts/ops/deploy.sh` copies and reads around a container's recreate.

`--force-recreate` discards a container's `json-file` stream and a failed deploy recreates the
application pair twice, so `:: copy_streams` runs on both paths -- refusing where nothing has been
recreated yet, and warning inside `:: roll_back`, where the site is already down and a log file is
not worth leaving it there. `:: check_env_names` and `:: check_env_names_held_once` read the
environment files before the recreate, the one place they are files, and print names alone.
`scripts/lib/_lib.sh :: wait_healthy`, sourced whole, is the read after it.
Each is driven behind a stand-in `docker`, so no daemon and no compose file of this machine; the
snippet that reader hands the image is run for real instead, because a stub records an argv and
answers nothing about what the image does.

Invariants:
  Nothing here reads or writes a real environment file: the fixture builds its own, of dummy names.
  Every case runs from the fixture's checkout: `_lib.sh` cd's to this repository on source.
"""

from __future__ import annotations

import os
import re
import shlex
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, base_env, lift_assignment, lift_function, new_root, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
REPO_ROOT: Final = SCRIPTS.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
DEPLOY: Final = SCRIPTS / "ops" / "deploy.sh"
LOCAL: Final = SCRIPTS / "ops" / "local.sh"
RUNBOOKS: Final = REPO_ROOT / "docs" / "ops" / "runbooks.md"


STAMP: Final = "2026-09-07T101500"

# `ps` and `logs` are steered by a service-name list in the environment. `run` and `ps` record their
# argv, the whole of what the mount, the user and the compose file are asserted from; `inspect`
# answers every container healthy.
STUB: Final = """#!/usr/bin/env bash
set -u
last=""
for arg in "$@"; do last="$arg"; done
# `run` answers as `docker run` does, and records what its container was handed: its stdin, and
# whether Git Bash was told to leave its arguments alone. Read off the subcommand's position, since
# a snippet in the argv may spell any word.
if [[ "${1:-}" == "compose" && " ${*:2:3} " == *" run "* ]]; then
  printf '%s\\n' "$@" > "${FL_DEPLOY_ARGV}"
  cat > "${FL_DEPLOY_ARGV}.stdin"
  printf '%s' "${MSYS_NO_PATHCONV-unset}" > "${FL_DEPLOY_ARGV}.pathconv"
  if [[ -n "${FL_DEPLOY_RUN_SAYS:-}" ]]; then printf '%s\\n' "${FL_DEPLOY_RUN_SAYS}" >&2; fi
  exit "${FL_DEPLOY_RUN_RC:-0}"
fi
if [[ "${1:-}" == "compose" ]]; then
  case " $* " in
    *" ps "*)
      printf '%s\\n' "$@" > "${FL_DEPLOY_PS_ARGV}"
      case ":${FL_DEPLOY_NO_CONTAINER:-}:" in *":${last}:"*) exit 0 ;; esac
      printf 'cid-%s\\n' "$last"; exit 0 ;;
    *" logs "*)
      case ":${FL_DEPLOY_LOGS_FAIL:-}:" in *":${last}:"*) exit "${FL_DEPLOY_LOGS_RC:-1}" ;; esac
      printf '%s line one\\n%s line two\\n' "$last" "$last"; exit 0 ;;
    *" config "*)
      printf '%s\\n' "$@" > "${FL_DEPLOY_ARGV}"
      # On BOTH streams: without --quiet this subcommand prints the resolved configuration, every
      # value in both environment files with it, so a case proving none of it reaches the operator
      # covers stdout too.
      if [[ -n "${FL_DEPLOY_CONFIG_SAYS:-}" ]]; then
        printf '%s\\n' "${FL_DEPLOY_CONFIG_SAYS}"
        printf '%s\\n' "${FL_DEPLOY_CONFIG_SAYS}" >&2
      fi
      exit "${FL_DEPLOY_CONFIG_RC:-0}" ;;
  esac
  exit 0
fi
if [[ "${1:-}" == "inspect" ]]; then printf 'healthy\\n'; exit 0; fi
if [[ "${1:-}" == "run" ]]; then
  printf '%s\\n' "$@" > "${FL_DEPLOY_ARGV}"
  if [[ -n "${FL_DEPLOY_RUN_SAYS:-}" ]]; then printf '%s\\n' "${FL_DEPLOY_RUN_SAYS}" >&2; fi
  exit "${FL_DEPLOY_RUN_RC:-0}"
fi
exit 0
"""


def _lifted(name: str) -> str:
    return lift_function(DEPLOY, name)


def _assignment(name: str) -> str:
    return lift_assignment(DEPLOY, name)


# Every assignment the environment readers build their containers from.
ENV_ASSIGNMENTS: Final = ("SHARED_ENV", "ENV_MOUNTS", "ENV_UNION_DIR", "ENV_UNION_BUILD", "ENV_NAME_CHECK", "ENV_OVERLAP_CHECK")


class _Fixture:
    """The temporary checkout one case drives the lifted functions inside."""

    def __init__(self) -> None:
        self.root = new_root("fl-deploy-streams-")
        self.logs = self.root / "logs"
        self.logs.mkdir(parents=True)
        self.checkout = self.root / "checkout" / "fl_backend"
        self.checkout.mkdir(parents=True)
        # The fixture's own environment file, of names nothing declares: every assertion below reads
        # the arguments the mount was built from, and none reads a file.
        (self.checkout / ".env").write_bytes(b"A_NAME_NOTHING_DECLARES=a value no case reads\n")
        self.argv = self.root / "argv.txt"
        self.ps_argv = self.root / "ps-argv.txt"


def _run(body: str, **overrides: str) -> tuple[int, str, _Fixture]:
    """`_lib.sh`, the lifted readers and a stand-in `docker`, run from a checkout of the fixture's own."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    fixture = _Fixture()
    stubs = fixture.root / "stubs"
    stubs.mkdir()
    # The execute bit is what puts this ahead of a real daemon on PATH.
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    environment = base_env()
    # The key check reads it over the mount path, so a caller's own would decide every key case.
    environment.pop("ACTOR_SIGNING_KEY_FILE", None)
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    environment["FL_DEPLOY_ARGV"] = str(fixture.argv)
    environment["FL_DEPLOY_PS_ARGV"] = str(fixture.ps_argv)
    environment.update(overrides)
    script = fixture.root / "parent.sh"
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        # `_lib.sh` cd's to THIS repository's root as it is sourced, so without this line the
        # fixture's checkout is never entered: `check_env_names` would build its mount from the real
        # tree, and the snippet cases below would read the real `fl_backend/.env`.
        f'cd "{fixture.checkout.parent.as_posix()}"',
        'COMPOSE="docker-compose.yml"',
        f'LOG_DIR="{fixture.logs.as_posix()}"',
        f'LOG_STAMP="{STAMP}"',
        "COPIED_STREAMS=0",
        "ATTEMPTED_STREAMS=0",
        'IMAGE_BACKEND="backend-image"',
        *(_assignment(name) for name in ENV_ASSIGNMENTS),
        _lifted("service_cid"),
        _lifted("check_compose_config"),
        _lifted("copy_streams"),
        _lifted("read_env_names"),
        _lifted("check_env_names"),
        _lifted("check_env_names_held_once"),
        body,
        "",
    )
    done = run_shell(BASH, write_shell(script, "\n".join(lines)), env=environment, cwd=fixture.checkout.parent)
    return done.returncode, done.stdout + done.stderr, fixture


def _copies(fixture: _Fixture) -> list[str]:
    return sorted(path.name for path in fixture.logs.iterdir())


# --- the copy taken before each recreate -------------------------------------------------------------

COUNTS: Final = 'printf "copied=%s attempted=%s\\n" "$COPIED_STREAMS" "$ATTEMPTED_STREAMS"'
BEFORE: Final = f'copy_streams "" refuse "NOTHING has been recreated." ; {COUNTS}'
FAILED: Final = f'copy_streams "-failed" warn "The rollback goes on without it." ; {COUNTS}'


def test_the_copy_before_the_recreate_names_one_file_per_running_service() -> None:
    code, output, fixture = _run(BEFORE)

    assert code == 0, output
    assert "copied=2" in output, output
    assert _copies(fixture) == [f"{STAMP}-backend.log", f"{STAMP}-frontend.log"], output


def test_a_service_with_no_container_is_skipped_rather_than_written_empty() -> None:
    """A first deploy has nothing to copy, and an empty file would read as a build that logged nothing."""
    code, output, fixture = _run(BEFORE, FL_DEPLOY_NO_CONTAINER="frontend:backend")

    assert code == 0, output
    assert "copied=0" in output, output
    assert _copies(fixture) == [], output


def test_the_rollbacks_copy_carries_the_suffix_beside_the_same_stamp() -> None:
    """One stamp for the run: a failed deploy leaves four files that sort together, not two pairs a reader has to match up."""
    code, output, fixture = _run(FAILED)

    assert code == 0, output
    assert _copies(fixture) == [f"{STAMP}-backend-failed.log", f"{STAMP}-frontend-failed.log"], output


def test_the_age_sweep_bounds_the_directory_rather_than_a_name_the_suffix_leaves() -> None:
    """The `-failed` names are only bounded while `docs/ops/runbooks.md` §7's tmpfiles line has no glob in it.

    A `*.log` pattern would leave them forever.
    """
    stanza = RUNBOOKS.read_text(encoding="utf-8")
    aged = [line for line in stanza.splitlines() if line.startswith("e /var/log/frankfurtleague")]

    assert aged, "docs/ops/runbooks.md carries no tmpfiles line aging /var/log/frankfurtleague"
    assert "*" not in aged[0], aged[0]
    assert "m:30d" in aged[0], aged[0]


def test_a_copy_that_fails_before_the_recreate_refuses_with_nothing_left_behind() -> None:
    """The `.partial` is the load-bearing half: a short file left in place reads as the build's whole stream."""
    code, output, fixture = _run(BEFORE, FL_DEPLOY_LOGS_FAIL="backend", FL_DEPLOY_LOGS_RC="7")

    assert code == 2, output
    assert "NOTHING has been recreated" in output, output
    assert "(exit 7)" in output, output
    assert _copies(fixture) == [f"{STAMP}-frontend.log"], output


def test_the_same_failure_inside_the_rollback_warns_and_copies_the_other_service() -> None:
    """The site is already down by there, so a refusal would trade the outage for a log file."""
    code, output, fixture = _run(FAILED, FL_DEPLOY_LOGS_FAIL="frontend", FL_DEPLOY_LOGS_RC="7")

    assert code == 0, output
    assert "The rollback goes on without it." in output, output
    assert "NOTHING has been recreated" not in output, output
    assert _copies(fixture) == [f"{STAMP}-backend-failed.log"], output


def test_both_copies_failing_inside_the_rollback_leaves_two_attempts_and_no_stream() -> None:
    """Zero copies with two containers that answered is two warnings already printed, not a stack nobody could ask."""
    code, output, fixture = _run(FAILED, FL_DEPLOY_LOGS_FAIL="frontend:backend", FL_DEPLOY_LOGS_RC="7")

    assert code == 0, output
    assert "copied=0 attempted=2" in output, output
    assert _copies(fixture) == [], output


def test_the_rollbacks_zero_copy_summary_reads_the_attempts_and_not_the_copies_alone() -> None:
    """A summary saying nobody answered, printed under two warnings naming a failed copy, contradicts the lines above it."""
    body = lift_function(DEPLOY, "roll_back")
    summary = body[body.index("copy_streams") : body.index("docker tag")]

    assert "COPIED_STREAMS" in summary, summary
    assert "ATTEMPTED_STREAMS" in summary, summary


def test_the_log_copy_is_bounded_so_a_stalled_daemon_cannot_hold_the_outage_open() -> None:
    """The rollback runs this with the site already down, and it is the one command there that waits on the daemon unbounded."""
    call = [line for line in lift_function(DEPLOY, "copy_streams").splitlines() if "logs --no-color" in line and "$partial" in line]

    assert len(call) == 1, call
    assert call[0].strip().startswith("timeout "), call


def test_the_rollback_copies_before_it_re_tags_anything() -> None:
    """The whole of the fix: a copy taken after the re-tag and the recreate is a copy of the build that replaced the failed one."""
    body = lift_function(DEPLOY, "roll_back")
    copied = body.index("copy_streams")
    retagged = body.index("docker tag")

    assert copied < retagged, "scripts/ops/deploy.sh :: roll_back re-tags before it copies the failed build's streams"


def test_the_two_call_sites_differ_in_the_suffix_and_in_the_verb_alone() -> None:
    """The pair is the decision: a refusal where nothing has been recreated, an advisory where the site is already down.

    The rollback's call comes first in the file.
    """
    calls = re.findall(r"^\s*copy_streams (\"[^\"]*\") (\w+) ", DEPLOY.read_text(encoding="utf-8"), re.MULTILINE)

    assert calls == [('"-failed"', "warn"), ('""', "refuse")], calls


# --- the environment file, read by the build about to run --------------------------------------------

NAMES: Final = "check_env_names"


def test_a_name_the_backend_does_not_declare_refuses_with_nothing_recreated() -> None:
    """Exit 3 is the snippet's own answer for the refusal, and nothing else may be graded as one."""
    code, output, _ = _run(NAMES, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="Invalid environment variables: LOG_FORMAT_")

    assert code == 2, output
    assert "LOG_FORMAT_" in output, output
    assert "NOTHING has been recreated" in output, output


def test_any_other_answer_is_an_advisory_the_deploy_survives() -> None:
    """A check that could not be made leaves the deploy where it stood before it existed; a refusal would stop a deploy over the checker."""
    code, output, _ = _run(NAMES, FL_DEPLOY_RUN_RC="125", FL_DEPLOY_RUN_SAYS="PermissionError")

    assert code == 0, output
    assert "(exit 125)" in output, output
    assert "PermissionError" in output, output


def test_what_the_container_said_goes_through_the_credential_filter() -> None:
    """This is a new site printing a container's own words, and a driver quotes the connection string back in exactly these failures."""
    code, output, _ = _run(NAMES, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="MONGODB_URI mongodb://user:pw@cluster.example.net/x")

    assert code == 2, output
    assert "user:pw@" not in output, output
    assert "<redacted>@cluster.example.net" in output, output


def test_both_files_are_mounted_read_only_and_joined_in_a_tmpfs_the_reader_is_pointed_at() -> None:
    """The backend's own file alone would leave every name the checkout's holds reading as missing, and refuse every deploy."""
    code, output, fixture = _run(f'printf "identity=%s:%s\\n" "$(id -u)" "$(id -g)" ; {NAMES}')
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()
    identity = re.search(r"^identity=(\S+)$", output, re.MULTILINE)

    assert code == 0, output
    assert identity is not None, output
    mounts = [arg for arg in argv if arg.endswith(":ro")]
    # The HOST halves, which nothing else reaches: the backend's file for the package half, and the
    # checkout's own, not a package's, for the shared half.
    assert len(mounts) == 2, argv
    assert mounts[0].endswith("/checkout/fl_backend/.env:/run/fl-env/package:ro"), argv
    assert mounts[1].endswith("/checkout/.env:/run/fl-env/shared:ro"), argv
    assert ["--tmpfs", "/tmp"] == argv[argv.index("--tmpfs") : argv.index("--tmpfs") + 2], argv
    # The join runs first and hands over to the snippet, which is told the directory it wrote into.
    # The snippet spans lines of the recorded argv, so only its neighbours are compared.
    joined = argv.index("-c")
    build = _assignment("ENV_UNION_BUILD").split("=", 1)[1][1:-1]
    assert argv[joined - 1 : joined + 5] == ["sh", "-c", build, "/run/fl-env", "/tmp", "python"], argv
    assert argv[-1] == "/tmp", argv
    # The identity of whoever ran the script, rather than a uid spelled here: a `sudo` deploy mounts
    # as root, so what is asserted is that the script asks, not which answer it gets.
    assert "--user" in argv, argv
    assert argv[argv.index("--user") + 1] == identity.group(1), (argv, identity.group(1))


# The join as the reader's container runs it, over two files of the fixture's own: the package's
# ending without a newline, which is the case the separator is for.
UNION: Final = """mkdir -p mounts union
printf 'PACKAGE_NAME=one' > mounts/package
printf 'SHARED_NAME=two\\n' > mounts/shared
sh -c "$ENV_UNION_BUILD" mounts union cat union/.env
"""


def test_the_join_puts_the_package_file_first_and_parts_it_from_the_checkouts_by_a_line() -> None:
    """Compose lets the last file listed win, and a package file ending without a newline would otherwise run into the checkout's first name."""
    code, output, _ = _run(UNION)

    assert code == 0, output
    assert output.splitlines()[-2:] == ["PACKAGE_NAME=one", "SHARED_NAME=two"], output


@pytest.mark.parametrize("half", ["package", "shared"])
def test_a_half_the_join_cannot_read_ends_it_as_a_read_failure_before_any_reader(half: str) -> None:
    """A join of one half would be judged as a file missing the other's names, a refusal pointing at the wrong remedy."""
    body = UNION.replace("sh -c", f"rm mounts/{half}\njoin_rc=0\nsh -c").replace("cat union/.env\n", "cat union/.env || join_rc=$?\n")
    code, output, _ = _run(body + 'printf "join=%s\\n" "$join_rc"\n')

    assert code == 0, output
    assert "join=4" in output, output
    assert "PACKAGE_NAME=one" not in output and "SHARED_NAME=two" not in output, output


def test_the_snippet_reaches_its_refusal_through_the_names_only_path() -> None:
    """`BackendEnvironment()` renders `input_value=` on its own error, so a snippet constructing it would publish the rejected value."""
    snippet = _assignment("ENV_NAME_CHECK")

    assert "read_environment()" in snippet, snippet
    assert "BackendEnvironment(" not in snippet, snippet
    # The other arm prints a class name and never the exception, whose message quotes what a source
    # could not read.
    assert "type(unexpected).__name__" in snippet, snippet


# --- the snippet itself, run rather than stubbed ------------------------------------------------------

# `venv_python` comes from `_lib.sh`, which the parent script already sources; `cd` reaches the
# fixture's own dotenv, the one file every case here is allowed to read.
SNIPPET: Final = """snippet_rc=0
"$(venv_python)" -c "$ENV_NAME_CHECK" fl_backend || snippet_rc=$?
printf 'snippet=%s\\n' "$snippet_rc"
"""


def test_the_snippet_answers_3_naming_the_variables_and_never_a_rejected_value() -> None:
    """Every case above stubs `docker run`, so each proves what the script asks and none proves what the image answers."""
    code, output, _ = _run(SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix())

    assert code == 0, output
    # The application is installed wherever this scope runs, CI's job included, so an import failure
    # here is the case failing, never the advisory arm the case below pins.
    assert "snippet=3" in output, output
    assert "A_NAME_NOTHING_DECLARES" in output, output
    assert "a value no case reads" not in output, output
    # The fixture's file declares nothing the backend requires either, so a missing required variable
    # reaches exit 3 beside the undeclared name -- both remedies the deploy's refusal words.
    assert "DB_BASE_NAME" in output, output


# A backend environment the settings accept, its public key a pair's of the case's own, and the five
# secret files, two keys of the class and one carrying a `$`. Fabricated, of `k` alone.
KEY_OUTSIDE_THE_CLASS: Final = """node -e "$PAIR_JS" ed25519 fl_backend/key.pem fl_backend/public.env
printf 'API_TRUSTED_HOSTS=localhost\\nAPI_CORS_ALLOWED_ORIGINS=http://localhost:3000\\n' > fl_backend/.env
{ printf 'DB_BASE_NAME=league\\n'; cat fl_backend/public.env; } >> fl_backend/.env
mkdir -p fl_backend/run-secrets
printf 'mongodb://localhost:27017/?directConnection=true' > fl_backend/run-secrets/backend_mongodb_uri
printf 'k%.0s' {1..64} > fl_backend/run-secrets/sperrliste_schluessel
printf '%s$%s' "$(printf 'k%.0s' {1..10})" "$(printf 'k%.0s' {1..53})" > fl_backend/run-secrets/internal_api_key_base
printf 'k%.0s' {1..64} > fl_backend/run-secrets/internal_api_key_system
printf 'k%.0s' {1..64} > fl_backend/run-secrets/internal_api_key_admin
export SECRETS_DIR=run-secrets
"""


def test_the_snippet_names_a_retired_line_and_passes_the_join_holding_it() -> None:
    """The image a rollback restores reads the line, so the release reading files says so and deploys."""
    retired = KEY_OUTSIDE_THE_CLASS.split("mkdir -p", 1)[0] + "printf 'MONGODB_URI=a value no case reads\\n' >> fl_backend/.env\n"
    code, output, _ = _run(retired + SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix(), PAIR_JS=PAIR)

    assert code == 0, output
    assert "snippet=0" in output, output
    assert "Retired, and read by nothing: MONGODB_URI" in output, output
    assert "a value no case reads" not in output, output


def test_the_boot_build_refuses_a_key_file_outside_the_class_naming_that_file_alone() -> None:
    """The preflight judges a key with the pulled image's own validator, in its container, so the class reaches the deploy first."""
    code, output, _ = _run(KEY_OUTSIDE_THE_CLASS + BOOT_SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix(), PAIR_JS=PAIR)

    assert code == 0, output
    assert "boot=3" in output, output
    assert "internal_api_key_base" in output, output
    assert "internal_api_key_system" not in output, output
    assert "internal_api_key_admin" not in output, output
    assert "kkkkkkkkkk$" not in output, output


def test_a_settings_module_the_snippet_cannot_import_answers_the_advisory_arm() -> None:
    """The import sits inside a guard of its own.

    An except clause naming a class an ImportError never bound raises a NameError, and that
    traceback is what this arm exists to keep out.
    """
    code, output, _ = _run(SNIPPET, PYTHONPATH="")

    assert code == 0, output
    assert "snippet=4" in output, output
    assert "ModuleNotFoundError" in output, output
    assert "Traceback" not in output, output


# --- a name a package file and the checkout's both hold -------------------------------------------------

HELD_ONCE: Final = "check_env_names_held_once"


def test_a_name_both_files_hold_refuses_with_nothing_recreated() -> None:
    """Exit 3 is the snippet's own answer, and the names are all it prints."""
    said = "fl_backend/.env and .env both hold: INTERNAL_API_KEY_BASE"
    code, output, _ = _run(HELD_ONCE, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS=said)

    assert code == 2, output
    assert said in output, output
    assert "keeping the one in .env" in output, output
    assert "NOTHING has been recreated" in output, output


def test_a_held_once_check_that_could_not_be_made_is_an_advisory() -> None:
    code, output, _ = _run(HELD_ONCE, FL_DEPLOY_RUN_RC="125", FL_DEPLOY_RUN_SAYS="Error")

    assert code == 0, output
    assert "(exit 125)" in output, output


def test_the_three_files_are_mounted_read_only_into_a_container_with_no_network() -> None:
    code, output, fixture = _run(HELD_ONCE)
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    mounts = [arg for arg in argv if arg.endswith(":ro")]
    assert [mount.rsplit("/checkout/", 1)[1] for mount in mounts] == [
        ".env:/run/fl-env/.env:ro",
        "fl_frontend/.env:/run/fl-env/fl_frontend/.env:ro",
        "fl_backend/.env:/run/fl-env/fl_backend/.env:ro",
    ], argv
    assert ["--network", "none"] == argv[argv.index("--network") : argv.index("--network") + 2], argv
    assert argv[-3:] == ["/run/fl-env", "fl_frontend", "fl_backend"], argv


# The snippet over three files of the fixture's own, one name in two of them.
OVERLAP: Final = """mkdir -p fl_frontend
printf 'SHARED_KEY=a value no case prints\\n' > .env
printf 'SHARED_KEY=another value no case prints\\nFRONTEND_ONLY=x\\n' > fl_frontend/.env
snippet_rc=0
"$(venv_python)" -c "$ENV_OVERLAP_CHECK" . fl_frontend fl_backend || snippet_rc=$?
printf 'snippet=%s\\n' "$snippet_rc"
"""


def test_the_overlap_snippet_answers_3_naming_the_file_and_the_name_and_never_a_value() -> None:
    """Every stubbed case proves what the script asks; this proves what the image's python-dotenv answers."""
    code, output, _ = _run(OVERLAP)

    assert code == 0, output
    assert "snippet=3" in output, output
    assert "fl_frontend/.env and .env both hold: SHARED_KEY" in output, output
    assert "fl_backend/.env and" not in output, output
    assert "value no case prints" not in output, output


def test_the_held_once_check_runs_in_preflight_ahead_of_both_readers_and_before_the_recreate() -> None:
    """Every case above drives the lifted function; this is the call the deploy itself makes."""
    text = DEPLOY.read_text(encoding="utf-8")
    held_once = text.index("\ncheck_env_names_held_once\n")
    read = text.index("\ncheck_env_names\n")
    recreated = text.index('step "Recreating the application containers"')

    assert held_once < read < recreated, "scripts/ops/deploy.sh asks whether a name is held twice after a reader or not at all"


def test_the_overlap_snippet_refuses_a_package_name_differing_from_the_roots_in_case_alone() -> None:
    """pydantic-settings lowercases every name, so `shared_key` in a package file is the same variable to the backend."""
    code, output, _ = _run(OVERLAP.replace("SHARED_KEY=another", "shared_key=another"))

    assert code == 0, output
    assert "snippet=3" in output, output
    assert "fl_frontend/.env and .env both hold: shared_key" in output, output


def test_the_overlap_snippet_answers_0_where_no_name_repeats() -> None:
    code, output, _ = _run(OVERLAP.replace("SHARED_KEY=another", "OTHER_KEY=another"))

    assert code == 0, output
    assert "snippet=0" in output, output


# --- the checkout root's `.env`, judged as text before compose or any reader ---------------------------

# The three keys, each a fabricated 64 `k`, written as the runbook's command writes them.
ROOT_KEYS: Final = "".join(f"INTERNAL_API_KEY_{tier}={'k' * 64}\n" for tier in ("BASE", "SYSTEM", "ADMIN"))


def _root_env(text: str) -> tuple[int, str]:
    """`scripts/lib/_lib.sh :: check_root_env` over a root file holding `text`, the fixture's own."""
    body = f"printf '%s' {shlex.quote(text)} > .env\ncheck_root_env .env\necho judged-clean\n"
    code, output, _ = _run(body)
    return code, output


def test_a_root_file_holding_the_three_keys_alone_is_clean() -> None:
    code, output = _root_env("# the keys\n\n" + ROOT_KEYS)

    assert code == 0, output
    assert "judged-clean" in output, output


@pytest.mark.parametrize(
    ("line", "said"),
    [
        ("COMPOSE_PROJECT_NAME=other", "COMPOSE_PROJECT_NAME is a compose setting"),
        ("MONGODB_URI=mongodb://no-login-here", "MONGODB_URI is not one of"),
        (f"INTERNAL_API_KEY_BASE={'k' * 64}", "INTERNAL_API_KEY_BASE is written a second time"),
        ("export OTHER=1", "is not NAME=value"),
    ],
    ids=["compose-setting", "one-service-name", "twice", "not-name-value"],
)
def test_a_root_file_holding_anything_else_refuses_before_compose_is_asked(line: str, said: str) -> None:
    """A compose setting is acted on by compose itself, and `MONGODB_URI` here would give both services one login."""
    code, output = _root_env(ROOT_KEYS + line + "\n")

    assert code == 2, output
    assert said in output, output
    assert "judged-clean" not in output, output


def test_a_root_file_missing_a_key_refuses() -> None:
    code, output = _root_env(ROOT_KEYS.replace(f"INTERNAL_API_KEY_ADMIN={'k' * 64}\n", ""))

    assert code == 2, output
    assert "INTERNAL_API_KEY_ADMIN is missing" in output, output


@pytest.mark.parametrize(("script", "first_compose"), [(DEPLOY, "\nif (( STATUS_ONLY )); then"), (LOCAL, "\nif (( DOWN )); then")])
def test_the_root_file_is_judged_before_the_first_compose_call(script: Path, first_compose: str) -> None:
    """`--status` and `--down` call compose too, which would take a `COMPOSE_*` line as its own."""
    text = script.read_text(encoding="utf-8")

    assert text.index("\ncheck_root_env ") < text.index(first_compose), script.name


# --- every `.env` compose reads, judged as text for the spellings its readers disagree on -----------------


def _env_spellings(text: str) -> tuple[int, str]:
    """`scripts/lib/_lib.sh :: check_env_spellings` over a file holding `text`, the fixture's own."""
    body = f"printf '%s' {shlex.quote(text)} > fl_backend/.env\ncheck_env_spellings fl_backend/.env\necho judged-clean\n"
    code, output, _ = _run(body)
    return code, output


def test_a_file_every_reader_takes_alike_is_clean() -> None:
    """Comments say anything; an encoded URI, a spaced comment, a matched quote pair and a bare backslash read alike."""
    lines = ("# costs $5 #1", "MONGODB_URI=mongodb://user:pa%24ss%23@db/x", "", "LOG_FORMAT='json' # the stream")
    lines += ('FROM="a#b"', "PATHLIKE=a\\b", "TICK=a`b")
    code, output = _env_spellings("\n".join(lines) + "\n")

    assert code == 0, output
    assert "judged-clean" in output, output


@pytest.mark.parametrize(
    ("line", "said"),
    [
        pytest.param("MONGODB_URI=mongodb://user:pa$ss@db/x", "holds a $", id="dollar-bare"),
        pytest.param("SECRET=${OTHER}", "holds a $", id="dollar-braced"),
        pytest.param("QUOTED='a$b'", "holds a $", id="dollar-single-quoted"),
        pytest.param('DOUBLE="a$b"', "holds a $", id="dollar-double-quoted"),
        pytest.param("export SPACED = a$b", "holds a $", id="dollar-export-and-spaces"),
        pytest.param("TRAILING=plain # was $5", "holds a $", id="dollar-in-a-trailing-comment"),
        pytest.param("HASH=a#b", "holds a # with no space before it", id="hash-unspaced"),
        pytest.param("HASH=#abc", "holds a # with no space before it", id="hash-leading"),
        pytest.param("SLASH='a\\b'", "holds a backslash inside quotes", id="backslash-single-quoted"),
        pytest.param('SLASH="a\\b"', "holds a backslash inside quotes", id="backslash-double-quoted"),
        pytest.param("TICK=`abc`", "opens with a backtick", id="backtick-leading"),
    ],
)
def test_a_spelling_the_readers_disagree_on_refuses_naming_the_line_never_the_value(line: str, said: str) -> None:
    """Each was read apart by python-dotenv, `@next/env` and `node:util :: parseEnv`; `$` even inside single quotes."""
    code, output = _env_spellings(f"FIRST=1\n{line}\n")
    name = line.removeprefix("export ").split("=", 1)[0].strip()

    assert code == 2, output
    assert f"line 2: {name} {said}" in output, output
    assert line.split("=", 1)[1].strip() not in output, output
    assert "judged-clean" not in output, output


@pytest.mark.parametrize("script", [DEPLOY, LOCAL], ids=["deploy", "local"])
def test_every_file_is_judged_before_the_first_compose_call_that_reads_it(script: Path) -> None:
    """The root file before `--status` and `--down` as well, which read it for interpolation."""
    text = script.read_text(encoding="utf-8")
    readers = ("\ncheck_compose_config\n", "docker compose build", "\ncheck_actor_key ")
    first_read = min(text.index(marker) for marker in readers if marker in text)
    root = "$SHARED_ENV" if script == DEPLOY else ".env"
    first_compose = "\nif (( STATUS_ONLY )); then" if script == DEPLOY else "\nif (( DOWN )); then"

    assert text.index("\ncheck_root_env ") < text.index(f'\ncheck_env_spellings "{root}"') < text.index(first_compose), script.name
    for package in ("fl_frontend", "fl_backend"):
        judged = text.index(f'\ncheck_env_spellings "{package}/.env"')
        assert text.index(f'\nrequire_file "{package}/.env"') < judged < first_read, (script.name, package)


# --- the actor token's key pair ---------------------------------------------------------------------------

# A pair of the case's own, generated with the node the check itself runs on and never committed:
# `$1` the key type, `$2` where the private half goes, `$3` a file naming the public half as
# `fl_backend/.env` does.
PAIR: Final = """
const { generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const [type, pem, env] = process.argv.slice(1);
const { privateKey, publicKey } = generateKeyPairSync(type);
writeFileSync(pem, privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(env, `ACTOR_TOKEN_PUBLIC_KEY=${publicKey.export({ format: "jwk" }).x}\\n`);
"""

# The check as the frontend image runs it, its key at `$1` and the environment file on stdin.
CHECK: Final = """check_rc=0
node -e "$ACTOR_KEY_CHECK" "$1" < "$2" || check_rc=$?
printf 'check=%s\\n' "$check_rc"
"""


def _judged(setup: str, key: str, env: str) -> str:
    """The check's printed answer over files `setup` wrote, with the exit code on its last line."""
    code, output, _ = _run(f"{setup}\nset -- {key} {env}\n{CHECK}", PAIR_JS=PAIR)

    assert code == 0, output
    # Neither half of any pair is ever printed: the PEM's armour, the public half's name with its value.
    assert "PRIVATE KEY" not in output, output
    assert re.search(r"[A-Za-z0-9_-]{43}", output) is None, output
    return output


def test_the_runbooks_command_writes_a_pair_the_check_passes() -> None:
    """Run as the runbook prints it, over the fixture's own `fl_backend/.env`: Git Bash's `openssl` is the carriage-return case."""
    text = RUNBOOKS.read_text(encoding="utf-8")
    generate = next(line for line in text.splitlines() if line.startswith("(umask 077 && mkdir -p secrets && openssl genpkey"))
    # The development machine's placing step, the server's being `sudo install` to a uid this host may not have.
    placed = re.findall(r"`(mv secrets/fl_actor_signing_key\.new secrets/fl_actor_signing_key)`", text)
    assert len(placed) == 1, placed
    command = f"{generate}\n{placed[0]}"
    # Counted, never printed: each file's carriage returns, which the runbook promises it writes none of.
    counted = "printf \"cr=%s\\n\" \"$(cat secrets/fl_actor_signing_key fl_backend/.env | tr -cd '\\r' | wc -c | tr -d ' ')\""
    output = _judged(f"{command}\n{counted}", "secrets/fl_actor_signing_key", "fl_backend/.env")

    assert "check=0" in output, output
    assert "cr=0" in output, output


def test_a_matching_pair_passes() -> None:
    output = _judged('node -e "$PAIR_JS" ed25519 key.pem env.txt', "key.pem", "env.txt")

    assert "check=0" in output, output


def test_the_key_is_read_where_the_environment_names_it_rather_than_at_the_mount() -> None:
    """The frontend's config reads `ACTOR_SIGNING_KEY_FILE` over its default, so the check does too."""
    output = _judged('node -e "$PAIR_JS" ed25519 named.pem env.txt\nexport ACTOR_SIGNING_KEY_FILE=named.pem', "absent.pem", "env.txt")

    assert "check=0" in output, output


@pytest.mark.parametrize(
    ("setup", "key", "said"),
    [
        pytest.param(
            'node -e "$PAIR_JS" ed25519 key.pem mine.txt\nnode -e "$PAIR_JS" ed25519 other.pem env.txt',
            "key.pem",
            "ACTOR_TOKEN_PUBLIC_KEY is not the public half of the signing key",
            id="another-pairs-public-half",
        ),
        pytest.param(
            "node -e \"$PAIR_JS\" ed25519 key.pem mine.txt\nprintf 'ACTOR_TOKEN_PUBLIC_KEY=short\\n' > env.txt",
            "key.pem",
            "ACTOR_TOKEN_PUBLIC_KEY is not the base64url of 32 bytes",
            id="malformed-public-half",
        ),
        pytest.param(
            "node -e \"$PAIR_JS\" ed25519 key.pem mine.txt\nprintf 'OTHER=1\\n' > env.txt",
            "key.pem",
            "ACTOR_TOKEN_PUBLIC_KEY is missing from fl_backend/.env",
            id="no-public-half",
        ),
        pytest.param(
            'node -e "$PAIR_JS" ed25519 other.pem env.txt',
            "absent.pem",
            "the signing key could not be read by the frontend user (ENOENT)",
            id="unreadable-key",
        ),
        pytest.param(
            "node -e \"$PAIR_JS\" ed25519 other.pem env.txt\nprintf 'not a key\\n' > key.pem",
            "key.pem",
            "the signing key file holds no private key in PEM",
            id="no-key-in-the-file",
        ),
        pytest.param(
            'node -e "$PAIR_JS" x25519 key.pem env.txt',
            "key.pem",
            "the signing key is x25519, not Ed25519",
            id="not-a-signing-key",
        ),
        pytest.param(
            'node -e "$PAIR_JS" ed25519 key.pem env.txt\nexport ACTOR_SIGNING_KEY_FILE=../secrets/fl_actor_signing_key',
            "key.pem",
            "which ACTOR_SIGNING_KEY_FILE names in its environment, and could not read it there (ENOENT)",
            id="a-dev-path-the-environment-names-over-a-good-mount",
        ),
        pytest.param(
            'node -e "$PAIR_JS" ed25519 key.pem env.txt\nexport ACTOR_SIGNING_KEY_FILE=',
            "key.pem",
            "which ACTOR_SIGNING_KEY_FILE names in its environment, and could not read it there",
            id="an-empty-path-the-frontend-s-config-refuses",
        ),
    ],
)
def test_a_pair_that_would_not_work_answers_3_naming_what_is_wrong(setup: str, key: str, said: str) -> None:
    """3 is every reader's refusal; each line says which half to fix and prints neither."""
    output = _judged(setup, key, "env.txt")

    assert "check=3" in output, output
    assert said in output, output


KEY_CHECK: Final = 'check_actor_key "NOTHING has been recreated." docker compose -f docker-compose.yml run --rm --no-deps -T frontend'


def test_a_refused_pair_stops_the_run_with_its_remedy() -> None:
    code, output, _ = _run(KEY_CHECK, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="ACTOR_TOKEN_PUBLIC_KEY is missing from fl_backend/.env")

    assert code == 2, output
    assert "ACTOR_TOKEN_PUBLIC_KEY is missing from fl_backend/.env" in output, output
    assert "docs/ops/runbooks.md §16" in output, output
    assert "NOTHING has been recreated." in output, output


def test_a_pair_check_that_could_not_be_made_is_an_advisory() -> None:
    code, output, _ = _run(KEY_CHECK, FL_DEPLOY_RUN_RC="125", FL_DEPLOY_RUN_SAYS="Error")

    assert code == 0, output
    assert "(exit 125)" in output, output


def _key_check_call(script: Path) -> str:
    return "check_actor_key " + script.read_text(encoding="utf-8").split("\ncheck_actor_key ", 1)[1].split("\n\n", 1)[0]


@pytest.mark.parametrize("script", [DEPLOY, LOCAL], ids=["deploy", "local"])
def test_each_script_runs_the_check_in_the_frontend_service_as_the_stack_starts_it(script: Path) -> None:
    """A bare image run holds none of the service's environment, and passes a key the frontend never finds.

    No `--user`: the key is its image user's, whom the caller's uid is not.
    """
    code, output, fixture = _run(_key_check_call(script))
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert argv[0] == "compose", argv
    run = argv.index("run")
    assert argv[run : run + 5] == ["run", "--rm", "--no-deps", "-T", "frontend"], argv
    assert "--user" not in argv, argv
    assert argv[argv.index("-e") - 1 : argv.index("-e") + 1] == ["node", "-e"], argv
    assert argv[-1] == "/run/secrets/fl_actor_signing_key", argv


def test_git_bash_is_told_to_leave_the_mount_path_as_written() -> None:
    """Git Bash rewrites a `/run/...` argument to a native program into a Windows path.

    The container then reads the key as missing on every development machine; Linux ignores the variable.
    """
    code, output, fixture = _run(KEY_CHECK)

    assert code == 0, output
    assert Path(f"{fixture.argv}.pathconv").read_text(encoding="utf-8") == "1"


def test_the_container_is_handed_the_public_half_s_line_and_nothing_else() -> None:
    """The rest of `fl_backend/.env` is the backend's database login and keys, which the frontend never holds."""
    lines = "MONGODB_URI=mongodb://user:secret@db/x\\nACTOR_TOKEN_PUBLIC_KEY=the-public-half\\nSPERRLISTE_SCHLUESSEL=other\\n"
    code, output, fixture = _run(f"printf '{lines}' > fl_backend/.env\n{KEY_CHECK}")

    assert code == 0, output
    assert Path(f"{fixture.argv}.stdin").read_text(encoding="utf-8") == "ACTOR_TOKEN_PUBLIC_KEY=the-public-half\n"


def test_a_backend_file_without_the_public_half_hands_the_check_an_empty_line() -> None:
    """grep's "no such line" is the check's own finding to make, never a refusal of the read."""
    code, output, fixture = _run(KEY_CHECK)

    assert code == 0, output
    assert Path(f"{fixture.argv}.stdin").read_text(encoding="utf-8") == "\n"


# `stat` answered by a function of the case's own, since a Windows filesystem keeps no mode to set.
MODE: Final = "stat() { STAT_ANSWER; }\n" + _lifted("signing_key_mode_advisory") + "\nsigning_key_mode_advisory\necho judged"


@pytest.mark.parametrize(
    ("answer", "warned"),
    [
        pytest.param("printf '400\\n'", "", id="the-frontend-user-s-alone"),
        pytest.param("printf '440\\n'", "has mode 440", id="its-group-reads-it"),
        pytest.param("printf '604\\n'", "has mode 604", id="everyone-reads-it"),
        pytest.param("printf '420\\n'", "has mode 420", id="its-group-writes-it"),
        pytest.param("return 1", "could not be read", id="stat-fails"),
    ],
)
def test_a_key_another_account_can_reach_draws_a_warning_and_never_a_refusal(answer: str, warned: str) -> None:
    code, output, _ = _run(MODE.replace("STAT_ANSWER", answer))

    assert code == 0, output
    assert "judged" in output, output
    if warned:
        assert warned in output, output
    else:
        assert "!!" not in output, output


def test_the_deploy_reads_the_key_s_mode_once_it_knows_the_key_is_there() -> None:
    text = DEPLOY.read_text(encoding="utf-8")

    assert text.index('\nrequire_file "$SIGNING_KEY_FILE"') < text.index("\nsigning_key_mode_advisory\n"), DEPLOY.name


@pytest.mark.parametrize(
    ("script", "after", "before"),
    [
        (DEPLOY, "\ncheck_frontend_env_names\n", 'step "Recreating the application containers"'),
        (LOCAL, 'ok "images built"', 'section "start"'),
    ],
)
def test_the_pair_is_judged_after_the_build_it_runs_in_and_before_anything_starts(script: Path, after: str, before: str) -> None:
    text = script.read_text(encoding="utf-8")

    assert text.index(after) < text.index("\ncheck_actor_key ") < text.index(before), script.name
    assert text.index('\nrequire_file "$SIGNING_KEY_FILE"') < text.index("\ncheck_actor_key "), script.name


# --- the configuration compose reads, before anything is pulled ---------------------------------------

CONFIG: Final = "check_compose_config"


def test_a_configuration_compose_cannot_read_refuses_with_nothing_pulled_or_recreated() -> None:
    """Compose stops before it touches a container, so a refusal is the only ending true of the site."""
    code, output, _ = _run(
        CONFIG,
        FL_DEPLOY_CONFIG_RC="15",
        FL_DEPLOY_CONFIG_SAYS="env_file: unterminated quoted string A_VALUE_NO_CASE_READS",
    )

    assert code == 2, output
    assert "(exit 15)" in output, output
    assert "NOTHING has been pulled or recreated, and the site is untouched" in output, output
    # The four files, because the refusal cannot say which of them the message named.
    assert "docker-compose.yml" in output, output
    assert "fl_backend/.env" in output, output
    assert "fl_frontend/.env" in output, output
    assert "fl_backend/.env and .env." in output, output
    # `redact_uri_credentials` is for a container's log and reaches none of this, and a parse error
    # quotes the line it could not read -- which in an environment file is a value.
    assert "A_VALUE_NO_CASE_READS" not in output, output
    assert "unterminated" not in output, output


def test_a_configuration_compose_reads_passes_the_preflight() -> None:
    code, output, _ = _run(CONFIG)

    assert code == 0, output
    assert "compose parses docker-compose.yml" in output, output


def test_the_validation_asks_compose_to_parse_and_to_print_nothing() -> None:
    """`--quiet` is the whole of what keeps the resolved configuration, every value in it, off the terminal."""
    code, output, fixture = _run(CONFIG)
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert argv[0] == "compose", argv
    assert "config" in argv, argv
    assert "--quiet" in argv, argv
    assert argv[argv.index("-f") + 1] == "docker-compose.yml", argv


def test_the_configuration_is_read_before_anything_is_pulled_or_recreated() -> None:
    text = DEPLOY.read_text(encoding="utf-8")
    validated = text.index("\ncheck_compose_config\n")
    pulled = text.index('section "pull"')
    recreated = text.index('step "Recreating the application containers"')

    assert validated < pulled < recreated, "scripts/ops/deploy.sh validates the configuration after it has already pulled or recreated"


# --- the health read after the recreate ----------------------------------------------------------------


def test_the_health_read_hands_compose_the_deploys_file_as_two_arguments() -> None:
    """Under `_lib.sh`'s IFS, a flag and its file joined in one expansion arrive as one argument.

    Compose reads a file named " docker-compose.yml", exits 1, and the deploy refuses at the health wait.
    """
    code, output, fixture = _run('wait_healthy "$COMPOSE" backend 3')
    argv = fixture.ps_argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert "'backend' is healthy" in output, output
    assert argv[:5] == ["compose", "-f", "docker-compose.yml", "ps", "-q"], argv


def test_the_local_stacks_health_read_names_no_file_and_leaves_the_choice_to_compose_file() -> None:
    code, output, fixture = _run('wait_healthy "" backend 3')
    argv = fixture.ps_argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert argv[:3] == ["compose", "ps", "-q"], argv


# --- the secret files, read by each service's own container ---------------------------------------------

RUNNER: Final = 'docker compose -f "$COMPOSE" run --rm --no-deps -T'
FILES_CHECK: Final = f'check_secret_files "NOTHING has been recreated." frontend FRONTEND_SECRETS {RUNNER}'
BOOT_CHECK: Final = f'check_backend_boot_config "NOTHING has been recreated." {RUNNER}'


def _lib_array(name: str) -> list[str]:
    return lift_assignment(LIB, name).split("=", 1)[1].strip("()").split()


def test_a_file_the_container_cannot_use_refuses_with_nothing_recreated() -> None:
    """Exit 3 is the program's own answer, and the remedy names where each file is written."""
    code, output, _ = _run(FILES_CHECK, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="auth_secret: missing from /run/secrets")

    assert code == 2, output
    assert "auth_secret: missing from /run/secrets" in output, output
    assert "docs/ops/runbooks.md §16" in output, output
    assert "NOTHING has been recreated." in output, output


def test_a_file_check_that_could_not_be_made_is_an_advisory() -> None:
    """The running stack never runs it, so a check that could not run leaves the deploy where it stood."""
    code, output, _ = _run(FILES_CHECK, FL_DEPLOY_RUN_RC="125", FL_DEPLOY_RUN_SAYS="Error")

    assert code == 0, output
    assert "(exit 125)" in output, output


def test_the_file_check_runs_in_the_service_with_its_list_and_no_user_of_its_own() -> None:
    """The service's own user, mounts and groups are the whole of what the answer is about, so no `--user` overrides them."""
    code, output, fixture = _run(FILES_CHECK)
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    run = argv.index("run")
    assert argv[run : run + 8] == ["run", "--rm", "--no-deps", "-T", "frontend", "sh", "-c", ""], argv
    assert "--user" not in argv, argv
    files = _lib_array("FRONTEND_SECRETS")
    assert argv[-len(files) - 1 :] == ["sh", *files], argv


# Each case's own files, placeholders of `x` alone, read by the program as the container's sh would.
FILES_FIXTURE: Final = """mkdir -p run-secrets/adir
printf 'xxxx\\n' > run-secrets/good
printf '  \\n\\n' > run-secrets/blank
: > run-secrets/empty
files_rc=0
SECRETS_DIR=run-secrets sh -c "$SECRET_FILES_CHECK" sh good blank empty adir absent || files_rc=$?
printf 'files=%s\\n' "$files_rc"
"""


def test_the_program_names_each_file_and_its_fault_and_never_its_bytes() -> None:
    """Run for real: a stub proves the argv and nothing about what the program answers. An unreadable file is the docker run's to drive."""
    code, output, _ = _run(FILES_FIXTURE)

    assert code == 0, output
    assert "files=3" in output, output
    for line in ("blank: empty or blank", "empty: empty or blank", "adir: not a file", "absent: missing from run-secrets"):
        assert line in output, output
    assert "good:" not in output, output
    assert "xxxx" not in output, output


def test_the_program_answers_0_over_files_it_can_use() -> None:
    code, output, _ = _run(FILES_FIXTURE.replace("sh good blank empty adir absent", "sh good"))

    assert code == 0, output
    assert "files=0" in output, output


def test_settings_the_backend_refuses_stop_the_run_with_nothing_recreated() -> None:
    code, output, fixture = _run(BOOT_CHECK, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="Invalid environment variables: SPERRLISTE_SCHLUESSEL")
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 2, output
    assert "SPERRLISTE_SCHLUESSEL" in output, output
    assert "NOTHING has been recreated." in output, output
    run = argv.index("run")
    assert argv[run : run + 7] == ["run", "--rm", "--no-deps", "-T", "backend", "python", "-c"], argv


def test_a_settings_check_that_could_not_be_made_is_an_advisory() -> None:
    code, output, _ = _run(BOOT_CHECK, FL_DEPLOY_RUN_RC="4", FL_DEPLOY_RUN_SAYS="ModuleNotFoundError")

    assert code == 0, output
    assert "(exit 4)" in output, output


BOOT_SNIPPET: Final = """boot_rc=0
( cd fl_backend && "$(venv_python)" -c "$BACKEND_BOOT_CHECK" ) || boot_rc=$?
printf 'boot=%s\\n' "$boot_rc"
"""


def test_the_settings_program_answers_3_naming_what_it_refuses_and_never_a_value() -> None:
    """Run for real, over the fixture's file of an undeclared name and nothing the backend requires."""
    code, output, _ = _run(BOOT_SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix())

    assert code == 0, output
    assert "boot=3" in output, output
    assert "a value no case reads" not in output, output


@pytest.mark.parametrize(
    ("script", "after", "before"),
    [
        (DEPLOY, "\ncheck_actor_key ", 'step "Recreating the application containers"'),
        (LOCAL, "\ncheck_actor_key ", 'section "start"'),
    ],
)
def test_the_files_are_judged_after_the_key_and_before_anything_starts(script: Path, after: str, before: str) -> None:
    text = script.read_text(encoding="utf-8")

    for call in ("\ncheck_secret_files ", "\ncheck_backend_boot_config "):
        assert text.index(after) < text.index(call) < text.index(before), (script.name, call)


@pytest.mark.parametrize(("script", "frontend"), [(DEPLOY, "FRONTEND_SECRETS"), (LOCAL, "LOCAL_FRONTEND_SECRETS")])
def test_each_script_hands_each_service_its_own_list(script: Path, frontend: str) -> None:
    """The local stack sends no mail, so its frontend holds no provider key and is asked for none."""
    text = script.read_text(encoding="utf-8")

    assert f" frontend {frontend} " in text, script.name
    assert " backend BACKEND_SECRETS " in text, script.name


# --- a line the secret files replace, still in an environment file ----------------------------------------

MOVED: Final = """printf 'LOG_FORMAT=json\\nmongodb_uri=a value no case reads\\n' > fl_backend/.env
printf 'INTERNAL_API_KEY_BASE=a value no case reads\\n' > .env
check_moved_names {verb} fl_backend/.env .env
echo moved-names-passed
"""


def test_the_deploy_warns_naming_every_moved_line_in_any_case_and_goes_on() -> None:
    """The image a rollback restores reads these lines, so the release running the files keeps them."""
    code, output, _ = _run(MOVED.format(verb="warn"))

    assert code == 0, output
    assert "moved-names-passed" in output, output
    assert "fl_backend/.env: mongodb_uri" in output, output
    assert ".env: INTERNAL_API_KEY_BASE" in output, output
    assert "LOG_FORMAT" not in output, output
    assert "a value no case reads" not in output, output


def test_the_local_stack_refuses_them_restoring_no_older_image() -> None:
    code, output, _ = _run(MOVED.format(verb="refuse"))

    assert code == 2, output
    assert "moved-names-passed" not in output, output
    assert "Delete them" in output, output


def test_a_file_holding_no_moved_line_passes_in_silence() -> None:
    code, output, _ = _run(MOVED.format(verb="refuse").replace("mongodb_uri=", "DB_BASE_NAME=").replace("INTERNAL_API_KEY_BASE=", "# "))

    assert code == 0, output
    assert "moved-names-passed" in output, output
    assert "!!" not in output, output


def test_the_moved_names_are_the_secret_files_names() -> None:
    """Each moved name is a file's under the same name upper-cased, the two database logins sharing one."""
    files = {name.upper() for name in _lib_array("FRONTEND_SECRETS") + _lib_array("BACKEND_SECRETS")}
    renamed = {name.replace("FRONTEND_", "").replace("BACKEND_", "") for name in files}

    assert set(_lib_array("MOVED_ENV_NAMES")) == renamed


# --- the checkout root's `.env` while the secret files replace it -----------------------------------------


@pytest.mark.parametrize("text", ["", "# emptied\n\n"], ids=["empty", "comments-alone"])
def test_a_root_file_holding_no_key_is_clean(text: str) -> None:
    """The host empties it once the release reading the files runs healthy, and compose still lists it."""
    code, output = _root_env(text)

    assert code == 0, output
    assert "judged-clean" in output, output


def test_a_root_file_holding_some_keys_refuses_naming_the_rest() -> None:
    """A rollback's image reads the three together, so a part of the set is a deploy that restores nothing working."""
    code, output = _root_env(f"INTERNAL_API_KEY_BASE={'k' * 64}\n")

    assert code == 2, output
    assert "INTERNAL_API_KEY_SYSTEM is missing, beside the key(s) the file does hold" in output, output
    assert "INTERNAL_API_KEY_ADMIN is missing" in output, output


# --- the copy of production a development machine takes -----------------------------------------------

DUMP: Final = (
    "printf 'DB_BASE_NAME=league\\nA_NAME=a value no case reads\\n' > fl_backend/.env\n"
    f"{lift_assignment(LOCAL, 'DUMP_URI_FILE')}\n"
    'DUMP_LOG="dump.log"\n'
    f"{lift_function(LOCAL, 'take_dump')}\n"
    "take_dump\n"
)


def test_the_copy_is_handed_the_read_only_login_s_file_and_the_database_s_name_alone() -> None:
    """No development machine holds production's write login, so the copy reads `secrets/dump_mongodb_uri` and no environment file whole."""
    code, output, fixture = _run(DUMP)
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert "--env-file" not in argv, argv
    assert argv[argv.index("-e") + 1] == "DB_BASE_NAME", argv
    mounts = [argv[i + 1] for i, arg in enumerate(argv) if arg == "-v"]
    assert [mount for mount in mounts if mount.endswith(":/run/secrets/dump_mongodb_uri:ro")], mounts
    assert not [mount for mount in mounts if "/secrets:" in mount or ".env" in mount], mounts
