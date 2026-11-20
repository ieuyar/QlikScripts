/*
Task Reload Table
A table with a button on every row that starts the QMC reload task whose id is in that row.
The task start / execution monitoring approach is based on AppTaskReload
by Jan Skibniewski (https://github.com/miguki/AppTaskReload, MIT).
*/

define([
    "qlik",
    "jquery",
    "./properties",
    "./qrs",
    "css!./style.css"
], function (qlik, $, properties, qrs) {
    'use strict';

    // ---------- Texts ----------

    var TEXTS = {
        en: {
            button: 'Reload',
            confirm: 'Are you sure?',
            starting: 'Starting',
            started: 'Started',
            done: 'Finished',
            noTask: 'No task',
            noAccess: 'No access',
            notFound: 'Task not found',
            couldNotStart: 'Could not start',
            timedOut: 'Monitoring timed out',
            invalidColumn: 'Invalid task ID column number: ',
            status: {
                0: 'Never started', 1: 'Triggered', 2: 'Running', 3: 'Queued',
                4: 'Aborting', 5: 'Aborting', 6: 'Aborted', 7: 'Finished',
                8: 'Failed', 9: 'Skipped', 10: 'Retrying', 11: 'Error', 12: 'Reset'
            }
        },
        tr: {
            button: 'Güncelle',
            confirm: 'Emin misiniz?',
            starting: 'Başlatılıyor',
            started: 'Başlatıldı',
            done: 'Tamamlandı',
            noTask: 'Task yok',
            noAccess: 'Yetki yok',
            notFound: 'Task bulunamadı',
            couldNotStart: 'Başlatılamadı',
            timedOut: 'İzleme süresi doldu',
            invalidColumn: 'Geçersiz task ID kolon numarası: ',
            status: {
                0: 'Başlamadı', 1: 'Tetiklendi', 2: 'Çalışıyor', 3: 'Kuyrukta',
                4: 'İptal ediliyor', 5: 'İptal ediliyor', 6: 'İptal edildi', 7: 'Tamamlandı',
                8: 'Hata', 9: 'Atlandı', 10: 'Tekrar deneniyor', 11: 'Hata', 12: 'Sıfırlandı'
            }
        }
    };

    // QRS executionresult.status codes that end a run
    var FINISHED_OK = [7];
    var FINISHED_FAILED = [6, 8, 9, 11, 12];

    var GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var CELLS_PER_PAGE = 10000;               // max cells per getData request
    var MAX_ROWS = 5000;                      // safety limit
    var POLL_INTERVAL = 2000;
    var MONITOR_TIMEOUT = 2 * 60 * 60 * 1000; // stop monitoring after 2 hours
    var CONFIRM_TIMEOUT = 4000;

    // State that survives repaints
    var taskState = {};   // taskId -> { stage, text }
    var sortState = {};   // objectId -> { column, ascending }

    function texts(lang) {
        return TEXTS[lang] || TEXTS.en;
    }

    function clock() {
        var d = new Date();
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    // ---------- Button state ----------

    function paintButton($btn, state) {
        var stage = state ? state.stage : 'ready';
        $btn.removeClass('trt-ready trt-confirm trt-running trt-done trt-failed').addClass('trt-' + stage);
        $btn.find('.trt-label').text(state ? state.text : $btn.attr('data-label'));
        $btn.find('.trt-icon').toggleClass('trt-spin', stage === 'running');
    }

    // The same task can appear in several rows or objects: update all of them
    function refreshButtons(taskId) {
        var state = taskState[taskId];
        $('.trt-btn[data-task="' + taskId + '"]').each(function () {
            paintButton($(this), state);
        });
    }

    function setState(taskId, stage, text) {
        if (stage === null) {
            delete taskState[taskId];
        } else {
            taskState[taskId] = { stage: stage, text: text };
        }
        refreshButtons(taskId);
    }

    function errorText(error, t) {
        if (error && error.status === 403) {
            return t.noAccess;
        }
        if (error && error.status === 404) {
            return t.notFound;
        }
        return t.couldNotStart;
    }

    // ---------- Start and monitor ----------

    function monitor(taskId, executionId, t) {
        var startedAt = Date.now();
        var timer = setInterval(function () {
            if (Date.now() - startedAt > MONITOR_TIMEOUT) {
                clearInterval(timer);
                setState(taskId, 'failed', t.timedOut);
                return;
            }
            qrs.getStatus(executionId).then(function (status) {
                if (status === null || isNaN(status)) {
                    return; // no result yet
                }
                if (FINISHED_OK.indexOf(status) > -1) {
                    clearInterval(timer);
                    setState(taskId, 'done', t.done + ' ' + clock());
                } else if (FINISHED_FAILED.indexOf(status) > -1) {
                    clearInterval(timer);
                    setState(taskId, 'failed', t.status[status] + ' ' + clock());
                } else {
                    setState(taskId, 'running', t.status[status] || t.status[2]);
                }
            }, function () {
                // temporary error: try again on the next poll
            });
        }, POLL_INTERVAL);
    }

    function startTask(taskId, watch, t) {
        setState(taskId, 'running', t.starting);
        qrs.startTask(taskId).then(function (executionId) {
            if (!watch || !executionId) {
                setState(taskId, 'done', t.started + ' ' + clock());
                return;
            }
            setState(taskId, 'running', t.status[3]);
            monitor(taskId, executionId, t);
        }, function (error) {
            setState(taskId, 'failed', errorText(error, t));
        });
    }

    // ---------- Data ----------

    // Fetch all hypercube rows page by page
    function fetchRows(backendApi, hc) {
        var width = hc.qSize.qcx;
        var total = Math.min(hc.qSize.qcy, MAX_ROWS);
        var pageHeight = Math.max(1, Math.floor(CELLS_PER_PAGE / Math.max(width, 1)));
        var rows = [];

        (hc.qDataPages || []).forEach(function (page) {
            rows = rows.concat(page.qMatrix);
        });

        function next() {
            if (rows.length >= total || width === 0) {
                return Promise.resolve(rows.slice(0, total));
            }
            return backendApi.getData([{
                qTop: rows.length,
                qLeft: 0,
                qWidth: width,
                qHeight: Math.min(pageHeight, total - rows.length)
            }]).then(function (pages) {
                var more = pages && pages[0] ? pages[0].qMatrix : [];
                if (!more.length) {
                    return rows;
                }
                rows = rows.concat(more);
                return next();
            });
        }

        return next();
    }

    // Qlik colour value (result of RGB() / ARGB()) to CSS
    function toCss(value) {
        if (!value) {
            return null;
        }
        var n = value.qNum;
        if (typeof n === 'number' && !isNaN(n)) {
            n = n >>> 0;
            var a = (n >>> 24) & 255;
            var r = (n >>> 16) & 255;
            var g = (n >>> 8) & 255;
            var b = n & 255;
            return 'rgba(' + r + ',' + g + ',' + b + ',' + (a / 255).toFixed(3) + ')';
        }
        if (value.qText && /^(rgb|#)/i.test(value.qText)) {
            return value.qText;
        }
        return null;
    }

    function cellColours(cell) {
        var values = cell && cell.qAttrExps && cell.qAttrExps.qValues ? cell.qAttrExps.qValues : [];
        return {
            background: toCss(values[0]),
            text: toCss(values[1])
        };
    }

    function cellText(cell) {
        if (!cell || cell.qIsNull || cell.qText === undefined || cell.qText === null) {
            return '-';
        }
        return cell.qText;
    }

    function compare(a, b) {
        var aNum = typeof a.qNum === 'number' && !isNaN(a.qNum);
        var bNum = typeof b.qNum === 'number' && !isNaN(b.qNum);
        if (aNum && bNum) {
            return a.qNum - b.qNum;
        }
        if (aNum) {
            return -1;
        }
        if (bNum) {
            return 1;
        }
        return String(a.qText || '').localeCompare(String(b.qText || ''));
    }

    // ---------- Rendering ----------

    function createButton(taskId, p, t) {
        var $btn = $('<button type="button" class="trt-btn">' +
            '<span class="trt-icon lui-icon lui-icon--sync"></span>' +
            '<span class="trt-label"></span></button>');

        if (!GUID.test(taskId)) {
            $btn.addClass('trt-none').prop('disabled', true).find('.trt-label').text(t.noTask);
            return $btn;
        }

        $btn.attr('data-task', taskId).attr('data-label', p.buttonLabel || t.button);
        paintButton($btn, taskState[taskId]);
        return $btn;
    }

    function render($element, layout, rows, backendApi) {
        var hc = layout.qHyperCube;
        var p = layout.props || {};
        var t = texts(p.language);
        var objectId = layout.qInfo.qId;

        // Columns: dimensions first, then measures (hypercube order)
        var columns = [];
        hc.qDimensionInfo.forEach(function (d, i) {
            columns.push({ type: 'dim', index: i, title: d.qFallbackTitle, pos: columns.length });
        });
        hc.qMeasureInfo.forEach(function (m, i) {
            columns.push({ type: 'measure', index: i, title: m.qFallbackTitle, pos: columns.length });
        });

        var taskColumn = parseInt(p.taskColumn, 10) - 1;
        if (!(taskColumn >= 0 && taskColumn < columns.length)) {
            taskColumn = -1;
        }
        var hasButton = taskColumn > -1;
        var buttonLeft = p.buttonPosition === 'left';

        var visible = columns.filter(function (c) {
            return !(p.hideTaskColumn && c.pos === taskColumn);
        });

        // Client-side sorting (header click)
        var sort = sortState[objectId];
        var sorted = rows;
        if (sort && sort.column < columns.length) {
            sorted = rows.slice().sort(function (a, b) {
                return compare(a[sort.column], b[sort.column]) * (sort.ascending ? 1 : -1);
            });
        }

        var $wrap = $('<div class="trt-wrap"></div>');

        if (!hasButton && parseInt(p.taskColumn, 10) > 0) {
            $wrap.append($('<div class="trt-note"></div>').text(t.invalidColumn + p.taskColumn));
        }

        var $table = $('<table class="trt-table"></table>');
        var $headerRow = $('<tr></tr>');
        var $buttonTh = $('<th class="trt-btn-col"></th>').text(p.buttonHeader || '');

        if (hasButton && buttonLeft) {
            $headerRow.append($buttonTh);
        }
        visible.forEach(function (c) {
            var $th = $('<th></th>').text(c.title).attr('data-pos', c.pos);
            if (c.type === 'measure') {
                $th.addClass('trt-num');
            }
            if (sort && sort.column === c.pos) {
                $th.addClass(sort.ascending ? 'trt-asc' : 'trt-desc');
            }
            $headerRow.append($th);
        });
        if (hasButton && !buttonLeft) {
            $headerRow.append($buttonTh);
        }
        $table.append($('<thead></thead>').append($headerRow));

        var $body = $('<tbody></tbody>');
        sorted.forEach(function (row) {
            var $tr = $('<tr></tr>');
            var $buttonTd = null;

            if (hasButton) {
                var taskId = String(cellText(row[taskColumn])).trim();
                $buttonTd = $('<td class="trt-btn-col"></td>').append(createButton(taskId, p, t));
            }
            if ($buttonTd && buttonLeft) {
                $tr.append($buttonTd);
            }

            visible.forEach(function (c) {
                var cell = row[c.pos];
                var $td = $('<td></td>').text(cellText(cell));
                var colours = cellColours(cell);

                if (c.type === 'measure') {
                    $td.addClass('trt-num');
                }
                if (colours.background) {
                    $td.css('background-color', colours.background);
                }
                if (colours.text) {
                    $td.css('color', colours.text);
                }
                if (c.type === 'dim' && p.selectOnClick !== false && cell && cell.qElemNumber >= 0) {
                    $td.addClass('trt-selectable')
                        .attr('data-dim', c.index)
                        .attr('data-elem', cell.qElemNumber);
                }
                $tr.append($td);
            });

            if ($buttonTd && !buttonLeft) {
                $tr.append($buttonTd);
            }
            $body.append($tr);
        });
        $table.append($body);
        $wrap.append($table);

        // Header click: ascending -> descending -> original order
        $wrap.on('click', 'th[data-pos]', function () {
            var column = parseInt($(this).attr('data-pos'), 10);
            var current = sortState[objectId];
            if (!current || current.column !== column) {
                sortState[objectId] = { column: column, ascending: true };
            } else if (current.ascending) {
                sortState[objectId] = { column: column, ascending: false };
            } else {
                delete sortState[objectId];
            }
            render($element, layout, rows, backendApi);
        });

        // Dimension cell click: select the value
        $wrap.on('click', 'td.trt-selectable', function () {
            var dim = parseInt($(this).attr('data-dim'), 10);
            var elem = parseInt($(this).attr('data-elem'), 10);
            backendApi.selectValues(dim, [elem], true);
        });

        // Button click: confirm, then start
        $wrap.on('click', '.trt-btn', function (e) {
            e.stopPropagation();
            var taskId = $(this).attr('data-task');
            if (!taskId) {
                return;
            }
            var state = taskState[taskId];
            if (state && state.stage === 'running') {
                return;
            }
            if (p.confirm !== false && !(state && state.stage === 'confirm')) {
                setState(taskId, 'confirm', t.confirm);
                setTimeout(function () {
                    if (taskState[taskId] && taskState[taskId].stage === 'confirm') {
                        setState(taskId, null);
                    }
                }, CONFIRM_TIMEOUT);
                return;
            }
            startTask(taskId, p.monitor !== false, t);
        });

        $element.empty().append($wrap);
    }

    // ---------- Extension definition ----------

    return {
        initialProperties: {
            qHyperCubeDef: {
                qDimensions: [],
                qMeasures: [],
                qInitialDataFetch: [{ qWidth: 25, qHeight: 400 }],
                qSuppressZero: false,
                qSuppressMissing: false
            },
            props: {
                taskColumn: 0,
                hideTaskColumn: true,
                buttonHeader: '',
                buttonLabel: '',
                buttonPosition: 'right',
                confirm: true,
                monitor: true,
                selectOnClick: true,
                language: 'en'
            },
            showTitles: true
        },
        definition: properties,
        support: {
            snapshot: false,
            export: true,
            exportData: true
        },
        paint: function ($element, layout) {
            var backendApi = this.backendApi;
            var work = fetchRows(backendApi, layout.qHyperCube).then(function (rows) {
                render($element, layout, rows, backendApi);
            });
            return qlik.Promise.resolve(work);
        }
    };
});
