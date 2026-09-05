import type { RepositoryConfig } from "./types.js";

export const defaultRepositoryConfig: RepositoryConfig = {
  enabled: true,
  mention: {
    enabled: true,
    allowedUsers: "collaborators",
    allowedCommands: ["answer", "explain", "review", "fix", "analyze"]
  },
  issueTriage: {
    enabled: false,
    onOpened: true,
    autoReply: true,
    autoLabels: true,
    allowedLabels: ["bug", "feature", "question", "documentation", "needs-reproduction", "good first issue"]
  },
  pullRequestReview: {
    enabled: false,
    onOpened: true,
    onReopened: true,
    onSynchronize: true,
    onReadyForReview: true,
    skipDraft: true,
    skipForks: true,
    mode: "summary"
  },
  agent: {
    allowWrite: false
  }
};
