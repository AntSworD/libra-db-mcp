# Libra MCP Server

这是一个基于 Node.js 的 MCP Server，通过 Streamable HTTP 为 MCP 客户端提供 PostgreSQL 或 MySQL 数据库查询能力。

提供以下工具：

- `db_list_connections`：列出当前令牌已授权的数据库连接
- `db_list_tables`：列出所选数据库中的表
- `db_describe_table`：查看表字段和数据类型
- `db_query_readonly`：执行只读 `SELECT` 或 `WITH` 查询

## 启动

```bash
cd tools/db-mcp-server
npm install
cp .env.example .env
# 按需配置 .env 中的管理服务参数，然后启动
npm start
```

建议使用仅对指定表或视图拥有 `SELECT` 权限的数据库账号。

## Web 管理连接

运行 `npm install` 后执行 `npm start`，打开 [本机管理页](http://127.0.0.1:3000)。页面支持新增、编辑、测试和删除 MySQL 或 PostgreSQL 连接。删除连接会同时移除对该连接的令牌授权。

管理服务独立运行，仅监听 `127.0.0.1`。可通过 `WEB_PORT` 修改端口。配置和密码加密密钥默认保存在项目的 `data/` 目录，可用 `DB_CONFIG_DIR` 指定其他目录。Web 和 MCP 需要使用同一个配置目录，备份时需同时保留配置和密钥。

浏览器会提示登录，用户名为 `admin`。首次启动时生成的随机密码保存在配置目录的 `admin-password` 文件，默认路径是 `data/admin-password`，文件权限为 `0600`。可在 `.env` 中设置至少 12 个字符的 `WEB_ADMIN_PASSWORD` 并重启服务，以覆盖默认密码。

## 环境变量

如果此前只通过 `DB_HOST`、`DB_NAME` 等环境变量配置业务库，升级后请在管理页添加该连接并授权给对应令牌。连接的允许表列表应用于列出表和查看字段。SQL 查询的访问范围由数据库账号权限控制。

设置 `CONFIG_DB_HOST` 后，连接列表和 MCP 令牌授权会保存到 `libra_mcp` 管理库。新建管理库时先执行 `examples/mysql/management.sql`，再配置 `CONFIG_DB_*` 和至少 32 个字符的 `DB_CONFIG_ENCRYPTION_KEY`。已有管理库在部署新版前需在对应库执行一次 `examples/mysql/migrate-token-connections.sql`。未配置管理库时继续使用本地 `data/` 文件。

## 配置 MCP 客户端

在管理页的「MCP 访问令牌」中勾选允许访问的连接，再创建并复制令牌。明文只显示一次。可以通过「保存权限」为已有令牌修改授权。升级前创建的令牌默认没有数据库权限，补配授权后可继续使用原令牌。权限变更从下一次 MCP 请求生效。

客户端可用 `db_list_connections` 获取授权连接及其 ID。已授权一个连接时，数据库工具可省略 `connectionId`。授权多个连接时须传入 `connectionId`。没有授权连接时，数据库工具拒绝操作。

在客户端添加 Streamable HTTP MCP 服务，URL 填写 `http://127.0.0.1:3000/mcp`，请求头名称填写 `Authorization`，值填写 `Bearer <令牌>`。服务默认只监听本机。

## 本地 Docker

本地 MySQL 示例使用 `127.0.0.1:3306`。初始化脚本会创建 `mcp_demo` 数据库、`customers` 和 `orders` 示例表，并创建只有查询权限的 `mcp_reader` 账号。

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p < examples/mysql/init.sql
docker compose -f deploy/compose.yaml up --build -d
```

示例账号密码是 `mcp_reader` 和 `change-me`。如果数据库已有同名账号，请先删除账号，或修改 `examples/mysql/init.sql` 中的账号密码后再执行初始化。

管理页地址是 `http://127.0.0.1:13000`，MCP 地址是 `http://127.0.0.1:13000/mcp`。Compose 中的 `host.docker.internal` 用于从容器访问宿主机的 MySQL。
