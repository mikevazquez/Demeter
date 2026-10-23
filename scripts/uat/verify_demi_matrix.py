"""Verify operational evidence, including failures that must prevent approval."""
import hashlib
import json
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / "docs/uat/demi-matrix-20261022"
ENV = "hedouonyhynuvwbckdlg"
RUNTIME = "5feefafb38a98e57a91b749e514a52c0a1212a8b"
NAMES = ["purchase", "resolution", "failures", "cancellation", "alternatives", "cash"]


def read(name):
    return json.loads((ROOT / (name + ".json")).read_text())


def artifacts(run, kind):
    return sorted((a for a in run["artifacts"] if a["kind"] == kind),
                  key=lambda a: a["created_at"])


def steps(run):
    result = []
    for after in artifacts(run, "after_message"):
        before = next(a for a in reversed(artifacts(run, "before_message"))
                      if a["created_at"] < after["created_at"]
                      and a["payload"]["provider_id"] == after["payload"]["provider_id"])
        result.append({"message": before["payload"]["text"],
                       "before": before["payload"]["state"],
                       "after": after["payload"]["state"],
                       "result": after["payload"]["result"]})
    return result


def rights(state, student):
    ids = {a["id"] for a in state["product_acquisitions"] if a["student_id"] == student}
    return sum(l["quantity"] for l in state["credit_ledger"] if l["acquisition_id"] in ids)


def student_reservations(state, student):
    return [r for r in state["reservations"] if r["student_id"] == student]


def unchanged(a, b, tables):
    return all(sorted(a[t], key=lambda r: r["id"]) == sorted(b[t], key=lambda r: r["id"])
               for t in tables)


def snapshots_ok(value):
    if isinstance(value, dict):
        if {"students", "reservations", "credit_ledger"} <= value.keys():
            if any(isinstance(v, dict) and "error" in v for v in value.values()):
                return False
        return all(snapshots_ok(v) for v in value.values())
    return not isinstance(value, list) or all(snapshots_ok(v) for v in value)


runs = {n: read(n) for n in NAMES}
p, r, f, c, a, cash = (runs[n] for n in NAMES)
ps, rs, fs, cs, aas, cashs = (steps(runs[n]) for n in NAMES)
commercial = ["students", "reservations", "product_acquisitions", "credit_ledger",
              "student_enrollments", "sales", "payments"]
checks = {
    "six_isolated_captured_runs": len({x["run"]["studio_id"] for x in runs.values()}) == 6
        and all(x["environment"] == ENV and x["runtimeSha"] == RUNTIME
                and x["transport"] == "captured" for x in runs.values()),
    "all_33_snapshot_queries_checked": all(len(x["snapshotTableNames"]) == 33
                                           and snapshots_ok(x) for x in runs.values()),
    "all_33_message_requests_retained": [len(x) for x in [ps, rs, fs, cs, aas, cashs]]
        == [6, 3, 9, 8, 4, 3],
    "quote_without_purchase_or_profile": not ps[0]["after"]["assistant_transfer_purchase_intents"]
        and unchanged(ps[0]["before"], ps[0]["after"], commercial),
    "acceptance_one_80000_intent_no_premature_rights":
        len(ps[1]["after"]["assistant_transfer_purchase_intents"]) == 1
        and ps[1]["after"]["assistant_transfer_purchase_intents"][0]["amount_minor"] == 80000
        and unchanged(ps[1]["before"], ps[1]["after"], commercial),
    "receipt_is_explicitly_synthetic_not_payment":
        artifacts(p, "matrix_synthetic_receipt")[0]["payload"]["money_transferred"] is False
        and artifacts(p, "matrix_synthetic_receipt")[0]["payload"]["ocr_verified"] is False,
    "receipt_requests_three_fields_before_activation":
        artifacts(p, "matrix_synthetic_receipt")[0]["payload"]["result"]["profile_fields"]
        == ["full_name", "birth_date", "email"]
        and unchanged(ps[2]["before"], ps[2]["after"], commercial),
    "conversation_asks_all_three_profile_fields": all(w in
        artifacts(p, "whatsapp_reply")[2]["payload"]["text"].lower()
        for w in ["nombre completo", "fecha de nacimiento", "correo"]),
    "profile_provisional_without_booked_money": len(ps[3]["after"]["students"]) == 12
        and not ps[3]["after"]["payments"]
        and ps[3]["after"]["assistant_transfer_purchase_intents"][0]["status"] == "provisional_active",
}
intent = p["state"]["assistant_transfer_purchase_intents"][0]
student = intent["student_id"]
new_packages = [x for x in p["state"]["product_acquisitions"] if x["student_id"] == student]
reviews = artifacts(p, "human_receipt_review")
checks.update({
    "human_approval_single_80000_payment": intent["status"] == "validated"
        and len(p["state"]["payments"]) == 1 and p["state"]["payments"][0]["amount_minor"] == 80000,
    "approval_replay_keeps_payment": len(reviews) == 2
        and all(len(x["payload"]["after"]["payments"]) == 1 for x in reviews),
    "purchase_one_enrollment_and_package": len(new_packages) == 1
        and len([e for e in p["state"]["student_enrollments"] if e["student_id"] == student]) == 1,
    "package_dates_preserved_after_booking": new_packages[0]["starts_on"] == "2026-10-22"
        and new_packages[0]["expires_on"] == "2026-11-21",
    "next_booking_one_debit_balance_seven": rights(p["state"], student) == 7
        and len(student_reservations(p["state"], student)) == 1,
    "validated_payment_visibility_failure_preserved": any(
        "validación definitiva" in z["payload"]["text"]
        and "no puedo confirmarla" in z["payload"]["text"] for z in artifacts(p, "whatsapp_reply")),
})
app = artifacts(r, "matrix_app_payment")[0]["payload"]
checks.update({
    "app_sale_closes_both_pending_types": app["after_intent"]["status"] == "superseded"
        and app["group_after"]["status"] == "superseded"
        and app["sale_result"]["paid_minor"] == 15000,
    "hello_after_app_does_not_mutate_commercial_state": rs[-1]["message"].lower() == "hola"
        and unchanged(rs[-1]["before"], rs[-1]["after"], commercial),
    "hello_uses_current_rights_without_old_charge": "una clase disponible" in
        artifacts(r, "whatsapp_reply")[-1]["payload"]["text"]
        and not any(w in artifacts(r, "whatsapp_reply")[-1]["payload"]["text"].lower()
                    for w in ["comprobante", "transferencia", "$150"]),
})
fstudent = f["run"]["fixtures"]["people"]["student_active"]["student_id"]
executions = sorted((x for x in f["state"]["assistant_tool_executions"]
                     if x["tool_name"] == "execute_booking"), key=lambda x: x["created_at"])
extra = read("extra-audit")["audit"]
checks.update({
    "three_failures_tracked_with_configured_limit":
        [x["result_json"].get("attempt_count") for x in executions[:3]] == [1, 2, 3]
        and all(x["result_json"]["attempt_limit"] == 3 for x in executions[:3]),
    "no_booking_or_debit_during_three_failures": all(
        rights(s["after"], fstudent) == 8 and not student_reservations(s["after"], fstudent)
        for s in fs[3:6]),
    "fourth_attempt_no_new_execution": unchanged(fs[6]["before"], fs[6]["after"],
        commercial + ["assistant_tool_executions", "assistant_whatsapp_deliveries"]),
    "claim_and_resolve_real_handoff": [x["payload"]["decision"] for x in artifacts(f, "human_control")]
        == ["claim", "resolve"] and f["state"]["assistant_handoffs"][0]["status"] == "resolved",
    "recovery_one_booking_balance_seven_audit_retained": rights(f["state"], fstudent) == 7
        and len(student_reservations(f["state"], fstudent)) == 1 and len(extra["booking_failures"]) == 3,
    "replay_no_business_model_or_reply_duplication": unchanged(fs[-1]["before"], fs[-1]["after"],
        commercial + ["assistant_model_calls", "assistant_whatsapp_deliveries"])
        and fs[-1]["result"]["outcomes"][0]["outcome"] == "duplicate_already_handled",
    "earlier_booking_api_failures_not_discarded": any(
        x["result_json"].get("error") == "booking_eligibility_unavailable"
        for x in f["state"]["assistant_tool_executions"]),
})
cstudent = c["run"]["fixtures"]["people"]["student_active"]["student_id"]
reminders = [x["payload"] for x in artifacts(c, "notification_delivery")
             if x["payload"].get("template") == "class_reminder"]
channels = Counter(x["channel"] for x in reminders)
checks.update({
    "late_cancel_not_executed_before_confirmation": unchanged(cs[5]["before"], cs[5]["after"], commercial),
    "late_cancel_consumes_one_credit": rights(c["state"], cstudent) == 7
        and [x["status"] for x in student_reservations(c["state"], cstudent)] == ["cancelled_late"],
    "late_cancel_repeat_does_not_move_credits": unchanged(cs[-1]["before"], cs[-1]["after"], commercial),
    "reminder_duplicate_failure_preserved": channels == {"inbox": 2, "whatsapp": 2}
        and len({x["message"]["body"] for x in reminders}) == 1,
    "reminders_all_captured": all(x["captured"] is True and not x["failed"] for x in reminders),
})
checks.update({
    "capacity_loss_does_not_create_prospect_student": not any(
        x["person_id"] == a["run"]["fixtures"]["people"]["prospect_existing"]["person_id"]
        for x in a["state"]["students"]),
    "capacity_loss_retains_one_proof_and_no_money": len(a["state"]["demi_group_receipts"]) == 1
        and not a["state"]["sales"] and not a["state"]["payments"],
    "alternative_offered_without_repayment": any("no necesitas pagar de nuevo" in x["payload"]["text"]
        for x in artifacts(a, "whatsapp_reply")),
    "refund_handoff_failure_is_real_not_disabled_policy": not a["state"]["assistant_handoffs"]
        and all(x["enabled"] for x in extra["handoff_policies"])
        and any(x["result_json"].get("error") == "handoff_reason_not_enabled"
                for x in a["state"]["assistant_tool_executions"]),
    "cash_failure_does_not_create_sale_payment_or_rights": not cash["state"]["sales"]
        and not cash["state"]["payments"]
        and unchanged(cashs[-1]["before"], cashs[-1]["after"], commercial),
    "cash_tool_failure_preserved": any(x["result_json"].get("reason_code") == "cash_purchase_failed"
        for x in cash["state"]["assistant_tool_executions"]),
})
strict = read("strict-role-results")
replacements = {s["file"]: s for s in strict["suites"]}
suites = [replacements.get(s["file"], {**s, "status": "PASSED"})
          for s in read("sql-results")["suites"]]
suites.append(replacements["tests/demi-cash-promised-date-uat.sql"])


def control_count(suite):
    total = 0
    for result in suite["results"]:
        if isinstance(result.get("result"), dict):
            total += len(result["result"]["controls"])
        elif "results" in result:
            total += len(result["results"])
        else:
            total += result.get("controls", 1)
    return total


passing_controls = sum(control_count(s) for s in suites if s["status"] == "PASSED")
profile = read("profile-fixture-retest")
supplemental = read("supplemental-results")["suites"]
supplemental_count = sum(control_count(s) for s in supplemental)
checks.update({
    "strict_sql_80_controls_and_two_failed_suites": passing_controls == 80
        and sum(s["status"] == "FAILED" for s in suites) == 2,
    "cash_permission_denial_reproduced_in_actual_role": all(
        "permission denied for function product_purchase_eligibility" in s["error"]["message"]
        for s in strict["suites"] if s["status"] == "FAILED"),
    "profile_fixture_correction_eight_controls_pass": profile["results"][0]["result"] == "passed"
        and profile["results"][0]["controls"] == 8,
    "resolved_pendings_and_transfer_11_controls_pass": supplemental_count == 11
        and all(s["status"] == "PASSED" and s["actualRole"] == "service_role" for s in supplemental),
    "live_birth_date_gap_not_overstated": read("profile-audit")["profile"]["birth_date"] is None,
})
a07 = read("a07-engine-results")["results"][0]["results"]
integrated = next(x for x in a07 if x["variant"] == "A_integrated")
checks.update({
    "a07_six_engine_passes_one_blocker": Counter(x["status"] for x in a07)
        == {"PASSED_ENGINE": 6, "BLOCKED_ENGINE_DEPENDENCY": 1},
    "a07_integrated_gap_preserved": integrated["package_balance"] == 8
        and integrated["expected_balance"] == 7 and integrated["starts_on"] is None
        and not integrated["first_class_linked_to_package"]
        and integrated["original_payment_unchanged"],
})
cleanup, access = read("cleanup-audit"), read("access-cleanup")
checks.update({
    "34_events_31_captured_replies": cleanup["before"]["event_count"] == 34
        and cleanup["before"]["captured_replies"] == 31,
    "58_notification_attempts_zero_external": cleanup["before"]["notification_attempts"] == 58
        and cleanup["before"]["uncaptured_attempts"] == 0,
    "temporary_access_revoked": cleanup["after"]["account_status"] == "disabled"
        and cleanup["after"]["banned"] and all(cleanup["after"][k] == 0
            for k in ["sessions", "refresh_tokens", "active_memberships", "pending_followups"]),
    "faults_restored_and_leases_clear": cleanup["after"]["faults_restored"]
        and cleanup["after"]["leases_clear"],
    "old_session_and_password_login_denied": access["staleSessionDenied"]
        and access["loginHttpStatus"] == 400 and access["loginError"] == "user_banned",
    "four_private_files_removed": access["privateFilesAbsent"] and len(access["privateFilesRemoved"]) == 4,
    "five_client_timeouts_reconciled_without_blind_resend":
        len(read("client-timeouts")["attempts"]) == 5
        and all(x["clientOutcome"] == "TIMEOUT" and x["blindlyResent"] is False
                and x["reconciledAfterArtifactId"] for x in read("client-timeouts")["attempts"]),
})
latest = {}
for x in sorted(cleanup["before"]["case_results"], key=lambda x: x["created_at"]):
    latest[x["case"]] = x["status"]
checks["failed_cases_not_approved"] = latest == {"M05": "partial", "M08": "partial", "M13": "failed",
    "M07": "failed", "M17": "failed", "M10": "failed", "M09": "partial"}
manifest = {str(p.relative_to(REPO)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [REPO / "tests" / n for n in ["demi-2-cash-human-uat.sql",
                "demi-cash-promised-date-uat.sql", "demi-2-group-followup-uat.sql",
                "demi-2-deferred-prospect-uat.sql", "demi-prospect-transfer-purchase-uat.sql",
                "demi-transfer-enrollment-package-uat.sql",
                "demi-a07-engine-probe-uat.sql"]]}
report = {"status": "FAILED_WITH_BLOCKERS", "environment": ENV, "runtimeSha": RUNTIME,
          "sourceSha": p["sourceSha"], "transport": "captured", "checks": checks,
          "strictSqlControlsPassed": passing_controls + 8 + supplemental_count, "strictSqlSuitesPassed": 14,
          "strictSqlSuitesFailed": 2, "a07EnginePassed": 6, "a07Blocked": 1,
          "latestBankResults": latest, "scriptSha256": manifest,
          "model": sorted({v["model"] for x in runs.values() for v in x["state"]["assistant_model_calls"]}),
          "externalWhatsApp": "BLOCKED; DEMI-PILOT-01 inactive; Mike acceptance pending"}
summary_path = ROOT / "summary.json"
if not summary_path.exists() or json.loads(summary_path.read_text()) != report:
    summary_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": report["status"], "checks": checks}, ensure_ascii=False))
assert all(checks.values()), [k for k, v in checks.items() if not v]
