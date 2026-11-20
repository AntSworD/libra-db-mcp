const form = document.querySelector('#form-title + form');
const tokenForm = document.querySelector('#token-form');
const tokenList = document.querySelector('#tokens');
const newToken = document.querySelector('#new-token');
const tokenSecret = document.querySelector('#token-secret');
const fields = form.elements;
const list = document.querySelector('#connections');
const status = document.querySelector('#status');
const token = document.querySelector('meta[name="management-token"]').content;
let store = { connections: [], activeId: null };
let selectedId = null;

async function api(path, method = 'GET', input) {
  const headers = { 'X-Management-Token': token };
  if (input) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api${path}`, { method, headers, body: input && JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

async function run(action) {
  const controls = [...document.querySelectorAll('button, input, select')];
  const enabled = controls.filter((control) => !control.disabled);
  enabled.forEach((control) => { control.disabled = true; });
  status.className = '';
  status.textContent = '处理中…';
  try {
    status.textContent = await action();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  } finally {
    enabled.forEach((control) => { control.disabled = false; });
  }
}

function select(connection) {
  selectedId = connection?.id ?? null;
  form.reset();
  document.querySelector('#form-title').textContent = connection ? '编辑连接' : '新增连接';
  document.querySelector('#clear-label').hidden = !connection?.hasPassword;
  document.querySelector('#password-hint').textContent = connection?.hasPassword ? '留空保留现有密码。' : '';
  fields.password.disabled = false;
  if (!connection) return;
  for (const name of ['name', 'type', 'host', 'port', 'database', 'user', 'maxRows', 'poolSize', 'timeout']) {
    fields[name].value = connection[name];
  }
  fields.allowedTables.value = connection.allowedTables.join(', ');
}

function button(label, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
  return element;
}

function render() {
  list.replaceChildren();
  if (!store.connections.length) list.textContent = '还没有保存的连接。';
  for (const connection of store.connections) {
    const entry = document.createElement('article');
    entry.className = 'connection';
    const name = document.createElement('strong');
    name.textContent = connection.name;
    entry.append(name);
    const active = connection.id === store.activeId;
    if (active) {
      const badge = document.createElement('span');
      badge.className = 'active';
      badge.textContent = '已启用';
      entry.append(badge);
    }
    const detail = document.createElement('p');
    detail.className = 'detail';
    detail.textContent = `${connection.type === 'mysql' ? 'MySQL' : 'PostgreSQL'} · ${connection.user}@${connection.host}:${connection.port}/${connection.database}`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(button('编辑', () => select(connection)));
    if (!active) {
      actions.append(button('启用', () => run(async () => {
        store = await api(`/connections/${connection.id}/activate`, 'POST');
        render();
        return '已启用，下次 MCP 工具调用将使用此连接。';
      })));
    }
    actions.append(button('删除', () => {
      if (!confirm(`删除连接「${connection.name}」？`)) return;
      run(async () => {
        store = await api(`/connections/${connection.id}`, 'DELETE');
        if (selectedId === connection.id) select();
        render();
        return '已删除。';
      });
    }));
    entry.append(detail, actions);
    list.append(entry);
  }
}

function input() {
  const { password, clearPassword, allowedTables, ...values } = Object.fromEntries(new FormData(form));
  return {
    ...values,
    allowedTables: allowedTables.split(/[,，]/).map((name) => name.trim()).filter(Boolean),
    password: clearPassword ? '' : (password || undefined),
  };
}

document.querySelector('#new').addEventListener('click', () => {
  select();
  fields.name.focus();
});
fields.type.addEventListener('change', () => {
  if (fields.port.value === '' || ['3306', '5432'].includes(fields.port.value)) {
    fields.port.value = fields.type.value === 'mysql' ? 3306 : 5432;
  }
});
document.querySelector('#test').addEventListener('click', () => {
  if (!form.reportValidity()) return;
  const values = { ...input(), id: selectedId };
  run(async () => (await api('/test', 'POST', values)).message);
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = input();
  run(async () => {
    const id = selectedId;
    store = await api(id ? `/connections/${id}` : '/connections', id ? 'PUT' : 'POST', values);
    select(store.connections.find((connection) => connection.id === id) ?? store.connections.at(-1));
    render();
    return '已保存。';
  });
});

function renderTokens(tokens) {
  tokenList.replaceChildren();
  if (!tokens.length) tokenList.textContent = '还没有访问令牌。';
  for (const token of tokens) {
    const entry = document.createElement('article');
    entry.className = 'connection';
    const name = document.createElement('strong');
    name.textContent = token.name;
    const date = document.createElement('p');
    date.className = 'detail';
    date.textContent = new Date(token.createdAt).toLocaleString();
    entry.append(name, date, button('撤销', () => {
      if (!confirm(`撤销令牌「${token.name}」？`)) return;
      run(async () => {
        renderTokens(await api(`/tokens/${token.id}`, 'DELETE'));
        tokenSecret.value = '';
        newToken.hidden = true;
        return '令牌已撤销。';
      });
    }));
    tokenList.append(entry);
  }
}

tokenForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = tokenForm.elements.name.value;
  run(async () => {
    const created = await api('/tokens', 'POST', { name });
    tokenSecret.value = created.secret;
    newToken.hidden = false;
    tokenForm.reset();
    renderTokens(await api('/tokens'));
    return '令牌已创建。';
  });
});

run(async () => {
  const [connections, tokens] = await Promise.all([api('/connections'), api('/tokens')]);
  store = connections;
  render();
  renderTokens(tokens);
  return '';
});
