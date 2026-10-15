/**
 * Local POSIX journal for trusted, private storage. No remote adapter is enabled.
 * Immutable, fsynced revisions are published with no-replace hard links. A stale
 * writer gets CONFLICT, never overwrites history. This is not a distributed DB.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonical, digest, initialState, invariant, validateState } from "./governance-evaluator.mjs";

const LIMIT = 4 * 1024 * 1024;
const REVISION = /^\d{12}\.json$/;

export class LedgerConflict extends Error {
  constructor() {
    super("Governance ledger changed; reload and reconcile before retrying");
    this.code = "CONFLICT";
  }
}

export class GovernanceLedger {
  constructor(directory, profile) {
    this.directory = path.resolve(directory);
    this.empty = initialState(profile);
    invariant(fs.constants.O_NOFOLLOW !== undefined, "POSIX no-follow support");
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(this.directory);
    invariant(stat.isDirectory() && !stat.isSymbolicLink(), "real ledger directory");
    invariant((stat.mode & 0o022) === 0, "private writable directory");
    invariant(fs.realpathSync(this.directory) === this.directory, "no symlink ancestors");
    this.device = stat.dev;
    this.inode = stat.ino;
  }

  checkDirectory() {
    const stat = fs.lstatSync(this.directory);
    invariant(stat.isDirectory() && stat.dev === this.device && stat.ino === this.inode, "directory identity");
    invariant(fs.realpathSync(this.directory) === this.directory, "directory path");
  }

  read() {
    this.checkDirectory();
    const names = fs.readdirSync(this.directory).filter((name) => !name.startsWith(".pending-"));
    invariant(names.every((name) => REVISION.test(name)), "unexpected journal entry");
    names.sort();
    let result = { revision: null, sequence: 0, state: structuredClone(this.empty) };
    for (const name of names) {
      const sequence = result.sequence + 1;
      invariant(name === `${String(sequence).padStart(12, "0")}.json`, "journal gap");
      const file = path.join(this.directory, name);
      const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
      const fd = fs.openSync(file, flags);
      let text;
      try {
        const stat = fs.fstatSync(fd);
        invariant(stat.isFile() && stat.size <= LIMIT, "bounded revision file");
        text = fs.readFileSync(fd, "utf8");
      } finally {
        fs.closeSync(fd);
      }
      const entry = JSON.parse(text);
      const { sha256, ...record } = entry;
      invariant(sha256 === digest(record), "revision digest");
      invariant(record.version === 1 && record.sequence === sequence, "revision identity");
      invariant(record.parent === result.revision, "parent revision");
      this.checkSuccessor(result.state, record.state);
      result = { revision: sha256, sequence, state: record.state };
    }
    return result;
  }

  checkSuccessor(previous, next) {
    validateState(next);
    invariant(next.repository === this.empty.repository, "repository namespace");
    invariant(next.controlBranch === this.empty.controlBranch, "branch namespace");
    invariant(next.events.length >= previous.events.length, "history deletion");
    invariant(canonical(next.events.slice(0, previous.events.length)) === canonical(previous.events), "history rewrite");
  }

  commit(expectedRevision, next) {
    const current = this.read();
    if (current.revision !== expectedRevision) throw new LedgerConflict();
    this.checkSuccessor(current.state, next);
    if (canonical(current.state) === canonical(next)) return { ...current, changed: false };
    const record = {
      version: 1,
      sequence: current.sequence + 1,
      parent: current.revision,
      state: structuredClone(next),
    };
    const revision = digest(record);
    const text = `${canonical({ ...record, sha256: revision })}\n`;
    invariant(Buffer.byteLength(text) <= LIMIT, "ledger capacity; archive explicitly");
    const temporary = path.join(this.directory, `.pending-${randomUUID()}`);
    const target = path.join(this.directory, `${String(record.sequence).padStart(12, "0")}.json`);
    let linked = false;
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, text, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      this.checkDirectory();
      fs.linkSync(temporary, target);
      linked = true;
      const directoryFd = fs.openSync(this.directory, fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(directoryFd);
      } finally {
        fs.closeSync(directoryFd);
      }
    } catch (error) {
      if (!linked && error.code === "EEXIST") throw new LedgerConflict();
      if (linked) {
        const uncertain = new Error("Revision published; durability uncertain. Read before retrying.");
        uncertain.code = "RECONCILE_REQUIRED";
        throw uncertain;
      }
      throw error;
    } finally {
      fs.unlinkSync(temporary);
    }
    return { revision, sequence: record.sequence, state: structuredClone(next), changed: true };
  }
}
