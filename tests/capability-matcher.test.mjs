import assert from "node:assert/strict";
import test from "node:test";

import {
  matchCapabilities,
  matchRequiredCapabilities,
  matchesRequiredCapabilities,
  rankCapabilityMatches,
  selectBestCapabilityMatch,
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

test("ranks qualifying candidates deterministically across capability and verification states", () => {
  const makeProfile = (id, verification = "not-requested", discoveryStatus = "observed") => ({
    id,
    capabilities: [{
      ...observation("headless", discoveryStatus),
      verification: { status: verification },
    }],
  });
  const cases = [
    {
      name: "verified full match outranks discovered full match",
      profiles: [makeProfile("discovered"), makeProfile("verified", "passed")],
      expected: ["verified", "discovered"],
    },
    {
      name: "equal matches use harness id rather than input order",
      profiles: [makeProfile("zeta"), makeProfile("alpha")],
      expected: ["alpha", "zeta"],
    },
    {
      name: "missing capabilities are excluded",
      profiles: [
        makeProfile("complete"),
        {
          id: "incomplete",
          capabilities: [observation("mcp")],
        },
      ],
      expected: ["complete"],
    },
    {
      name: "mixed verification states remain discovered until every requirement is verified",
      profiles: [{
        id: "mixed",
        capabilities: [
          { ...observation("headless"), verification: { status: "passed" } },
          { ...observation("mcp"), verification: { status: "failed" } },
        ],
      }],
      expected: ["mixed"],
    },
    {
      name: "stale or discovery-only lifecycle profiles are never presented as verified",
      profiles: [
        {
          ...makeProfile("stale", "passed"),
          status: "stale",
        },
        {
          ...makeProfile("discovery-only", "passed"),
          lifecycle: "discovered",
        },
        makeProfile("verified", "passed"),
      ],
      expected: ["verified", "discovery-only", "stale"],
    },
    {
      name: "no-match produces no candidates",
      profiles: [makeProfile("missing", "passed", "not-observed")],
      expected: [],
    },
  ];

  for (const scenario of cases) {
    const ranked = rankCapabilityMatches(
      scenario.profiles,
      { requires: scenario.name.includes("mixed") ? ["headless", "mcp"] : ["headless"] },
    );
    assert.deepEqual(
      ranked.map((candidate) => candidate.harnessId),
      scenario.expected,
      scenario.name,
    );
  }

  const profiles = [makeProfile("zeta"), makeProfile("alpha")];
  assert.equal(
    selectBestCapabilityMatch(profiles, { requires: ["headless"] })?.harnessId,
    "alpha",
  );
  assert.deepEqual(
    rankCapabilityMatches(profiles, { requires: ["headless"] }),
    rankCapabilityMatches([...profiles].reverse(), { requires: ["headless"] }),
  );
});
