# Qlik Cloud Scripts

Small, practical scripts for Qlik Cloud developers.

## Engine API from the browser console

On Qlik Sense on-prem, the Engine API Explorer lets you pull every measure,
chart expression and variable out of an app in a few calls. Qlik Cloud has no
built-in equivalent, and in locked-down environments Qixplorer and qlik-cli
are not always available.

These scripts run the same Engine API calls from your browser's developer
console, over the session you are already logged in with.

| Script | What you get |
|---|---|
| [`dump-app-objects.js`](engine-api-browser/dump-app-objects.js) | Every sheet, chart, master measure and master dimension, with full properties and expressions |
| [`dump-app-variables.js`](engine-api-browser/dump-app-variables.js) | Every variable with its definition |

### How to use

1. Open the app in Qlik Cloud (any sheet).
2. Press `F12` and go to the **Console** tab. Chrome may ask you to type
   `allow pasting` first.
3. Paste the script and press Enter.
4. A JSON file is downloaded when it finishes.

`Promise {<pending>}` right after pasting is normal: the script is running.
Progress is printed with a `[dump]` prefix.

### Good to know

- **Read-only.** The scripts only read properties. They use the access you
  already have and need no API key.
- **Variables need their own call.** `GetAllInfos` does not return them, which
  is why there are two scripts.
- **Check the output before sharing it.** Variables sometimes hold things that
  should not be stored in an app, such as API keys.
- **The output is raw JSON.** Master measure expressions are under
  `props.qMeasure.qDef`; chart measures are under
  `props.qHyperCubeDef.qMeasures[]`, either inline (`qDef.qDef`) or as a
  reference to a master measure (`qLibraryId`).
- Follow your organisation's policies before running scripts against a tenant.

## License

MIT
