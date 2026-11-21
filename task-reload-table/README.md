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
3. Under **Reload button → Task ID column**, enter that column's field name or label (for example `KOK TASK ID`). Because the column is found by name, adding or moving columns does not break the buttons. A column number still works for older objects.
   With a number, dimensions are counted first, then measures (e.g. 4 dimensions + 2 measures:
   the second measure is column 6). The column is hidden by default.

Getting task IDs into your data model: load `/qrs/task/full` through the
`monitor_apps_REST_app` connection that ships with the monitoring apps. Each task
has an `id` and a child `app` object with the app ID.

### Options

| Option | Default | |
|---|---|---|
| Task ID column | empty (no buttons) | Field name or column label holding the task ID; a number (1 = first column) also works |
| Hide the task ID column | on | |
| Button column header | empty | |
| Button label | language default | |
| Button column position | right | right / left |
| Ask for confirmation | on | Click twice to start |
| Monitor task status | on | Polls the task every 2 seconds |
| Select on dimension cell click | on | Same as a native table |
| Language of button texts | English | English / Türkçe |

### Presentation

The **Presentation** section works like the styling options of the native table.
Everything starts from the current look, and header and row text follow the app
theme until you switch them to *Custom*.

| Group | Options |
|---|---|
| Object | Border (colour, width), corner radius and shadow around the whole object, title included |
| Header | Theme default or custom: font size, text colour, background colour, bold. Text alignment |
| Rows | Theme default or custom: font size, text colour. Row height (compact / medium / spacious), alternating row colour, hover colour, grid lines (horizontal / both / none) and their colour |
| Columns | Width: auto (fill the object), fit to content, or fixed px per column (e.g. `200,150,120` in visible column order). Text wrapping: on wraps headers and cells onto more lines in narrow columns; off keeps one line and ends with "…" |
| Button | Minimum width. Default or custom colours for hover / confirm, running, finished and failed |

Colour pickers offer the theme palette and a custom colour. Cell colour
expressions always win over the alternating row and hover colours.

**Colours:** every dimension and measure has a *Background colour expression* and
a *Text colour expression* text box (type the expression starting with `=`), e.g.
`=If(Today() - Floor([Last reload]) >= 3, RGB(248,215,218))`.

**Sorting:** click a column header (ascending → descending → original). Empty
values always stay at the bottom. The default order comes from the *Sorting*
section.

**Column width:** drag the right edge of a column header, as in the native table.
In analysis mode the widths last for the session; in edit mode they are saved in
the object (*Columns → Column width* becomes *Fixed*). Set it back to *Auto* to
reset.

**Search:** every dimension header has a search icon, as in the native table. It
lists all values of the field with their selection state (green selected, grey
excluded). Type to filter, click a value to toggle it, press **Enter** to select
all matches, **Esc** or click outside to close. For calculated dimensions it lists
the values in the table.

**Edit mode:** the table does not react to clicks while you edit the sheet (no
selections, sorting, search or reloads), so clicking it selects the object, as
with native objects.

## Security rules

The button calls the QRS API with the logged-in user's session, so the user must
be allowed to start the task. You typically need a rule that gives the users **Read** and **Update** on the reload tasks they may start
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


## License

MIT, see [LICENSE.md](LICENSE.md).
