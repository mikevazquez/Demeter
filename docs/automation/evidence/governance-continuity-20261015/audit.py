"""Offline evidence audit. No network, secrets, model calls or external writes."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def load(name):
    raw = (ROOT / name).read_bytes()
    assert len(raw) < 1024 * 1024, "bounded evidence"
    return json.loads(raw)

def audit(journal, record, recovery, report, jobs, index, scheduler):
    payload = {k: v for k, v in journal.items() if k != "sha256"}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    assert digest == journal["sha256"], "journal digest mismatch"
    assert record["revision"] == recovery["revision"] == digest, "revision mismatch"
    assert record["sequence"] == recovery["sequence"] == journal["sequence"], "sequence mismatch"
    assert recovery["recovered"] is True, "recovery not confirmed"
    assert recovery["changed"] is False, "recovery mutated journal"
    assert record["sourceSha"] == report["sourceSha"] == recovery["journalHead"], "source mismatch"
    assert str(record["runId"]) == str(report["runId"]), "run mismatch"
    assert record["eligibleTaskIds"] == [], "not an idle cycle"
    assert record["changed"] is False and record["noticesSent"] is False, "unexpected effects"
    for name in ["execute", "repair", "certify", "publish"]:
        assert report["jobs"][name]["result"] == "skipped", "unexpected execution"
    for name in ["persist-governance", "recover-governance"]:
        job = next(x for x in jobs["jobs"] if x["name"] == name)
        assert job["conclusion"] == "success", "job failure"
    assert index["total_count"] == len(index["runs"]), "incomplete run listing"
    origin = next(x for x in index["runs"] if x["id"] == record["runId"])
    assert origin["head_sha"] == record["sourceSha"] and origin["conclusion"] == "success", "origin mismatch"
    cycles = [e for e in journal["state"]["events"] if e["type"] == "cycle"]
    return {
        "sourceRun": record["runId"], "sourceEvent": origin["event"],
        "sourceSha": record["sourceSha"], "journalRevision": digest,
        "sequence": journal["sequence"], "historicalReadOnlyRecoveryVerified": True,
        "historicalIdleVerified": True, "historicalExecutedTasks": 0,
        "storedJournalCycleEvents": len(cycles),
        "githubScheduleRunsObserved": sum(x["event"] == "schedule" for x in index["runs"]),
        "hostedSchedulerEnabled": scheduler["is_enabled"],
        "hostedLastRunObserved": scheduler["last_run_time"],
        "verifiedConsecutiveHostedScheduledCycles": 0,
        "requiredConsecutiveHostedScheduledCycles": 3,
        "hostedScheduledCycleEvidence": "unknown; no per-wakeup receipts available in these sources",
        "operationalContinuityAccepted": False,
        "note": "The historical push/no-op and journal recovery are verified. They do not prove hosted scheduled wakeups. Zero verified is not a claim of zero actual wakeups. Availability/recovery after a real interruption remains unverified."
    }

if __name__ == "__main__":
    result = audit(*(load(name) for name in ["journal.json", "record.json", "recover.json", "report.json", "jobs.json", "runs-index.json", "hosted-scheduler.json"]))
    print(json.dumps(result, ensure_ascii=False, indent=2))
