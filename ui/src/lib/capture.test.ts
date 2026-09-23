import { describe, expect, it } from "vitest";
import { captureKind } from "./capture";

describe("captureKind", () => {
  it("recognises bookings, tasks and notes", () => {
    expect(captureKind("/zeit NP-8801 1h")).toBe("zeit");
    expect(captureKind("  /ZEIT NP-8801 1h")).toBe("zeit");
    expect(captureKind("- [ ] Angebot")).toBe("task");
    expect(captureKind("todo Angebot")).toBe("task");
    expect(captureKind("TODO: Angebot")).toBe("task");
    expect(captureKind("todos aufräumen")).toBe("note");
    expect(captureKind("todo")).toBe("note");
    expect(captureKind("Idee")).toBe("note");
  });
});
