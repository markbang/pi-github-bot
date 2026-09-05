import type { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import type { TaskPayload, AgentContext } from "./types.js";

export type InstallationOctokit = Octokit;

type Issue = Awaited<ReturnType<Octokit["rest"]["issues"]["get"]>>["data"];
type PullRequest = Awaited<ReturnType<Octokit["rest"]["pulls"]["get"]>>["data"];

export function getInstallationClient(app: App, installationId: number): Promise<InstallationOctokit> {
  return app.getInstallationOctokit(installationId) as unknown as Promise<InstallationOctokit>;
}

export async function loadAgentContext(client: InstallationOctokit, task: TaskPayload): Promise<AgentContext> {
  const issueResponse = await client.rest.issues.get({ owner: task.owner, repo: task.repo, issue_number: task.issueNumber });
  const issue = issueResponse.data as Issue;
  const labels = issue.labels.map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean);
  const comments = await client.paginate(client.rest.issues.listComments, {
    owner: task.owner, repo: task.repo, issue_number: task.issueNumber, per_page: 100
  });
  const thread = comments.slice(-30).map((comment) => `${comment.user?.login ?? "unknown"}: ${comment.body ?? ""}`).join("\n\n");
  const context: AgentContext = {
    issue: { number: issue.number, title: issue.title, body: issue.body ?? "", author: issue.user?.login ?? "unknown", labels },
    repository: `${task.owner}/${task.repo}`,
    task: task.commentBody ?? "Inspect this item and provide the appropriate response.",
    comments: thread
  };

  if (task.kind === "pr_review" || task.isPullRequest || task.eventName.includes("pull_request")) {
    const prResponse = await client.rest.pulls.get({ owner: task.owner, repo: task.repo, pull_number: task.issueNumber });
    const pr = prResponse.data as PullRequest;
    const diffResponse = await client.rest.pulls.get({
      owner: task.owner, repo: task.repo, pull_number: task.issueNumber,
      mediaType: { format: "diff" }
    });
    const files = await client.paginate(client.rest.pulls.listFiles, {
      owner: task.owner, repo: task.repo, pull_number: task.issueNumber, per_page: 100
    });
    const reviews = await client.paginate(client.rest.pulls.listReviewComments, {
      owner: task.owner, repo: task.repo, pull_number: task.issueNumber, per_page: 100
    });
    context.diff = typeof diffResponse.data === "string" ? diffResponse.data : "";
    context.files = files.map((file) => `${file.filename} (+${file.additions}/-${file.deletions})`).join("\n");
    context.comments = [thread, reviews.slice(-30).map((review) => `${review.user?.login ?? "unknown"} on ${review.path}: ${review.body ?? ""}`).join("\n\n")].filter(Boolean).join("\n\n");
    context.issue = { ...context.issue, title: pr.title, body: pr.body ?? "" };
  }
  return context;
}

export async function replyToIssue(client: InstallationOctokit, task: TaskPayload, body: string): Promise<void> {
  await client.rest.issues.createComment({ owner: task.owner, repo: task.repo, issue_number: task.issueNumber, body });
}

export async function addLabels(client: InstallationOctokit, task: TaskPayload, labels: string[], allowed: string[]): Promise<void> {
  const safeLabels = [...new Set(labels.map((label) => label.trim()).filter((label) => allowed.includes(label)))];
  if (safeLabels.length === 0) return;
  await client.rest.issues.addLabels({ owner: task.owner, repo: task.repo, issue_number: task.issueNumber, labels: safeLabels });
}

export async function submitReview(client: InstallationOctokit, task: TaskPayload, review: {
  body: string;
  event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE";
  comments?: Array<{ path: string; line: number; body: string; side?: "LEFT" | "RIGHT" }>;
}, commitId: string): Promise<void> {
  await client.rest.pulls.createReview({
    owner: task.owner,
    repo: task.repo,
    pull_number: task.issueNumber,
    body: review.body,
    event: review.event,
    commit_id: commitId,
    comments: review.comments?.map((comment) => ({
      path: comment.path,
      line: comment.line,
      body: comment.body,
      side: comment.side ?? "RIGHT"
    }))
  });
}
