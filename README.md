# pi GitHub Bot

A self-hosted GitHub App for configurable AI issue triage, pull request review, and `@pi-bot` assistance, powered by [pi](https://pi.dev/).

It runs as a small Docker Compose stack. GitHub sends App webhooks to the API, Redis queues work, and a dedicated worker checks out the repository and runs pi. No GitHub Actions are required.

## Features

- Install one GitHub App into multiple personal or organization repositories.
- Respond to `@your-app-slug` in Issue and PR comments.
- Triage newly opened Issues with a reply and an allow-listed label set.
- Review opened, reopened, ready-for-review, and synchronized PRs.
- Configure behavior per repository in `.github/pi-bot.yml` or from the built-in settings page.
- Use any pi provider supported by the installed pi version.
- Process events asynchronously with delivery and task deduplication.
- Keep automatic code writes disabled by default.

## Quick start

### 1. Create the GitHub App

Follow [docs/github-app.md](docs/github-app.md). You need the App ID, slug, private key, webhook secret, and a public HTTPS URL. Install the App on the repositories it should manage.

The initial repository permissions are:

- Metadata: Read-only
- Issues: Read and write
- Pull requests: Read and write
- Contents: Read-only

### 2. Configure and start

```bash
cp .env.example .env
# Fill in .env. Keep the private key and setup token secret.
docker compose up -d --build
```

The API health check is available at `https://your-host.example/healthz`. Open `https://your-host.example/` for the repository settings page and use the `SETUP_TOKEN` from `.env`.

Docker Compose expects the service to be reachable by GitHub at `/webhooks/github`. Put it behind Caddy, Nginx, a load balancer, or Cloudflare Tunnel with HTTPS.

### 3. Configure a repository

Use the settings page for the common switches, or copy the example into a repository:

```bash
mkdir -p .github
cp .github/pi-bot.yml.example .github/pi-bot.yml
```

Then commit the file. The worker reads it from the PR head for PR jobs and the default branch for Issue jobs.

### 4. Use it

```text
@pi-bot explain the authentication flow in this repository
@pi-bot review this PR for security issues
```

## Environment

See [.env.example](.env.example). `PI_PROVIDER`, `PI_MODEL`, and `PI_API_KEY` select the default pi model. Repository configuration can override the provider, model, thinking level, and timeout.

## Security model

The App uses short-lived installation tokens. Webhook signatures are verified before events are accepted. Mention jobs only run for GitHub users whose comment association is `OWNER`, `MEMBER`, or `COLLABORATOR` by default. Automatic Issue and PR jobs skip drafts and fork PRs by default. Every task gets a fresh temporary checkout and a time limit.

The worker currently runs pi in its own container. For untrusted public repositories, put the worker on a dedicated host and use an additional sandbox boundary before enabling `allow_write` or reviewing fork PRs. `ALLOW_AGENT_WRITES=false` is a server-side safety ceiling; a repository cannot enable writes unless the operator explicitly raises that ceiling. Never enable merge or production credentials for the agent.

## Development

```bash
npm install
npm run build
npm test
```

Local integration testing needs PostgreSQL, Redis, a configured GitHub App, and a public HTTPS tunnel. The current sandbox does not include Docker, so Compose startup must be verified on a Docker host.

## License

MIT
