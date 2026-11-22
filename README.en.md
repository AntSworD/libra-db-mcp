# Libra DB MCP <img src="src/public/favicon.svg" alt="" width="24" height="24">

[中文](README.md) · English

Libra DB MCP lets MCP clients query MySQL and PostgreSQL over Streamable HTTP. Use the web admin page to manage database connections, issue access tokens, and choose which connections each token can access.

## Run locally

Run these commands from the repository root. The Docker image uses Node.js 24, which is also recommended for local use.

```bash
npm ci
cp -n .env.example .env
npm start
```

1. Open the [local admin page](http://127.0.0.1:3000) and sign in as `admin`. The password generated on first startup is stored in `data/admin-password`. To set your own password, assign `WEB_ADMIN_PASSWORD` a value of at least 12 characters in `.env` and restart the service.
2. Click **Add connection** (新增连接), enter the database address and read-only credentials, then test and save the connection.
3. Click **Create token** (创建令牌), enter a name, and select the allowed connections. Copy the token and the AI agent setup instructions after creation. The plaintext token is shown only once.
4. In your MCP client, add a Streamable HTTP server at `http://127.0.0.1:3000/mcp` with the `Authorization: Bearer <token>` header. Call `db_list_connections` to check access, then run `SELECT 1 AS ok` with `db_query_readonly` to verify queries work.

## MCP tools and permissions

| Tool | Arguments | Purpose |
| --- | --- | --- |
| `db_list_connections` | None | List the connections the token can access and their IDs |
| `db_list_tables` | `connectionId` | List tables in the selected database |
| `db_describe_table` | `tableName`, `connectionId` | Show the columns and data types of a table |
| `db_query_readonly` | `sql`, `connectionId` | Run a single `SELECT` or `WITH` query with a server-enforced row limit |

You can omit `connectionId` when the token has access to exactly one connection. If it has access to several, pass the target connection ID. With no grants, `db_list_connections` returns an empty list and database operations are denied.

Click **Edit permissions** (编辑权限) in the token list to change which connections a token can access. Saved changes take effect on the next MCP request. Deleting a connection removes its grants, and revoking a token blocks subsequent requests.

The table allowlist filters table listings and column lookups. The database account's privileges control what SQL can read. Use an account with `SELECT` access limited to the tables or views it needs.

## Configuration storage

By default, the service stores connections and token grants in `data/connections.json` and encrypts database passwords with the key in `data/credentials.key`. Set `DB_CONFIG_DIR` to change the storage directory. Back up the configuration and the encryption key together.

### Initialize the MySQL management database

Before running the [initialization script](examples/mysql/management.sql), replace its `change-me` placeholder with the management account password. The script creates `libra_mcp` by default. For a custom database name, update the `CREATE DATABASE`, `USE`, and `GRANT` statements and set `CONFIG_DB_NAME` to the same name.

Run this command from the repository root. Replace the host, port, and `root` with your MySQL endpoint and an account that can create databases, tables, and users and grant privileges.

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p < examples/mysql/management.sql
```

The script creates the connection, token, and settings tables and grants `libra_mcp_admin` `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges on the management database. If the account already exists, use its current password. `CREATE USER IF NOT EXISTS` leaves the existing password in place.

Verify the schema using the application account. The output should include `libra_mcp_connections`, `libra_mcp_tokens`, and `libra_mcp_settings`, plus the `connection_ids` column in the token table.

```bash
mysql -h 127.0.0.1 -P 3306 -u libra_mcp_admin -p -D libra_mcp \
  -e "SHOW TABLES; SHOW COLUMNS FROM libra_mcp_tokens LIKE 'connection_ids';"
```

Set these variables in `.env` and restart the service.

```dotenv
CONFIG_DB_HOST=127.0.0.1
CONFIG_DB_PORT=3306
CONFIG_DB_NAME=libra_mcp
CONFIG_DB_USER=libra_mcp_admin
CONFIG_DB_PASSWORD=<management account password>
DB_CONFIG_ENCRYPTION_KEY=<encryption key of at least 32 characters>
```

Instances sharing a management database must use the same `DB_CONFIG_ENCRYPTION_KEY` to decrypt existing connection credentials. Add the databases you want to query through the web admin page.

### Service addresses

| Environment variable | Purpose |
| --- | --- |
| `WEB_PORT` | Service port, defaults to `3000` |
| `WEB_BIND_ADDRESS` | Bind address, defaults to `127.0.0.1` locally and `0.0.0.0` in the Docker image |
| `WEB_LOCAL_ORIGINS` | Comma-separated list of additional allowed origins, including scheme and any non-default port |
| `MCP_ALLOWED_HOSTS` | Comma-separated list of additional allowed `Host` values for `/mcp`, including the port if the request includes one |

### Upgrade from an earlier release

1. For an existing MySQL management database, run the [token grant migration](examples/mysql/migrate-token-connections.sql) once against that database before deploying. It adds `connection_ids` to `libra_mcp_tokens`.
2. If you configured a database to query through `DB_HOST`, `DB_NAME`, or other `DB_*` variables, add that connection in the web admin page.
3. Existing tokens start with no connection grants. Assign permissions to keep using the same tokens. Saved connections are available to grant immediately.

## Local Docker example

These commands create the `mcp_demo` database on the host's MySQL server and start the service with Compose.

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p < examples/mysql/init.sql
docker compose -f deploy/compose.yaml up --build -d
docker compose -f deploy/compose.yaml exec -T db-mcp cat /app/data/admin-password
```

Open `http://127.0.0.1:13000` and add a MySQL connection. On Docker Desktop, use `host.docker.internal:3306` to reach MySQL on the host. The sample database is `mcp_demo`, the username is `mcp_reader`, and the sample password is `change-me`. Save the connection, create a token with access, and point your MCP client to `http://127.0.0.1:13000/mcp`.

## Development checks

```bash
npm run check
```
