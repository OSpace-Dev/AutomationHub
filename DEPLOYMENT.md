# Server build

This package is source material for building AutomationHub on the target server. Do not put a real `.env` file into the package or image.

1. Verify the adjacent SHA-256 file before extracting the ZIP.
2. Extract into a new release directory.
3. Copy `.env.example` to `.env` and replace `ADMIN_API_KEY` with a long random secret.
4. Run `docker compose build --pull` on the server.
5. Run `docker compose up -d`.
6. Verify `docker compose ps` and `curl --fail http://127.0.0.1:3000/health`.
7. Open `/tasks` directly and confirm the management application loads.

Persistent application data is stored in the `automationhub-data` Docker volume. Back it up before upgrades. Keep the prior release directory and image tag until the new version passes health and manual checks.
