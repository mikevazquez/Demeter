import test from 'node:test';
import assert from 'node:assert/strict';
import { requestSha, downloadManifest } from './controller-request.mjs';
const sha = 'a'.repeat(40);
const manifestSha = 'b'.repeat(40);
test('request permits only immutable SHA, without URL, path or commands', () => {
  assert.equal(requestSha({ candidate_sha: sha, manifest_sha: manifestSha }), sha);
  for (const value of [null, {}, {candidate_sha:'main'}, {candidate_sha:sha.toUpperCase()}, {candidate_sha:sha,manifest_sha:manifestSha,url:'https://example.com'}, {candidate_sha:sha,manifest_sha:manifestSha,command:'echo bad'}]) {
    assert.throws(() => requestSha(value));
  }
});
test('candidate manifest is read from fixed repository and SHA only as JSON', async () => {
  const manifest = { candidate_sha: sha, target: 'production-staged' };
  assert.deepEqual(await downloadManifest(sha, manifestSha, async (url, options) => {
    assert.equal(url, `https://raw.githubusercontent.com/mikevazquez/Demeter/${manifestSha}/docs/sf-gov-001/release-manifest.json`);
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(manifest));
  }), manifest);
});
test('missing, oversized, malformed, wrong SHA and wrong target fail closed', async () => {
  for (const response of [new Response('',{status:404}), new Response('x'.repeat(262145)), new Response('not json'), new Response(JSON.stringify({candidate_sha:'b'.repeat(40),target:'production-staged'})), new Response(JSON.stringify({candidate_sha:sha,target:'production'}))]) {
    await assert.rejects(downloadManifest(sha, manifestSha, async () => response));
  }
});
