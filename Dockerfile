FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY apps/admin apps/admin
RUN pnpm build
RUN pnpm --filter automation-hub-api deploy --prod --legacy /tmp/api-runtime
RUN cd /tmp/api-runtime && node --input-type=module -e "await import('pg'); await import('proxy-agent')"

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    ADMIN_DIST_PATH=/app/admin

WORKDIR /app
COPY --from=build /app/apps/api/dist /app/api
COPY --from=build /app/apps/admin/dist /app/admin
COPY --from=build /tmp/api-runtime/node_modules /app/api/node_modules

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "/app/api/main/index.js"]
