import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig } from "./config.js";
import { parseAgentResult } from "./agent-result.js";
import { buildAgentPrompt } from "./prompts.js";
import type { AgentContext, AgentResult, RepositoryConfig } from "./types.js";

const run = promisify(execFile);

export interface RuntimeTask {
  context: AgentContext;
  repositoryConfig: RepositoryConfig;
  owner: string;
  repo: string;
  headSha?: string;
  installationToken: string;
  appSlug: string;
}

export async function runPi(config: AppConfig, task: RuntimeTask): Promise<AgentResult> {
  const workspace = await mkdtemp(path.join(tmpdir(), "pi-github-"));
  const repository = path.join(workspace, "repository");
  const helper = path.join(workspace, "git-askpass");
  try {
    await writeFile(helper, `#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' x-access-token ;;
  *) printf '%s\\n' "$GITHUB_INSTALLATION_TOKEN" ;;
esac
`, { mode: 0o700 });
    await chmod(helper, 0o700);
    const gitEnv = { ...process.env, GIT_ASKPASS: helper, GITHUB_INSTALLATION_TOKEN: task.installationToken, GIT_TERMINAL_PROMPT: "0" };
    await run("git", ["clone", "--depth=50", `https://github.com/${task.owner}/${task.repo}.git`, repository], {
      env: gitEnv,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024
    });
    if (task.headSha) {
      await run("git", ["fetch", "origin", task.headSha], { cwd: repository, env: gitEnv, timeout: 120_000 });
      await run("git", ["checkout", "--detach", task.headSha], { cwd: repository, env: gitEnv, timeout: 30_000 });
    }

    const prompt = buildAgentPrompt(task.context, task.repositoryConfig, task.appSlug);
    const args = ["--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--provider", task.repositoryConfig.agent.provider ?? config.PI_PROVIDER, "--model", task.repositoryConfig.agent.model ?? config.PI_MODEL, "--thinking", task.repositoryConfig.agent.thinkingLevel ?? config.PI_THINKING_LEVEL, "--tools", task.repositoryConfig.agent.allowWrite ? "read,write,edit,bash" : "read,grep,find,ls", "-p", prompt];
    const provider = task.repositoryConfig.agent.provider ?? config.PI_PROVIDER;
    const providerEnv: Record<string, string> = provider === "openai" ? { OPENAI_API_KEY: config.PI_API_KEY } : provider === "google" ? { GEMINI_API_KEY: config.PI_API_KEY } : { ANTHROPIC_API_KEY: config.PI_API_KEY };
    const agentEnv = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      LANG: process.env.LANG ?? "C.UTF-8",
      HOME: path.join(workspace, "home"),
      PI_CODING_AGENT_DIR: path.join(workspace, "pi-config"),
      ...providerEnv
    };
    const { stdout, stderr } = await run("pi", args, {
      cwd: repository,
      env: agentEnv,
      timeout: (task.repositoryConfig.agent.timeoutMinutes ?? config.PI_TIMEOUT_MINUTES) * 60_000,
      maxBuffer: 8 * 1024 * 1024
    });
    return parseAgentResult(`${stdout}\n${stderr}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
