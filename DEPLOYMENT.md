# AutomationHub 部署手册

本文适用于 `0.1.8` 及后续版本。部署目标是 Linux 服务器，服务器使用 Docker Compose 构建并启动容器。

本次采用全新部署方案，不处理旧目录、旧 PostgreSQL 数据或旧版本迁移。请使用一个新的、为空的部署根目录。

## 1. 目录结构

```text
<deploy-root>/
├── data/
│   ├── .env
│   ├── postgres/
│   └── backups/
└── release/
    ├── 0.1.8/
    └── <next-version>/
```

- `data/.env`：跨版本共用的生产配置和密钥。
- `data/postgres/`：跨版本共用的 PostgreSQL 数据目录。
- `data/backups/`：数据库逻辑备份目录。
- `release/<version>/`：对应版本的完整程序包，每次更新只新增目录。

不再使用 `shared/`、`releases/`、`artifacts/`、`current` 软链接或 `scripts/deploy-release.sh`。

## 2. 核心规则

必须进入具体版本目录执行 Compose：

```bash
cd <deploy-root>/release/<version>
docker compose --env-file ../../data/.env build
docker compose --env-file ../../data/.env up -d
```

Compose 的相对路径固定为：

```text
../../data/.env     -> <deploy-root>/data/.env
../../data/postgres -> <deploy-root>/data/postgres
```

所有版本共用 Compose 项目名 `automation-hub`。从新版本目录执行 `up -d` 会更新应用容器，并继续使用同一个 PostgreSQL 数据目录。当前数据库镜像是 `postgres:18-bookworm`。

禁止执行 `docker compose down -v`，禁止删除 `data/postgres/`。

## 3. 服务器准备

```bash
command -v docker
command -v unzip
command -v sha256sum
command -v curl
docker compose version
docker info
docker image inspect postgres:18-bookworm
```

当前用户需要有 Docker 权限。后续命令请始终使用同一种权限方式，不要混用普通用户和 `sudo`。

## 4. 首次部署

### 4.1 创建目录

先将 `<deploy-root>` 替换为服务器上的实际部署根目录：

```bash
cd <deploy-root>
export DEPLOY_ROOT="$PWD"
mkdir -p "$DEPLOY_ROOT/data/postgres"
mkdir -p "$DEPLOY_ROOT/data/backups"
mkdir -p "$DEPLOY_ROOT/release"
```

如果目录中已有旧的 `shared/`、`releases/` 或旧数据库数据，不要混用。本方案要求新的空目录。

### 4.2 上传并校验制品

将以下两个文件上传到服务器临时目录，例如 `/tmp`：

```text
automation-hub-source-0.1.8.zip
automation-hub-source-0.1.8.zip.sha256
```

校验 ZIP：

```bash
VERSION=0.1.8
ZIP_NAME="automation-hub-source-${VERSION}.zip"
cd /tmp
sha256sum -c "${ZIP_NAME}.sha256"
```

必须看到 `OK`。校验失败时停止部署，重新上传两个文件。

### 4.3 解压程序包

```bash
cd "$DEPLOY_ROOT"
VERSION=0.1.8
ZIP_NAME="automation-hub-source-${VERSION}.zip"
RELEASE_DIR="$DEPLOY_ROOT/release/$VERSION"
test ! -e "$RELEASE_DIR"
mkdir "$RELEASE_DIR"
unzip -q "/tmp/$ZIP_NAME" -d "$RELEASE_DIR"
test -f "$RELEASE_DIR/compose.yaml"
test -f "$RELEASE_DIR/Dockerfile"
test -f "$RELEASE_DIR/.env.example"
```

### 4.4 创建生产配置

只在第一次部署时执行：

```bash
cp "$RELEASE_DIR/.env.example" "$DEPLOY_ROOT/data/.env"
chmod 600 "$DEPLOY_ROOT/data/.env"
nano "$DEPLOY_ROOT/data/.env"
```

至少修改：

```env
ADMIN_API_KEY=管理后台登录密钥
MODEL_CONFIG_ENCRYPTION_KEY=长期保持不变的随机密钥
PGPASSWORD=数据库密码
PUBLIC_BASE_URL=https://你的公网域名
AUTOMATION_HUB_PORT=3000
```

可使用 `openssl rand -hex 32` 生成随机密钥。后续版本必须保持 `MODEL_CONFIG_ENCRYPTION_KEY` 不变。

### 4.5 构建、启动和健康检查

以下命令必须在版本目录执行：

```bash
cd "$RELEASE_DIR"
docker compose --env-file ../../data/.env config
docker compose --env-file ../../data/.env build --no-cache
docker compose --env-file ../../data/.env up -d
docker compose --env-file ../../data/.env ps
```

首次部署使用 `--no-cache`，确保服务器不会复用之前版本的错误构建层。后续版本如果 Dockerfile 或依赖发生变化，也建议首次构建使用 `--no-cache`。

检查健康接口：

```bash
PORT="$(awk -F= '$1 == "AUTOMATION_HUB_PORT" { print $2; exit }' ../../data/.env | tr -d '\r' | tr -d '[:space:]')"
PORT="${PORT:-3000}"
curl --fail --show-error "http://127.0.0.1:${PORT}/health"
```

## 5. 后续更新

每次更新只解压到新的 `release/<版本>`，不修改 `data/`。以下示例更新到 `0.1.9`：

```bash
cd <deploy-root>
export DEPLOY_ROOT="$PWD"
VERSION=0.1.9
ZIP_NAME="automation-hub-source-${VERSION}.zip"
RELEASE_DIR="$DEPLOY_ROOT/release/$VERSION"
test ! -e "$RELEASE_DIR"
mkdir "$RELEASE_DIR"
unzip -q "/tmp/$ZIP_NAME" -d "$RELEASE_DIR"
cd "$RELEASE_DIR"
docker compose --env-file ../../data/.env config
docker compose --env-file ../../data/.env build --no-cache
docker compose --env-file ../../data/.env up -d
docker compose --env-file ../../data/.env ps
```

更新前备份数据库：

```bash
cd "$DEPLOY_ROOT/release/0.1.8"
bash scripts/backup-postgres.sh
```

备份文件写入 `<deploy-root>/data/backups/`。新版本验证通过前不要删除旧版本目录。

## 6. 日常命令

先选择要操作的版本：

```bash
cd <deploy-root>
export DEPLOY_ROOT="$PWD"
VERSION=0.1.8
cd "$DEPLOY_ROOT/release/$VERSION"
```

```bash
docker compose --env-file ../../data/.env ps
docker compose --env-file ../../data/.env logs --tail=100 automation-hub
docker compose --env-file ../../data/.env logs --tail=100 postgres
docker compose --env-file ../../data/.env up -d
docker compose --env-file ../../data/.env down
```

停止服务时禁止使用 `down -v`。

## 7. 失败回退

本方案不使用 `current` 软链接。回退时直接进入已经验证的旧版本目录，使用同一份 `data/.env` 和同一个 `data/postgres/`：

```bash
cd <deploy-root>
export DEPLOY_ROOT="$PWD"
VERSION=0.1.8
cd "$DEPLOY_ROOT/release/$VERSION"
docker compose --env-file ../../data/.env build
docker compose --env-file ../../data/.env up -d
docker compose --env-file ../../data/.env ps
curl --fail --show-error "http://127.0.0.1:${PORT:-3000}/health"
```

回退完成必须确认应用容器和 PostgreSQL 容器运行、`/health` 成功、管理后台可登录，且 `data/postgres/` 仍然存在。

## 8. 首次部署验收

1. `/health` 返回成功。
2. 管理后台可以登录。
3. 设备授权、任务列表和运行日志可以打开。
4. 日报提示词可以读取、修改和保存。
5. 日报生成和 Telegram 推送按配置工作。
6. `data/.env`、`data/postgres/` 和 `data/backups/` 均位于部署根目录下，版本目录中没有生产密钥。

## 9. Windows 开发机生成源码包

在 `codes/AutomationHub/` 目录执行 `scripts/package-source.ps1`。脚本默认生成 `0.1.8`：

```text
dist/automation-hub-source-0.1.8.zip
dist/automation-hub-source-0.1.8.zip.sha256
```

源码包不包含真实 `.env`、PostgreSQL 数据、依赖目录、构建目录、日志或其他 ZIP 文件。

## 10. 本次故障经验

### 10.1 现象与根因

如果 API 容器出现以下错误：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pg'
```

不能只检查 `apps/api/package.json` 是否声明了 `pg`。本项目使用 pnpm workspace，开发和构建阶段的 `node_modules` 可能包含指向 workspace 包存储的符号链接；如果直接把这类目录复制到最终镜像，链接目标不会随镜像一起存在，运行时仍然会找不到依赖。

### 10.2 当前版本的修复规则

Dockerfile 必须在构建阶段为 API 生成独立的生产依赖目录：

```dockerfile
RUN pnpm --filter automation-hub-api deploy --prod --legacy /tmp/api-runtime
RUN cd /tmp/api-runtime && node --input-type=module -e "await import('pg'); await import('proxy-agent')"
```

最终运行镜像只复制这个独立目录下的 `node_modules`，不能复制 workspace 根目录或 `apps/api/node_modules` 的链接目录。构建期导入检查是发布前的快速失败检查，可在镜像生成阶段直接发现生产依赖缺失。

### 10.3 后续排查顺序

出现容器启动异常时，固定按以下顺序检查：

1. 确认当前目录是具体的 `release/<version>`，不要在部署根目录执行 Compose。
2. 执行 `docker compose --env-file ../../data/.env config`，确认配置文件和相对路径解析正确。
3. 执行 `docker compose --env-file ../../data/.env ps`，确认 PostgreSQL 先健康、应用容器没有反复重启。
4. 执行 `docker compose --env-file ../../data/.env logs --tail=200 automation-hub`，区分入口文件缺失、生产依赖缺失和数据库连接问题。
5. Dockerfile 或依赖发生变化时使用 `docker compose --env-file ../../data/.env build --no-cache`，避免复用旧版本错误构建层。
6. 通过 `curl --fail --show-error http://127.0.0.1:<port>/health` 完成应用健康检查。

不要通过把开发依赖目录整体复制进运行镜像来绕过问题，也不要因为容器启动失败而删除 `data/postgres/`。生产依赖必须在构建阶段独立部署并验证，数据目录必须与版本目录保持分离。
