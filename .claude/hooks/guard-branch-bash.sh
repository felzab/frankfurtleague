#!/usr/bin/env bash
#
# PreToolUse hook on Bash — refuses a shell command that WRITES while HEAD is `main`.
#
# WHY THIS EXISTS SEPARATELY FROM guard-branch.sh:
#   That hook matches Edit|Write|NotebookEdit and stops those tools on `main`. It never sees a shell
#   redirect, `sed -i`, a heredoc or a `python -c` that writes — which are the same edit by another
#   route, and in practice the more common one. Guarding only the tools left the rule looking
#   enforced while the usual path around it stayed open.
#
# CONTRACT: prints nothing and exits 0 unless HEAD is `main` AND the command looks like it mutates a
# path inside the repo. Reads (`git log`, `grep`, `cat`) are untouched, and so are writes that
# clearly land outside the working tree.
#
# HOW THE GITIGNORE EXEMPTION IS REACHED HERE, WHERE guard-branch.sh IS HANDED ONE PATH:
#   Asking "does this command mention something ignored?" is the unsafe question: it is a substring
#   test, and `sed -i s/a/b/ src/x.ts && cat docs/audit/r.md` writes one path while mentioning
#   another, so that test would release the command whole. The question asked instead is the
#   inverse — "does it mention anything TRACKED?" — which refuses that example on `src/x.ts`.
#
#   The exemption is granted only for a command simple enough that its targets are all visible, and
#   every condition below must hold. Anything unparseable stays blocked, so the failure direction is
#   always toward asking for a branch:
#     - one simple command: no `&&`, `||`, `;`, `|`, newline, `$(` or backtick, because a second
#       command can write a tracked file while naming none of it (`pnpm format` is the case);
#     - no `cd`, which moves the base every path below is resolved against;
#     - at least one token that git reports ignored AND untracked, so the command is genuinely
#       aimed at the exempt class rather than merely compatible with it;
#     - no token git reports tracked;
#     - no credential-shaped token, refused whatever .gitignore says, exactly as guard-branch.sh
#       refuses it.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

branch="$(git branch --show-current 2>/dev/null)"
[ "$branch" = "main" ] || exit 0

cmd="$(node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try {
    process.stdout.write(JSON.parse(s).tool_input?.command || "");
  } catch {}
});
' 2>/dev/null)"

[ -n "$cmd" ] || exit 0

# Writes landing outside the working tree — the scratchpad, the system temp dir — are fine on any
# branch, and are matched FIRST so a legitimate scratch write is never blocked by the pattern below.
case "$cmd" in
  *scratchpad* | */tmp/* | *"AppData/Local/Temp"*) exit 0 ;;
esac

# `git checkout -b` / `git switch -c` are how a session LEAVES main. Never block the escape hatch.
case "$cmd" in
  *"checkout -b"* | *"switch -c"*) exit 0 ;;
esac

# Matched against a SPACE-PREFIXED copy so a verb at the very start of the command is caught: the
# pattern for `rm` has to be " rm " to avoid matching inside a word, and `rm docs/x` has no leading
# space of its own.
padded=" $cmd"
writes=0
case "$padded" in
  *"sed -i"* | *"sed --in-place"*) writes=1 ;;
  *" tee "* | *"| tee"*)           writes=1 ;;
  *"write_bytes"* | *"write_text"* | *".writelines"*) writes=1 ;;
  *" >> "* | *" > "*)              writes=1 ;;
  *"git commit"* | *"git merge"* | *"git rebase"* | *"git apply"* | *"git restore"*) writes=1 ;;
  *" mv "* | *" cp "* | *" rm "* | *" rmdir "* | *" mkdir "* | *" touch "*) writes=1 ;;
esac

[ "$writes" = "1" ] || exit 0

# A redirect into the null device only — nothing is written anywhere. Tested after the write shapes,
# because a command can redirect its chatter there while writing somewhere real.
case "$cmd" in
  *">/dev/null"* | *"> /dev/null"*)
    case "$cmd" in
      *"sed -i"* | *" tee "* | *"write_bytes"* | *"write_text"* | *"git commit"*) ;;
      *) exit 0 ;;
    esac
    ;;
esac

# The gitignore exemption; the header states what each condition refuses to guess. Matched on the
# padded copy so a verb opening the command is caught -- `rm -rf x` carries no leading space.
case "$padded" in
  *"&&"* | *"||"* | *";"* | *"|"* | *'$('* | *'`'* | *" cd "*) ;;
  # Deletion is never exempt: guard-branch.sh grants writing an ignored path and cannot remove
  # anything, so granting removal would make this hook wider than the one it mirrors.
  *" rm "* | *" rmdir "*) ;;
  *)
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
    if [ -n "$repo_root" ]; then
      saw_ignored=0
      saw_tracked=0
      for token in $cmd; do
        case "$token" in
          -*) continue ;;  # a flag is not a path
          # Refused whatever .gitignore says: the class whose whole purpose is to be ignored is the
          # class that must never be written without a person watching.
          *.env | *.env.* | *.pem | *id_rsa* | *credentials.json | *kubeconfig* | *service-account*)
            saw_tracked=1
            break
            ;;
        esac
        git -C "$repo_root" ls-files --error-unmatch -- "$token" >/dev/null 2>&1 && saw_tracked=1 && break
        if git -C "$repo_root" check-ignore -q -- "$token" >/dev/null 2>&1; then
          git -C "$repo_root" ls-files --error-unmatch -- "$token" >/dev/null 2>&1 || saw_ignored=1
        fi
      done
      [ "$saw_tracked" = "0" ] && [ "$saw_ignored" = "1" ] && exit 0
    fi
    ;;
esac

printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this command writes, and HEAD is main. main is protected and takes changes only through a PR. Branch FIRST — the working tree comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>. Allowed on any branch: the scratchpad or /tmp, and a single simple command whose only named paths are gitignored and untracked — a chain, a substitution, a cd, or any tracked path in the command puts it back here."}}'

exit 0
