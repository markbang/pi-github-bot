import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentResult } from "../src/agent-result.js";
import { extractMentionCommand, parseRepositoryConfig } from "../src/repository-config.js";

test("extracts an app mention and command", () => {
  assert.equal(extractMentionCommand("@pi-bot review this PR", "pi-bot"), "review this PR");
  assert.equal(extractMentionCommand("please @other-bot help", "pi-bot"), null);
});

test("accepts snake_case repository configuration", () => {
  const config = parseRepositoryConfig("issue_triage:\n  enabled: true\npull_request_review:\n  skip_draft: false");
  assert.equal(config.issueTriage.enabled, true);
  assert.equal(config.pullRequestReview.skipDraft, false);
  assert.equal(config.mention.enabled, true);
});

test("parses marked JSON agent output", () => {
  const result = parseAgentResult("some logs\nPI_RESULT: {\"reply\":\"done\",\"labels\":[\"bug\"]}");
  assert.deepEqual(result, { reply: "done", labels: ["bug"] });
});
