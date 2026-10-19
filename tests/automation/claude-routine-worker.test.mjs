import { describe, expect, it } from "vitest";
import {
  buildRoutineText,
  classifyRoutineError,
  dispatchFingerprint,
  fireClaudeRoutine,
  validateRoutineFireUrl,
} from "../../scripts/automation/claude-routine-worker.mjs";

const contract = {
  task_id: "GOV-PILOT-02",
  objective: "Run a safe repository maintenance task",
  repo: "mikevazquez/Demeter",
  branch: "feat/governance-claude-routine-bridge",
  base_sha: "a".repeat(40),
  acceptance_criteria: ["No production changes"],
  definition_of_done: ["Checkpoint returned"],
  forbidden: ["merge main", "production deploy"],
};

describe("Claude Code routine worker adapter", () => {
  it("accepts only the Anthropic routine fire endpoint", () => {
    expect(
      validateRoutineFireUrl(
        "https://api.anthropic.com/v1/claude_code/routines/trig_example123/fire",
      ),
    ).toBe(
      "https://api.anthropic.com/v1/claude_code/routines/trig_example123/fire",
    );

    expect(() =>
      validateRoutineFireUrl(
        "https://evil.example/v1/claude_code/routines/trig_example123/fire",
      ),
    ).toThrow("api.anthropic.com");
  });

  it("serializes the task contract without changing task_id", () => {
    const text = buildRoutineText(contract);
    expect(text).toContain('"task_id": "GOV-PILOT-02"');
    expect(text).toContain("Preserve task_id exactly");
    expect(text).toContain("Do not broaden scope");
    expect(text).toContain(`Dispatch fingerprint: ${dispatchFingerprint(contract)}`);\n    expect(text).toContain("status must be lowercase completed, blocked, or failed");\n    expect(text).toContain("tests_passed must be an array");
  });

  it("maps subscription limit responses to no_capacity", () => {
    expect(classifyRoutineError(429)).toBe("no_capacity");
    expect(classifyRoutineError(503)).toBe("degraded");
    expect(classifyRoutineError(401)).toBe("disconnected");
  });

  it("returns a stable dispatch fingerprint", () => {
    expect(dispatchFingerprint(contract)).toMatch(/^[a-f0-9]{64}$/);
    expect(dispatchFingerprint(contract)).toBe(dispatchFingerprint({ ...contract }));
  });

  it("fires a routine and returns the Claude session reference", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            type: "routine_fire",
            claude_code_session_id: "session_test_123",
            claude_code_session_url: "https://claude.ai/code/session_test_123",
          };
        },
      };
    };

    const result = await fireClaudeRoutine({
      fireUrl:
        "https://api.anthropic.com/v1/claude_code/routines/trig_example123/fire",
      token: "secret-test-token",
      contract,
      fetchImpl,
    });

    expect(result.status).toBe("dispatched");
    expect(result.worker_id).toBe("claude-code-web");
    expect(result.task_id).toBe(contract.task_id);
    expect(result.worker_state).toBe("busy");
    expect(result.claude_code_session_id).toBe("session_test_123");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.Authorization).toBe("Bearer secret-test-token");
    expect(calls[0].init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(calls[0].init.body).text).toContain(contract.task_id);
  });

  it("returns no_capacity for a 429 without retrying", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: false,
        status: 429,
        async json() {
          return {
            type: "error",
            error: { type: "rate_limit_error", message: "usage limit reached" },
          };
        },
      };
    };

    const result = await fireClaudeRoutine({
      fireUrl:
        "https://api.anthropic.com/v1/claude_code/routines/trig_example123/fire",
      token: "secret-test-token",
      contract,
      fetchImpl,
    });

    expect(calls).toBe(1);
    expect(result.status).toBe("rejected");
    expect(result.worker_state).toBe("no_capacity");
    expect(result.http_status).toBe(429);
  });

  it("marks network uncertainty and does not claim success", async () => {
    const result = await fireClaudeRoutine({
      fireUrl:
        "https://api.anthropic.com/v1/claude_code/routines/trig_example123/fire",
      token: "secret-test-token",
      contract,
      fetchImpl: async () => {
        throw new Error("connection reset");
      },
    });

    expect(result.status).toBe("uncertain");
    expect(result.worker_state).toBe("degraded");
    expect(result.claude_code_session_id).toBeUndefined();
  });
});
