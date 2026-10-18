export function sumSafeIntegers(values) {
  if (!Array.isArray(values)) {
    throw new TypeError("Expected an array of safe integers");
  }

  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Every entry must be a Number safe integer");
    }

    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new TypeError("Every intermediate total must be a safe integer");
    }
  }

  return total;
}
