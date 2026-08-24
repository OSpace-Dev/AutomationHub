# AutomationHub 部署与升级操作手册

本文面向 Linux 服务器。部署采用“发布目录”和“持久化目录”分离的布局：

```text
<deploy-root>/
├── shared/
│   ├── .env
│   ├── postgres/
│   └── backups/
├── releases/
│   ├── 0.1.3/
│   └── 0.1.4/
├── artifacts/
│   ├── automation-hub-source-0.1.4.zip
│   └── automation-hub-source-0.1.4.zip.sha256
└── current -> releases/0.1.4
```

本项目 `0.1.5` 起使用 `postgres:18-bookworm`。PostgreSQL 18 的数据目录布局与 17 及更早版本不同：

- Compose 宿主机目录仍是 `shared/postgres/`。
- 容器挂载点是 `/var/lib/postgresql`。
- PostgreSQL 18 默认实际数据目录是 `/var/lib/postgresql/18/docker`，因此宿主机上通常会出现 `shared/postgres/18/docker/PG_VERSION`。
- PostgreSQL 16 或更早版本常见的 `shared/postgres/PG_VERSION` 目录不能直接被 PostgreSQL 18 启动。

## 1. 目录职责

- `shared/.env`：所有版本共用的生产配置和密钥。
- `shared/postgres/`：所有版本共用的 PostgreSQL 数据目录。
- `shared/backups/`：PostgreSQL 备份文件。
- `releases/<version>/`：某个版本解压后的程序文件，只新增，不覆盖旧版本。
- `artifacts/`：上传的 ZIP 和 SHA-256 校验文件。
- `current`：指向当前已通过健康检查的 release 的软链接。

所有服务器命令都从 `<deploy-root>` 执行。先将 `<deploy-root>` 替换为实际部署目录：

```bash
cd <deploy-root>
export DEPLOY_ROOT="$PWD"
```

不要在 `releases/<version>/` 内直接运行相对路径的部署命令。Compose 文件虽然位于 release 目录，但命令通过 `--project-directory` 明确指定该目录。

## 2. 先判断当前处于哪一步

在部署根目录执行：

```bash
cd <deploy-root>
export DEPLOY_ROOT="$PWD"
find "$DEPLOY_ROOT" -maxdepth 2 -type d -print
test -f "$DEPLOY_ROOT/shared/.env" && echo 'shared/.env: exists' || echo 'shared/.env: missing'
test -L "$DEPLOY_ROOT/current" && echo 'current: exists' || echo 'current: missing'
```

按结果选择流程：

- `releases/<version>` 不存在：按第 4 节执行首次部署。
- `releases/<version>` 已存在，但 `current` 不存在：按第 5 节“已有 release”执行手动启动。
- `current` 已存在：服务通常已经部署过；按第 6 节检查容器和日志，升级按第 7 节执行。

不要把“上传 ZIP”“解压临时引导脚本”“解压到 `releases/<version>`”混为同一个步骤。ZIP 可以放在 `artifacts/`，引导脚本放在临时目录，正式程序才放在 `releases/<version>`。

## 3. 部署前检查

服务器需要安装并运行：

```bash
command -v bash
command -v unzip
command -v zipinfo
command -v sha256sum
command -v curl
command -v docker
docker compose version
docker info
docker image inspect postgres:18-bookworm
```

`docker info` 必须成功。若 Docker 服务未启动，可使用：

```bash
sudo systemctl enable --now docker
```

当前用户还需要能够执行 Docker。若出现 permission denied，确认用户已加入 Docker 用户组，或临时使用 `sudo docker ...`，但不要混用两种方式创建同一套容器和数据目录。

## 4. 上传制品

每个版本必须同时上传两个文件，并且文件名不能修改：

```text
artifacts/automation-hub-source-<version>.zip
artifacts/automation-hub-source-<version>.zip.sha256
```

校验文件必须与 ZIP 放在同一目录。上传后执行：

```bash
VERSION=0.1.5
ZIP_NAME="automation-hub-source-${VERSION}.zip"

cd "$DEPLOY_ROOT/artifacts"
sha256sum -c "$ZIP_NAME.sha256"
```

看到 `OK` 才继续。若校验失败，重新上传两个文件，不要强行部署。

## 5. 首次部署

首次部署使用制品 ZIP 内的 `scripts/deploy-release.sh`。脚本会负责：

1. 校验 ZIP 和路径安全。
2. 创建 `shared/`、`releases/` 和 `artifacts/`。
3. 从 `.env.example` 创建 `shared/.env`。
4. 将程序解压到新的 `releases/<version>/`。
5. 执行 Docker Compose 构建、启动和 `/health` 检查。
6. 健康检查通过后更新 `current`。

### 5.1 解压引导脚本

在部署根目录执行：

```bash
VERSION=0.1.5
ZIP_NAME="automation-hub-source-${VERSION}.zip"
BOOTSTRAP_DIR="$(mktemp -d)"

unzip -q \
  "$DEPLOY_ROOT/artifacts/$ZIP_NAME" \
  -d "$BOOTSTRAP_DIR"
```

不要把引导目录放入 `releases/`，因为它只是临时执行脚本的目录。

### 5.2 第一次运行

```bash
bash "$BOOTSTRAP_DIR/scripts/deploy-release.sh" \
  "$DEPLOY_ROOT/artifacts/$ZIP_NAME" \
  "$DEPLOY_ROOT"
```

第一次运行如果提示以下内容，这是预期流程，不是部署失败：

```text
Created .../shared/.env from .env.example.
Replace placeholder values ... before deployment.
```

此时脚本已经创建了 `shared/.env`，但不会启动服务。编辑配置：

```bash
umask 077
nano "$DEPLOY_ROOT/shared/.env"
chmod 600 "$DEPLOY_ROOT/shared/.env"
```

至少修改这些配置：

```env
ADMIN_API_KEY=改成管理后台登录密钥
MODEL_CONFIG_ENCRYPTION_KEY=生成后长期保持不变
PGPASSWORD=改成数据库密码
PUBLIC_BASE_URL=https://外部访问的管理站点域名
AUTOMATION_HUB_PORT=3000
```

`MODEL_CONFIG_ENCRYPTION_KEY` 后续升级必须保持不变，否则已保存的模型 API 密钥无法解密。

可以使用以下命令生成随机值，再复制到 `.env`：

```bash
openssl rand -hex 32
```

不要把真实 `.env` 上传到 `artifacts/`，也不要把密钥写入源码或 ZIP。

### 5.3 第二次运行

配置完成后，在部署根目录重新执行同一条命令：

```bash
bash "$BOOTSTRAP_DIR/scripts/deploy-release.sh" \
  "$DEPLOY_ROOT/artifacts/$ZIP_NAME" \
  "$DEPLOY_ROOT"
```

成功时应看到：

```text
Prepared release: ...
Deployment succeeded. Current release: 0.1.5
```

执行完成后可以删除临时引导目录：

```bash
rm -rf "$BOOTSTRAP_DIR"
```

## 6. 已经存在 `releases/<version>` 时怎么处理

如果已经看到：

```text
releases/0.1.4/
shared/.env
shared/postgres/
```

说明初始化流程已经执行过一部分。此时不要再次运行 `deploy-release.sh`，因为脚本会拒绝覆盖已有的 `releases/0.1.4/`。

先检查配置没有占位符：

```bash
grep -n 'replace-with-' "$DEPLOY_ROOT/shared/.env" || true
```

如果有输出，先编辑配置并再次检查：

```bash
nano "$DEPLOY_ROOT/shared/.env"
chmod 600 "$DEPLOY_ROOT/shared/.env"
```

然后手动完成当前 release 的 Docker 启动：

```bash
VERSION=0.1.4
RELEASE_DIR="$DEPLOY_ROOT/releases/$VERSION"
ENV_FILE="$DEPLOY_ROOT/shared/.env"

compose() {
  AUTOMATION_HUB_VERSION="$VERSION" docker compose \
    --project-name automation-hub \
    --project-directory "$RELEASE_DIR" \
    --env-file "$ENV_FILE" \
    --file "$RELEASE_DIR/compose.yaml" \
    --no-ansi "$@"
}

compose config
compose build --pull
compose up -d
compose ps
```

检查健康状态：

```bash
curl --fail --show-error http://127.0.0.1:3000/health
```

如果 `AUTOMATION_HUB_PORT` 不是 `3000`，将上面的端口替换成 `.env` 中的端口。

健康检查成功并且 `current` 不存在时，创建当前版本软链接：

```bash
if [[ ! -e "$DEPLOY_ROOT/current" && ! -L "$DEPLOY_ROOT/current" ]]; then
  ln -s "releases/$VERSION" "$DEPLOY_ROOT/.current-$VERSION"
  mv -Tf "$DEPLOY_ROOT/.current-$VERSION" "$DEPLOY_ROOT/current"
fi

readlink -f "$DEPLOY_ROOT/current"
```

如果 `current` 已经存在，不要直接删除。先确认它指向哪个版本：

```bash
readlink -f "$DEPLOY_ROOT/current"
```

## 7. 日常检查与日志

查看当前版本：

```bash
readlink -f "$DEPLOY_ROOT/current"
```

查看容器：

```bash
VERSION="$(basename "$(readlink -f "$DEPLOY_ROOT/current")")"
RELEASE_DIR="$DEPLOY_ROOT/releases/$VERSION"

docker compose \
  --project-name automation-hub \
  --project-directory "$RELEASE_DIR" \
  --env-file "$DEPLOY_ROOT/shared/.env" \
  --file "$RELEASE_DIR/compose.yaml" \
  --no-ansi ps
```

查看应用日志：

```bash
docker compose \
  --project-name automation-hub \
  --project-directory "$RELEASE_DIR" \
  --env-file "$DEPLOY_ROOT/shared/.env" \
  --file "$RELEASE_DIR/compose.yaml" \
  --no-ansi logs --tail=100 automation-hub
```

查看 PostgreSQL 日志：

```bash
docker compose \
  --project-name automation-hub \
  --project-directory "$RELEASE_DIR" \
  --env-file "$DEPLOY_ROOT/shared/.env" \
  --file "$RELEASE_DIR/compose.yaml" \
  --no-ansi logs --tail=100 postgres
```

重新启动当前版本：

```bash
docker compose \
  --project-name automation-hub \
  --project-directory "$RELEASE_DIR" \
  --env-file "$DEPLOY_ROOT/shared/.env" \
  --file "$RELEASE_DIR/compose.yaml" \
  --no-ansi up -d
```

停止当前服务时可以使用 `down`，但禁止使用 `down -v`：

```bash
docker compose \
  --project-name automation-hub \
  --project-directory "$RELEASE_DIR" \
  --env-file "$DEPLOY_ROOT/shared/.env" \
  --file "$RELEASE_DIR/compose.yaml" \
  --no-ansi down
```

## 8. 后续升级

以下示例假设升级到 `0.1.5`，实际版本替换 `VERSION` 即可。

### 8.1 上传并校验

将以下两个文件上传到 `$DEPLOY_ROOT/artifacts/`：

```text
automation-hub-source-0.1.5.zip
automation-hub-source-0.1.5.zip.sha256
```

```bash
VERSION=0.1.5
ZIP_NAME="automation-hub-source-${VERSION}.zip"

cd "$DEPLOY_ROOT/artifacts"
sha256sum -c "$ZIP_NAME.sha256"
test ! -e "$DEPLOY_ROOT/releases/$VERSION"
```

如果同版本 release 已存在，停止升级，不要覆盖它。

### 8.2 升级前备份

备份脚本位于当前 release 中，使用当前 `current` 和 `shared/.env`：

```bash
CURRENT_RELEASE="$(readlink -f "$DEPLOY_ROOT/current")"
bash "$CURRENT_RELEASE/scripts/backup-postgres.sh" "$DEPLOY_ROOT"
```

确认备份文件已生成：

```bash
ls -lh "$DEPLOY_ROOT/shared/backups/"
```

如果 `shared/postgres/PG_VERSION` 存在且内容为 `16` 或其他非 `18` 版本，先按第 9 节完成数据库迁移，再执行第 8.3 节。不要直接运行 PostgreSQL 18 Compose，也不要删除旧数据目录。

### 8.3 执行升级

从新 ZIP 解压临时引导脚本：

```bash
BOOTSTRAP_DIR="$(mktemp -d)"
unzip -q "$DEPLOY_ROOT/artifacts/$ZIP_NAME" -d "$BOOTSTRAP_DIR"

bash "$BOOTSTRAP_DIR/scripts/deploy-release.sh" \
  "$DEPLOY_ROOT/artifacts/$ZIP_NAME" \
  "$DEPLOY_ROOT"
```

脚本只会新增 `releases/0.1.5/`，复用以下数据：

```text
shared/.env
shared/postgres/
shared/backups/
```

只有新版本构建、启动和 `/health` 检查全部通过后，`current` 才会切换。

## 9. PostgreSQL 16 迁移到 PostgreSQL 18

只有当 `shared/postgres/PG_VERSION` 内容为 `16` 或其他低于 `18` 的版本时执行本节。迁移采用“旧库逻辑备份 -> 新空目录初始化 -> 逻辑恢复”，旧目录会保留用于排查和回退。

### 9.1 确认旧数据库版本并备份

```bash
cd <deploy-root>
export DEPLOY_ROOT="$PWD"
cat "$DEPLOY_ROOT/shared/postgres/PG_VERSION"
CURRENT_RELEASE="$(readlink -f "$DEPLOY_ROOT/current")"
bash "$CURRENT_RELEASE/scripts/backup-postgres.sh" "$DEPLOY_ROOT"
BACKUP_PATH="$(ls -1t "$DEPLOY_ROOT/shared/backups"/postgres-*.dump | head -n 1)"
test -s "$BACKUP_PATH"
```

备份文件必须存在且大小大于 0。若备份失败，停止迁移，不要移动数据库目录。

### 9.2 停止旧版本并保留旧数据目录

```bash
VERSION="$(basename "$CURRENT_RELEASE")"
OLD_COMPOSE_ARGS=(
  --project-name automation-hub
  --project-directory "$CURRENT_RELEASE"
  --env-file "$DEPLOY_ROOT/shared/.env"
  --file "$CURRENT_RELEASE/compose.yaml"
  --no-ansi
)
docker compose "${OLD_COMPOSE_ARGS[@]}" down

MIGRATION_SUFFIX="$(date -u +%Y%m%d-%H%M%S)"
mv "$DEPLOY_ROOT/shared/postgres" \
  "$DEPLOY_ROOT/shared/postgres-pg16-$MIGRATION_SUFFIX"
install -d -m 700 "$DEPLOY_ROOT/shared/postgres"
```

不要执行 `docker compose down -v`。不要删除 `postgres-pg16-*` 目录。

### 9.3 准备 0.1.5 release 并只启动 PostgreSQL 18

将 `automation-hub-source-0.1.5.zip` 和校验文件上传到 `artifacts/`，完成第 8.1 节校验，然后执行：

```bash
VERSION=0.1.5
ZIP_NAME="automation-hub-source-${VERSION}.zip"
RELEASE_DIR="$DEPLOY_ROOT/releases/$VERSION"
test ! -e "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
unzip -q "$DEPLOY_ROOT/artifacts/$ZIP_NAME" -d "$RELEASE_DIR"

COMPOSE_ARGS=(
  --project-name automation-hub
  --project-directory "$RELEASE_DIR"
  --env-file "$DEPLOY_ROOT/shared/.env"
  --file "$RELEASE_DIR/compose.yaml"
  --no-ansi
)
AUTOMATION_HUB_VERSION="$VERSION" docker compose "${COMPOSE_ARGS[@]}" up -d postgres
AUTOMATION_HUB_VERSION="$VERSION" docker compose "${COMPOSE_ARGS[@]}" ps
```

确认 PostgreSQL 18 已经初始化：

```bash
docker compose "${COMPOSE_ARGS[@]}" exec -T postgres \
  sh -c 'cat "$PGDATA/PG_VERSION"'
```

预期输出为 `18`。如果不是 `18`，停止操作并查看日志：

```bash
docker compose "${COMPOSE_ARGS[@]}" logs --tail=100 postgres
```

### 9.4 恢复备份并启动应用

```bash
AUTOMATION_HUB_VERSION="$VERSION" docker compose "${COMPOSE_ARGS[@]}" exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --clean --if-exists --no-owner' < "$BACKUP_PATH"

AUTOMATION_HUB_VERSION="$VERSION" docker compose "${COMPOSE_ARGS[@]}" up -d automation-hub
AUTOMATION_HUB_VERSION="$VERSION" docker compose "${COMPOSE_ARGS[@]}" ps
```

检查服务：

```bash
PORT="$(awk -F= '$1 == "AUTOMATION_HUB_PORT" { print $2; exit }' "$DEPLOY_ROOT/shared/.env" | tr -d '\r' | tr -d '[:space:]')"
PORT="${PORT:-3000}"
curl --fail --show-error "http://127.0.0.1:$PORT/health"
```

健康检查和人工验收都通过后，再切换 `current`：

```bash
ln -s "releases/$VERSION" "$DEPLOY_ROOT/.current-$VERSION"
mv -Tf "$DEPLOY_ROOT/.current-$VERSION" "$DEPLOY_ROOT/current"
readlink -f "$DEPLOY_ROOT/current"
```

迁移失败时，停止 0.1.5 Compose，恢复旧目录名称，并使用旧 release 启动。迁移前先记录旧的 `current` 目标：

```bash
docker compose "${COMPOSE_ARGS[@]}" down
mv "$DEPLOY_ROOT/shared/postgres" "$DEPLOY_ROOT/shared/postgres-pg18-failed-$MIGRATION_SUFFIX"
mv "$DEPLOY_ROOT/shared/postgres-pg16-$MIGRATION_SUFFIX" "$DEPLOY_ROOT/shared/postgres"
AUTOMATION_HUB_VERSION="$(basename "$CURRENT_RELEASE")" docker compose \
  --project-name automation-hub \
  --project-directory "$CURRENT_RELEASE" \
  --env-file "$DEPLOY_ROOT/shared/.env" \
  --file "$CURRENT_RELEASE/compose.yaml" \
  --no-ansi up -d
```

如果 `current` 在迁移过程中已经被切换，按第 10 节的软链接切换命令将它恢复到 `CURRENT_RELEASE`；如果从未切换，则保持原链接不变。回退后使用第 10 节的健康检查确认旧版本恢复。

## 10. 升级失败与回退

部署脚本失败时会：

1. 保留新建的 release，便于排查。
2. 停止新版本 Compose 服务。
3. 尝试重新启动上一版本。
4. 保持 `current` 指向旧版本。

检查当前版本：

```bash
readlink -f "$DEPLOY_ROOT/current"
```

手动启动指定旧版本时：

```bash
VERSION=0.1.3
RELEASE_DIR="$DEPLOY_ROOT/releases/$VERSION"

AUTOMATION_HUB_VERSION="$VERSION" docker compose \
  --project-name automation-hub \
  --project-directory "$RELEASE_DIR" \
  --env-file "$DEPLOY_ROOT/shared/.env" \
  --file "$RELEASE_DIR/compose.yaml" \
  --no-ansi up -d
```

确认旧版本健康后，再切换软链接：

```bash
ln -s "releases/$VERSION" "$DEPLOY_ROOT/.current-$VERSION"
mv -Tf "$DEPLOY_ROOT/.current-$VERSION" "$DEPLOY_ROOT/current"
curl --fail --show-error http://127.0.0.1:3000/health
```

回退期间：

- 不删除 `shared/postgres/`。
- 不执行 `docker compose down -v`。
- 不删除最后一个可用的旧 release。
- 不修改现有的 `MODEL_CONFIG_ENCRYPTION_KEY`。

## 10. 首次部署验收

部署成功后至少检查：

```bash
curl --fail --show-error http://127.0.0.1:3000/health
readlink -f "$DEPLOY_ROOT/current"
docker ps
```

浏览器人工验收：

1. 打开管理后台，确认可以登录。
2. 打开任务列表，确认任务数据可以读取。
3. 检查设备心跳和授权管理。
4. 打开日报设置，确认日报提示词可以修改和保存。
5. 检查日报生成、Telegram 推送和公开分享链接。

## 11. 数据与安全注意事项

- `shared/.env` 不上传、不提交、不放入 ZIP。
- PostgreSQL 数据只在 `shared/postgres/`，不要删除或移动。
- 备份文件位于 `shared/backups/`，权限应为 `600`。
- `MODEL_CONFIG_ENCRYPTION_KEY` 必须跨版本保持一致。
- `PUBLIC_BASE_URL` 应设置为外部可访问的站点 origin，不要追加分享页面路径。
- 数据库 schema 变更必须向后兼容；不兼容迁移必须在升级前单独准备恢复方案。
