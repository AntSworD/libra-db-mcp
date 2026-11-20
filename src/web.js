import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadStore, publicStore, editStore, saveConnection, parseConnection, listTokens, createToken, revokeToken, authorizeMcp, managementPassword } from './config.js';
import { createDatabase } from './database.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './index.js';

const port = Number(process.env.WEB_PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WEB_PORT 必须在 1–65535 之间');
const token = randomBytes(32).toString('hex');
const origins = new Set([
  `http://127.0.0.1:${port}`, `http://localhost:${port}`,
  ...(process.env.WEB_LOCAL_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
]);
const mcpHosts = new Set((process.env.MCP_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
const bindAddress = process.env.WEB_BIND_ADDRESS || '127.0.0.1';
const password = await managementPassword();
if (password.length < 12) throw new Error('本地管理密码文件无效');

function digest(value) {
  return createHash('sha256').update(value).digest();
}

const adminCredentials = digest(`admin:${password}`);

function authorizeAdmin(header) {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header ?? '');
  return Boolean(match && timingSafeEqual(adminCredentials, digest(Buffer.from(match[1], 'base64'))));
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('请使用 JSON 请求');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const host = request.headers.host?.toLowerCase();
    const localHost = origins.has(`http://${host}`);
    if ((!localHost && !(url.pathname === '/mcp' && mcpHosts.has(host)))
        || (request.headers.origin && !origins.has(request.headers.origin))) {
      return json(response, 403, { error: 'Host or Origin is not allowed' });
    }
    if (url.pathname === '/mcp') {
      if (!await authorizeMcp(request.headers.authorization)) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return json(response, 401, { error: 'Invalid or missing MCP token' });
      }
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      const mcp = createMcpServer();
      response.once('close', () => { void mcp.close().catch(() => {}); });
      await mcp.connect(transport);
      return await transport.handleRequest(request, response);
    }
    if (!authorizeAdmin(request.headers.authorization)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="Database MCP Admin", charset="UTF-8"');
      return json(response, 401, { error: '请输入管理账号和密码' });
    }
    if (request.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const [file, type] = files[url.pathname];
      let content = await readFile(new URL(`./public/${file}`, import.meta.url), 'utf8');
      if (file === 'index.html') content = content.replace('__TOKEN__', token);
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      return response.end(content);
    }
    const supplied = Buffer.from(request.headers['x-management-token'] || '');
    if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) {
      return json(response, 403, { error: '请刷新管理页面后重试' });
    }
    if (url.pathname === '/api/tokens') {
      if (request.method === 'GET') return json(response, 200, await listTokens());
      if (request.method === 'POST') return json(response, 201, await createToken(await body(request)));
    }
    const tokenMatch = /^\/api\/tokens\/([a-f0-9-]+)$/.exec(url.pathname);
    if (request.method === 'DELETE' && tokenMatch) {
      await revokeToken(tokenMatch[1]);
      return json(response, 200, await listTokens());
    }
    if (request.method === 'GET' && url.pathname === '/api/connections') {
      return json(response, 200, publicStore(await loadStore()));
    }
    if (request.method === 'POST' && url.pathname === '/api/test') {
      const input = await body(request);
      const store = await loadStore();
      const existing = input.id ? store.connections.find((item) => item.id === input.id) : undefined;
      if (input.id && !existing) throw new Error('连接不存在');
      const config = await parseConnection(input, existing);
      const db = await createDatabase(config);
      try {
        await db.query('SELECT 1 AS ok');
        return json(response, 200, { message: '连接成功' });
      } finally { await db.end(); }
    }
    if (request.method === 'POST' && url.pathname === '/api/connections') {
      const input = await body(request);
      return json(response, 201, await editStore((store) => saveConnection(store, input)));
    }
    const match = url.pathname.match(/^\/api\/connections\/([a-zA-Z0-9-]+)(\/activate)?$/);
    if (match) {
      const [, id, activate] = match;
      if (request.method === 'POST' && activate) {
        return json(response, 200, await editStore((store) => {
          if (!store.connections.some((item) => item.id === id)) throw new Error('连接不存在');
          store.activeId = id;
        }));
      }
      if (request.method === 'PUT' && !activate) {
        const input = await body(request);
        return json(response, 200, await editStore((store) => saveConnection(store, input, id)));
      }
      if (request.method === 'DELETE' && !activate) {
        return json(response, 200, await editStore((store) => {
          if (store.activeId === id) throw new Error('请先启用其他连接，再删除当前连接');
          if (!store.connections.some((item) => item.id === id)) throw new Error('连接不存在');
          store.connections = store.connections.filter((item) => item.id !== id);
        }));
      }
    }
    json(response, 404, { error: '接口不存在' });
  } catch (error) {
    if (response.headersSent) return response.end();
    // Never return driver error messages, which can contain connection credentials.
    const message = error.name === 'ZodError' ? '配置格式不正确，请检查必填项、端口和数值范围'
      : ['连接不存在', '请先启用其他连接，再删除当前连接', '请求内容过大', '请使用 JSON 请求'].includes(error.message)
        ? error.message : '操作失败，请检查连接信息、数据库可达性和本地配置文件';
    json(response, 400, { error: message });
  }
});
server.requestTimeout = 15000;
server.listen(port, bindAddress, () => console.log(`数据库 MCP 服务监听 ${bindAddress}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
