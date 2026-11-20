# Qlik Scripts

Small, practical scripts and extensions for Qlik Sense developers, both Qlik Cloud
and client-managed.

| | Platform | What it is |
|---|---|---|
| [Engine API from the browser console](#engine-api-from-the-browser-console) | Qlik Cloud | Dump every object, expression and variable of an app to JSON |
| [Task Reload Table](task-reload-table/) | Client-managed (QSEoW) | Extension: a table with a reload button on every row that starts that row's QMC task |

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

## Task Reload Table

A Qlik Sense extension for client-managed sites: a table where every row has a
**Reload** button that starts the QMC reload task in that row and shows its
progress. Per-column colour expressions, sorting and selections work as in a
native table. Download the zip from
[`task-reload-table/dist`](task-reload-table/dist/TaskReloadTable.zip) and import
it in the QMC. Setup, options and the security rules it needs are in the
[extension README](task-reload-table/README.md).

## License

MIT
