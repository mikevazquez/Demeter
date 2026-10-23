"""Validate captured evidence; passing checks do not approve the full UAT."""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "docs/uat/demi-retest-20261022"


def read(name):
    return json.loads((ROOT / name).read_text())


with gzip.open(ROOT / "core.json.gz", "rt") as stream:
    core = json.load(stream)
db = read("database-checks.json")["checks"]
cash = db["cash_live_verified"][0]["cash_verified"]
rights = db["retest_rights_handoff"][0]["rights_and_handoff"]
dispatch = db["retest_reminder_dispatch"][0]["dispatch"]
replay = db["retest_reminder_replay"][0]["replay"]
final = db["retest_final_rights"][0]["final_rights"]
cleanup = db["retest_cleanup"][0]["cleanup"]
access = read("access-cleanup.json")
operational = read("c07-operational.json")["samples"]
objections = [s for s in operational if "efectivo" in s["message"]]
advance = next(s for s in operational if "Mejor sí" in s["message"])
zero_effects = ["students", "reservations", "sales", "payments", "product_acquisitions", "assistant_handoffs"]
case_status = {a["payload"]["case_id"]: a["payload"]["status"] for a in core["artifacts"] if a["kind"] == "case_result"}
checks = {
    "cash_first_booking_keeps_debt_and_debits_once": cash["cash"]["payment_count"] == 0 and cash["acquisition"]["balance"] == 7 and cash["cash_booking_count"] == 1,
    "transfer_validated_paid_once_and_balance_seven": rights["purchase"]["status"] == "validated" and rights["purchase"]["payments"] == 1 and rights["purchase"]["balance"] == 7 and rights["purchase"]["reserve_count"] == 1,
    "handoff_resolved_and_control_returned": rights["handoff"]["status"] == "resolved" and rights["handoff"]["human_takeover"] is None,
    "reminder_one_delivery_per_channel": len(dispatch["per_notification_channel"]) == 4 and all(d["deliveries"] == 1 for d in dispatch["per_notification_channel"]),
    "reminder_all_four_deliveries_captured": len(dispatch["attempts"]) == 4 and all(d["captured"] and d["provider_message_id"].startswith("uat:") for d in dispatch["attempts"]),
    "reminder_replay_no_new_dispatch": replay["reminder_attempt_count"] == 4 and all(w["result"]["deliveryClaimed"] == 0 for w in replay["workers"] if not w["make_due"]),
    "cash_collection_allows_next_booking_without_reset": final["cash_balance"] == 6 and final["cash_payment_count"] == 1 and final["starts_on"] == "2026-10-23" and final["expires_on"] == "2026-11-22",
    "three_cash_objections_without_model_or_business_effects": len(objections) == 3 and all(all(s["delta"][k] == 0 for k in zero_effects + ["assistant_model_calls", "assistant_tool_executions", "demi_group_bookings"]) for s in objections),
    "first_and_reset_explain_advance_second_offers_walk_in": "pago por adelantado" in objections[0]["reply"][0] and "únicamente si hay lugar" in objections[1]["reply"][0] and "pago por adelantado" in objections[2]["reply"][0],
    "advance_acceptance_resumes_without_duplicate_business": all(advance["delta"][k] == 0 for k in zero_effects + ["demi_group_bookings"]) and advance["delta"]["assistant_tool_executions"] > 0,
    "failed_cash_date_variant_not_overwritten": case_status["M13"] == "failed" and all(case_status[k] == "partial" for k in ["M05", "M10", "M17"]),
    "temporary_account_revoked": cleanup["account_status"] == "disabled" and cleanup["banned"] and all(cleanup[k] == 0 for k in ["sessions", "refresh_tokens", "active_memberships", "expiry_jobs"]),
    "fixture_no_pending_automatic_work": all(cleanup[k] == 0 for k in ["pending_jobs", "pending_deliveries", "pending_engine", "pending_followups"]),
    "all_notification_attempts_captured": cleanup["notification_attempts"] == 28 and cleanup["uncaptured_attempts"] == 0,
    "old_session_and_new_login_denied": access["staleSessionDenied"] and access["loginHttpStatus"] == 400 and access["loginError"] == "user_banned",
    "private_files_removed_and_previews_revoked": access["privateFilesAbsent"] and len(access["privateFilesRemoved"]) == 18 and all(v["revoked"] for v in read("preview-access-revocations.json")),
}
for name, item in read("evidence-manifest.json")["files"].items():
    checks["hash:" + name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == item["sha256"]
print(json.dumps({"evidence_checks": checks, "passed": sum(checks.values()), "total": len(checks), "uat_status": "FAILED_WITH_OPEN_ITEMS"}, ensure_ascii=False, indent=2))
assert all(checks.values()), "Evidence mismatch; do not approve or overwrite raw failures"
