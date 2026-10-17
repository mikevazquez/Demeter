import { describe, expect, it } from "vitest";
import {
  isTrustedStateComment,
  nextState,
  parseState,
  serializeState,
} from "../../scripts/automation/continuity-lab.mjs";

describe("continuity lab 315", () => {
  it("starts only with explicit start", () => {
    expect(nextState(null, "resume", 22)).toBeNull();
    expect(nextState(null, "start", 22)).toEqual({
      phase: "waiting",
      startedBy: 22,
      completedBy: null,
    });
  });

  it("continues only in a distinct run", () => {
    const state = nextState(null, "start", 22);
    expect(() => nextState(state, "resume", 22)).toThrow("separate");
    expect(nextState(state, "resume", 23)).toEqual({
      phase: "complete",
      startedBy: 22,
      completedBy: 23,
    });
  });

  it("replay cannot duplicate completion", () => {
    const first = nextState(null, "start", 22);
    expect(nextState(first, "start", 24)).toBeNull();
    const complete = nextState(first, "resume", 23);
    expect(nextState(complete, "resume", 25)).toBeNull();
    expect(nextState(complete, "start", 26)).toBeNull();
  });

  it("rejects malformed or inconsistent persisted records", () => {
    expect(() => nextState({ phase: "waiting" }, "start", 28)).toThrow();
    expect(() =>
      nextState({ phase: "waiting", startedBy: 22, completedBy: 23 }, "resume", 24),
    ).toThrow();
    expect(() => parseState('<!-- continuity-lab-315:v1 -->\n{"phase":"waiting"}')).toThrow();
  });

  it("round-trips the strict persistent marker", () => {
    const state = nextState(null, "start", 22);
    expect(parseState(serializeState(state))).toEqual(state);
    expect(parseState("ordinary issue comment")).toBeNull();
    expect(() =>
      parseState(
        '<!-- continuity-lab-315:v1 -->\n{"phase":"waiting","startedBy":22,"completedBy":null,"admin":true}',
      ),
    ).toThrow("Unexpected");
  });

  it("ignores forged state comments from ordinary users", () => {
    expect(
      isTrustedStateComment({
        user: { login: "github-actions[bot]", type: "Bot" },
      }),
    ).toBe(true);
    expect(
      isTrustedStateComment({
        user: { login: "external-user", type: "User" },
      }),
    ).toBe(false);
    expect(
      isTrustedStateComment({
        user: { login: "github-actions[bot]", type: "User" },
      }),
    ).toBe(false);
    expect(isTrustedStateComment(null)).toBe(false);
  });

  it("rejects invalid run IDs and triggers", () => {
    expect(() => nextState(null, "start", 0)).toThrow();
    expect(() => nextState(null, "deploy", 22)).toThrow();
  });
});
