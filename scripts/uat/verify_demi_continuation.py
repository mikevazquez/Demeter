"""Verify retained cancellation and commercial Sandbox evidence without network access."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2] / 'docs/uat/demi-handoff-20261022'
bank = json.loads((root / 'bank-live-55f59c2c.json').read_text())
tools = json.loads((root / 'bank-tools-55f59c2c.json').read_text())['tools']
cancellation = json.loads((root / 'cancellation-summary-80e5ada6.json').read_text())
samples = bank['samples']
by_case = {case: [s for s in samples if s['id'] == case] for case in ['S12', 'S13', 'S14']}
student_conversation = by_case['S14'][0]['conversationId']
receipt_reply = by_case['S12'][3]['reply']
seeded_receipt_reply = by_case['S13'][0]['reply']
three_fields = lambda text: all(term in text.lower() for term in ['nombre completo', 'fecha de nacimiento', 'correo'])
activation_claim = lambda text: re.search(r'(?:qued[oó]|queda|quedaron)\s+(?:activad|activ)', text, re.I) is not None
checks = {
    'ten_valid_turns': len(samples) == 10 and all(s['httpStatus'] == 200 and s['ok'] for s in samples),
    'quote_before_acceptance': not by_case['S12'][0]['canSimulateReceipt'] and not by_case['S12'][1]['canSimulateReceipt'] and by_case['S12'][2]['canSimulateReceipt'],
    'receipt_requires_three_fields_without_activation': three_fields(receipt_reply) and not activation_claim(receipt_reply),
    'seeded_receipt_requires_three_fields_without_activation': three_fields(seeded_receipt_reply) and not activation_claim(seeded_receipt_reply),
    'profiles_activated_only_by_successful_simulated_tool': len([t for t in tools if t['tool_name'] == 'complete_purchase_profile' and t['result_json'].get('status') == 'provisional_active' and t['result_json'].get('simulated')]) == 2,
    'no_unsupported_tool': not any(t['result_json'].get('error') == 'simulation_not_supported' for t in tools),
    'no_student_followup': not any(t['conversation_id'] == student_conversation and t['tool_name'] == 'update_contact_followup' for t in tools),
    'prospect_followup_still_simulated': any(t['tool_name'] == 'update_contact_followup' and t['result_json'].get('simulated') and t['result_json'].get('ok') for t in tools),
    'both_database_cancellation_cases_pass': all(c['status'] == 'PASS' and all(c['checks'].values()) for c in cancellation['cases']),
}
report = {
    'environment': 'hedouonyhynuvwbckdlg',
    'commercialRuntimeSha': bank['sha'],
    'cancellationRuntimeSha': cancellation['runtimeSha'],
    'checks': checks,
    'status': 'PASS' if all(checks.values()) else 'FAIL',
    'supersededFailure': {'sha': 'b98d14eea7640753023082331630529830928626', 'status': 'FAIL', 'issues': ['S12 premature activation before profile', 'S14 unsupported transfer choice'], 'evidence': 'bank-live-b98d14ee.json'},
    'functionalUat': 'PENDING', 'pilot': 'BLOCKED_INACTIVE',
}
(root / 'continuation-summary-55f59c2c.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
assert all(checks.values())
