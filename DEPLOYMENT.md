# Server build

This package is source material for building AutomationHub on the target server. Do not put a real `.env` file into the package or image.

1. Verify the adjacent SHA-256 file before extracting the ZIP.
2. Extract into a new release directory.
3. Copy `.env.example` to `.env`, replace `ADMIN_API_KEY` with a long random secret, and set `MODEL_CONFIG_ENCRYPTION_KEY` to another stable random secret. Keep the latter unchanged across upgrades or existing model API keys cannot be decrypted.
4. Set `MODEL_REQUEST_MIN_INTERVAL_MS=60000` unless the model provider has explicitly granted a higher request rate. This is the minimum start-to-start interval shared by every daily-report model batch and retry in one API process; setting it to `0` disables the protection.
5. Set `PUBLIC_BASE_URL` to the externally reachable management site origin, for example `https://reports.example.com`. Do not append `/share/reports/...`; HTTPS is recommended.
6. Run `docker compose build --pull` on the server.
7. Run `docker compose up -d`.
8. Verify `docker compose ps` and `curl --fail http://127.0.0.1:3000/health`.
9. Open `/tasks` directly and confirm the management application loads.
10. Generate or open a completed report, copy its public URL, and verify `/share/reports/{token}` is reachable through the configured public domain.

Persistent application data is stored in the `automationhub-data` Docker volume. Back it up before upgrades. Keep the prior release directory and image tag until the new version passes health and manual checks.
