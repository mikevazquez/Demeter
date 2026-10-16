"""Run the pre-existing trusted checker in a minimal offline mount namespace."""
import datetime,hashlib,json,pathlib,shutil,subprocess,sys
stage=sys.argv[1]
assert stage in ('execute','certify')
root=pathlib.Path('/workspace/work/studio-flow-local-evidence/supervised')
repo=pathlib.Path('/workspace/work/studio-flow-local-'+stage)
relative='tests/automation/fixtures/governante-codex-local-proof.mjs'
source='2af9188523c5e18bed2d647092c3395c6f428cd9'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()==source
node=pathlib.Path(shutil.which('node')).resolve()
filehash=hashlib.sha256((repo/relative).read_bytes()).hexdigest()
command=['bwrap','--unshare-all','--die-with-parent','--new-session']
for path in ('/usr','/bin','/lib','/lib64'):
    command+=['--ro-bind',path,path]
command+=['--ro-bind',str(node.parent),'/runtime','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--ro-bind',str(repo),'/repo','--ro-bind',str(root/'checker.mjs'),'/checker.mjs','--chdir','/repo','--clearenv','--setenv','PATH','/runtime:/usr/bin:/bin']
checks=[command+['node','--check',relative],command+['node','--experimental-vm-modules','/checker.mjs',relative,filehash]]
results=[]
for index,args in enumerate(checks):
    result=subprocess.run(args,text=True,capture_output=True,timeout=15)
    (root/f'{stage}-check-{index}.stdout.txt').write_text(result.stdout)
    (root/f'{stage}-check-{index}.stderr.txt').write_text(result.stderr)
    results.append({'check':index,'exitCode':result.returncode,'stdout':result.stdout,'stderr':result.stderr,'command':args})
record={'stage':stage,'mode':'current-codex-session-supervised','sourceSha':source,'checkout':str(repo),'file':relative,'fileSha256':filehash,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':results,'passed':all(x['exitCode']==0 for x in results)}
(root/f'{stage}-verification.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
assert record['passed'],f'{stage} verification failed'
