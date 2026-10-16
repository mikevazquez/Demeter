"""Publish only the previously certified bytes. Never executes the fixture."""
import datetime,hashlib,json,pathlib,subprocess
root=pathlib.Path('/workspace/work/studio-flow-local-evidence/supervised')
repo=pathlib.Path('/workspace/work/studio-flow-local-execute')
registry=pathlib.Path('/workspace/work/studio-flow-local-registry')
cert=json.loads((root/'certificate.json').read_text())
queue=json.loads((root/'queue.local.json').read_text())
task=next(t for t in queue['tasks'] if t['id']==cert['id'])
assert cert['certified'] and cert['mode']=='current-codex-session-supervised'
assert cert['checks']=={'execution':[0,0],'certification':[0,0]}
def gh(path,*args):return json.loads(subprocess.check_output(['gh','api',path,*args],text=True))
issue=gh('repos/mikevazquez/Demeter/issues/306')
assert issue['state']=='open' and hashlib.sha256(issue['body'].encode()).hexdigest()==task['issueBodySha256'] and issue['updated_at']==task['issueUpdatedAt']
base='feat/governance-codex-queue-integration-20261015'
assert gh('repos/mikevazquez/Demeter/git/ref/heads/'+base)['object']['sha']==cert['sourceSha']
branch=cert['proposal']['branch']
existing=gh('repos/mikevazquez/Demeter/pulls?state=all&head=mikevazquez:'+branch)
assert existing==[],'Existing PR consumes this ID; do not create another'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()==cert['sha']
assert subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True)==''
content=subprocess.check_output(['git','show','HEAD:'+task['allowedPaths'][0]],cwd=repo)
assert hashlib.sha256(content).hexdigest()==cert['fileSha256']
evidence_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=registry,text=True).strip()
assert gh('repos/mikevazquez/Demeter/git/ref/heads/evidence/governante-codex-local-20261015-v1')['object']['sha']==evidence_commit
subprocess.run(['git','remote','set-url','origin','https://github.com/mikevazquez/Demeter.git'],cwd=repo,check=True)
subprocess.run(['git','-c','credential.helper=!gh auth git-credential','push','origin','HEAD:refs/heads/'+branch],cwd=repo,check=True)
assert gh('repos/mikevazquez/Demeter/git/ref/heads/'+branch)['object']['sha']==cert['sha']
body=f'''Refs #306. Una sola tarea y un único fixture ESM, sin imports ni efectos externos.

Generado por la sesión actual de Codex, con autorización explícita del propietario, después de conservar el intento previo de CLI fallido por autenticación. **Ejecución supervisada; no demuestra delegación automática ni jobs de Actions.**

Fuente: `{cert['sourceSha']}`. Resultado: `{cert['sha']}`.
Contrato SHA256: `{cert['contractHash']}`.
Archivo SHA256: `{cert['fileSha256']}`.

Validación: sintaxis y verificador determinista aprobados en ejecución y en un clon separado del SHA fuente. Mismos bytes certificados; sin ruta de red, variables heredadas, home de Codex o escritura de Git. El proceso de certificación está aislado; el agente supervisor es el mismo. Los controles existentes de integración/coordinador tienen 33/33 pruebas aprobadas en la fuente, no se atribuyen como CI de este Draft.

[Certificado y logs previos a publicación](https://github.com/mikevazquez/Demeter/tree/{evidence_commit}/docs/automation/evidence/governante-codex-local-20261015-v1/supervised).

Base exclusiva: rama de integración de #304. Ningún otro trabajo de la cola se ejecutó. Sin merges, promoción, aplicación, cambios de producción, API keys, compras o nuevas suscripciones. UAT funcional y producción no autorizados. La autenticación de la CLI sigue pendiente.
'''
payload={'title':'[Codex supervisado] '+cert['id'],'head':branch,'base':base,'draft':True,'body':body}
(root/'draft-request.json').write_text(json.dumps(payload,indent=2)+'\n')
response=subprocess.run(['gh','api','--method','POST','repos/mikevazquez/Demeter/pulls','--input',str(root/'draft-request.json')],capture_output=True,text=True,check=True)
pull=json.loads(response.stdout)
assert pull['draft'] and pull['head']['sha']==cert['sha'] and pull['base']['ref']==base
record={'version':1,'taskId':cert['id'],'mode':cert['mode'],'publishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha':cert['sha'],'sourceSha':cert['sourceSha'],'pr':pull['html_url'],'prNumber':pull['number'],'draft':pull['draft'],'base':pull['base']['ref'],'evidenceCommitBeforePublication':evidence_commit,'certified':True,'mergePerformed':False,'deploymentRequested':False}
(root/'publication.json').write_text(json.dumps(record,indent=2)+'\n',{ } if False else 'utf-8')
print(json.dumps(record,indent=2))
