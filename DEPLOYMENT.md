# Server build

This package is source material for building AutomationHub on the target server. Do not put a real `.env` file into the package or image.

## Local development

Running `pnpm dev:api` without `STORAGE_DRIVER` uses SQLite and stores local data in `data/automationhub.sqlite` relative to the API working directory. In the workspace command, this is `apps/api/data/automationhub.sqlite`; inside the production container, it is `/app/data/automationhub.sqlite`. The file is ignored by Git and survives API restarts, so local devices, tasks, collection runs and reports remain available during development.

To intentionally reset local data, stop the API first and delete the SQLite file and its `-wal`/`-shm` companions from the API data directory. Do not use this reset step against the production PostgreSQL volume.

Production remains PostgreSQL-only through the Compose configuration below.

1. Verify the adjacent SHA-256 file before extracting the ZIP.
2. Extract into a new release directory.
3. Copy `.env.example` to `.env`, replace `ADMIN_API_KEY` and `PGPASSWORD` with long random secrets, and set `MODEL_CONFIG_ENCRYPTION_KEY` to another stable random secret. Keep the latter unchanged across upgrades or existing model API keys cannot be decrypted.
4. Set `MODEL_REQUEST_MIN_INTERVAL_MS=60000` unless the model provider has explicitly granted a higher request rate. This is the minimum start-to-start interval shared by every daily-report model batch and retry in one API process; setting it to `0` disables the protection.
5. Set `PUBLIC_BASE_URL` to the externally reachable management site origin, for example `https://reports.example.com`. Do not append `/share/reports/...`; HTTPS is recommended.
6. Keep `PGHOST=postgres`, `PGPORT=5432`, `PGDATABASE=automationhub`, `PGUSER=automationhub`, and `STORAGE_DRIVER=postgres` unless the deployment has an explicit database configuration change.
7. Back up the current data before upgrading. For the first PostgreSQL deployment, keep the old `automationhub-data` volume for rollback and do not delete or mount it into the new application.
8. Run `docker compose build --pull` on the server.
9. Run `docker compose up -d`.
10. Verify `docker compose ps` and `curl --fail http://127.0.0.1:3000/health`.
11. Open `/tasks` directly and confirm the management application loads.
12. Generate or open a completed report, copy its public URL, and verify `/share/reports/{token}` is reachable through the configured public domain.

Persistent application data is stored in the fixed-name `automationhub-postgres-data` Docker volume. Compose project directory changes do not create a new volume. Back it up before upgrades. Keep the prior release directory, image tag, and old `automationhub-data` volume until the new version passes health and manual checks.

## PostgreSQL backup

Run the backup from the server before an upgrade. Replace the placeholder values with the same values used in `.env`; do not put the command or output into the repository.

```bash
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > automationhub-postgres-$(date +%Y%m%d-%H%M%S).dump
```

The password is read inside the PostgreSQL container from its environment and is not placed in the command line. Keep the dump outside the release directory.

## First PostgreSQL cutover

The first PostgreSQL deployment intentionally starts with an empty database. Existing `store.json` data is not imported. Devices must be authorized again and model providers must be configured again. The old `automationhub-data` volume remains untouched so the previous JSON-backed release can be started for rollback.

The Compose file uses the fixed actual volume name `automationhub-postgres-data`. Do not rename it, run `docker compose down -v`, or delete it during a normal upgrade.
