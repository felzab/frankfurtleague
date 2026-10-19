"""SCRIPTS · on Windows, every process the gate starts ends with the gate, or with whatever started it.

A stop reaches a POSIX gate as a signal to its process group, while on Windows a stop ending a tree
from its root reaches no further than the launching shell, Git Bash starting a script from a forked
copy of itself that exits once the script runs. A job object holds every process a member starts,
whoever its parent, so the gate joins one before it starts anything and this watcher ends the job
once the gate, or anything that started it, is gone. Never `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: a crashed watcher
would then end the gate without a word.
"""

from __future__ import annotations

import argparse
import ctypes
import signal
import sys
from ctypes import wintypes
from pathlib import Path
from typing import Final

# `scripts/lib/` is a sibling of this directory, and a script's sys.path opens with this one.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import EXIT_INTERRUPTED, EXIT_OK, EXIT_REFUSED, run

# The one line the gate waits for before it starts anything: a process it starts earlier is outside
# the job.
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
TH32CS_SNAPPROCESS: Final = 0x0002
INVALID_HANDLE_VALUE: Final = wintypes.HANDLE(-1).value
WAIT_OBJECT_0: Final = 0
INFINITE: Final = 0xFFFF_FFFF


def _checked(result: object, what: str) -> None:
    if not result:
        raise ctypes.WinError(ctypes.get_last_error(), f"{what} failed")


def _created(process: int) -> int:
    """When the process was created, in the 100 ns ticks every Windows timestamp counts."""
    times = [wintypes.FILETIME() for _ in range(4)]
    _checked(kernel32.GetProcessTimes(process, *(ctypes.byref(each) for each in times)), "GetProcessTimes")
    return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime


def _windows_parent(pid: int) -> int | None:
    """The pid Windows recorded as the creator of `pid`, which may since have ended and been reused."""
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == INVALID_HANDLE_VALUE:
        raise ctypes.WinError(ctypes.get_last_error(), "CreateToolhelp32Snapshot failed")
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(ProcessEntry)
        found = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while found:
            if entry.th32ProcessID == pid:
                return int(entry.th32ParentProcessID)
            found = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        return None
    finally:
        kernel32.CloseHandle(snapshot)


def _watched(pid: int, gate: int) -> int | None:
    """A handle on `pid` where it is still the process running before the gate, else None.

    A pid names whoever holds it now: one created after the gate did not start it, and a signalled
    one has ended.
    """
    handle = kernel32.OpenProcess(LAUNCHER_ACCESS, False, pid)
    if not handle:
        return None
    if _created(handle) > _created(gate) or kernel32.WaitForSingleObject(handle, 0) == WAIT_OBJECT_0:
        kernel32.CloseHandle(handle)
        return None
    return handle


def launchers_of(ancestors: list[int], gate_pid: int, gate: int) -> dict[int, int] | None:
    """Handles on what started the gate, keyed to their pids, or None where one has ended.

    Every MSYS ancestor, a stop ending the outermost shell while a wrapper script outlives it; and
    the topmost's Windows parent, a native launcher.
    """
    handles: dict[int, int] = {}
    for pid in ancestors:
        handle = _watched(pid, gate)
        if handle is None:
            return None
        handles[handle] = pid
    above = _windows_parent(ancestors[-1] if ancestors else gate_pid)
    handle = None if above is None else _watched(above, gate)
    if handle is not None and above is not None:
        handles[handle] = above
    return handles or None


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


def main() -> int:
    parser = argparse.ArgumentParser(description="End the gate's processes with the gate, or with whatever started it (Windows).")
    parser.add_argument("--gate", type=int, required=True, help="the gate's own Windows pid")
    parser.add_argument("--launcher", type=int, action="append", default=[], help="an MSYS ancestor's Windows pid, nearest first")
    given = parser.parse_args()

    # Ctrl-C is the gate's to answer (`scripts/lib/_lib.sh :: on_interrupt`): ending here on it would
    # end the gate before its closing statement.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGBREAK, signal.SIG_IGN)

    job = kernel32.CreateJobObjectW(None, None)
    _checked(job, "CreateJobObjectW")
    gate = kernel32.OpenProcess(GATE_ACCESS, False, given.gate)
    _checked(gate, f"OpenProcess on the gate (Windows pid {given.gate})")
    _checked(kernel32.AssignProcessToJobObject(job, gate), "AssignProcessToJobObject")

    launchers = launchers_of(given.launcher, given.gate, gate)
    if launchers is None:
        print(stopped(None, before_running=True), file=sys.stderr, flush=True)
        _checked(kernel32.TerminateJobObject(job, EXIT_INTERRUPTED), "TerminateJobObject")
        return EXIT_OK
    # Bytes: a Windows text stream ends the line in a carriage return, which bash's `read` keeps.
    sys.stdout.buffer.write(ARMED.encode("ascii") + b"\n")
    sys.stdout.flush()

    # Ended either way, the gate leaves nothing behind: an interrupt ends it before the builds its
    # units were waiting on.
    ended = first_to_end(gate, *launchers)
    if ended != gate:
        print(stopped(launchers[ended], before_running=False), file=sys.stderr, flush=True)
    _checked(kernel32.TerminateJobObject(job, EXIT_INTERRUPTED), "TerminateJobObject")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(run(main))
