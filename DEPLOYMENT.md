# AutomationHub 部署手册

本文适用于 `0.1.6` 及后续版本。部署目标是 Linux 服务器，服务器使用 Docker Compose 构建并启动容器。

本次采用全新部署方案，不处理旧目录、旧 PostgreSQL 数据或旧版本迁移。请使用一个新的、为空的部署根目录。

## 1. 目录结构

```text
<deploy-root>/
├── data/
│   ├── .env
│   ├── postgres/
│   └── backups/
└── release/
    ├── 0.1.6/
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
automation-hub-source-0.1.6.zip
automation-hub-source-0.1.6.zip.sha256
```

校验 ZIP：

```bash
VERSION=0.1.6
ZIP_NAME="automation-hub-source-${VERSION}.zip"
cd /tmp
sha256sum -c "${ZIP_NAME}.sha256"
```

必须看到 `OK`。校验失败时停止部署，重新上传两个文件。

### 4.3 解压程序包

```bash
cd "$DEPLOY_ROOT"
VERSION=0.1.6
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
docker compose --env-file ../../data/.env build
docker compose --env-file ../../data/.env up -d
docker compose --env-file ../../data/.env ps
```

检查健康接口：

```bash
PORT="$(awk -F= '$1 == "AUTOMATION_HUB_PORT" { print $2; exit }' ../../data/.env | tr -d '\r' | tr -d '[:space:]')"
PORT="${PORT:-3000}"
curl --fail --show-error "http://127.0.0.1:${PORT}/health"
```

## 5. 后续更新

每次更新只解压到新的 `release/<版本>`，不修改 `data/`。以下示例更新到 `0.1.7`：

```bash
cd <deploy-root>
export DEPLOY_ROOT="$PWD"
VERSION=0.1.7
ZIP_NAME="automation-hub-source-${VERSION}.zip"
RELEASE_DIR="$DEPLOY_ROOT/release/$VERSION"
test ! -e "$RELEASE_DIR"
mkdir "$RELEASE_DIR"
unzip -q "/tmp/$ZIP_NAME" -d "$RELEASE_DIR"
cd "$RELEASE_DIR"
docker compose --env-file ../../data/.env config
docker compose --env-file ../../data/.env build
docker compose --env-file ../../data/.env up -d
docker compose --env-file ../../data/.env ps
```

更新前备份数据库：

```bash
cd "$DEPLOY_ROOT/release/0.1.6"
bash scripts/backup-postgres.sh
```

备份文件写入 `<deploy-root>/data/backups/`。新版本验证通过前不要删除旧版本目录。

## 6. 日常命令

先选择要操作的版本：

```bash
cd <deploy-root>
export DEPLOY_ROOT="$PWD"
VERSION=0.1.6
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
VERSION=0.1.6
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

在 `codes/AutomationHub/` 目录执行 `scripts/package-source.ps1`。脚本默认生成 `0.1.6`：

```text
dist/automation-hub-source-0.1.6.zip
dist/automation-hub-source-0.1.6.zip.sha256
```

源码包不包含真实 `.env`、PostgreSQL 数据、依赖目录、构建目录、日志或其他 ZIP 文件。
