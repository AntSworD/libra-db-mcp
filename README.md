# Libra DB MCP <img src="src/public/favicon.svg" alt="" width="24" height="24">

中文 · [English](README.en.md)

通过 Streamable HTTP 为 MCP 客户端提供 MySQL 和 PostgreSQL 查询能力。Web 管理页用于管理数据库连接、签发访问令牌，以及为每个令牌分配可访问的连接。

## 本地启动

在仓库根目录执行以下命令。Docker 镜像使用 Node.js 24，本地也推荐使用同一版本。

```bash
npm ci
cp -n .env.example .env
npm start
```

1. 打开 [本地管理页](http://127.0.0.1:3000)，用 `admin` 登录。首次启动时生成的密码保存在 `data/admin-password`。也可以在 `.env` 中设置至少 12 个字符的 `WEB_ADMIN_PASSWORD`，然后重启服务。
2. 点击「新增连接」，填写业务库地址和只读账号。测试连接后保存。
3. 点击「创建令牌」，填写名称并勾选允许访问的连接。创建后可复制令牌和 AI Agent 配置指引。令牌明文只在创建时显示。
4. 在 MCP 客户端添加 Streamable HTTP 服务，地址为 `http://127.0.0.1:3000/mcp`，请求头为 `Authorization: Bearer <令牌>`。调用 `db_list_connections` 确认可访问的连接，再用 `db_query_readonly` 执行 `SELECT 1 AS ok` 验证查询。

## MCP 工具与授权

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| `db_list_connections` | 无 | 列出令牌已授权的数据库连接及其 ID |
| `db_list_tables` | `connectionId` | 列出目标数据库的表 |
| `db_describe_table` | `tableName`、`connectionId` | 查看表字段和数据类型 |
| `db_query_readonly` | `sql`、`connectionId` | 执行单条 `SELECT` 或 `WITH` 查询，服务端追加行数限制 |

查询会在数据库侧包裹并限制最大返回行数，同时检查响应字节数；配置了表白名单时，SQL 中的 `FROM` / `JOIN` 表也必须在白名单内。数据库账号权限仍是最终安全边界。

令牌只授权一个连接时可省略 `connectionId`。授权多个连接时须传入目标连接的 ID。令牌没有授权时，连接列表为空，数据库操作会被拒绝。

在令牌列表点击「编辑权限」可调整授权，保存后从下一次 MCP 请求生效。删除连接会一并移除它的令牌授权，撤销令牌后新请求会被拒绝。

表白名单用于列出表和查看字段。SQL 能读取哪些库、表或视图由数据库账号权限控制，请给业务连接使用仅有必要 `SELECT` 权限的账号。

## 管理配置存储

默认将连接和令牌授权保存在 `data/connections.json`，数据库密码通过 `data/credentials.key` 加密。可用 `DB_CONFIG_DIR` 修改目录。备份时请同时保留配置和加密密钥。

### 初始化 MySQL 管理库

首次启用 MySQL 管理库时，先把脚本中的 `change-me` 改为管理库账号的实际密码。脚本默认创建 `libra_mcp` 库。如果使用自定义库名，请同步修改脚本中的 `CREATE DATABASE`、`USE` 和 `GRANT` 目标，并让下方的 `CONFIG_DB_NAME` 与之对应。[管理库初始化脚本](examples/mysql/management.sql)

在仓库根目录运行以下命令。将主机、端口与 `root` 换成实际 MySQL 地址和有建库、建表、创建账号及授权权限的账号。

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p < examples/mysql/management.sql
```

脚本会创建连接、令牌和设置表，并给 `libra_mcp_admin` 授予管理库内的 `SELECT`、`INSERT`、`UPDATE` 和 `DELETE` 权限。如果账号已存在，请使用该账号的现有密码，`CREATE USER IF NOT EXISTS` 不会更新密码。

用应用账号检查初始化结果。输出应包含 `libra_mcp_connections`、`libra_mcp_tokens` 和 `libra_mcp_settings`，以及令牌表中的 `connection_ids` 字段。

```bash
mysql -h 127.0.0.1 -P 3306 -u libra_mcp_admin -p -D libra_mcp \
  -e "SHOW TABLES; SHOW COLUMNS FROM libra_mcp_tokens LIKE 'connection_ids';"
```

将以下配置填入 `.env`，然后重启服务。

```dotenv
CONFIG_DB_HOST=127.0.0.1
CONFIG_DB_PORT=3306
CONFIG_DB_NAME=libra_mcp
CONFIG_DB_USER=libra_mcp_admin
CONFIG_DB_PASSWORD=<管理库密码>
DB_CONFIG_ENCRYPTION_KEY=<至少32个字符的加密密钥>
```

多个实例共享管理库时，需使用同一 `DB_CONFIG_ENCRYPTION_KEY` 才能解密已有连接。管理库保存连接配置和令牌授权，业务库连接在管理页中添加。

### 服务地址

| 环境变量 | 用途 |
| --- | --- |
| `WEB_PORT` | 服务端口，默认 `3000` |
| `WEB_BIND_ADDRESS` | 监听地址，本机启动默认 `127.0.0.1`，Docker 镜像默认 `0.0.0.0` |
| `WEB_LOCAL_ORIGINS` | 逗号分隔的额外允许来源，包含协议及非默认端口 |
| `MCP_ALLOWED_HOSTS` | 逗号分隔的额外 `/mcp` 请求 Host，填写域名及请求中携带的端口 |

### 从旧版升级

1. 使用已有 MySQL 管理库时，在部署前对实际管理库执行一次 [令牌授权迁移脚本](examples/mysql/migrate-token-connections.sql)，为 `libra_mcp_tokens` 添加 `connection_ids`。
2. 以前通过 `DB_HOST`、`DB_NAME` 等 `DB_*` 变量配置的业务库，升级后需在管理页添加连接。
3. 旧令牌的数据库授权默认为空。给它们补配权限后可继续使用原令牌。数据库工具根据令牌授权选库，保存连接后即可授权使用。

## Docker 本地示例

以下命令在宿主机 MySQL 上创建示例库 `mcp_demo`，并用 Compose 启动服务。

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p < examples/mysql/init.sql
docker compose -f deploy/compose.yaml up --build -d
docker compose -f deploy/compose.yaml exec -T db-mcp cat /app/data/admin-password
```

打开 `http://127.0.0.1:13000`，在管理页添加 MySQL 连接。Docker Desktop 上可用 `host.docker.internal:3306` 访问宿主机。示例库名为 `mcp_demo`，账号为 `mcp_reader`，示例密码为 `change-me`。保存连接并创建已授权的令牌后，客户端连接 `http://127.0.0.1:13000/mcp`。

## 开发检查

```bash
npm run check
```
