// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Pending } from "./Pending";

describe("a block drawn while its content is read", () => {
  // The harm: a sample's button that the Tab key reaches or a screen reader announces acts on nothing, and the layout
  // guard, which reads boxes, sees neither. The busy region here hides nothing itself, so the block's own wrapper does.
  it("is out of the accessibility tree and inert while its region is busy", () => {
    render(
      <div aria-busy>
        <Pending>
          <Button
            variant="primary"
            label={COPY.shared.verb.adopt}
          />
        </Pending>
      </div>,
    );

    expect(screen.queryByRole("button")).toBeNull();
    const button = screen.getByRole("button", { hidden: true });
    // jsdom acts on no `inert`, so the attribute is read where a browser takes the focus and the press away.
    expect(button.closest("[inert]")).not.toBeNull();
  });
});
