const recorded: string[] = [];
const finalJudges: (() => void)[] = [];

const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export function recordVerdict(where: string, failure: unknown): void {
  recorded.push(`- ${where}: ${messageOf(failure)}`);
}

/**
 * Records a hook's failed judgement rather than throwing it: a hook that throws stops node:test running
 * the cleanup registered after it (`docs/frontend/spec.md` §1.9).
 */
export function judging(where: string, judge: () => void): void {
  try {
    judge();
  } catch (failure) {
    recordVerdict(where, failure);
  }
}

/** A judgement for the process's own end, run before the recorded failures are thrown. */
export function judgeAtProcessEnd(judge: () => void): void {
  finalJudges.push(judge);
}

// Once every hook has run and the event loop is empty: the one place after all cleanup, where a throw
// fails the file and the runner prints the message.
process.once("beforeExit", () => {
  for (const judge of finalJudges.splice(0)) judging("the file's end", judge);
  if (recorded.length === 0) return;

  throw new Error(`a judging hook recorded ${String(recorded.length)} failure(s), surfaced after every cleanup:\n${recorded.join("\n")}`);
});
