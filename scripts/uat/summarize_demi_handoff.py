"""Summarize retained synthetic Sandbox evidence; never calls a service."""
import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "docs/uat/demi-handoff-20261022"
BUSINESS = ["reservations", "product_acquisitions", "student_enrollments", "credit_ledger", "sales", "payments"]
EXPECTED = {
    "burst": (3, 1), "same_payload": (3, 1), "contacts": (2, 2), "media": (2, 2),
    "stale": (2, 1), "replay": (1, 1), "outside": (2, 2),
    "tenant_guard": (0, 0), "signature_guard": (0, 0),
}

def millis(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000

rows = []
for scenario, (event_count, delivery_count) in EXPECTED.items():
    data = json.loads((ROOT / f"burst-{scenario}-3bf191dd.json").read_text())
    before = next(a["payload"] for a in data["artifacts"] if a["kind"] == "before_burst")
    after = next(a["payload"] for a in data["artifacts"] if a["kind"] == "after_burst")
    state = data["state"]
    events = state["assistant_whatsapp_events"]
    deliveries = state["assistant_whatsapp_deliveries"]
    captures = [a for a in data["artifacts"] if a["kind"] == "whatsapp_reply"]
    turns = state["assistant_turns"]
    checks = {
        "no_action_error": not data.get("actionError") and after["failure"] is None,
        "snapshots_complete": all(isinstance(v, list) for v in state.values()) and all(isinstance(v, list) for v in before["state"].values()),
        "event_count": len(events) == event_count,
        "capture_count": len(captures) == delivery_count,
        "delivery_count": len(deliveries) == delivery_count,
        "captured_provider_ids": all(d["status"] == "accepted" and d["provider_message_id"].startswith("uat:") for d in deliveries),
        "business_rows_unchanged": all(state[k] == before["state"][k] for k in BUSINESS),
    }
    phases = [e.get("processing_result", {}).get("phase") for e in events]
    outcomes = [o["outcome"] for response in after["responses"] for o in response["result"].get("outcomes", [])]
    if scenario in ["burst", "same_payload"]:
        checks["superseded_two"] = sum(e["processing_status"] == "ignored" for e in events) == 2
        checks["full_ordered_history"] = [t["content"] for t in turns if t["role"] == "user"] == [m["text"]["body"] for request in after["inputs"] for m in request["messages"]]
        checks["single_assistant_turn"] = sum(t["role"] == "assistant" for t in turns) == 1
    if scenario == "contacts":
        checks["separate_conversations"] = len({e["assistant_conversation_id"] for e in events}) == 2
        checks["separate_recipients"] = len({c["payload"]["recipient"] for c in captures}) == 2
    if scenario == "media":
        checks["image_preserved"] = any(e["message_type"] == "image" for e in events) and all(e["processing_status"] != "ignored" for e in events)
    if scenario == "stale":
        checks["new_text_during_assistant_execution"] = after["observed_model_call_during_first_request"] is True
        checks["post_assistant_suppression"] = "post_assistant" in phases
        checks["only_current_answer"] = len([t for t in turns if t["role"] == "assistant"]) == 1 and "Avenida" in captures[0]["payload"]["text"]
    if scenario == "replay":
        checks["replay_ignored"] = "duplicate_already_handled" in outcomes and len(turns) == 2
    if scenario in ["tenant_guard", "signature_guard"]:
        expected_status = 503 if scenario == "tenant_guard" else 401
        checks["rejected_before_capture"] = after["responses"][0]["http_status"] == expected_status and not turns and not state["assistant_model_calls"]
    first_capture_ms = None
    last_capture_ms = None
    if captures:
        first_capture = min(millis(c["created_at"]) for c in captures)
        first_capture_ms = round(first_capture - min(millis(i["sent_at"]) for i in after["inputs"]))
        last_capture_ms = round(first_capture - max(millis(i["sent_at"]) for i in after["inputs"]))
        # Only meaningful for the one-answer burst. Multi-response/replay cases have separate turns.
    rows.append({
        "scenario": scenario, "status": "PASS" if all(checks.values()) else "FAIL",
        "runId": data["runId"], "studioId": data["studioId"], "checks": checks,
        "events": len(events), "captures": len(captures), "modelCalls": len(state["assistant_model_calls"]),
        "outputTokens": sum(m["output_tokens"] for m in state["assistant_model_calls"]),
        "quietMs": after["quiet_ms"], "phases": [p for p in phases if p], "outcomes": outcomes,
        "firstInputToCaptureMs": first_capture_ms if scenario in ["burst", "same_payload", "stale"] else None,
        "lastInputToCaptureMs": last_capture_ms if scenario in ["burst", "same_payload", "stale"] else None,
    })

old = json.loads((ROOT / "burst-older_replay-3bf191dd.json").read_text())
original = json.loads((ROOT / "burst-burst-3bf191dd.json").read_text())
old_result = next(a["payload"]["result"] for a in old["artifacts"] if a["kind"] == "after_message")
old_checks = {
    "ignored": old_result["outcomes"][0]["outcome"] == "duplicate_already_handled",
    "turns_unchanged": old["state"]["assistant_turns"] == original["state"]["assistant_turns"],
    "model_calls_unchanged": old["state"]["assistant_model_calls"] == original["state"]["assistant_model_calls"],
    "accepted_receipt_unchanged": old["state"]["assistant_whatsapp_deliveries"] == original["state"]["assistant_whatsapp_deliveries"],
    "business_unchanged": all(old["state"][k] == original["state"][k] for k in BUSINESS),
}
summary = {
    "environment": "hedouonyhynuvwbckdlg", "runtimeSha": "3bf191dd57a00b7ee59130e7c70394e75aef3a05",
    "receiverSha": "8575eec3d4aa100c929508ba8b02bff9a16f45fd",
    "rows": rows, "olderReplay": {"status": "PASS" if all(old_checks.values()) else "FAIL", "checks": old_checks},
    "setupFailures": [{"stage": "createDemiUatRun", "httpStatus": 500, "at": "2026-10-22T02:33:54.715Z", "digest": "226521140", "cause": "canceling statement due to statement timeout", "recovered": True}],
    "limits": ["One sample per burst variant; no p95 inference.", "Capture-only transport; no Meta delivery to a person.", "Live before-action database race not exercised; six real-orchestrator runtime tests use fake action executors.", "Image test preserves a synthetic blank image/handoff, not a validated payment receipt.", "Functional UAT and operational regression are pending; pilot remains blocked/inactive."],
}
(ROOT / "burst-summary-3bf191dd.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"scenarios": [(r["scenario"], r["status"]) for r in rows], "olderReplay": summary["olderReplay"]}, ensure_ascii=False))
assert all(r["status"] == "PASS" for r in rows) and all(old_checks.values())
