"""The deploy's verdict, driven through `scripts/ops/deploy.sh` itself behind a stand-in engine

No case can run the script against a real engine, which is the server's alone. Each copies it with
`_lib.sh` into a fixture tree of its own, where it `cd`s and writes `.env`, and puts a stand-in
`docker` and `uname` first on PATH. The stand-in answers `docker compose ps` as Docker documents it
(https://docs.docker.com/reference/cli/docker/compose/ps/): only running containers by default, and
with `--all` the stopped ones too, a one-off container `docker compose run` left among them.
"""

from __future__ import annotations

import os
import shutil
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, new_root, run_shell, write_shell

PREVIOUS: Final = "sha-aaaaaaa"
NEW: Final = "sha-bbbbbbb"
SERVICES: Final = ("frontend", "backend", "nginx", "cloudflared")
HEALTHY: Final = {"frontend": "running healthy", "backend": "running healthy", "nginx": "running", "cloudflared": "running healthy"}
SAID_HEALTHY: Final = "every service is running and healthy"

# Every engine call the script makes, logged one per line with the tag it ran under. `ps` reads the
# containers of the tag the script exported, `service state health` a line, and prints the stopped
# ones and the one-offs only under `--all`. `unread.<tag>` names the read that fails under a tag.
DOCKER: Final = r"""#!/usr/bin/env bash
d="$FL_DEPLOY_DIR"
printf '%s TAG=%s\n' "$*" "${TAG-}" >> "$d/calls"
[[ "$1" == compose ]] || exit 0
shift
unread="$(cat "$d/unread.${TAG-}" 2>/dev/null)"
case "$1" in
  up) exit "$(cat "$d/up.$TAG" 2>/dev/null || printf 0)" ;;
  config)
    if [[ "$unread" == config-fails ]]; then printf '%s\n' 'service "backend" refers to undefined secret' >&2; exit 15; fi
    if [[ "$unread" != config-empty ]]; then printf '%s\n' frontend backend nginx cloudflared; fi ;;
  logs) if [[ " $* " == *" --since "* ]]; then printf '%s\n' '2026/11/12 08:46:11 [notice] 1#1: start worker processes'; fi ;;
  ps)
    if [[ "$unread" == ps-fails ]]; then printf '%s\n' 'Cannot connect to the Docker daemon' >&2; exit 1; fi
    all=0 format=0
    for arg in "$@"; do
      case "$arg" in --all|-a) all=1 ;; --format) format=1 ;; esac
    done
    if (( ! format )); then printf '%s\n' 'NAME SERVICE STATUS'; exit 0; fi
    while read -r service state health; do
      if (( all )) || [[ "$state" == running ]]; then printf '%s %s %s\n' "$service" "$state" "${health-}"; fi
    done < "$d/containers.$TAG"
    if (( all )) && [[ -f "$d/one-offs" ]]; then cat "$d/one-offs"; fi ;;
esac
exit 0
"""

UNAME: Final = "#!/usr/bin/env bash\nprintf '%s\\n' Linux\n"


def containers(**states: str | None) -> str:
    """The project's containers as `service state health` lines: `HEALTHY` with `states` over it, None removing one."""
    merged = HEALTHY | states
    return "".join(f"{service} {merged[service]}\n" for service in SERVICES if merged.get(service) is not None)


def deploy(
    *args: str,
    new: str = containers(),
    previous: str = containers(),
    new_up: int = 0,
    previous_up: int = 0,
    one_offs: str = "",
    unread: dict[str, str] | None = None,
) -> tuple[int, str, str, list[str], str]:
    """One run deploying `NEW` over a stack pinning `PREVIOUS`: its exit code, stdout, stderr, the engine calls and the `.env` it left."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-deploy-")
    for script in ("scripts/ops/deploy.sh", "scripts/lib/_lib.sh"):
        (root / script).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / script, root / script)
    (root / ".env").write_bytes(f"TAG={PREVIOUS}\n".encode())
    engine = new_root("fl-deploy-engine-")
    stubs = engine / "stubs"
    stubs.mkdir()
    for name, text in (("docker", DOCKER), ("uname", UNAME)):
        os.chmod(write_shell(stubs / name, text), 0o755)
    (engine / f"containers.{NEW}").write_bytes(new.encode())
    (engine / f"containers.{PREVIOUS}").write_bytes(previous.encode())
    (engine / f"up.{NEW}").write_bytes(str(new_up).encode())
    (engine / f"up.{PREVIOUS}").write_bytes(str(previous_up).encode())
    if one_offs:
        (engine / "one-offs").write_bytes(one_offs.encode())
    for tag, read in (unread or {}).items():
        (engine / f"unread.{tag}").write_bytes(read.encode())
    environment = base_env() | {"PATH": str(stubs) + os.pathsep + os.environ["PATH"], "FL_DEPLOY_DIR": engine.as_posix()}
    environment.pop("TAG", None)
    done = run_shell(BASH, root / "scripts/ops/deploy.sh", NEW, *args, env=environment, cwd=root)
    calls = (engine / "calls").read_bytes().decode().splitlines()
    return done.returncode, done.stdout, done.stderr, calls, (root / ".env").read_bytes().decode()


def last_line(stream: str) -> str:
    return [line for line in stream.splitlines() if line.strip()][-1]


def went_back(calls: list[str]) -> bool:
    return any(call.startswith("compose up ") and call.endswith(f"TAG={PREVIOUS}") for call in calls)


def reloaded_nginx(calls: list[str]) -> bool:
    """Whether nginx was sent this checkout's `nginx/`, which going back leaves as pulled and loaded."""
    return any(call.startswith("compose exec -T nginx nginx -s reload ") for call in calls)


@pytest.mark.parametrize(
    ("named", "new"),
    [
        pytest.param("frontend", containers(frontend="running starting"), id="starting"),
        pytest.param("cloudflared", containers(cloudflared="exited"), id="no-running-container"),
        pytest.param("nginx", containers(nginx=None), id="no-container-at-all"),
        pytest.param("backend", containers() + "backend running unhealthy\n", id="one-of-two-containers-unhealthy"),
    ],
)
def test_a_service_the_last_read_names_goes_back_although_up_answered_0(named: str, new: str):
    """`up --wait` judges each service once, and on some Compose releases answers 0 at its timeout with one still starting."""
    code, out, err, calls, pinned = deploy(new=new)

    assert code == 1, out + err
    assert went_back(calls), calls
    assert pinned == f"TAG={PREVIOUS}\n"
    assert f"so the stack went back to {PREVIOUS}, which is live." in last_line(err) and named in last_line(err), err
    assert f"compose logs --tail=60 {named} TAG={NEW}" in calls, calls
    assert SAID_HEALTHY not in out + err
    assert not reloaded_nginx(calls), calls


def test_a_stopped_one_off_container_names_nothing():
    """`ps --all` lists the container a `docker compose run` left under its service's name; the read must not."""
    code, out, err, calls, pinned = deploy(one_offs="backend exited \n")

    assert code == 0, out + err
    assert f"{NEW} is live." in last_line(out), out
    assert SAID_HEALTHY in out
    assert pinned == f"TAG={NEW}\n"
    assert not went_back(calls)
    assert reloaded_nginx(calls), calls


@pytest.mark.parametrize("read", ["ps-fails", "config-fails", "config-empty"])
def test_a_read_compose_cannot_answer_judges_nothing_live(read: str):
    """A list naming no defined service names none failing, so it is no answer either."""
    code, out, err, calls, pinned = deploy(unread={NEW: read})

    assert code == 1, out + err
    assert went_back(calls), calls
    assert pinned == f"TAG={PREVIOUS}\n"
    assert "compose could not read each service's state" in last_line(err), err
    assert f"so the stack went back to {PREVIOUS}, which is live." in last_line(err), err
    assert SAID_HEALTHY not in out + err
    assert not reloaded_nginx(calls), calls


def test_a_rollback_whose_build_does_not_come_up_is_never_called_live():
    code, out, err, calls, pinned = deploy(new_up=1, previous_up=1)

    assert code == 1, out + err
    assert went_back(calls), calls
    assert pinned == f"TAG={PREVIOUS}\n"
    assert f"{PREVIOUS} did not come up either" in last_line(err), err
    assert "which is live" not in out + err


def test_a_rollback_whose_build_reads_unhealthy_is_never_called_live():
    """The failed `up` comes first: its account names the service from a read of its own, since no read ran before it."""
    code, out, err, calls, pinned = deploy(
        new_up=1, new=containers(frontend="running unhealthy"), previous=containers(backend="running unhealthy")
    )

    assert code == 1, out + err
    assert f"compose logs --tail=60 frontend TAG={NEW}" in calls, calls
    assert went_back(calls), calls
    assert pinned == f"TAG={PREVIOUS}\n"
    assert f"{PREVIOUS} did not come up either" in last_line(err), err
    assert "which is live" not in out + err


def test_a_rollback_whose_read_compose_cannot_answer_says_only_that():
    """The run knows the previous build's `up` answered 0 and nothing of its services, so it says neither live nor down."""
    code, out, err, calls, pinned = deploy(new_up=1, unread={PREVIOUS: "ps-fails"})

    assert code == 1, out + err
    assert went_back(calls), calls
    assert pinned == f"TAG={PREVIOUS}\n"
    said = last_line(err)
    assert f"the stack went back to {PREVIOUS}, but compose could not read each service's state after it" in said, err
    assert "did not come up either" not in said and "which is live" not in said, err


def test_no_rollback_stops_on_a_service_the_last_read_names():
    code, out, err, calls, pinned = deploy("--no-rollback", new=containers(backend="running unhealthy"))

    assert code == 1, out + err
    assert not went_back(calls), calls
    assert pinned == f"TAG={NEW}\n"
    assert "--no-rollback leaves the stack as it stands" in err and "backend" in err, err
