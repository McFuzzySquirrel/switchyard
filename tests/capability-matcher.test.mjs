import assert from "node:assert/strict";
import test from "node:test";

import {
  matchCapabilities,
  matchRequiredCapabilities,
  matchesRequiredCapabilities,
} from "../src/index.ts";

function observation(capability, discoveryStatus = "observed") {
  return {
    capability,
    discovery: { status: discoveryStatus },
  };
}

test("matches every required capability and preserves requirement order", () => {
  const profile = {
    id: "fixture",
    capabilities: [
      observation("repository-access"),
      observation("headless"),
      observation("mcp"),
    ],
  };

  const result = matchRequiredCapabilities(profile, {
    requires: ["headless", "mcp"],
  });

  assert.deepEqual(result, {
    harnessId: "fixture",
    required: ["headless", "mcp"],
    matched: ["headless", "mcp"],
    missing: [],
    qualifies: true,
  });
  assert.equal(matchesRequiredCapabilities(profile, { requires: ["headless"] }), true);
  assert.equal(matchCapabilities(profile, ["mcp"]).qualifies, true);
});

test("rejects a profile missing any required capability", () => {
  const profile = {
    id: "fixture",
    capabilities: [
      observation("headless"),
      observation("repository-access", "not-observed"),
    ],
  };

  const result = matchRequiredCapabilities(profile, {
    requires: ["repository-access", "mcp", "headless"],
  });

  assert.deepEqual(result.matched, ["headless"]);
  assert.deepEqual(result.missing, ["repository-access", "mcp"]);
  assert.equal(result.qualifies, false);
  assert.equal(matchesRequiredCapabilities(profile, { requires: [] }), true);
});

test("does not treat verification or non-observed discovery as capability evidence", () => {
  const profile = {
    id: "fixture",
    capabilities: [
      {
        ...observation("mcp", "not-observed"),
        verification: { status: "passed" },
      },
    ],
  };

  const result = matchRequiredCapabilities(profile, { requires: ["mcp"] });
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.missing, ["mcp"]);
  assert.equal(result.qualifies, false);
});
