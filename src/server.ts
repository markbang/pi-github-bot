import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { App } from "@octokit/app";
import { loadConfig } from "./config.js";
import { claimDelivery, createDatabase, createTask, ensureDatabase, getRepositorySettings, saveRepositorySettings } from "./db.js";
import { createRedis, createTaskQueue } from "./queue.js";
import { extractMentionCommand, parseRepositoryConfig } from "./repository-config.js";
import { renderSettingsPage } from "./web-ui.js";
import type { GitHubEventName, TaskPayload } from "./types.js";

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const queue = createTaskQueue(redis);
const github = new App({ appId: config.GITHUB_APP_ID, privateKey: config.GITHUB_APP_PRIVATE_KEY, webhooks: { secret: config.GITHUB_WEBHOOK_SECRET } });
const server = Fastify({ logger: true });
await server.register(rawBody, { field: "rawBody", global: false, encoding: "utf8", runFirst: true });

type RawRequest = { rawBody?: string; headers: Record<string, string | string[] | undefined>; body: unknown };

server.get("/healthz", async () => ({ ok: true, service: "pi-github-bot" }));
server.get("/", async (_, reply) => reply.type("text/html").send(renderSettingsPage(config.PUBLIC_URL)));

server.post<{ Body: unknown } & RawRequest>("/webhooks/github", { config: { rawBody: true } }, async (request, reply) => {
  const event = header(request.headers, "x-github-event");
  const deliveryId = header(request.headers, "x-github-delivery");
  const signature = header(request.headers, "x-hub-signature-256");
  if (!event || !deliveryId || !signature || !request.rawBody) return reply.code(400).send({ error: "Missing GitHub webhook headers" });
  const raw = typeof request.rawBody === "string" ? request.rawBody : request.rawBody.toString("utf8");
  if (!(await github.webhooks.verify(raw, signature))) return reply.code(401).send({ error: "Invalid webhook signature" });
  if (!await claimDelivery(db, deliveryId)) return reply.code(202).send({ accepted: true, duplicate: true });
  const payload = request.body as Record<string, unknown>;
  const tasks = taskFromWebhook(event, deliveryId, payload, config.GITHUB_APP_SLUG);
  for (const task of tasks) {
    const stored = await createTask(db, task);
    if (stored) await queue.add(task.kind, stored, { jobId: stored.id });
  }
  return reply.code(202).send({ accepted: true, tasks: tasks.length });
});

server.get<{ Params: { owner: string; repo: string } }>("/api/settings/:owner/:repo", async (request, reply) => {
  if (!authorized(request.headers.authorization)) return reply.code(401).send({ error: "Unauthorized" });
  if (!validRepositoryName(request.params.owner) || !validRepositoryName(request.params.repo)) return reply.code(400).send({ error: "Invalid repository name" });
  return getRepositorySettings(db, request.params.owner, request.params.repo);
});
server.put<{ Params: { owner: string; repo: string }; Body: unknown }>("/api/settings/:owner/:repo", async (request, reply) => {
  if (!authorized(request.headers.authorization)) return reply.code(401).send({ error: "Unauthorized" });
  if (!validRepositoryName(request.params.owner) || !validRepositoryName(request.params.repo)) return reply.code(400).send({ error: "Invalid repository name" });
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) return reply.code(400).send({ error: "Settings must be a JSON object" });
  let settings;
  try {
    settings = parseRepositoryConfig(JSON.stringify(request.body));
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid settings" });
  }
  await saveRepositorySettings(db, request.params.owner, request.params.repo, settings as unknown as Record<string, unknown>);
  return { ok: true };
});

await ensureDatabase(db);
await server.listen({ host: "0.0.0.0", port: config.PORT });
console.log(`pi GitHub App listening on ${config.PORT}`);

function authorized(value: string | undefined): boolean {
  return value === `Bearer ${config.SETUP_TOKEN}`;
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function taskFromWebhook(event: string, deliveryId: string, payload: Record<string, unknown>, appSlug: string): TaskPayload[] {
  const installation = object(payload.installation);
  const repository = object(payload.repository);
  const sender = object(payload.sender);
  const issue = object(payload.issue);
  const pullRequest = object(payload.pull_request);
  const comment = object(payload.comment);
  const installationId = numberValue(installation.id);
  const owner = stringValue(object(repository.owner).login) ?? stringValue(repository.full_name)?.split("/")[0];
  const repo = stringValue(repository.name);
  const issueNumber = numberValue(issue.number) ?? numberValue(pullRequest.number);
  if (!installationId || !owner || !repo || !issueNumber) return [];
  if (stringValue(sender.type)?.toLowerCase() === "bot") return [];
  const base = { deliveryId, installationId, owner, repo, issueNumber, defaultBranch: stringValue(repository.default_branch) };
  const result: TaskPayload[] = [];
  if (event === "issue_comment" || event === "pull_request_review_comment") {
    const body = stringValue(comment.body) ?? "";
    const command = extractMentionCommand(body, appSlug);
    if (command) result.push({ ...base, eventName: event as GitHubEventName, kind: "mention", commentId: numberValue(comment.id), commentBody: command, authorAssociation: stringValue(comment.author_association), isPullRequest: Boolean(object(issue.pull_request).url) });
  }
  if (event === "issues" && stringValue(payload.action) === "opened") {
    result.push({ ...base, eventName: "issues", action: "opened", kind: "issue_triage", authorAssociation: stringValue(issue.author_association), commentBody: "Classify this new issue, suggest an appropriate response, and select only relevant allowed labels." });
  }
  if (event === "pull_request") {
    const action = stringValue(payload.action);
    if (["opened", "reopened", "synchronize", "ready_for_review"].includes(action ?? "")) {
      result.push({ ...base, eventName: "pull_request", action, kind: "pr_review", headSha: stringValue(object(pullRequest.head).sha), isFork: Boolean(object(object(pullRequest.head).repo).fork), isDraft: Boolean(pullRequest.draft), commentBody: "Review this pull request for actionable bugs, security issues, and regressions." });
    }
  }
  return result;
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) ? value : undefined; }
function validRepositoryName(value: string): boolean { return value.length > 0 && value.length <= 100 && /^[A-Za-z0-9_.-]+$/.test(value); }
