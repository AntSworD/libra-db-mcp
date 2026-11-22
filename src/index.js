import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createDatabase } from './database.js';

async function withDatabase(config, action) {
  const db = await createDatabase(config);
  try {
    return await action({
      ...db,
      databaseType: config.type,
      maxRows: config.maxRows,
      allowedTables: new Set(config.allowedTables.map((name) => name.toLowerCase())),
    });
  } finally {
    await db.end();
  }
}

function assertAllowedTable(tableName, allowedTables) {
  const normalized = tableName.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(normalized)) {
    throw new Error('Table names may contain only letters, numbers and underscores');
  }
  if (allowedTables.size > 0 && !allowedTables.has(normalized)) {
    throw new Error(`Table is not allowed: ${tableName}`);
  }
  return normalized;
}

function validateReadOnlySql(sql) {
  const cleaned = sql.trim().replace(/;\s*$/, '');
  if (!cleaned || cleaned.includes(';')) {
    throw new Error('Only one SQL statement is allowed');
  }
  if (!/^(select|with)\b/i.test(cleaned)) {
    throw new Error('Only SELECT and WITH queries are allowed');
  }
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|call|merge)\b/i.test(cleaned)) {
    throw new Error('Read-only SQL is required');
  }
  return cleaned;
}

export function createMcpServer({ connections, resolveConnection }) {
  const server = new McpServer({ name: 'libra-db-mcp', version: '0.1.0' });
  const connectionId = z.string().uuid().optional().describe('Authorized connection ID from db_list_connections');
  const onConnection = async (id, action) => withDatabase(await resolveConnection(id), action);

server.tool(
  'db_list_connections',
  'List database connections authorized for the current token',
  {},
  () => ({ content: [{ type: 'text', text: JSON.stringify(connections) }] }),
);

server.tool(
  'db_list_tables',
  'List queryable base tables in the configured database',
  { connectionId },
  ({ connectionId }) => onConnection(connectionId, async ({ query, databaseType, allowedTables }) => {
    const rows = databaseType === 'mysql'
      ? await query('SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = ? ORDER BY TABLE_NAME', ['BASE TABLE'])
      : await query('SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = $1 ORDER BY table_name', ['BASE TABLE']);
    const tables = rows.map((row) => row.table_name).filter((name) => allowedTables.size === 0 || allowedTables.has(name.toLowerCase()));
    return { content: [{ type: 'text', text: JSON.stringify(tables) }] };
  }),
);

server.tool(
  'db_describe_table',
  'Return columns and data types for one queryable table',
  { tableName: z.string().min(1), connectionId },
  ({ tableName, connectionId }) => onConnection(connectionId, async ({ query, databaseType, allowedTables }) => {
    const table = assertAllowedTable(tableName, allowedTables);
    const rows = databaseType === 'mysql'
      ? await query('SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION', [table])
      : await query('SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position', [table]);
    return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
  }),
);

server.tool(
  'db_query_readonly',
  'Execute one read-only SELECT/WITH query with the configured row limit.',
  { sql: z.string().min(1), connectionId },
  ({ sql, connectionId }) => onConnection(connectionId, async ({ query, maxRows }) => {
    const safeSql = validateReadOnlySql(sql);
    const limitedSql = `${safeSql} LIMIT ${maxRows}`;
    const rows = await query(limitedSql);
    return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
  }),
);

  return server;
}
