# AutomationHub 部署与升级

本项目采用“发布目录”和“持久化目录”分离的部署布局。`<deploy-root>` 是服务器上的部署根目录；仓库文档不绑定某个真实服务器绝对路径。

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

- `shared/.env`、`shared/postgres/` 和 `shared/backups/` 跨版本保留。
- `releases/<version>/` 只保存某个版本的程序包解压内容。
- `artifacts/` 保存已校验的源码包和 SHA-256 文件。
- `current` 只在新版本健康检查通过后切换，用于标记当前程序版本。

源码包只用于服务器构建 AutomationHub。不要把真实 `.env`、数据库数据或密钥放入源码包或镜像。

## 首次部署

1. 在服务器创建 `<deploy-root>/artifacts/`，上传源码 ZIP 与相邻的 `.sha256` 文件。
2. 将 ZIP 临时解压到临时目录，从其中执行引导脚本。脚本本身会再次校验 ZIP、解压到新的 release，并完成构建、启动和健康检查：

   ```bash
   unzip -q automation-hub-source-0.1.4.zip -d <bootstrap-dir>
   bash <bootstrap-dir>/scripts/deploy-release.sh \
     automation-hub-source-0.1.4.zip <deploy-root>
   ```

3. 首次运行会从 `.env.example` 创建 `<deploy-root>/shared/.env`，然后因存在占位值而停止。编辑该文件中的密钥、域名和端口后，重新执行同一个脚本。
4. 脚本会创建 `shared/postgres/`、`shared/backups/`、`releases/` 和 `artifacts/`，拒绝覆盖已有版本目录，并在 `/health` 通过后更新 `current`。

保持 `MODEL_CONFIG_ENCRYPTION_KEY` 在后续升级中不变，否则现有模型 API 密钥无法解密。生产 Compose 固定使用 PostgreSQL；本地开发仍可使用 SQLite。

## 后续升级

1. 将新版本 ZIP 和 `.sha256` 上传到 `<deploy-root>/artifacts/`，或从其他目录直接传给脚本。
2. 升级前执行数据库备份：

   ```bash
   bash scripts/backup-postgres.sh <deploy-root>
   ```

3. 从新 ZIP 临时解压脚本，并执行：

   ```bash
   unzip -q automation-hub-source-0.1.4.zip -d <bootstrap-dir>
   bash <bootstrap-dir>/scripts/deploy-release.sh \
     automation-hub-source-0.1.4.zip <deploy-root>
   ```

4. 脚本只新增 `releases/0.1.4/`，复用 `shared/.env` 和 `shared/postgres/`，不会复制或覆盖持久化数据。
5. 健康检查通过后，再人工打开 `/tasks`、检查设备心跳、日报生成和公开分享链接。

`MODEL_REQUEST_MIN_INTERVAL_MS=60000` 是默认建议值；`PUBLIC_BASE_URL` 应设置为外部可访问的管理站点 origin，不要追加 `/share/reports/...`。

## PostgreSQL 备份与回退

备份脚本从 `shared/.env` 和 `current` 读取配置，密码只在容器内通过环境变量传给 `pg_dump`，备份文件写入 `shared/backups/` 且权限为 `600`。

```bash
bash scripts/backup-postgres.sh <deploy-root>
```

健康检查失败时脚本会保留新 release，保持 `current` 指向旧版本，并尝试停止新 Compose 服务、重新启动旧版本。人工回退时也只使用旧 release 和同一份 `shared/.env`，确认 `/health` 后再恢复流量。

不要执行 `docker compose down -v`，也不要删除 `shared/postgres/`。数据库 schema 变更必须向后兼容；如果无法做到，必须在升级前准备可验证的数据库备份、恢复和前滚方案。旧 release 在确认新版本稳定前不要删除。

首次 PostgreSQL 部署仍从空库开始，不自动导入旧 JSON 数据。旧 JSON 存储如果需要保留，应由旧版本自己的部署布局管理；本方案不会自动迁移或同步两种数据格式。
