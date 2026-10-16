// Real GitHub GET transport through the already authorized CLI; no mocked data.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
globalThis.fetch=async (url,options={})=>{
  const target=new URL(url),method=options.method||'GET';
  if(target.origin!=='https://api.github.com'||!target.pathname.startsWith('/repos/mikevazquez/Demeter/')||method!=='GET')throw Error('Repository GET only');
  let status=200,body;
  try{body=execFileSync('gh',['api','--method','GET',target.pathname+target.search],{encoding:'utf8',timeout:35000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});}
  catch(error){const match=String(error.stderr).match(/HTTP (\d{3})/);if(!match)throw Error('GitHub CLI transport failed');status=Number(match[1]);body=error.stdout||'{}';}
  fs.appendFileSync('/workspace/work/studio-flow-local-evidence/supervised/api-reads.jsonl',JSON.stringify({time:new Date().toISOString(),transport:'gh-api',method,path:target.pathname+target.search,status})+'\n');
  return new Response(body,{status});
};
