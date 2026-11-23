const form = document.querySelector('#connection-form');
const connectionDialog = document.querySelector('#connection-dialog');
const tokenDialog = document.querySelector('#token-dialog');
const tokenForm = document.querySelector('#token-form');
const tokenList = document.querySelector('#tokens');
const newToken = document.querySelector('#new-token');
const tokenSecret = document.querySelector('#token-secret');
const tokenAgentGuide = document.querySelector('#token-agent-guide');
const fields = form.elements;
const list = document.querySelector('#connections');
const pageStatus = document.querySelector('#status');
const token = document.querySelector('meta[name="management-token"]').content;
let store = { connections: [], activeId: null };
let selectedId = null;
let busy = false;
const tokenConnections = document.querySelector('#token-connections');

async function api(path, method = 'GET', input) {
  const headers = { 'X-Management-Token': token };
  if (input) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api${path}`, { method, headers, body: input && JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

async function run(action) {
  if (busy) return;
  busy = true;
  const dialog = document.querySelector('dialog[open]');
  const status = dialog?.querySelector('[role="status"]') ?? pageStatus;
  const controls = [...document.querySelectorAll('button, input, select')];
  const enabled = controls.filter((control) => !control.disabled);
  enabled.forEach((control) => { control.disabled = true; });
  status.className = '';
  status.textContent = '处理中…';
  try {
    const message = await action();
    status.textContent = message;
    if (dialog && !dialog.open) pageStatus.textContent = message;
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  } finally {
    busy = false;
    enabled.forEach((control) => { control.disabled = false; });
  }
}

function select(connection) {
  selectedId = connection?.id ?? null;
  form.reset();
  document.querySelector('#advanced-settings').open = false;
  document.querySelector('#form-title').textContent = connection ? '编辑连接' : '新增连接';
  document.querySelector('#clear-label').hidden = !connection?.hasPassword;
  document.querySelector('#password-hint').textContent = connection?.hasPassword ? '留空保留现有密码。' : '';
  fields.password.disabled = false;
  if (!connection) return;
  for (const name of ['name', 'type', 'host', 'port', 'database', 'user', 'maxRows', 'maxResultBytes', 'poolSize', 'timeout']) {
    fields[name].value = connection[name];
  }
  fields.allowedTables.value = connection.allowedTables.join(', ');
}

function openDialog(dialog) {
  dialog.querySelector('[role="status"]').textContent = '';
  dialog.showModal();
}

for (const dialog of [connectionDialog, tokenDialog]) {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
}

form.addEventListener('invalid', (event) => {
  const details = event.target.closest('details');
  if (details) details.open = true;
}, true);

function button(label, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.className = className;
  element.addEventListener('click', action);
  return element;
}

function render() {
  renderConnectionChoices(tokenConnections, selectedConnectionIds(tokenConnections));
  list.replaceChildren();
  list.classList.toggle('empty', !store.connections.length);
  if (!store.connections.length) list.textContent = '还没有保存的连接。';
  for (const connection of store.connections) {
    const entry = document.createElement('article');
    entry.className = 'connection';
    const name = document.createElement('strong');
    name.textContent = connection.name;
    entry.append(name);
    const detail = document.createElement('p');
    detail.className = 'detail';
    detail.textContent = `${connection.type === 'mysql' ? 'MySQL' : 'PostgreSQL'} · ${connection.database}`;
    const host = document.createElement('p');
    host.className = 'detail host';
    host.textContent = `${connection.user}@${connection.host}:${connection.port}`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(button('编辑', () => {
      select(connection);
      openDialog(connectionDialog);
    }));
    actions.append(button('删除', () => {
      if (!confirm(`删除连接「${connection.name}」？`)) return;
      run(async () => {
        store = await api(`/connections/${connection.id}`, 'DELETE');
        if (selectedId === connection.id) select();
        render();
        renderTokens(await api('/tokens'));
        return '已删除。';
      });
    }, 'danger'));
    entry.append(detail, host, actions);
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
  openDialog(connectionDialog);
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
    connectionDialog.close();
    render();
    renderTokens(await api('/tokens'));
    return '已保存。';
  });
});

function selectedConnectionIds(container) {
  return [...container.querySelectorAll('input:checked')].map(({ value }) => value);
}

function renderConnectionChoices(container, selectedIds) {
  const legend = container.querySelector('legend');
  container.replaceChildren(legend);
  if (!store.connections.length) container.append('请先添加数据库连接。');
  for (const { id, name, database } of store.connections) {
    const label = document.createElement('label');
    label.className = 'checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = id;
    checkbox.checked = selectedIds.includes(id);
    checkbox.defaultChecked = checkbox.checked;
    label.append(checkbox, ` ${name} (${database})`);
    container.append(label);
  }
}

function renderTokens(tokens) {
  tokenList.replaceChildren();
  tokenList.classList.toggle('empty', !tokens.length);
  if (!tokens.length) tokenList.textContent = '还没有访问令牌。';
  for (const token of tokens) {
    const entry = document.createElement('article');
    entry.className = 'connection';
    const name = document.createElement('strong');
    name.textContent = token.name;
    const date = document.createElement('p');
    date.className = 'detail';
    date.textContent = new Date(token.createdAt).toLocaleString();
    const grants = document.createElement('div');
    grants.className = 'grants';
    const authorized = store.connections.filter(({ id }) => token.connectionIds.includes(id));
    for (const label of authorized.length ? authorized.map(({ name }) => name) : ['未授权连接']) {
      const badge = document.createElement('span');
      badge.className = authorized.length ? 'grant' : 'grant unassigned';
      badge.textContent = label;
      grants.append(badge);
    }
    const choices = document.createElement('fieldset');
    choices.className = 'connection-choices';
    choices.hidden = true;
    choices.id = `permissions-${token.id}`;
    const legend = document.createElement('legend');
    legend.textContent = '允许访问的数据库连接';
    choices.append(legend);
    renderConnectionChoices(choices, token.connectionIds);
    const save = button('保存权限', () => {
      const connectionIds = selectedConnectionIds(choices);
      run(async () => {
        renderTokens(await api(`/tokens/${token.id}`, 'PUT', { connectionIds }));
        return '数据库权限已保存。';
      });
    }, 'primary');
    save.disabled = true;
    save.hidden = true;
    const edit = button('编辑权限', () => {
      choices.hidden = !choices.hidden;
      save.hidden = choices.hidden;
      edit.textContent = choices.hidden ? '编辑权限' : '取消编辑';
      edit.setAttribute('aria-expanded', String(!choices.hidden));
      if (choices.hidden) {
        renderConnectionChoices(choices, token.connectionIds);
        save.disabled = true;
      }
    });
    edit.setAttribute('aria-expanded', 'false');
    edit.setAttribute('aria-controls', choices.id);
    choices.addEventListener('change', () => {
      const selected = selectedConnectionIds(choices);
      save.disabled = selected.length === authorized.length && selected.every((id) => token.connectionIds.includes(id));
    });
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(edit, save, button('撤销', () => {
      if (!confirm(`撤销令牌「${token.name}」？`)) return;
      run(async () => {
        renderTokens(await api(`/tokens/${token.id}`, 'DELETE'));
        return '令牌已撤销。';
      });
    }, 'danger'));
    entry.append(name, date, grants, choices, actions);
    tokenList.append(entry);
  }
}

const createTokenButton = document.querySelector('button[form="token-form"]');
const closeTokenButton = tokenDialog.querySelector('[data-close]');
for (const copyButton of newToken.querySelectorAll('[data-copy]')) {
  copyButton.addEventListener('click', async () => {
    const field = document.getElementById(copyButton.dataset.copy);
    const status = tokenDialog.querySelector('[role="status"]');
    try {
      await navigator.clipboard.writeText(field.value);
      status.className = '';
      status.textContent = `${copyButton.getAttribute('aria-label')}成功。`;
    } catch {
      field.select();
      status.className = 'error';
      status.textContent = '无法自动复制，已选中文本，可手动复制。';
    }
  });
}
document.querySelector('#create-token').addEventListener('click', () => {
  tokenForm.reset();
  renderConnectionChoices(tokenConnections, []);
  tokenForm.hidden = false;
  createTokenButton.hidden = false;
  closeTokenButton.textContent = '取消';
  openDialog(tokenDialog);
});
tokenDialog.addEventListener('close', () => {
  tokenSecret.value = '';
  tokenAgentGuide.value = '';
  newToken.hidden = true;
});

tokenForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = tokenForm.elements.name.value;
  const connectionIds = selectedConnectionIds(tokenConnections);
  run(async () => {
    const created = await api('/tokens', 'POST', { name, connectionIds });
    tokenSecret.value = created.secret;
    const mcpUrl = new URL('/mcp', window.location.origin);
    tokenAgentGuide.value = `请添加名为 libra-db-mcp 的远程 MCP 服务，使用 Streamable HTTP 连接 ${mcpUrl}，设置请求头 Authorization: Bearer ${created.secret}，并调用 db_list_connections 查看已授权的连接。`;
    newToken.hidden = false;
    tokenForm.hidden = true;
    createTokenButton.hidden = true;
    closeTokenButton.textContent = '完成';
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
