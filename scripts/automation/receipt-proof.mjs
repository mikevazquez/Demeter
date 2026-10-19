export function normalizeReceiptSet(receipts) {
  if (!Array.isArray(receipts)) {
    throw new TypeError("Receipts must be a dense array");
  }

  const fields = ["taskId", "commitSha", "url", "draft"];
  const byTask = new Map();
  const byUrl = new Map();

  for (let index = 0; index < receipts.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(receipts, index)) {
      throw new TypeError("Receipts must not contain holes");
    }
    const receipt = receipts[index];
    if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
      throw new TypeError("Each receipt must be an object");
    }
    const keys = Reflect.ownKeys(receipt);
    if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) {
      throw new TypeError("Each receipt must have exactly the four required own keys");
    }

    const { taskId, commitSha, url, draft } = receipt;
    if (
      typeof taskId !== "string" ||
      !/^[a-z0-9][a-z0-9-]{2,79}$/.test(taskId) ||
      typeof commitSha !== "string" ||
      !/^[0-9a-f]{40}$/.test(commitSha) ||
      typeof url !== "string" ||
      !/^https:\/\/github\.com\/mikevazquez\/Demeter\/pull\/[1-9][0-9]*$/.test(url) ||
      draft !== true
    ) {
      throw new TypeError("Receipt fields are invalid");
    }

    const previous = byTask.get(taskId);
    if (previous && (previous.commitSha !== commitSha || previous.url !== url)) {
      throw new TypeError("Conflicting receipts for the same task");
    }
    if (byUrl.has(url) && byUrl.get(url) !== taskId) {
      throw new TypeError("A receipt URL must belong to only one task");
    }
    if (!previous) {
      byTask.set(taskId, { taskId, commitSha, url, draft });
      byUrl.set(url, taskId);
    }
  }

  return Array.from(byTask.values()).sort((left, right) =>
    left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0,
  );
}
