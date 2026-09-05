# GitHub App Setup

## Create the App

In GitHub, open **Settings → Developer settings → GitHub Apps → New GitHub App**.

Use these values:

- **GitHub App name**: a globally unique name such as `pi-bot-yourname`
- **Homepage URL**: your deployed service URL
- **Webhook URL**: `https://your-host.example/webhooks/github`
- **Webhook secret**: the value used for `GITHUB_WEBHOOK_SECRET`
- **Expire user authorization tokens**: enabled
- **Request user authorization (OAuth) during installation**: disabled

Repository permissions:

| Permission | Access |
| --- | --- |
| Metadata | Read-only |
| Issues | Read and write |
| Pull requests | Read and write |
| Contents | Read-only |

Subscribe to these events:

- Issue comment
- Issues
- Pull request
- Pull request review comment

Create the App, generate a private key, and record:

- App ID → `GITHUB_APP_ID`
- URL slug → `GITHUB_APP_SLUG`
- downloaded private key contents → `GITHUB_APP_PRIVATE_KEY`
- webhook secret → `GITHUB_WEBHOOK_SECRET`

For `GITHUB_APP_PRIVATE_KEY` in `.env`, preserve line breaks as `\n` inside a quoted value. Docker Compose passes this through to the Node process.

## Install it

Use the App's **Install App** page and select the account and repositories it may access. Installing it on an organization does not automatically grant access to every repository if you choose selected repositories.

The App can receive events from every selected repository through the one webhook URL. No repository-level webhook configuration is needed.

## Local testing

GitHub requires the webhook URL to be HTTPS and publicly reachable. A temporary tunnel works for development:

```bash
cloudflared tunnel --url http://localhost:3000
```

Use the generated HTTPS URL in the App webhook configuration. For production, use a stable domain and persistent tunnel or reverse proxy.

## First verification

After `docker compose up -d --build`:

```bash
curl https://your-host.example/healthz
```

Create a test Issue, then comment:

```text
@your-app-slug explain what this repository does
```

If there is no response, check the app container logs, then verify the App's **Advanced → Recent Deliveries** page. A `401` means the webhook secret does not match. A `202` means the event was accepted and queued.
