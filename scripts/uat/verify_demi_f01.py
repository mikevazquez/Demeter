"""Verify the retained real Sandbox F01 runs, including effects and old-event replay."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2] / "docs/uat/demi-f01-20261022"
names = ["matching", "changed_date", "changed_time", "negation", "conditional", "short_confirmation"]
commercial = ["reservations", "credit_ledger", "product_acquisitions",
              "student_enrollments", "sales", "payments"]

def same(before, after, tables):
    return all(sorted(before[t], key=lambda r: r["id"]) ==
               sorted(after[t], key=lambda r: r["id"]) for t in tables)

def steps(data):
    ordered = sorted(data["artifacts"], key=lambda a: a["created_at"])
    result = []
    for after in (a for a in ordered if a["kind"] == "after_message"):
        before = next(a for a in reversed(ordered)
                      if a["kind"] == "before_message"
                      and a["created_at"] < after["created_at"]
                      and a["payload"]["provider_id"] == after["payload"]["provider_id"])
        result.append((before["payload"], after["payload"]))
    return result

reports = []
for name in names:
    data = json.loads((root / (name + ".json")).read_text())
    assert data["completed"], name
    student = data["run"]["fixtures"]["people"]["student_active"]["student_id"]
    acquisition = next(a["id"] for a in data["state"]["product_acquisitions"]
                       if a["student_id"] == student)
    balance = sum(l["quantity"] for l in data["state"]["credit_ledger"]
                  if l["acquisition_id"] == acquisition)
    reservations = [r for r in data["state"]["reservations"] if r["student_id"] == student]
    stages = steps(data)
    replies = [a for a in sorted(data["artifacts"], key=lambda a: a["created_at"])
               if a["kind"] == "whatsapp_reply"]
    checks = {
        "exact_sandbox_and_runtime": data["environment"] == "hedouonyhynuvwbckdlg"
            and data["runtimeSha"] == "5feefafb38a98e57a91b749e514a52c0a1212a8b",
        "all_snapshots_checked_and_retained_tables_present": len(data["snapshotTableNames"]) == 33
            and all(t in data["state"] for t in data["retainedStateTables"]),
        "http_and_receiver_succeeded": all(o["httpStatus"] == 200 for o in data["observations"])
            and all(after["http_status"] == 200 and after["result"]["ok"] for _, after in stages),
        "preparation_has_no_commercial_effect": same(stages[0][0]["state"], stages[0][1]["state"], commercial),
        "all_replies_captured": len(replies) == 2 and all(a["payload"]["captured"] and not a["payload"]["failed"] for a in replies),
    }
    if name in ["matching", "short_confirmation"]:
        initial_ids = {l["id"] for l in data["initialState"]["credit_ledger"]}
        new_debits = [l for l in data["state"]["credit_ledger"]
                      if l["id"] not in initial_ids and l["acquisition_id"] == acquisition]
        event = next(e for e in data["state"]["assistant_whatsapp_events"]
                     if e["provider_event_id"] == stages[1][1]["provider_id"])
        checks.update({
            "one_reservation_one_credit": balance == 7 and len(reservations) == 1
                and reservations[0]["status"] == "reserved" and len(new_debits) == 1
                and new_debits[0]["quantity"] == -1,
            "confirmation_uses_no_model_or_preparation": event["processing_result"]["trace"]["modelCalls"] == 0
                and event["processing_result"]["trace"]["toolCalls"] == [{"name": "execute_booking", "status": "executed"}]
                and len(stages[1][0]["state"]["assistant_model_calls"]) == len(stages[1][1]["state"]["assistant_model_calls"])
                and len(stages[1][0]["state"]["assistant_pending_actions"]) == len(stages[1][1]["state"]["assistant_pending_actions"]) == 1,
            "confirmation_reply_does_not_ask_again": "confirmada" in replies[1]["payload"]["text"].lower()
                and "?" not in replies[1]["payload"]["text"],
        })
        if name == "matching":
            checks["replay_is_ignored_without_effect_or_response"] = len(stages) == 3 and stages[2][1]["result"]["outcomes"][0]["outcome"] == "duplicate_already_handled" and same(
                stages[2][0]["state"], stages[2][1]["state"],
                commercial + ["assistant_turns", "assistant_model_calls", "assistant_whatsapp_deliveries"])
    else:
        checks.update({
            "negative_preserves_all_six_commercial_tables": same(data["initialState"], data["state"], commercial),
            "negative_does_not_book_or_debit": balance == 8 and not reservations,
            "negative_never_executes_booking_successfully": not any(
                t["tool_name"] == "execute_booking" and t["result_json"].get("ok")
                for t in data["state"]["assistant_tool_executions"]),
        })
    reports.append({
        "case": name, "runId": data["run"]["id"], "studioId": data["run"]["studio_id"],
        "status": "PASS" if all(checks.values()) else "FAIL", "checks": checks,
        "balance": balance, "reservationIds": [r["id"] for r in reservations],
        "confirmationMessage": data["observations"][1]["message"],
        "confirmationReply": replies[1]["payload"]["text"],
    })

cleanup = json.loads((root / "cleanup-audit.json").read_text())
access = json.loads((root / "access-cleanup.json").read_text())
closure_checks = {
    "twelve_new_events_and_captured_replies": cleanup["before"]["event_count"] == 12 and cleanup["before"]["captured_replies"] == 12,
    "worker_attempts_captured_only": cleanup["before"]["uncaptured_attempts"] == 0,
    "bank_keeps_integral_cases_partial": len(cleanup["before"]["case_results"]) == 6 and all(c["status"] == "partial" and c["commit"] == "5feefafb38a98e57a91b749e514a52c0a1212a8b" for c in cleanup["before"]["case_results"]),
    "temporary_account_revoked": cleanup["after"]["account_status"] == "disabled" and cleanup["after"]["banned"] and all(cleanup["after"][k] == 0 for k in ["sessions", "refresh_tokens", "active_memberships", "pending_followups"]),
    "leases_released": all(r["lease_until"] is None for r in cleanup["after"]["run_leases"]),
    "old_browser_and_new_login_denied": access["staleSessionDenied"] and access["loginHttpStatus"] == 400 and access["loginError"] == "user_banned",
    "private_access_files_removed": access["privateFilesAbsent"],
}
report = {
    "environment": "hedouonyhynuvwbckdlg",
    "runtimeSha": "5feefafb38a98e57a91b749e514a52c0a1212a8b",
    "deployment": "dpl_C9X83NHvNyoGqRYQ8LAxf5BrpPhP",
    "status": "PASS" if all(r["status"] == "PASS" for r in reports) and all(closure_checks.values()) else "FAIL",
    "closureChecks": closure_checks,
    "cases": reports, "functionalUat": "PENDING", "pilot": "BLOCKED_INACTIVE",
    "supersededFailure": {"runtimeSha": "55f59c2cef805908d45748a06c205dcc8ad60a67",
                          "evidenceSha": "daa32acebfa4b7cdef92fb6145991c761ee0628a",
                          "status": "FAILED", "case": "F01 detailed confirmation"},
}
path = root / "summary.json"
if not path.exists() or json.loads(path.read_text()) != report:
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
assert report["status"] == "PASS"
