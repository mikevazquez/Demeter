import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

assert.deepEqual(Object.keys(process.env).sort(),['PATH','PWD']);
assert.equal(fs.readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
assert.equal(fs.existsSync('/home'),false);
assert.equal(fs.existsSync('/workspace'),false);
assert.equal(fs.existsSync('/root'),false);
assert.throws(()=>fs.writeFileSync('/repo/.git/local-pilot-probe','blocked'),e=>e.code==='EROFS');
const file=process.argv[2],expectedHash=process.argv[3];
assert.equal(file,'tests/automation/fixtures/governante-codex-local-proof.mjs');
const content=fs.readFileSync(`/repo/${file}`,'utf8');
assert.equal(createHash('sha256').update(content).digest('hex'),expectedHash);
const context=vm.createContext({});
const module=new vm.SourceTextModule(content,{context,importModuleDynamically:()=>{throw Error('Dynamic imports forbidden');}});
await module.link(()=>{throw Error('Imports forbidden');});
await module.evaluate({timeout:1000});
assert.deepEqual(Object.keys(module.namespace),['pilotProof']);
assert.equal(Object.isFrozen(module.namespace.pilotProof),true);
assert.deepEqual(JSON.parse(JSON.stringify(module.namespace.pilotProof)),{
  marker:'GOVERNANTE-CODEX-LOCAL-V1',taskId:'governante-codex-local-20261015-v1',selectionLimit:1,execution:'local-chatgpt',productionAuthorized:false,
});
assert.equal(vm.runInContext('typeof process',context),'undefined');
assert.equal(vm.runInContext('typeof fetch',context),'undefined');
console.log('LOCAL_PILOT_CERTIFICATION_PASS: exact SHA256; ESM syntax; sole frozen export; exact fields; no network route; no inherited credentials; no home/workspace; readonly Git; imports denied; VM timeout');
