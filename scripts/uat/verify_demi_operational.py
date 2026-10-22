"""Check retained operational evidence; a known conversation failure stays failed."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2] / "docs/uat/demi-operational-20261022"
booking = json.loads((root / "booking.json").read_text())
negative = json.loads((root / "negatives.json").read_text())

def steps(run):
    ordered = sorted(run["artifacts"], key=lambda a: a["created_at"])
    result = []
    for after in (a for a in ordered if a["kind"] == "after_message"):
        before = next(a for a in reversed(ordered)
                      if a["kind"] == "before_message"
                      and a["created_at"] < after["created_at"]
                      and a["payload"]["provider_id"] == after["payload"]["provider_id"])
        result.append({"message": before["payload"]["text"],
                       "persona": before["payload"]["persona"],
                       "providerId": after["payload"]["provider_id"],
                       "state": after["payload"]["state"],
                       "before": before["payload"]["state"],
                       "result": after["payload"]["result"]})
    return result

def rights(state, run, persona):
    student = run["run"]["fixtures"]["people"][persona]["student_id"]
    acquisitions = {a["id"] for a in state["product_acquisitions"] if a["student_id"] == student}
    reservations = [r for r in state["reservations"] if r["student_id"] == student]
    return {"balance": sum(l["quantity"] for l in state["credit_ledger"]
                           if l["acquisition_id"] in acquisitions),
            "reserved": [r for r in reservations if r["status"] == "reserved"],
            "allReservations": reservations}

def unchanged(before, after, tables):
    return all(sorted(before[t], key=lambda r: r["id"]) ==
               sorted(after[t], key=lambda r: r["id"]) for t in tables)

bs, ns = steps(booking), steps(negative)
assert len(bs) == 9 and len(ns) == 4, (len(bs), len(ns))
r = [rights(s["state"], booking, "student_active") for s in bs]
before_error = bs[5]["state"]["assistant_tool_executions"][-1]["result_json"]
after_error = bs[6]["state"]["assistant_tool_executions"][-1]["result_json"]
recovery = bs[7]["state"]["assistant_tool_executions"][-1]["result_json"]
commercial = ["reservations", "credit_ledger", "product_acquisitions",
              "student_enrollments", "sales", "payments"]
checks = {
    "sandbox_only": all(d["environment"] == "hedouonyhynuvwbckdlg" for d in [booking, negative]),
    "all_snapshot_queries_succeeded": all(not (isinstance(v, dict) and "error" in v)
        for s in bs + ns for v in s["state"].values()),
    "prepare_does_not_book_or_debit": r[0]["balance"] == 8 and not r[0]["reserved"],
    "short_confirmation_creates_one_reservation_and_debit": r[2]["balance"] == 7 and len(r[2]["reserved"]) == 1,
    "cancellation_returns_one_credit": r[3]["balance"] == 8 and not r[3]["reserved"]
        and r[3]["allReservations"][0]["status"] == "cancelled_on_time",
    "new_date_prepared_without_booking": r[4]["balance"] == 8 and not r[4]["reserved"],
    "failure_before_effect_is_real_and_atomic": before_error.get("error") == "booking_execution_failed"
        and before_error.get("inject_failure_before") is True
        and r[5]["balance"] == 8 and not r[5]["reserved"],
    "unknown_outcome_has_one_persisted_booking": after_error.get("outcome_unknown") is True
        and r[6]["balance"] == 7 and len(r[6]["reserved"]) == 1,
    "retry_uses_same_persisted_reservation_once": recovery.get("ok") is True
        and r[7]["balance"] == 7 and len(r[7]["reserved"]) == 1
        and r[7]["reserved"][0]["id"] == r[6]["reserved"][0]["id"],
    "cancelled_old_and_reserved_new_both_correct": len(r[7]["allReservations"]) == 2
        and {z["status"] for z in r[7]["allReservations"]} == {"cancelled_on_time", "reserved"}
        and r[7]["reserved"][0]["session_id"] == booking["run"]["fixtures"]["sessions"]["alternative"],
    "old_event_replay_has_no_new_turn_delivery_or_effect": unchanged(bs[8]["before"], bs[8]["state"],
        commercial + ["assistant_turns", "assistant_model_calls", "assistant_whatsapp_deliveries"]),
    "all_three_business_negatives_preserve_commercial_state": all(
        unchanged(s["before"], s["state"], commercial) for s in ns),
    "full_class_waitlist_only": ns[1]["state"]["assistant_tool_executions"][-1]["result_json"].get("ok") is True
        and not rights(ns[1]["state"], negative, "student_active")["reserved"],
    "expired_package_not_consumed": not rights(ns[2]["state"], negative, "student_expired_package")["reserved"],
    "no_credits_not_booked": not rights(ns[3]["state"], negative, "student_cash")["reserved"],
}
natural_failure = any(t["result_json"].get("error") == "explicit_confirmation_required"
                      for t in bs[1]["state"]["assistant_tool_executions"])
sql = json.loads((root / "sql-results.json").read_text())
trial = json.loads((root / "trial-credit-results.json").read_text())
sql_results = [r for suite in sql["suites"] for r in suite["results"]] + trial["results"]
checks["sql_36_passed_with_rollback"] = len(sql_results) == 36 and all(r["passed"] for r in sql_results)
checks["known_failure_preserved"] = natural_failure
cleanup = json.loads((root / "cleanup-audit.json").read_text())
access = json.loads((root / "access-cleanup.json").read_text())
waitlist = json.loads((root / "waitlist.json").read_text())["entries"]
checks["waitlist_persisted_once_without_promotion"] = len(waitlist) == 1 and waitlist[0]["status"] == "active" and waitlist[0]["promoted_reservation_id"] is None
checks["twelve_events_and_captured_replies"] = cleanup["before"]["event_count"] == 12 and cleanup["before"]["captured_replies"] == 12
checks["worker_deliveries_captured_only"] = cleanup["before"]["uncaptured_attempts"] == 0
checks["access_revoked_and_flags_restored"] = cleanup["after"]["account_status"] == "disabled" and cleanup["after"]["banned"] and cleanup["after"]["faults_restored"] and all(cleanup["after"][k] == 0 for k in ["sessions", "refresh_tokens", "pending_followups", "active_memberships"])
checks["old_session_and_new_login_denied"] = access["staleSessionDenied"] and access["loginHttpStatus"] == 400 and access["loginError"] == "user_banned" and access["privateFilesAbsent"]
checks["failed_bank_case_not_approved"] = {c["case"]: c["status"] for c in cleanup["before"]["case_results"]} == {"M13": "failed", "M09": "partial", "M10": "partial", "M07": "partial"}
report = {
    "sourceSha": booking["sourceSha"], "runtimeSha": booking["runtimeSha"],
    "environment": booking["environment"], "deployment": booking["deployment"],
    "transport": "captured", "status": "PARTIAL_WITH_FAILURE",
    "checks": checks, "sqlChecksPassed": sum(bool(x["passed"]) for x in sql_results),
    "runs": [booking["run"]["id"], negative["run"]["id"]],
    "bookingSteps": [{"message": s["message"], "providerId": s["providerId"],
        "balance": rr["balance"], "reservations": [{"id": z["id"], "status": z["status"],
        "sessionId": z["session_id"]} for z in rr["allReservations"]]}
        for s, rr in zip(bs, r)],
    "failures": [{"id": "F01", "status": "FAILED", "case": "A01 natural confirmation",
        "message": bs[1]["message"], "observed": "explicit_confirmation_required; prepared again",
        "policyChanged": False}],
    "pending": ["functional acceptance by Mike", "complete remaining operational variants",
                "A05/A06 conversations with persisted app/payment validation",
                "A07 full integrated/separate package matrix", "real WhatsApp pilot remains blocked"],
}
summary_path = root / "summary.json"
if not summary_path.exists() or json.loads(summary_path.read_text()) != report:
    summary_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": report["status"], "checks": checks}, ensure_ascii=False))
assert all(checks.values())
