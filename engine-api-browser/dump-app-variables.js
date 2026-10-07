/*
 * Qlik Cloud – dump every variable in an app with its definition,
 * from the browser console.
 *
 * Usage: open the app in Qlik Cloud, press F12, paste this in the Console tab.
 * Output: <app>-variables.json is downloaded.
 * Read-only. Uses your existing browser session; no API key needed.
 *
 * WARNING: check the output before sharing it. Variables sometimes contain
 * secrets such as API keys.
 */
(async () => {
  const appId = location.pathname.match(/app\/([0-9a-f-]{36})/)[1];
  const r = await fetch('/api/v1/csrf-token', { credentials: 'include' });
  const csrf = r.headers.get('qlik-csrf-token');
  const ws = new WebSocket(`wss://${location.host}/app/${appId}` +
    (csrf ? `?qlik-csrf-token=${csrf}` : ''));

  let id = 0; const pending = {};
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
  };
  const call = (handle, method, params = []) => new Promise(res => {
    const i = ++id; pending[i] = res;
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, handle, method, params }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const doc = (await call(-1, 'OpenDoc', [appId])).result.qReturn.qHandle;
  const so = await call(doc, 'CreateSessionObject', [{
    qInfo: { qType: 'VariableList' },
    qVariableListDef: {
      qType: 'variable', qShowReserved: false, qShowConfig: false,
      qData: { tags: '/tags' }
    }
  }]);
  const lay = await call(so.result.qReturn.qHandle, 'GetLayout');
  const items = lay.result.qLayout.qVariableList.qItems;
  ws.close();

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(items, null, 1)], { type: 'application/json' }));
  a.download = appId + '-variables.json';
  document.body.appendChild(a); a.click();
  console.log('[vars] DONE', items.length, 'variables');
})().catch(e => console.error('[vars] FAILED:', e.message));
