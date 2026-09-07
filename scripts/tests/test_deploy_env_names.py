"""SCRIPTS · `scripts/ops/deploy.sh :: check_frontend_env_names`, and `:: read_env_names`, the one function both packages go through.

The frontend image carries no settings class a deploy can instantiate, so the reader it runs is a
script emitted beside the standalone server and the key set the build wrote from the schema. Both
are lifted out and driven behind a stand-in `docker`, so no daemon, no compose file and no
environment file of this machine.

Invariants:
  Nothing here reads or writes a real environment file: the fixture builds its own, of dummy names.

See:
  scripts/tests/test_deploy_streams.py -- the backend arm, and the stand-in this one is cut down from
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Final

from conftest import base_env, lift_function, new_root, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
REPO_ROOT: Final = SCRIPTS.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
DEPLOY: Final = SCRIPTS / "ops" / "deploy.sh"
FRONTEND_DOCKERFILE: Final = REPO_ROOT / "fl_frontend" / "Dockerfile"

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

# `scripts/tests/test_deploy_streams.py :: STUB` without the compose arms, which no case here
# reaches: a stand-in answering subcommands nothing asks would hide an arm that stopped being run.
STUB: Final = """#!/usr/bin/env bash
set -u
if [[ "${1:-}" == "run" ]]; then
  printf '%s\\n' "$@" > "${FL_DEPLOY_ARGV}"
  if [[ -n "${FL_DEPLOY_RUN_SAYS:-}" ]]; then printf '%s\\n' "${FL_DEPLOY_RUN_SAYS}" >&2; fi
  exit "${FL_DEPLOY_RUN_RC:-0}"
fi
exit 0
"""

FRONTEND_ARM: Final = "check_frontend_env_names"


class _Fixture:
    """The temporary checkout one case drives the lifted function inside."""

    def __init__(self) -> None:
        self.root = new_root("fl-deploy-env-names-")
        self.checkout = self.root / "checkout" / "fl_frontend"
        self.checkout.mkdir(parents=True)
        # The fixture's own environment file, of a name nothing declares: every assertion below reads
        # the arguments the mount was built from, and none reads a file.
        (self.checkout / ".env").write_bytes(b"A_NAME_NOTHING_DECLARES=a value no case reads\n")
        self.argv = self.root / "argv.txt"


def _run(body: str, **overrides: str) -> tuple[int, str, _Fixture]:
    """`_lib.sh`, the lifted reader and a stand-in `docker`, run from a checkout of the fixture's own."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    fixture = _Fixture()
    stubs = fixture.root / "stubs"
    stubs.mkdir()
    # The execute bit is what puts this ahead of a real daemon on PATH.
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    environment["FL_DEPLOY_ARGV"] = str(fixture.argv)
    environment.update(overrides)
    script = fixture.root / "parent.sh"
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        lift_function(DEPLOY, "read_env_names"),
        lift_function(DEPLOY, "check_frontend_env_names"),
        body,
        "",
    )
    done = run_shell(BASH, write_shell(script, "\n".join(lines)), env=environment, cwd=fixture.checkout.parent)
    return done.returncode, done.stdout + done.stderr, fixture


def _workdir() -> str:
    """The directory the runner stage puts the reader and the mount in, read off the image that carries them."""
    declared = set(re.findall(r"^WORKDIR\s+(\S+)$", FRONTEND_DOCKERFILE.read_text(encoding="utf-8"), re.MULTILINE))

    assert declared == {"/app"}, declared
    return declared.pop()


def test_a_name_the_frontend_does_not_declare_refuses_with_nothing_recreated() -> None:
    """Exit 3 is the reader's own answer for the refusal, and nothing else may be graded as one."""
    code, output, _ = _run(FRONTEND_ARM, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="Undeclared environment variables: AUTH_URL_")

    assert code == 2, output
    assert "AUTH_URL_" in output, output
    assert "the frontend refuses this host's environment file" in output, output
    assert "NOTHING has been recreated" in output, output


def test_any_other_answer_from_the_frontend_image_is_an_advisory_the_deploy_survives() -> None:
    """A check that could not be made leaves the deploy where it stood; a refusal would stop it over the checker."""
    code, output, _ = _run(FRONTEND_ARM, FL_DEPLOY_RUN_RC="125", FL_DEPLOY_RUN_SAYS="Error")

    assert code == 0, output
    assert "(exit 125)" in output, output
    assert "fl_frontend/.env" in output, output


def test_what_the_frontend_container_said_goes_through_the_credential_filter() -> None:
    """The frontend schema holds `MONGODB_URI` too, so this arm can print a connection string exactly as the backend's can."""
    code, output, _ = _run(FRONTEND_ARM, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="MONGODB_URI mongodb://user:pw@cluster.example.net/x")

    assert code == 2, output
    assert "user:pw@" not in output, output
    assert "<redacted>@cluster.example.net" in output, output


def test_the_frontend_file_is_mounted_read_only_where_its_own_image_puts_its_working_directory() -> None:
    """A `WORKDIR` change would leave the reader with nothing at the path it defaults to, and the check would pass over every file forever."""
    code, output, fixture = _run(FRONTEND_ARM)
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    mount = next((arg for arg in argv if arg.endswith(":ro")), "")
    # The frontend's own file, not the backend's: one function serves both arms, and the package it
    # was handed is the only thing separating them.
    assert mount.endswith(f"/fl_frontend/.env:{_workdir()}/.env:ro"), argv
    # Neither the image's own user, whose uid this host does not have, nor root.
    assert "--user" in argv, argv
    assert argv[argv.index("--user") + 1] not in ("0:0", "root"), argv
    assert ["--network", "none"] == argv[argv.index("--network") : argv.index("--network") + 2], argv


def test_the_reader_the_arm_runs_is_the_one_the_frontend_image_carries() -> None:
    """The arm names a script rather than a snippet, so a rename in the Dockerfile would leave the deploy running nothing."""
    _, _, fixture = _run(FRONTEND_ARM)
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()
    pattern = r"^COPY --from=builder(?: (--chmod=\S+))? (/app/\S+) (/app/\S+) \./$"
    copied = re.search(pattern, FRONTEND_DOCKERFILE.read_text(encoding="utf-8"), re.MULTILINE)

    assert copied is not None, "fl_frontend/Dockerfile copies no reader into the runner"
    # Left to the builder's umask, a 0600 reader would answer this arm's advisory on every deploy
    # forever -- the one verdict no other case here can tell from a pass.
    assert copied.group(1) == "--chmod=644", copied.group(0)
    assert argv[-2:] == ["node", Path(copied.group(3)).name], argv


def test_the_mount_the_user_and_the_filter_are_one_function_both_arms_reach() -> None:
    """A second copy is how one arm's mount or user drifts from the other's; the verdicts differ because the readers judge different things."""
    text = DEPLOY.read_text(encoding="utf-8")
    asked = re.findall(r"^\s*read_env_names (\S+) (\S+)", text, re.MULTILINE)

    assert len(re.findall(r"^read_env_names\(\) \{$", text, re.MULTILINE)) == 1, text.count("read_env_names")
    assert asked == [("fl_backend", '"$IMAGE_BACKEND"'), ("fl_frontend", '"$IMAGE_FRONTEND"')], asked
    # Both verdict arms are reached by the preflight, and each exactly once.
    assert re.findall(r"^check_\w*env_names$", text, re.MULTILINE) == ["check_env_names", "check_frontend_env_names"], text
