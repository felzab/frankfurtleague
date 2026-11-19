# Driver: this repository

- Install, and run each check you drive, by the commands of [the writer's addendum](writer.md): its
  sections "Installs" and "The targeted set" give them, and its "Traps" bind your runs too.
- The interpreter that caches compiled files here is Python, so each Python run takes a fresh cache
  folder: `PYTHONPYCACHEPREFIX="$(mktemp -d)" uv run --project fl_backend --frozen pytest <paths>`.
  Git Bash hands the folder to Windows Python as a Windows path.
