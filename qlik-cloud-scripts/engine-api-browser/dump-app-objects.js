/*
 * Qlik Cloud – dump every object in an app (sheets, charts, master measures,
 * master dimensions) with full properties, from the browser console.
 *
 * Usage: open the app in Qlik Cloud, press F12, paste this in the Console tab.
 * Output: <app>-objects.json is downloaded.
 * Read-only. Uses your existing browser session; no API key needed.
 * Note: variables are NOT included here – use dump-app-variables.js.
 */
(async () => {
  const log = (...a) => console.log('[dump]', ...a);
  const appId = location.pathname.match(/app\/([0-9a-f-]{36})/)[1];
  log('app', appId);

  const r = await fetch('/api/v1/csrf-token', { credentials: 'include' });
  const csrf = r.headers.get('qlik-csrf-token');
  const ws = new WebSocket(`wss://${location.host}/app/${appId}` +
    (csrf ? `?qlik-csrf-token=${csrf}` : ''));

  let id = 0; const pending = {};
  ws.onclose = e => log('socket closed', e.code, e.reason);
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
  };
  const call = (handle, method, params = []) => new Promise((res, rej) => {
    const i = ++id; pending[i] = res;
    setTimeout(() => rej(new Error('timeout on ' + method)), 30000);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, handle, method, params }));
  });
  await new Promise((res, rej) => {
    ws.onopen = res; ws.onerror = () => rej(new Error('socket error'));
  });
  log('socket open');

  const od = await call(-1, 'OpenDoc', [appId]);
  if (od.error) throw new Error('OpenDoc: ' + JSON.stringify(od.error));
  const doc = od.result.qReturn.qHandle;

  const infos = (await call(doc, 'GetAllInfos')).result.qInfos;
  log('objects to read:', infos.length);

  const getter = { measure: 'GetMeasure', dimension: 'GetDimension', variable: 'GetVariableById' };
  const out = [];
  for (const [n, { qId, qType }] of infos.entries()) {
    if (n % 50 === 0) log('progress', n, '/', infos.length);
    const g = await call(doc, getter[qType] || 'GetObject', [qId]);
    const h = g.result && g.result.qReturn && g.result.qReturn.qHandle;
    if (!h) { out.push({ qId, qType, error: g.error }); continue; }
    const p = await call(h, 'GetProperties');
    out.push({ qId, qType, props: p.result && p.result.qProp });
  }
  ws.close();

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  a.download = appId + '-objects.json';
  document.body.appendChild(a); a.click();
  log('DONE', out.length, 'objects');
})().catch(e => console.error('[dump] FAILED:', e.message));
