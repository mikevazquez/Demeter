// Trusted supervisor storage. This module never dispatches a worker or runs candidate code.
import { createHash, randomUUID } from "node:crypto";

const REPOSITORY = "mikevazquez/Demeter";
const SCHEMA = "governance2-supervisor-v1";
const LEGACY_SCHEMA = "governance2-registry-authority-v1";
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_BYTES = 128 * 1024;
const MAX_STATUS_BYTES = 256 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REF =
  /^refs\/heads\/governance2\/(?:registry-318-v1|supervisor-proof-[a-z0-9][a-z0-9-]{0,59})$/;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function ensure(ok, message, code = "INVALID_STORE") {
  if (!ok) throw failure(code, message);
}

function jsonBytes(value, maxBytes = MAX_STATE_BYTES) {
  const seen = new Set();
  function visit(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number") {
      ensure(Number.isFinite(item), "JSON values must contain only finite numbers");
      return;
    }
    ensure(typeof item === "object", "Plain serializable JSON values required");
    ensure(!seen.has(item), "Cyclic JSON values are not permitted");
    ensure(
      Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype,
      "Plain JSON objects required",
    );
    seen.add(item);
    if (Array.isArray(item)) {
      ensure(Reflect.ownKeys(item).length === item.length + 1, "Plain dense JSON arrays required");
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, i);
        ensure(
          descriptor && "value" in descriptor && descriptor.enumerable,
          "Plain JSON array elements required",
        );
        visit(descriptor.value);
      }
    } else {
      ensure(Object.getOwnPropertySymbols(item).length === 0, "JSON symbols are not permitted");
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
        ensure("value" in descriptor && descriptor.enumerable, "Plain JSON properties required");
        visit(descriptor.value);
      }
    }
    seen.delete(item);
  }
  visit(value);
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  ensure(bytes.length <= maxBytes, "Supervisor JSON exceeds its size limit");
  return bytes;
}

// Deliberately compatible with the legacy authority's SHA256(JSON.stringify(value)).
export function supervisorSnapshotSha256(value) {
  return createHash("sha256").update(jsonBytes(value)).digest("hex");
}

function blobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function copy(value) {
  return JSON.parse(jsonBytes(value).toString("utf8"));
}

function configOf(config) {
  ensure(config && typeof config === "object", "Store configuration required");
  const { repository, ref, anchorSha, legacySha256, request, renderStatus } = config;
  ensure(repository === REPOSITORY, "Repository is outside the reviewed supervisor scope");
  ensure(REF.test(ref ?? ""), "Reference is outside the reviewed supervisor scope");
  ensure(SHA.test(anchorSha ?? ""), "Pinned legacy head required");
  ensure(SHA256.test(legacySha256 ?? ""), "Pinned legacy snapshot digest required");
  ensure(typeof request === "function", "GitHub request adapter required");
  ensure(
    renderStatus === undefined || typeof renderStatus === "function",
    "Status renderer must be a function when configured",
  );
  return { repository, ref, anchorSha, legacySha256, request, renderStatus };
}

function validateLegacy(legacy, config) {
  ensure(
    legacy &&
      Object.keys(legacy).sort().join() === "head_sha,sha256,state" &&
      legacy.head_sha === config.anchorSha &&
      legacy.sha256 === config.legacySha256,
    "Legacy snapshot pins changed",
  );
  ensure(
    legacy.state?.schema === LEGACY_SCHEMA &&
      legacy.state.repository === config.repository &&
      legacy.state.active === null &&
      Array.isArray(legacy.state.history) &&
      Array.isArray(legacy.state.entries) &&
      legacy.state.entries.every(
        (entry) => entry?.closure !== null && entry?.closure !== undefined,
      ),
    "Only a closed legacy authority may be preserved in the supervisor envelope",
  );
  ensure(
    supervisorSnapshotSha256(legacy.state) === config.legacySha256,
    "Legacy snapshot content changed",
  );
}

function validateState(state, config) {
  jsonBytes(state);
  ensure(
    state?.schema === SCHEMA &&
      state.repository === config.repository &&
      Number.isSafeInteger(state.sequence) &&
      state.sequence >= 0 &&
      SHA.test(state.previous ?? ""),
    "Invalid supervisor envelope",
  );
  validateLegacy(state.legacy, config);
  ensure(
    state.sequence !== 0 || state.previous === config.anchorSha,
    "Supervisor migration must descend from the pinned legacy head",
  );
  return state;
}

function internals(config) {
  const api = `repos/${config.repository}`;
  const git = `${api}/git`;
  const refPath = `${git}/ref/${config.ref.slice(5)}`;
  const updatePath = `${git}/refs/${config.ref.slice(5)}`;
  const request = config.request;
  let anchorPromise;

  async function readRef() {
    let ref;
    try {
      ref = await request("GET", refPath);
    } catch (error) {
      if ((error.httpStatus ?? error.status) === 404) {
        throw failure(
          "STATE_NOT_FOUND",
          "Supervisor reference is missing; explicit setup is required",
        );
      }
      throw error;
    }
    ensure(
      ref?.ref === config.ref && ref.object?.type === "commit" && SHA.test(ref.object.sha),
      "Invalid supervisor reference",
    );
    return ref.object.sha;
  }

  async function readCommit(version) {
    ensure(SHA.test(version ?? ""), "A full commit version is required");
    const commit = await request("GET", `${git}/commits/${version}`);
    ensure(
      commit?.sha === version &&
        SHA.test(commit.tree?.sha ?? "") &&
        Array.isArray(commit.parents) &&
        commit.parents.length === 1 &&
        SHA.test(commit.parents[0]?.sha ?? ""),
      "Invalid supervisor commit ancestry",
    );
    const tree = await request("GET", `${git}/trees/${commit.tree.sha}`);
    ensure(
      tree?.sha === commit.tree.sha && tree.truncated === false && Array.isArray(tree.tree),
      "Complete supervisor tree required",
    );
    const entries = tree.tree.filter((entry) => entry.path === "registry.json");
    ensure(
      entries.length === 1 &&
        entries[0].type === "blob" &&
        entries[0].mode === "100644" &&
        SHA.test(entries[0].sha ?? ""),
      "A regular registry.json blob is required",
    );
    const blob = await request("GET", `${git}/blobs/${entries[0].sha}`);
    ensure(
      blob?.sha === entries[0].sha &&
        blob.encoding === "base64" &&
        typeof blob.content === "string" &&
        Number.isSafeInteger(blob.size) &&
        blob.size > 0 &&
        blob.size <= MAX_STATE_BYTES + 1,
      "Bounded registry blob required",
    );
    const bytes = Buffer.from(blob.content, "base64");
    ensure(
      bytes.length === blob.size && blobSha(bytes) === blob.sha,
      "Registry blob bytes do not match their Git identity",
    );
    const state = JSON.parse(bytes.toString("utf8"));
    jsonBytes(state);
    return { version, state, parent: commit.parents[0].sha, treeSha: commit.tree.sha };
  }

  async function readAnchor() {
    if (!anchorPromise) {
      anchorPromise = readCommit(config.anchorSha).then((anchor) => {
        validateLegacy(
          { head_sha: anchor.version, sha256: config.legacySha256, state: anchor.state },
          config,
        );
        return anchor;
      });
    }
    return anchorPromise;
  }

  async function readAt(version) {
    const anchor = await readAnchor();
    if (version === config.anchorSha) {
      throw failure(
        "MIGRATION_REQUIRED",
        "Legacy authority requires explicit supervisor migration",
      );
    }
    const current = await readCommit(version);
    validateState(current.state, config);
    ensure(
      current.state.previous === current.parent,
      "Supervisor previous version differs from Git parent",
    );
    ensure(
      supervisorSnapshotSha256(current.state.legacy.state) ===
        supervisorSnapshotSha256(anchor.state),
      "Supervisor does not preserve the pinned legacy snapshot",
    );
    const previous =
      current.parent === config.anchorSha ? anchor : await readCommit(current.parent);
    if (current.state.sequence === 0) {
      ensure(
        previous.version === config.anchorSha,
        "Migration parent is not the pinned legacy head",
      );
    } else {
      validateState(previous.state, config);
      ensure(
        previous.state.previous === previous.parent &&
          previous.state.sequence + 1 === current.state.sequence &&
          supervisorSnapshotSha256(previous.state.legacy) ===
            supervisorSnapshotSha256(current.state.legacy),
        "Supervisor sequence or preserved legacy history changed",
      );
    }
    // A compare proves descent and counts commits without replaying an ever-growing heartbeat journal.
    const ancestry = await request(
      "GET",
      `${api}/compare/${config.anchorSha}...${version}?per_page=1`,
    );
    ensure(
      ancestry?.status === "ahead" &&
        ancestry.behind_by === 0 &&
        ancestry.merge_base_commit?.sha === config.anchorSha &&
        ancestry.ahead_by === current.state.sequence + 1,
      "Supervisor history is not a monotonic extension of its pinned anchor",
    );
    return current;
  }

  async function createBlob(bytes) {
    const result = await request("POST", `${git}/blobs`, {
      encoding: "base64",
      content: bytes.toString("base64"),
    });
    ensure(result?.sha === blobSha(bytes), "Blob creation was not acknowledged", "WRITE_UNCERTAIN");
    return result.sha;
  }

  async function write(current, nextState, event) {
    const stateBytes = Buffer.concat([jsonBytes(nextState), Buffer.from("\n")]);
    let statusBytes;
    if (config.renderStatus) {
      let rendered;
      try {
        // The projection cannot mutate the state that will become authoritative.
        rendered = config.renderStatus(copy(nextState));
      } catch {
        throw failure("RENDER_FAILED", "Status projection failed before any supervisor write");
      }
      ensure(typeof rendered === "string", "Status projection must be a string", "RENDER_FAILED");
      statusBytes = Buffer.from(rendered, "utf8");
      ensure(
        statusBytes.length <= MAX_STATUS_BYTES,
        "Status projection exceeds its 256 KiB limit",
        "RENDER_FAILED",
      );
    }
    const record = {
      schema: "governance2-supervisor-event-v1",
      repository: config.repository,
      sequence: nextState.sequence,
      previous: current.version,
      transition_nonce: randomUUID(),
      state_sha256: supervisorSnapshotSha256(nextState),
      event: copy(event),
    };
    const eventBytes = jsonBytes(record, MAX_EVENT_BYTES);
    const eventHash = createHash("sha256").update(eventBytes).digest("hex");
    const eventPath = `events/${String(nextState.sequence).padStart(12, "0")}-${eventHash}.json`;
    let proposedVersion;
    try {
      const stateBlob = await createBlob(stateBytes);
      const eventBlob = await createBlob(eventBytes);
      const entries = [
        { path: "registry.json", mode: "100644", type: "blob", sha: stateBlob },
        { path: eventPath, mode: "100644", type: "blob", sha: eventBlob },
      ];
      if (statusBytes !== undefined) {
        entries.push({
          path: "status.md",
          mode: "100644",
          type: "blob",
          sha: await createBlob(statusBytes),
        });
      }
      const tree = await request("POST", `${git}/trees`, {
        base_tree: current.treeSha,
        tree: entries,
      });
      ensure(SHA.test(tree?.sha ?? ""), "Tree creation was not acknowledged", "WRITE_UNCERTAIN");
      const commit = await request("POST", `${git}/commits`, {
        message: `Governance supervisor transition ${nextState.sequence}`,
        tree: tree.sha,
        parents: [current.version],
      });
      ensure(
        SHA.test(commit?.sha ?? ""),
        "Commit creation was not acknowledged",
        "WRITE_UNCERTAIN",
      );
      proposedVersion = commit.sha;
    } catch {
      throw failure(
        "WRITE_UNCERTAIN",
        "Supervisor object creation was not acknowledged; read state before continuing",
      );
    }

    let updateError;
    try {
      const result = await request("PATCH", updatePath, { sha: proposedVersion, force: false });
      ensure(
        result?.ref === config.ref && result.object?.sha === proposedVersion,
        "Reference update was not acknowledged",
        "WRITE_UNCERTAIN",
      );
    } catch (error) {
      updateError = error;
    }

    let observedVersion;
    try {
      observedVersion = await readRef();
    } catch {
      throw failure(
        "WRITE_UNCERTAIN",
        "Supervisor reference readback failed; reconcile before continuing",
      );
    }
    if (observedVersion === proposedVersion) {
      // Recover a lost PATCH acknowledgement through GETs, never a second mutation.
      try {
        const verified = await readAt(proposedVersion);
        ensure(
          supervisorSnapshotSha256(verified.state) === supervisorSnapshotSha256(nextState),
          "Written supervisor state changed",
        );
        return { version: proposedVersion, state: copy(verified.state) };
      } catch {
        throw failure(
          "WRITE_UNCERTAIN",
          "Written supervisor state could not be verified; reconcile before continuing",
        );
      }
    }
    const status = updateError?.httpStatus ?? updateError?.status;
    if (status === 409 || status === 422) {
      throw failure(
        "CAS_CONFLICT",
        "Another supervisor transition owns the reference; reload state",
      );
    }
    throw failure(
      "WRITE_UNCERTAIN",
      "Supervisor reference advanced or write acknowledgement is uncertain; reconcile original intent",
    );
  }

  return { readRef, readCommit, readAnchor, readAt, write };
}

export function createGitHubSupervisorStore(input) {
  const config = configOf(input);
  const access = internals(config);
  return Object.freeze({
    async read() {
      const current = await access.readAt(await access.readRef());
      return { version: current.version, state: copy(current.state) };
    },
    async compareAndSwap(version, nextState, event) {
      ensure(SHA.test(version ?? ""), "Expected commit version required");
      validateState(nextState, config);
      const next = copy(nextState);
      const eventCopy = copy(event);
      jsonBytes(eventCopy, MAX_EVENT_BYTES);
      const observed = await access.readRef();
      if (observed !== version)
        throw failure("CAS_CONFLICT", "Supervisor version changed; reload state");
      const current = await access.readAt(version);
      ensure(
        next.previous === version && next.sequence === current.state.sequence + 1,
        "Supervisor CAS must advance sequence and preserve its exact previous version",
      );
      ensure(
        supervisorSnapshotSha256(next.legacy) === supervisorSnapshotSha256(current.state.legacy),
        "Legacy snapshot is immutable",
      );
      return access.write(current, next, eventCopy);
    },
  });
}

// Explicitly migrate the same reviewed authority, or a proof ref pinned to its exact closed snapshot.
// A missing ref, active legacy task, changed head or already-migrated ref is never auto-initialized.
export async function migrateSupervisorStore({ legacySnapshot, event, ...input }) {
  const config = configOf(input);
  const access = internals(config);
  const snapshot = copy(legacySnapshot);
  validateLegacy(snapshot, config);
  const observed = await access.readRef();
  if (observed !== config.anchorSha) {
    throw failure(
      "CAS_CONFLICT",
      "Migration requires the exact pinned legacy head; no reset or remigration",
    );
  }
  const legacy = await access.readAnchor();
  ensure(
    supervisorSnapshotSha256(legacy.state) === supervisorSnapshotSha256(snapshot.state),
    "Migration snapshot does not match the original legacy authority",
  );
  const state = {
    schema: SCHEMA,
    repository: config.repository,
    sequence: 0,
    previous: config.anchorSha,
    legacy: snapshot,
    tasks: [],
    active_task_id: null,
  };
  validateState(state, config);
  return access.write(
    legacy,
    state,
    event ?? { type: "explicit_supervisor_migration", legacy_head_sha: config.anchorSha },
  );
}
