import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, link, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

export const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(root, '.env') });
const directory = path.resolve(root, process.env.DB_CONFIG_DIR || 'data');
const configPath = path.join(directory, 'connections.json');
const keyPath = path.join(directory, 'credentials.key');
let managementPool;

function useManagementDatabase() {
  return Boolean(process.env.CONFIG_DB_HOST);
}

async function getManagementPool() {
  managementPool ??= mysql.createPool({
    host: process.env.CONFIG_DB_HOST,
    port: Number(process.env.CONFIG_DB_PORT || 3306),
    database: process.env.CONFIG_DB_NAME || 'libra_mcp',
    user: process.env.CONFIG_DB_USER,
    password: process.env.CONFIG_DB_PASSWORD,
    connectionLimit: 3,
  });
  return managementPool;
}

export async function managementPassword() {
  if (process.env.WEB_ADMIN_PASSWORD !== undefined) {
    if (process.env.WEB_ADMIN_PASSWORD.trim().length < 12) {
      throw new Error('WEB_ADMIN_PASSWORD 至少需要 12 个字符');
    }
    return process.env.WEB_ADMIN_PASSWORD;
  }

  const passwordPath = path.join(directory, 'admin-password');
  try {
    return (await readFile(passwordPath, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${passwordPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${randomBytes(24).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  try {
    await link(temporary, passwordPath);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    await unlink(temporary);
  }
  return (await readFile(passwordPath, 'utf8')).trim();
}

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['mysql', 'postgres']),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(255),
  user: z.string().trim().min(1).max(255),
  password: z.string().max(4096).optional(),
  allowedTables: z.array(z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(1000).default([]),
  maxRows: z.coerce.number().int().min(1).max(10000).default(100),
  poolSize: z.coerce.number().int().min(1).max(50).default(5),
  timeout: z.coerce.number().int().min(100).max(120000).default(10000),
});

async function key() {
  if (process.env.DB_CONFIG_ENCRYPTION_KEY) {
    if (process.env.DB_CONFIG_ENCRYPTION_KEY.length < 32) {
      throw new Error('DB_CONFIG_ENCRYPTION_KEY 至少需要 32 个字符');
    }
    return createHash('sha256').update(process.env.DB_CONFIG_ENCRYPTION_KEY, 'utf8').digest();
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return readFile(keyPath);
}

async function encrypt(password) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await key(), iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString('base64')).join('.');
}

async function decrypt(value) {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', await key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export async function loadStore() {
  if (useManagementDatabase()) {
    const pool = await getManagementPool();
    const [connections] = await pool.query('SELECT id, name, db_type AS `type`, host, port, database_name AS `database`, username AS `user`, encrypted_password AS `password`, allowed_tables AS allowedTables, max_rows AS maxRows, pool_size AS poolSize, timeout_ms AS `timeout` FROM libra_mcp_connections ORDER BY name');
    const [tokens] = await pool.query('SELECT id, name, token_hash AS hash, created_at AS createdAt FROM libra_mcp_tokens ORDER BY created_at');
    const [settings] = await pool.query('SELECT setting_key, setting_value FROM libra_mcp_settings');
    const values = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
    return { activeId: values.activeId || null, connections: connections.map((item) => ({ ...item, allowedTables: typeof item.allowedTables === 'string' ? JSON.parse(item.allowedTables) : item.allowedTables })), tokens };
  }
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { activeId: null, connections: [] };
    throw error;
  }
}

async function saveStore(store) {
  if (useManagementDatabase()) {
    const pool = await getManagementPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM libra_mcp_connections');
      for (const item of store.connections) await connection.query('INSERT INTO libra_mcp_connections (id,name,db_type,host,port,database_name,username,encrypted_password,allowed_tables,max_rows,pool_size,timeout_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [item.id, item.name, item.type, item.host, item.port, item.database, item.user, item.password, JSON.stringify(item.allowedTables), item.maxRows, item.poolSize, item.timeout]);
      await connection.query('DELETE FROM libra_mcp_tokens');
      for (const item of store.tokens ?? []) await connection.query('INSERT INTO libra_mcp_tokens (id,name,token_hash,created_at) VALUES (?,?,?,?)', [item.id, item.name, item.hash, new Date(item.createdAt)]);
      await connection.query('INSERT INTO libra_mcp_settings (setting_key,setting_value) VALUES (\'activeId\',?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [store.activeId || '']);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(temporary, configPath);
}

export function publicStore(store) {
  return {
    activeId: store.activeId,
    connections: store.connections.map(({ password, ...connection }) => ({
      ...connection, hasPassword: Boolean(password?.split('.')[2]),
    })),
  };
}

export async function parseConnection(input, existing) {
  const parsed = schema.parse(input);
  return {
    ...parsed,
    password: parsed.password === undefined
      ? (existing?.password ? await decrypt(existing.password) : '')
      : parsed.password,
  };
}

// Serialize edits so overlapping browser requests cannot overwrite each other.
let pending = Promise.resolve();
export function editStore(edit) {
  const result = pending.then(async () => {
    const store = await loadStore();
    await edit(store);
    await saveStore(store);
    return publicStore(store);
  });
  pending = result.catch(() => {});
  return result;
}

export async function saveConnection(store, input, id) {
  const existing = id ? store.connections.find((item) => item.id === id) : undefined;
  if (id && !existing) throw new Error('连接不存在');
  const connection = await parseConnection(input, existing);
  const saved = { ...connection, id: id || randomUUID(), password: await encrypt(connection.password) };
  if (existing) store.connections[store.connections.indexOf(existing)] = saved;
  else store.connections.push(saved);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function listTokens() {
  const store = await loadStore();
  return (store.tokens ?? []).map(({ hash, ...metadata }) => metadata);
}

export async function createToken(input) {
  const name = z.string().trim().min(1).max(100).parse(input?.name);
  const secret = `dbmcp_${randomBytes(32).toString('base64url')}`;
  const metadata = { id: randomUUID(), name, createdAt: new Date().toISOString() };
  await editStore((store) => {
    (store.tokens ??= []).push({ ...metadata, hash: tokenHash(secret) });
  });
  return { ...metadata, secret };
}

export async function revokeToken(id) {
  await editStore((store) => {
    store.tokens = (store.tokens ?? []).filter((entry) => entry.id !== id);
  });
}

export async function authorizeMcp(header) {
  const match = /^Bearer (dbmcp_[A-Za-z0-9_-]{43})$/i.exec(header ?? '');
  if (!match) return false;
  const hash = tokenHash(match[1]);
  const store = await loadStore();
  return (store.tokens ?? []).some((entry) => entry.hash === hash);
}

export async function activeConnection() {
  const store = await loadStore();
  if (store.activeId) {
    const connection = store.connections.find((item) => item.id === store.activeId);
    if (!connection) throw new Error('当前连接不存在，请在 Web 页面重新选择');
    return { ...connection, password: await decrypt(connection.password) };
  }
  const type = (process.env.DB_TYPE || 'postgres').toLowerCase().replace('postgresql', 'postgres');
  return schema.parse({
    name: '环境变量配置',
    type,
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || (type === 'mysql' ? 3306 : 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    allowedTables: (process.env.DB_ALLOWED_TABLES || '').split(',').map((name) => name.trim()).filter(Boolean),
    maxRows: process.env.DB_MAX_ROWS || 100,
    poolSize: process.env.DB_POOL_SIZE || 5,
    timeout: process.env.DB_STATEMENT_TIMEOUT_MS || 10000,
  });
}
