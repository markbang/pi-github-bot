import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentResult } from "../src/agent-result.js";
import { loadConfig } from "../src/config.js";
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

test("parses false write guard as false", () => {
  const config = loadConfig({
    GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "pi-bot", GITHUB_APP_PRIVATE_KEY: "key", GITHUB_WEBHOOK_SECRET: "0123456789012345",
    PUBLIC_URL: "https://example.com", DATABASE_URL: "postgres://user:pass@localhost/db", REDIS_URL: "redis://localhost:6379",
    SETUP_TOKEN: "0123456789012345", PI_PROVIDER: "anthropic", PI_MODEL: "model", PI_API_KEY: "key", ALLOW_AGENT_WRITES: "false"
  });
  assert.equal(config.ALLOW_AGENT_WRITES, false);
});

test("parses marked JSON agent output", () => {
  const result = parseAgentResult("some logs\nPI_RESULT: {\"reply\":\"done\",\"labels\":[\"bug\"]}");
  assert.deepEqual(result, { reply: "done", labels: ["bug"] });
});
