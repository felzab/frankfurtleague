import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { blankComments } from "@/core/blankComments.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC = path.resolve(import.meta.dirname, "..", "..");

/** A shared double's factory, called. */
const DOUBLE = /\b(?:doubleActions|doubleEveryAction|doubleFetch|doubleApiAnswers)\(/;
/** A poll of the page, which gives up after its second. */
const POLL = /\b(?:waitFor|find(?:All)?By\w+)\(/;
/** A press a person makes, through user-event, the two-press helper or a dispatched event. */
const PRESS = /\.(?:click|dblClick|type|keyboard|paste|selectOptions)\(|\bpressTwice\(|\bfireEvent\.\w+\(/;
/** The double's `answered`, taken from its return or read off it. */
const AWAITS = /\banswered\s*[,:}]|\.answered\b/;

/**
 * Whether a test file presses and polls over a shared double without once taking its `answered`. Read
 * per file rather than per press: a press answered by no double polls a render the press alone sets off.
 */
const pollsUnawaited = (source: string): boolean => {
  const code = blankComments(source, "suite.test.ts");

  return DOUBLE.test(code) && POLL.test(code) && PRESS.test(code) && !AWAITS.test(code);
};

describe("a suite polling after a press a shared double answers", () => {
  /* The reader against a sample, where the tree alone could pass a reader that matches nothing:
     every file in it may already await. */
  it("is told apart from one that awaits the answer, presses nothing, or doubles nothing", () => {
    const pressed = "const { calls } = doubleActions({ modules: [] });\nawait user.click(save);\nawait waitFor(() => done());\n";

    assert.equal(pollsUnawaited(pressed), true, "a press polled over a shared double reads as awaited");
    assert.equal(pollsUnawaited(pressed.replace("{ calls }", "{ calls, answered }")), false, "a taken `answered` is missed");
    assert.equal(pollsUnawaited(pressed.replace("user.click(save)", "render(page)")), false, "a mount-only poll is flagged");
    assert.equal(pollsUnawaited(pressed.replace("doubleActions(", "registerDoubles(")), false, "a suite's own double is flagged");
    assert.equal(pollsUnawaited(`// answered\n${pressed}`), true, "a comment naming `answered` counts as taking it");
  });

  /* `docs/frontend/spec.md` §1.9: a poll alone gives up after its second, which an answer and the
     render after it outlast under the gate's parallel load. */
  it("awaits that double's answer somewhere in the file", () => {
    const unawaited = filesUnder(SRC, isTestFile, 350)
      .filter((file) => pollsUnawaited(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

    assert.deepEqual(unawaited, [], "these suites poll after a press a shared double answers, and never await its `answered`");
  });
});
