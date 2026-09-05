export type TaskKind = "mention" | "issue_triage" | "pr_review";

export type GitHubEventName =
  | "issue_comment"
  | "pull_request_review_comment"
  | "issues"
  | "pull_request";

export interface TaskPayload {
  deliveryId: string;
  eventName: GitHubEventName;
  action?: string;
  kind: TaskKind;
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  isPullRequest?: boolean;
  commentId?: number;
  commentBody?: string;
  authorAssociation?: string;
  headSha?: string;
  isFork?: boolean;
  isDraft?: boolean;
  defaultBranch?: string;
}

export interface RepositoryConfig {
  enabled: boolean;
  mention: {
    enabled: boolean;
    allowedUsers: "anyone" | "collaborators";
    allowedCommands: string[];
  };
  issueTriage: {
    enabled: boolean;
    onOpened: boolean;
    autoReply: boolean;
    autoLabels: boolean;
    allowedLabels: string[];
  };
  pullRequestReview: {
    enabled: boolean;
    onOpened: boolean;
    onReopened: boolean;
    onSynchronize: boolean;
    onReadyForReview: boolean;
    skipDraft: boolean;
    skipForks: boolean;
    mode: "summary" | "review";
  };
  agent: {
    provider?: string;
    model?: string;
    thinkingLevel?: string;
    timeoutMinutes?: number;
    allowWrite: boolean;
  };
}

export interface AgentContext {
  issue: {
    number: number;
    title: string;
    body: string;
    author: string;
    labels: string[];
  };
  repository: string;
  task: string;
  diff?: string;
  files?: string;
  comments?: string;
}

export interface AgentReviewComment {
  path: string;
  line: number;
  body: string;
  side?: "LEFT" | "RIGHT";
}

export interface AgentResult {
  reply?: string;
  labels?: string[];
  review?: {
    body: string;
    event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE";
    comments?: AgentReviewComment[];
  };
}
