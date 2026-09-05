import { Worker } from "bullmq";
import { App } from "@octokit/app";
import { loadConfig } from "./config.js";
import { createDatabase, ensureDatabase, finishTask, getRepositorySettings, startTask } from "./db.js";
import { getInstallationClient, loadAgentContext, replyToIssue, addLabels, submitReview } from "./github.js";
import { createRedis } from "./queue.js";
import { defaultRepositoryConfig } from "./defaults.js";
import { mergeRepositoryConfig, parseRepositoryConfig } from "./repository-config.js";
import { runPi } from "./pi-runtime.js";
import type { RepositoryConfig, TaskPayload } from "./types.js";

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const github = new App({ appId: config.GITHUB_APP_ID, privateKey: config.GITHUB_APP_PRIVATE_KEY });

function mergeConfig(base: RepositoryConfig, settings: Record<string, unknown>): RepositoryConfig {
  return mergeRepositoryConfig(base as unknown as Record<string, unknown>, settings) as unknown as RepositoryConfig;
}

async function loadConfigForTask(client: Awaited<ReturnType<typeof getInstallationClient>>, task: TaskPayload): Promise<RepositoryConfig> {
  const settings = await getRepositorySettings(db, task.owner, task.repo);
  let configFromFile: RepositoryConfig = defaultRepositoryConfig;
  try {
    const response = await client.rest.repos.getContent({ owner: task.owner, repo: task.repo, path: ".github/pi-bot.yml", ref: task.headSha ?? task.defaultBranch });
    if (!Array.isArray(response.data) && response.data.type === "file") {
      configFromFile = parseRepositoryConfig(Buffer.from(response.data.content, "base64").toString("utf8"));
    }
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 404) throw error;
  }
  return mergeConfig(configFromFile, settings);
}

const worker = new Worker<{ id: string; payload: TaskPayload }>("pi-github-tasks", async (job) => {
  const task = job.data.payload;
  await startTask(db, job.data.id);
  try {
    const client = await getInstallationClient(github, task.installationId);
    const repositoryConfig = await loadConfigForTask(client, task);
    if (!config.ALLOW_AGENT_WRITES) repositoryConfig.agent.allowWrite = false;
    if (!repositoryConfig.enabled || !isEnabledForEvent(repositoryConfig, task)) {
      await finishTask(db, job.data.id, "succeeded");
      return;
    }
    if (task.kind === "mention" && repositoryConfig.mention.allowedUsers === "collaborators" && !isCollaboratorAssociation(task.authorAssociation)) {
      await finishTask(db, job.data.id, "succeeded");
      return;
    }
    const context = await loadAgentContext(client, task);
    const headSha = task.headSha;
    const result = await runPi(config, {
      context, repositoryConfig, owner: task.owner, repo: task.repo, headSha,
      installationToken: await getToken(github, task.installationId), appSlug: config.GITHUB_APP_SLUG
    });
    if (result.labels && task.kind === "issue_triage" && repositoryConfig.issueTriage.autoLabels) {
      await addLabels(client, task, result.labels, repositoryConfig.issueTriage.allowedLabels);
    }
    if (task.kind === "pr_review" && result.review && repositoryConfig.pullRequestReview.mode === "review") {
      if (!headSha) throw new Error("Cannot submit a PR review without the head commit SHA");
      await submitReview(client, task, result.review, headSha);
    } else if (result.reply && (task.kind !== "issue_triage" || repositoryConfig.issueTriage.autoReply)) {
      await replyToIssue(client, task, result.reply);
    } else if (result.review?.body && (task.kind !== "issue_triage" || repositoryConfig.issueTriage.autoReply)) {
      await replyToIssue(client, task, result.review.body);
    }
    await finishTask(db, job.data.id, "succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishTask(db, job.data.id, "failed", message.slice(0, 2000));
    throw error;
  }
}, { connection: redis, concurrency: config.PI_MAX_CONCURRENCY });

function isCollaboratorAssociation(association: string | undefined): boolean {
  return association === "OWNER" || association === "MEMBER" || association === "COLLABORATOR";
}

function isEnabledForEvent(config: RepositoryConfig, task: TaskPayload): boolean {
  if (task.kind === "mention") return config.mention.enabled;
  if (task.kind === "issue_triage") return config.issueTriage.enabled && task.action === "opened" && config.issueTriage.onOpened;
  if (!config.pullRequestReview.enabled || (task.isDraft && config.pullRequestReview.skipDraft) || (task.isFork && config.pullRequestReview.skipForks)) return false;
  return task.action === "opened" ? config.pullRequestReview.onOpened
    : task.action === "reopened" ? config.pullRequestReview.onReopened
      : task.action === "synchronize" ? config.pullRequestReview.onSynchronize
        : task.action === "ready_for_review" && config.pullRequestReview.onReadyForReview;
}

async function getToken(app: App, installationId: number): Promise<string> {
  const auth = await app.getInstallationOctokit(installationId).then((client) => client.auth({ type: "installation" }));
  if (!auth || typeof auth !== "object" || !("token" in auth) || typeof auth.token !== "string") throw new Error("GitHub installation token was not returned");
  return auth.token;
}

await ensureDatabase(db);
worker.on("failed", (job, error) => console.error("pi task failed", job?.id, error));
console.log(`pi worker ready with concurrency ${config.PI_MAX_CONCURRENCY}`);
