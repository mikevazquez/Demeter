// Local rehearsal harness only. JSON-line GitHub API bridge holds no credential
// in this process. Namespace is hardcoded to rehearsal; never performs capture.
import { createInterface } from "node:readline";
import { githubReservationStore } from "./metadata-broker-reservation.mjs";
const lines = createInterface({ input: process.stdin, terminal: false })[
  Symbol.asyncIterator
]();
const [controllerSha, baseTreeSha, requestId, binding] = process.argv.slice(2);
try {
  const reserve = githubReservationStore({
    controllerSha,
    baseTreeSha,
    rehearsal: true,
    api: async (method, path, body) => {
      process.stdout.write(
        JSON.stringify({ api: { method, path, body } }) + "\n",
      );
      const next = await lines.next();
      if (next.done) throw Error("bridge ended");
      return JSON.parse(next.value);
    },
  });
  process.stdout.write(
    JSON.stringify({ result: { granted: await reserve(requestId, binding) } }) +
      "\n",
  );
} catch {
  process.stdout.write(JSON.stringify({ result: { denied: true } }) + "\n");
  process.exitCode = 1;
} finally {
  process.stdin.destroy();
}
