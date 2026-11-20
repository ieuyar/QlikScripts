# Task Reload Table

A Qlik Sense extension for **Qlik Sense Enterprise on Windows (client-managed)**:
a table with a **Reload** button on every row. The button starts the QMC reload
task whose ID is in that row and shows its progress until it finishes.

Useful for an admin or "report status" sheet: list your apps (or the QVDs they
read), show when each was last reloaded, and let users refresh the one they need
without opening the QMC.

| Row state | Button |
|---|---|
| Task ID present | **Reload** |
| First click | **Are you sure?** (click again within 4 seconds) |
| Running | Queued → Running (yellow, spinning icon) |
| Finished | **Finished 10:33** (green) |
| Failed / aborted | **Failed 10:33** (red) |
| No valid task ID | **No task** (disabled) |

## Install

1. Download [`dist/TaskReloadTable.zip`](dist/TaskReloadTable.zip).
2. QMC → **Extensions** → **Import** → select the zip.
3. In a sheet, open **Custom objects** and add **Task Reload Table**.

## Set up

1. Add your **dimensions** and **measures** as in a normal table.
2. Add a column that returns the **reload task ID** for the row. A measure such
   as `=Only([TASK ID])` works best: if a row has more than one task, `Only()`
   returns nothing and the row shows **No task** instead of starting the wrong one.
3. Under **Reload button → Task ID column**, enter that column's number.
   Dimensions are counted first, then measures (e.g. 4 dimensions + 2 measures:
   the second measure is column 6). The column is hidden by default.

Getting task IDs into your data model: load `/qrs/task/full` through the
`monitor_apps_REST_app` connection that ships with the monitoring apps. Each task
has an `id` and a child `app` object with the app ID.

### Options

| Option | Default | |
|---|---|---|
| Task ID column | 0 (no buttons) | Column number holding the task ID |
| Hide the task ID column | on | |
| Button column header | empty | |
| Button label | language default | |
| Button column position | right | right / left |
| Ask for confirmation | on | Click twice to start |
| Monitor task status | on | Polls the task every 2 seconds |
| Select on dimension cell click | on | Same as a native table |
| Language of button texts | English | English / Türkçe |

**Colours:** every dimension and measure has a *Background colour expression* and
a *Text colour expression*, like the native table, e.g.
`=If(Today() - Floor([Last reload]) >= 3, RGB(248,215,218))`.

**Sorting:** click a column header (ascending → descending → original). The
default order comes from the *Sorting* section.

## Security rules

The button calls the QRS API with the logged-in user's session, so the user must
be allowed to start the task. As with
[AppTaskReload](https://github.com/miguki/AppTaskReload), you typically need a rule
that gives the users **Read** and **Update** on the reload tasks they may start
(resource filter `ReloadTask_*`), and **Read** on `ExecutionResult_*` /
`ExecutionSession_*` to monitor them. Test with a non-admin user before rolling out. Users with
only an Analyzer license cannot start tasks. A **No access** label on the button
means the rule is missing for that user or task.

## Limits

- The table's own data only changes when the app it sits in is reloaded. A
  finished task turns the button green, but reload times shown in the table stay
  the same until this app reloads.
- Client-managed only. Qlik Cloud has no QMC tasks; there, use a native button
  with an *Execute automation* action instead.
- Up to 15 dimensions, 10 measures and 5,000 rows.

## Credits

The task start and monitoring approach is based on
[AppTaskReload](https://github.com/miguki/AppTaskReload) by Jan Skibniewski (MIT).

## License

MIT, see [LICENSE.md](LICENSE.md).
