import base64,datetime,hashlib,json,pathlib,subprocess
root=pathlib.Path('/workspace/work/studio-flow-local-evidence/supervised')
read=lambda name:json.loads((root/name).read_text())
gh=lambda path:json.loads(subprocess.check_output(['gh','api',path],text=True))
cert=read('certificate.json');publication=read('publication.json')
pull=gh('repos/mikevazquez/Demeter/pulls/'+str(publication['prNumber']))
assert pull['draft'] and not pull['merged'] and pull['state']=='open'
assert pull['head']['sha']==cert['sha'] and pull['base']['sha']==cert['sourceSha']
assert pull['base']['ref']=='feat/governance-codex-queue-integration-20261015'
files=gh('repos/mikevazquez/Demeter/pulls/'+str(pull['number'])+'/files')
assert len(files)==1 and files[0]['filename']==cert['scope'][0] and files[0]['status']=='added'
blob=gh('repos/mikevazquez/Demeter/git/blobs/'+files[0]['sha'])
content=base64.b64decode(blob['content'])
assert hashlib.sha256(content).hexdigest()==cert['fileSha256']
assert hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()==files[0]['sha']
before=read('selection-before.json');after=read('selection-after.json')
assert before['selected']==[{'id':cert['id'],'recovery':False}]
assert after['selected']==[] and after['skipped']==[{'id':cert['id'],'reason':'PR already exists (including closed or merged)','url':pull['html_url']}]
matching=gh('repos/mikevazquez/Demeter/pulls?state=all&head=mikevazquez:automation/codex/'+cert['id'])
assert len(matching)==1 and matching[0]['number']==pull['number']
main=gh('repos/mikevazquez/Demeter/git/ref/heads/main')['object']['sha']
control=gh('repos/mikevazquez/Demeter/git/ref/heads/chore/governance-autonomous-coordinator-20261015')['object']['sha']
assert main=='87749e84d324c6c5263c0f0128075cbe8c7e61b7'
assert control=='d3e113fb65d778f106c1ce574296123668567861'
original=json.loads(pathlib.Path('/workspace/work/studio-flow-pilot/.github/codex-coordinator/queue.json').read_text())
assert read('queue.local.json')['tasks'][:-1]==original['tasks']
others=[]
for task,number in zip(original['tasks'],[296,297,298,301]):
    prs=gh('repos/mikevazquez/Demeter/pulls?state=all&head=mikevazquez:automation/codex/'+task['id'])
    assert len(prs)==1 and prs[0]['number']==number
    others.append({'id':task['id'],'existingPr':number,'selectedInThisExecution':False,'generatedInThisExecution':False})
status={'version':1,'taskId':cert['id'],'mode':'current-codex-session-supervised','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':'supervised-pilot-completed','sha':cert['sha'],'sourceSha':cert['sourceSha'],'pr':pull['html_url'],'draft':True,'base':pull['base']['ref'],'publishedFiles':[{'path':files[0]['filename'],'blobSha':files[0]['sha'],'sha256':cert['fileSha256'],'additions':files[0]['additions'],'deletions':files[0]['deletions']}],'stages':{'select':'passed-one-task','execute':'passed-current-session','certify':'passed-isolated-checkout','publish':'passed-draft-only','deduplication':'passed-zero-selected-one-pr'},'otherTasks':others,'mainUnchanged':main,'controlUnchanged':control,'newCliInvocations':0,'actionsJobsExecuted':False,'automaticInterAgentDelegationProven':False,'purchasesOrNewServices':False,'modelApiKeyUsed':False,'invoiceInspected':False,'productionPromotionAuthorized':False,'productionDeploymentRequested':False,'remainingBlocker':'CLI ChatGPT authentication/device login remains unresolved; automatic delegation not certified'}
(root/'final-audit.json').write_text(json.dumps(status,indent=2)+'\n')
print(json.dumps(status,indent=2))
