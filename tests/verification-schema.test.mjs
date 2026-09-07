import assert from "node:assert/strict";
import test from "node:test";

import {
  assertVerificationResult,
  isVerificationResult,
  validateVerificationResult,
} from "../src/index.ts";

const result = {
  schemaVersion: 1,
  capability: "headless",
  status: "passed",
  startedAt: "2026-09-07T19:00:00.000Z",
  completedAt: "2026-09-07T19:00:01.000Z",
  message: "bounded read-only probe passed",
};

test("validates versioned verification results and preserves timestamps", () => {
  const validated = validateVerificationResult(result);
  assert.equal(validated.success, true);
  assert.equal(isVerificationResult(result), true);
  assert.deepEqual(assertVerificationResult(result), result);
});

test("requires ordered UTC timestamps and rejects unknown fields", () => {
  const reversed = { ...result, completedAt: result.startedAt };
  assert.equal(validateVerificationResult(reversed).success, true);
  assert.equal(
    validateVerificationResult({
      ...result,
      completedAt: "2026-09-07T18:59:59.000Z",
    }).success,
    false,
  );
  assert.equal(validateVerificationResult({ ...result, extra: true }).success, false);
  assert.equal(
    validateVerificationResult({
      ...result,
      message: "x".repeat(4097),
    }).success,
    false,
  );
});
