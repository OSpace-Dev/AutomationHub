# AutomationHub

> A GitHub Trending collector, README archive, and AI daily report platform.

[中文 README](README.md)

AutomationHub uses a Chrome extension to collect rendered README content from GitHub Trending projects, uploads the data to an API, and provides an administration console for browsing collection results, managing devices and tasks, configuring model providers, and generating shareable AI daily reports.

## Screenshots

### Collection dashboard

![AutomationHub collection dashboard](docs/screenshots/homepage.png)

### Daily report view

![AutomationHub daily report view](docs/screenshots/report.png)

## Key capabilities

- **GitHub Trending collection**: Reads README content from the rendered browser page and stores project name, URL, rank, total stars, stars today, language, and collection status.
- **Reliable uploads and recovery**: Supports heartbeats, task claiming, reconnects, retry queues, and idempotent duplicate uploads.
- **Device and task management**: Manage device authorization, device status, immediate tasks, one-time schedules, and daily schedules.
- **Collection browsing**: Filter results by batch date and open the collected README or the original project page.
- **AI daily reports**: Calls OpenAI-compatible model providers in bounded batches and generates overviews, categories, project summaries, and trend information.
- **Prompt and model configuration**: Configure model base URLs, models, and daily report prompts in the admin console. API keys are encrypted on the server and masked in the UI.
- **Notification channels**: Supports Telegram daily report delivery and proxy configuration.
- **Public reading**: Completed reports can be viewed through unpredictable public URLs.
- **PostgreSQL persistence**: Production uses `postgres:18-bookworm`, with persistent data separated from versioned release directories.

## Repository structure

```text
apps/
├── api/        Node.js + TypeScript API service
├── admin/      Vue 3 + Vite administration console
└── extension/  Chrome Manifest V3 collection extension
docs/
└── screenshots/ README preview images
scripts/
└── backup-postgres.sh
```

## Tech stack

- Node.js 22
- pnpm 10.11.0
- Vue 3, Vite, and TypeScript
- Element Plus
- Chrome Manifest V3
- PostgreSQL 18
- Docker Compose

## Local development

### Install dependencies

```bash
corepack pnpm install --frozen-lockfile
```

### Start the API and admin console

Open two terminals and run these commands from the repository root:

```bash
corepack pnpm dev:api
```

```bash
corepack pnpm dev:admin
```

Default URLs:

- API: `http://localhost:3000`
- Admin console: `http://localhost:5173`

Local development uses SQLite by default and does not require PostgreSQL or production secrets. When needed, copy `.env.example` to `.env` and adjust the local configuration.

### Load the Chrome extension

1. Open `chrome://extensions/` in Chrome.
2. Enable Developer mode.
3. Select **Load unpacked**.
4. Choose the repository's `apps/extension/` directory.
5. Open GitHub Trending and click the extension icon to open the side panel.

### Verification

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Production deployment

Production uses Docker Compose and PostgreSQL. Persistent data is separated from versioned application releases:

```text
<deploy-root>/
├── data/
│   ├── .env
│   ├── postgres/
│   └── backups/
└── release/
    └── <version>/
```

Extract every new version into a new `release/<version>/` directory, then run these commands from that version directory:

```bash
docker compose --env-file ../../data/.env config
docker compose --env-file ../../data/.env build --no-cache
docker compose --env-file ../../data/.env up -d
docker compose --env-file ../../data/.env ps
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete first-time deployment, upgrade, backup, rollback, and troubleshooting workflow.

## Configuration

At minimum, configure the following values for production:

```env
ADMIN_API_KEY=your-admin-secret
MODEL_CONFIG_ENCRYPTION_KEY=your-stable-encryption-key
PGPASSWORD=your-database-password
PUBLIC_BASE_URL=https://your-domain.example
AUTOMATION_HUB_PORT=3000
```

See [.env.example](.env.example) for the complete template. Never commit a real `.env` file, API key, database password, or other credentials to Git.

## Version

Current version: `0.1.8`

Source packages are generated with `scripts/package-source.ps1`. The production image creates an isolated production dependency directory for the API during the Docker build, preventing pnpm workspace symlinks from breaking in the final image.

## License

No open-source license has been declared yet.
