"""SCRIPTS · on Windows, every process the gate starts ends with the gate, or with whatever started it.

A stop reaches a POSIX gate as a signal to its process group, while on Windows a stop ending a tree
from its root reaches no further than the launching shell, Git Bash starting a script from a forked
copy of itself that exits once the script runs. A job object holds every process a member starts,
whoever its parent, so the gate joins one before it starts anything and this watcher stops the job,
as a signal to a POSIX group would, once anything that started the gate is gone. Never
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: a crashed watcher would then end the gate without a word.
"""

from __future__ import annotations

import argparse
import ctypes
import os
import signal
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes
from pathlib import Path
from typing import Final

# `scripts/lib/` is a sibling of this directory, and a script's sys.path opens with this one.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import EXIT_INTERRUPTED, EXIT_OK, EXIT_REFUSED, run

# The one line the gate waits for before it starts anything, a process it starts earlier being
# outside the job; a tab and the pools' registry follow it.
ARMED: Final = "armed"

# The job API is Windows' own, and only `scripts/gate/verify.sh` on Windows starts this; read here
# alone, as the one spelling pyright narrows every call below on.
if sys.platform != "win32":
    print("a POSIX gate is stopped by a signal to its process group, which this would only repeat", file=sys.stderr)
    raise SystemExit(EXIT_REFUSED)

FILETIME_P = ctypes.POINTER(wintypes.FILETIME)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.CreateJobObjectW.restype = wintypes.HANDLE
kernel32.CreateJobObjectW.argtypes = (wintypes.LPVOID, wintypes.LPCWSTR)
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
kernel32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
kernel32.TerminateJobObject.argtypes = (wintypes.HANDLE, wintypes.UINT)
kernel32.WaitForSingleObject.restype = wintypes.DWORD
kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
kernel32.WaitForMultipleObjects.restype = wintypes.DWORD
kernel32.WaitForMultipleObjects.argtypes = (wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE), wintypes.BOOL, wintypes.DWORD)
kernel32.GetProcessTimes.argtypes = (wintypes.HANDLE, FILETIME_P, FILETIME_P, FILETIME_P, FILETIME_P)
kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
kernel32.CreateToolhelp32Snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
kernel32.QueryInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD, wintypes.LPDWORD)
kernel32.IsProcessInJob.argtypes = (wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL))
kernel32.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, wintypes.LPDWORD)
kernel32.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
kernel32.CreateEventW.restype = wintypes.HANDLE
kernel32.CreateEventW.argtypes = (wintypes.LPVOID, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR)
kernel32.SetEvent.argtypes = (wintypes.HANDLE,)
HANDLER_ROUTINE = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)
CTRL_C_EVENT: Final = 0
CTRL_BREAK_EVENT: Final = 1


class ProcessEntry(ctypes.Structure):
    """`PROCESSENTRY32W`, the snapshot record naming a process's creator."""

    _fields_ = (
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * wintypes.MAX_PATH),
    )


kernel32.Process32FirstW.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))
kernel32.Process32NextW.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))

SYNCHRONIZE: Final = 0x0010_0000
PROCESS_TERMINATE: Final = 0x0001
PROCESS_SET_QUOTA: Final = 0x0100
PROCESS_QUERY_LIMITED_INFORMATION: Final = 0x1000
# The two rights `AssignProcessToJobObject` asks of the process it is handed, beside the wait's.
GATE_ACCESS: Final = SYNCHRONIZE | PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
LAUNCHER_ACCESS: Final = SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
MEMBER_ACCESS: Final = SYNCHRONIZE | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
TH32CS_SNAPPROCESS: Final = 0x0002
INVALID_HANDLE_VALUE: Final = wintypes.HANDLE(-1).value
WAIT_OBJECT_0: Final = 0
INFINITE: Final = 0xFFFF_FFFF
JOB_OBJECT_BASIC_PROCESS_ID_LIST: Final = 3
ERROR_MORE_DATA: Final = 234
ERROR_INVALID_PARAMETER: Final = 87
MAX_IMAGE_PATH: Final = 32_768

# What every MSYS program loads from its own directory: a process whose image sits beside it takes a
# signal from the gate's `kill`, which ends any other process outright.
MSYS_RUNTIME: Final = "msys-2.0.dll"

# A ceiling on a stopped gate's traps before the job is ended under them; the wait ends once every
# signalled shell has. MEASURED 2026-10-19: a fixture gate's stop 0.20-0.26 s, the slowest trap step
# (two image tags removed) 0.28-0.32 s.
GRACE_S: Final = 30.0
GRACE_POLL_S: Final = 0.05


def _checked(result: object, what: str) -> None:
    if not result:
        raise ctypes.WinError(ctypes.get_last_error(), f"{what} failed")


def _created(process: int) -> int:
    """When the process was created, in the 100 ns ticks every Windows timestamp counts."""
    times = [wintypes.FILETIME() for _ in range(4)]
    _checked(kernel32.GetProcessTimes(process, *(ctypes.byref(each) for each in times)), "GetProcessTimes")
    return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime


def _windows_parents() -> dict[int, int]:
    """The pid Windows recorded as the creator of each running process, which may since have ended and been reused."""
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == INVALID_HANDLE_VALUE:
        raise ctypes.WinError(ctypes.get_last_error(), "CreateToolhelp32Snapshot failed")
    parents: dict[int, int] = {}
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(ProcessEntry)
        found = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while found:
            parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
            found = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        return parents
    finally:
        kernel32.CloseHandle(snapshot)


def image_of(process: int) -> Path:
    """The executable a process runs."""
    size = wintypes.DWORD(MAX_IMAGE_PATH)
    path = ctypes.create_unicode_buffer(size.value)
    _checked(kernel32.QueryFullProcessImageNameW(process, 0, path, ctypes.byref(size)), "QueryFullProcessImageNameW")
    return Path(path.value)


def _job_pids(job: int) -> list[int]:
    """Every process the job holds now, the list doubling until it fits."""
    header = 2 * ctypes.sizeof(wintypes.DWORD)
    capacity = 64
    while True:
        size = header + capacity * ctypes.sizeof(ctypes.c_size_t)
        listing = ctypes.create_string_buffer(size)
        listed = kernel32.QueryInformationJobObject(job, JOB_OBJECT_BASIC_PROCESS_ID_LIST, listing, size, None)
        if not listed and ctypes.get_last_error() != ERROR_MORE_DATA:
            raise ctypes.WinError(ctypes.get_last_error(), "QueryInformationJobObject failed")
        assigned, count = (wintypes.DWORD * 2).from_buffer(listing)
        if listed and count == assigned:
            return list((ctypes.c_size_t * count).from_buffer(listing, header))
        capacity = max(2 * capacity, assigned + 16)


def wind_down(job: int, kill: Path, pools: set[int]) -> int:
    """Stop the job as SIGTERM stops a POSIX group; answer how many signalled shells outlived `GRACE_S`.

    MSYS processes take SIGTERM and natives end; a pool outlives its units as on POSIX, or its shell
    reclaims the directory they still write.
    """
    parents = _windows_parents()
    members: dict[int, tuple[int, bool]] = {}
    try:
        for pid in _job_pids(job):
            handle = kernel32.OpenProcess(MEMBER_ACCESS, False, pid)
            inside = wintypes.BOOL()
            # Gone since the listing, or its pid taken by a process the job does not hold.
            if not handle or not kernel32.IsProcessInJob(handle, job, ctypes.byref(inside)) or not inside:
                if handle:
                    kernel32.CloseHandle(handle)
                continue
            members[pid] = (handle, (image_of(handle).parent / MSYS_RUNTIME).is_file())
        # Up to the forked copy of bash running it and no further, the shell above that being the one
        # whose trap is owed: a launcher between, as a virtualenv's `python.exe` is, ended first would
        # be the pool's ending.
        spared: set[int] = set()
        for pid in pools & set(members):
            while pid in members and pid not in spared:
                spared.add(pid)
                if members[pid][1]:
                    break
                pid = parents.get(pid, 0)
        signalled = [(pid, handle) for pid, (handle, msys) in members.items() if msys and pid not in spared]
        if signalled:
            # In one call and before any native is ended, so no bash sees its child end before its trap is due.
            subprocess.run(
                (str(kill), "-W", "-s", "TERM", *(str(pid) for pid, _ in signalled)),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        for pid, (handle, msys) in members.items():
            if not msys and pid not in spared:
                kernel32.TerminateProcess(handle, EXIT_INTERRUPTED)
        running = [handle for _, handle in signalled]
        deadline = time.monotonic() + GRACE_S
        while running and time.monotonic() < deadline:
            time.sleep(GRACE_POLL_S)
            running = [handle for handle in running if kernel32.WaitForSingleObject(handle, 0) != WAIT_OBJECT_0]
        return len(running)
    finally:
        for handle, _ in members.values():
            kernel32.CloseHandle(handle)


def _watched(pid: int, child: int) -> int | None:
    """A handle on `pid` if it is still what started `child`, else None.

    A pid created after `child` is reused; any other failure to open it raises, the run then
    unwatched rather than calling a launcher it cannot read ended.
    """
    handle = kernel32.OpenProcess(LAUNCHER_ACCESS, False, pid)
    if not handle:
        if ctypes.get_last_error() == ERROR_INVALID_PARAMETER:
            return None
        raise ctypes.WinError(ctypes.get_last_error(), f"OpenProcess on what started the gate (Windows pid {pid}) failed")
    if _created(handle) > _created(child) or kernel32.WaitForSingleObject(handle, 0) == WAIT_OBJECT_0:
        kernel32.CloseHandle(handle)
        return None
    return handle


def _git_launcher(process: int) -> bool:
    """Whether `process` is a Git for Windows launcher, its `bin\\bash.exe` among them, which only starts MSYS's own and waits."""
    return (image_of(process).parent.parent / "usr" / "bin" / MSYS_RUNTIME).is_file()


def launchers_of(ancestors: list[int], gate_pid: int, gate: int) -> dict[int, int] | None:
    """Handles on the gate's launchers by pid, or None where one has ended.

    Every MSYS ancestor, then the topmost's Windows parent read past any Git launcher, which waits on
    the gate when only what ran it is ended.
    """
    handles: dict[int, int] = {}
    child, child_pid = gate, gate_pid
    for pid in ancestors:
        handle = _watched(pid, gate)
        if handle is None:
            return None
        handles[handle] = pid
        child, child_pid = handle, pid
    parents = _windows_parents()
    while (above := parents.get(child_pid)) is not None and (handle := _watched(above, child)) is not None:
        handles[handle] = above
        if not _git_launcher(handle):
            break
        child, child_pid = handle, above
    return handles or None


def take_interrupts(interrupted: int) -> object:
    """Set `interrupted` on the console's Ctrl-C or Ctrl-Break; answer the routine, to be held.

    A shell whose input is no console ignores it, and the natives MSYS starts under it see none;
    taken here, it reaches them all through `wind_down`.
    """

    def on_console(event: int) -> bool:
        if event in (CTRL_C_EVENT, CTRL_BREAK_EVENT):
            kernel32.SetEvent(interrupted)
            return True
        return False

    routine = HANDLER_ROUTINE(on_console)
    # No console attached fails both calls, and there is then no interrupt to take.
    kernel32.SetConsoleCtrlHandler(None, False)
    kernel32.SetConsoleCtrlHandler(routine, True)
    return routine


def first_to_end(*processes: int) -> int:
    """Block until one of the processes ends, and answer which."""
    handles = (wintypes.HANDLE * len(processes))(*processes)
    ended = kernel32.WaitForMultipleObjects(len(processes), handles, False, INFINITE)
    index = ended - WAIT_OBJECT_0
    if not 0 <= index < len(processes):
        raise ctypes.WinError(ctypes.get_last_error(), f"WaitForMultipleObjects answered {ended}")
    return processes[index]


def stopped(launcher: int | None, *, before_running: bool) -> str:
    """The line a gate this watcher ended leaves on its stderr."""
    who = "a process that started this gate" + ("" if launcher is None else f" (Windows pid {launcher})")
    if before_running:
        return f"  !!  {who} had already ended, so the gate was stopped before it ran anything."
    return f"  !!  {who} has ended, so the gate and every process it started were stopped with it."


def outlasted(count: int) -> str:
    """The line naming a stop whose traps outran `GRACE_S`, so what they reclaim may be left behind."""
    return (
        f"  !!  {count} of the gate's shells had not finished cleaning up {GRACE_S:.0f}s after the stop, so they were ended"
        " where they stood, and what they create may be left behind."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="End the gate's processes with the gate, or with whatever started it (Windows).")
    parser.add_argument("--gate", type=int, required=True, help="the gate's own Windows pid")
    parser.add_argument("--launcher", type=int, action="append", default=[], help="an MSYS ancestor's Windows pid, nearest first")
    given = parser.parse_args()

    # Ending here on Ctrl-C would leave the gate's stop to processes that never see one; it is taken
    # as a stop below instead.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGBREAK, signal.SIG_IGN)
    interrupted = kernel32.CreateEventW(None, True, False, None)
    _checked(interrupted, "CreateEventW")
    handler = take_interrupts(interrupted)

    job = kernel32.CreateJobObjectW(None, None)
    _checked(job, "CreateJobObjectW")
    gate = kernel32.OpenProcess(GATE_ACCESS, False, given.gate)
    _checked(gate, f"OpenProcess on the gate (Windows pid {given.gate})")
    # The gate's own MSYS installation's: another's `kill` reaches none of these processes.
    kill = image_of(gate).parent / "kill.exe"
    if not kill.is_file():
        raise FileNotFoundError(f"no {kill.name} beside the gate's bash ({kill.parent}), so a stop could signal nothing")
    _checked(kernel32.AssignProcessToJobObject(job, gate), "AssignProcessToJobObject")

    launchers = launchers_of(given.launcher, given.gate, gate)
    if launchers is None:
        print(stopped(None, before_running=True), file=sys.stderr, flush=True)
        _checked(kernel32.TerminateJobObject(job, EXIT_INTERRUPTED), "TerminateJobObject")
        return EXIT_OK
    # Where each pool the gate starts names itself (`scripts/gate/gate_pool.py :: POOLS`), removed
    # once nothing the gate started is left to read it.
    descriptor, named = tempfile.mkstemp(prefix="fl-gate-pools-")
    os.close(descriptor)
    registry = Path(named)
    try:
        # Bytes: a Windows text stream ends the line in a carriage return, which bash's `read` keeps.
        sys.stdout.buffer.write(f"{ARMED}\t{registry}\n".encode())
        sys.stdout.flush()

        # Ended either way, the gate leaves nothing behind.
        ended = first_to_end(gate, interrupted, *launchers)
        if ended != gate:
            # An interrupt's closing statement is the gate's own (`scripts/lib/_lib.sh :: on_interrupt`).
            if ended != interrupted:
                print(stopped(launchers[ended], before_running=False), file=sys.stderr, flush=True)
            outlived = wind_down(job, kill, {int(pid) for pid in registry.read_bytes().split()})
            if outlived:
                print(outlasted(outlived), file=sys.stderr, flush=True)
        _checked(kernel32.TerminateJobObject(job, EXIT_INTERRUPTED), "TerminateJobObject")
    finally:
        registry.unlink(missing_ok=True)
        # Held to here: a routine collected while registered is a call into freed memory.
        del handler
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(run(main))
