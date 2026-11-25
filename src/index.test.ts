import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_NAME } from "./index.js";

describe("scaffold", () => {
  it("has a name", () => {
    expect(ORCHESTRATOR_NAME).toBe("apos-orchestrator");
  });
});
