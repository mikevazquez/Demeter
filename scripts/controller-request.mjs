import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function requestSha(request) {
  if (!request || Object.keys(request).length !== 2 ||
      !/^[0-9a-f]{40}$/.test(request.candidate_sha ?? '') ||
      !/^[0-9a-f]{40}$/.test(request.manifest_sha ?? '')) {
    throw new Error('Expected full lowercase candidate_sha and manifest_sha');
  }
  return request.candidate_sha;
}

export async function downloadManifest(sha, manifestSha, fetcher = fetch) {
  requestSha({ candidate_sha: sha, manifest_sha: manifestSha });
  const url = `https://raw.githubusercontent.com/mikevazquez/Demeter/${manifestSha}/docs/sf-gov-001/release-manifest.json`;
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new Error('Candidate manifest unavailable');
  let length = 0;
  const parts = [];
  for await (const part of response.body) {
    length += part.length;
    if (length > 262144) throw new Error('Candidate manifest too large');
    parts.push(Buffer.from(part));
  }
  const manifest = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (manifest?.candidate_sha !== sha || manifest?.target !== 'production-staged') {
    throw new Error('Candidate manifest target or SHA mismatch');
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Expected request and new manifest path');
    const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const sha = requestSha(request);
    const manifest = await downloadManifest(sha, request.manifest_sha);
    writeFileSync(process.argv[3], JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
    console.log(sha);
  } catch {
    console.error('DENIED: controller request or candidate manifest invalid');
    process.exitCode = 1;
  }
}
