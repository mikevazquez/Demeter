"""One text-only Codex invocation, using the existing ChatGPT session in place.

Does not read, copy, print, or export authentication files. Model tools and API-key
fallback are disabled. The result is untrusted JSON; it cannot publish or write code.
"""
import datetime, hashlib, json, os, pathlib, subprocess

root=pathlib.Path('/workspace/work/studio-flow-local-evidence')
selection=json.loads((root/'selection-before.json').read_text())
assert selection['selected']==[{'id':'governante-codex-local-20261015-v1','recovery':False}]
reservation=json.loads((root/'reservation.json').read_text())
assert reservation['maxCodexInvocations']==1
lock=root/'generation-started.json'
with lock.open('x') as f:
    json.dump({'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localExecutionId':reservation['localExecutionId'],'invocation':1,'authMethod':'chatgpt','apiKeyAllowed':False},f,indent=2)

# Publish the consumed local reservation before the model starts. A failed launch
# does not silently release this ID or permit a fresh invocation.
registry=pathlib.Path('/workspace/work/studio-flow-local-registry')
dest=registry/'docs/automation/evidence/governante-codex-local-20261015-v1'
for name in ('generation-started.json','selection-before.json','prepared-task.json','prompt.txt'):
    (dest/name).write_bytes((root/name).read_bytes())
subprocess.run(['git','add',str(dest)],cwd=registry,check=True)
subprocess.run(['git','-c','user.name=Mike Vazquez','-c','user.email=55609925+mikevazquez@users.noreply.github.com','commit','-m','docs(governance): consume local single-generation reservation'],cwd=registry,check=True,stdout=subprocess.DEVNULL)
subprocess.run(['git','-c','credential.helper=!gh auth git-credential','push','origin','HEAD:refs/heads/evidence/governante-codex-local-20261015-v1'],cwd=registry,check=True,stdout=subprocess.DEVNULL)
reserved_sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=registry,text=True).strip()

schema={'type':'object','properties':{'path':{'type':'string','enum':['tests/automation/fixtures/governante-codex-local-proof.mjs']},'content':{'type':'string'}},'required':['path','content'],'additionalProperties':False}
(root/'output-schema.json').write_text(json.dumps(schema))
prompt=(root/'prompt.txt').read_text()+'\n\nLOCAL EXECUTOR TRANSPORT: Return ONLY a JSON object with path and content matching the output schema. Supply the complete ESM file content; do not edit files or use any tool. The controller validates and materializes the single allowed file. This is one real generation call through the existing ChatGPT login; do not use an API key or any external service.\n'
command=['codex','exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--output-schema',str(root/'output-schema.json'),'--output-last-message',str(root/'model-output.json'),'-c','forced_login_method="chatgpt"','-c','web_search="disabled"']
for feature in ('apps','shell_tool','unified_exec','code_mode_host','code_mode','multi_agent','browser_use','computer_use','skill_search','view_image','js_repl'):
    command.extend(['--disable',feature])
command.append('-')
environment=dict(os.environ)
# Preserve cloud proxy/CA and injected runtime headers/guard variables. Remove
# application and publication credentials and explicit metered-provider keys.
removed=[]
for name in list(environment):
    if name in ('GH_TOKEN','GITHUB_TOKEN','OPENAI_API_KEY','CODEX_API_KEY','CODEX_NOTION_TOKEN','OPENAI_BASE_URL','OPENAI_ORG_ID','OPENAI_PROJECT_ID') or 'SUPABASE' in name or name.startswith(('VERCEL_','STRIPE_')):
        removed.append(name);environment.pop(name)
status=subprocess.run(['codex','login','status'],env=environment,capture_output=True,text=True,check=True)
assert 'Logged in using ChatGPT' in status.stdout+status.stderr
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (root/'codex-events.jsonl').open('x') as out,(root/'codex-stderr.txt').open('x') as err:
    try:
        result=subprocess.run(command,input=prompt,text=True,env=environment,cwd='/workspace/work/studio-flow-pilot',stdout=out,stderr=err,timeout=240)
        code=result.returncode
    except subprocess.TimeoutExpired:
        code=124
record={'localExecutionId':reservation['localExecutionId'],'sourceSha':reservation['sourceSha'],'authMethod':'chatgpt','apiKeyAllowed':False,'removedCredentialVariableNames':sorted(removed),'command':command,'reservationCommit':reserved_sha,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':code,'codexCliInvocations':1,'providerHttpRequestCount':'not asserted','taskId':reservation['id']}
if (root/'model-output.json').exists():record['modelOutputSha256']=hashlib.sha256((root/'model-output.json').read_bytes()).hexdigest()
(root/'execute.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
raise SystemExit(code)
