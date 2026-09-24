import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withoutPythonComments } from "./refusalRegister.ts";

describe("the comment cut every reader of the backend's Python shares", () => {
  it("cuts a comment beside a literal and on a line of its own", () => {
    assert.equal(
      withoutPythonComments('    "E1",  # the first half-year\n    # a quote "inside" a comment\n    "Q4",'),
      '    "E1",  \n    \n    "Q4",',
    );
  });

  // The cut a line comment makes inside a string leaves that literal's opening quote unmatched, and a
  // reader of the survivors would take the stub for the whole value.
  it("refuses a hash inside a string literal rather than cutting the literal short", () => {
    assert.throws(() => withoutPythonComments('    code="REQ-#1",'), /inside a string literal/);
  });

  it("leaves a line with no hash as it stands, a docstring's quotes among them", () => {
    assert.equal(withoutPythonComments('    """The register."""\n    """'), '    """The register."""\n    """');
  });
});
