/*
Task Reload Table
A table with a button on every row that starts the QMC reload task whose id is in that row.
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
            search: 'Search',
            clearSelection: 'Clear selection',
            noMatch: 'No match',
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
            search: 'Ara',
            clearSelection: 'Seçimi temizle',
            noMatch: 'Eşleşme yok',
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
    var LIST_FETCH = 5000;                    // values loaded into the search list
    var LIST_SHOW = 200;                      // values shown in the search list

    // State that survives repaints
    var taskState = {};   // taskId -> { stage, text }
    var sortState = {};   // objectId -> { column, ascending }
    var searchState = {}; // objectId -> { dim, text } (open search box)
    var listModels = {};  // objectId -> { field, model, values }

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

    // ---------- Search (like the native table header search) ----------

    function isEditMode(ext) {
        if (ext.options && ext.options.interactionState === 2) {
            return true;
        }
        return !!(qlik.navigation && qlik.navigation.getMode && qlik.navigation.getMode() === 'edit');
    }

    function closeSearch(objectId, app) {
        delete searchState[objectId];
        $(document).off('mousedown.trt' + objectId);
        $('.trt-pop[data-obj="' + objectId + '"]').remove();
        var lm = listModels[objectId];
        if (lm) {
            delete listModels[objectId];
            if (app && lm.model && lm.model.id) {
                app.destroySessionObject(lm.model.id);
            }
        }
    }

    function stateClass(state) {
        return { S: 'trt-s', L: 'trt-s', A: 'trt-a', X: 'trt-x', XS: 'trt-x', XL: 'trt-x' }[state] || '';
    }

    // Fill the open search list from the current values and search text
    function refreshSearchList(objectId, t) {
        var $pop = $('.trt-pop[data-obj="' + objectId + '"]');
        var st = searchState[objectId];
        if (!$pop.length || !st) {
            return;
        }
        var values = $pop.data('values') || [];
        var needle = (st.text || '').toLocaleLowerCase('tr');
        var matches = values.filter(function (v) {
            return !needle || String(v.qText).toLocaleLowerCase('tr').indexOf(needle) > -1;
        });
        $pop.data('matches', matches);

        var $list = $pop.find('.trt-pop-list').empty();
        if (!matches.length) {
            $list.append($('<li class="trt-pop-empty"></li>').text(t.noMatch));
            return;
        }
        matches.slice(0, LIST_SHOW).forEach(function (v) {
            $list.append($('<li></li>').text(v.qText).addClass(stateClass(v.qState)).attr('data-elem', v.qElemNumber));
        });
        if (matches.length > LIST_SHOW) {
            $list.append($('<li class="trt-pop-empty"></li>').text('+' + (matches.length - LIST_SHOW)));
        }
    }

    function openSearch($element, $wrap, layout, rows, ctx, dim) {
        var objectId = layout.qInfo.qId;
        var t = texts((layout.props || {}).language);
        var info = layout.qHyperCube.qDimensionInfo[dim];
        var field = info && info.qGroupFieldDefs ? info.qGroupFieldDefs[0] : '';
        var calculated = !field || field.charAt(0) === '=';
        var st = searchState[objectId] || { dim: dim, text: '' };
        searchState[objectId] = st;

        $('.trt-pop[data-obj="' + objectId + '"]').remove();
        var $pop = $('<div class="trt-pop"></div>').attr('data-obj', objectId);
        var $input = $('<input type="text" class="lui-input trt-pop-input">').attr('placeholder', t.search).val(st.text);
        var $close = $('<span class="trt-pop-close lui-icon lui-icon--close"></span>');
        var $clear = $('<button type="button" class="trt-pop-clear"></button>').text(t.clearSelection);
        $pop.append($('<div class="trt-pop-head"></div>').append($input, $close))
            .append('<ul class="trt-pop-list"></ul>')
            .append($('<div class="trt-pop-foot"></div>').append($clear));

        // Position under the column header
        var $th = $wrap.find('th[data-pos="' + dim + '"]');
        var left = $th.length ? $th[0].offsetLeft - $wrap.scrollLeft() : 0;
        left = Math.max(0, Math.min(left, $element.width() - 270));
        $pop.css({ left: left + 'px', top: ($th.outerHeight() || 28) + 'px' });
        $element.append($pop);

        function select(elems, toggle) {
            if (!elems.length) {
                return;
            }
            if (calculated) {
                ctx.backendApi.selectValues(dim, elems, toggle);
            } else {
                ctx.app.field(field).select(elems, toggle, true);
            }
        }

        // Values: field list (all values with states) or, for calculated dimensions, the table rows
        if (calculated) {
            var seen = {};
            var values = [];
            rows.forEach(function (row) {
                var c = row[dim];
                if (c && c.qElemNumber >= 0 && !seen[c.qElemNumber]) {
                    seen[c.qElemNumber] = true;
                    values.push({ qText: c.qText, qElemNumber: c.qElemNumber, qState: c.qState });
                }
            });
            $pop.data('values', values);
            refreshSearchList(objectId, t);
        } else {
            var lm = listModels[objectId];
            if (lm && lm.field === field) {
                $pop.data('values', lm.values || []);
                refreshSearchList(objectId, t);
            } else {
                if (lm) {
                    closeSearch(objectId, ctx.app);
                    searchState[objectId] = st;
                    $element.append($pop);
                }
                lm = { field: field, model: null, values: [] };
                listModels[objectId] = lm;
                ctx.app.createList({
                    qDef: {
                        qFieldDefs: [field],
                        qSortCriterias: [{ qSortByState: 1, qSortByNumeric: 1, qSortByAscii: 1 }]
                    },
                    qShowAlternatives: true,
                    qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 1, qHeight: LIST_FETCH }]
                }, function (reply) {
                    var page = reply.qListObject.qDataPages[0];
                    lm.values = page ? page.qMatrix.map(function (r) { return r[0]; }) : [];
                    $('.trt-pop[data-obj="' + objectId + '"]').data('values', lm.values);
                    refreshSearchList(objectId, t);
                }).then(function (model) {
                    lm.model = model;
                });
            }
        }

        $input.on('input', function () {
            st.text = $(this).val();
            refreshSearchList(objectId, t);
        }).on('keydown', function (e) {
            if (e.key === 'Escape') {
                closeSearch(objectId, ctx.app);
            } else if (e.key === 'Enter') {
                var matches = $pop.data('matches') || [];
                select(matches.map(function (v) { return v.qElemNumber; }), false);
            }
        });

        $pop.on('click', 'li[data-elem]', function () {
            select([parseInt($(this).attr('data-elem'), 10)], true);
        });
        $close.on('click', function () {
            closeSearch(objectId, ctx.app);
        });
        $clear.on('click', function () {
            if (calculated) {
                ctx.backendApi.clearSelections();
            } else {
                ctx.app.field(field).clear();
            }
        });

        // Click outside closes the box
        $(document).off('mousedown.trt' + objectId).on('mousedown.trt' + objectId, function (e) {
            if (!$(e.target).closest('.trt-pop[data-obj="' + objectId + '"], .trt-search').length) {
                closeSearch(objectId, ctx.app);
            }
        });

        var input = $input[0];
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
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

    function render($element, layout, rows, ctx) {
        var hc = layout.qHyperCube;
        var p = layout.props || {};
        var t = texts(p.language);
        var objectId = layout.qInfo.qId;
        var backendApi = ctx.backendApi;

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

        var $wrap = $('<div class="trt-wrap"></div>').toggleClass('trt-edit', ctx.editMode);

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
            var $th = $('<th></th>').append($('<span></span>').text(c.title)).attr('data-pos', c.pos);
            if (c.type === 'dim' && !ctx.editMode) {
                $th.append($('<span class="trt-search lui-icon lui-icon--search"></span>')
                    .attr('data-dim', c.index).attr('title', t.search));
            }
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

        $element.css('position', 'relative').empty().append($wrap);

        // Edit mode: no interaction, so clicking the object selects it for editing (as in native objects)
        if (ctx.editMode) {
            closeSearch(objectId, ctx.app);
            return;
        }

        // Header search icon: open the search box
        $wrap.on('click', '.trt-search', function (e) {
            e.stopPropagation();
            var dim = parseInt($(this).attr('data-dim'), 10);
            var pos = parseInt($(this).closest('th').attr('data-pos'), 10);
            if (searchState[objectId] && searchState[objectId].dim === pos) {
                closeSearch(objectId, ctx.app);
                return;
            }
            searchState[objectId] = { dim: pos, text: '' };
            openSearch($element, $wrap, layout, rows, ctx, dim);
        });

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
            render($element, layout, rows, ctx);
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

        // Keep an open search box open after a repaint (e.g. after a selection)
        if (searchState[objectId]) {
            openSearch($element, $wrap, layout, rows, ctx, searchState[objectId].dim);
        }
    }

    // ---------- Property repair ----------

    // Make sure every dimension / measure has two attribute expressions
    // (background, text) stored as plain strings. Objects created with an
    // older version may hold an object instead of a string, which the engine
    // drops, so typed colour expressions disappeared.
    var repaired = {};

    function normaliseAttributes(items) {
        var changed = false;
        (items || []).forEach(function (item) {
            var attrs = item.qAttributeExpressions;
            if (!Array.isArray(attrs)) {
                var list = [];
                if (attrs && typeof attrs === 'object') {
                    Object.keys(attrs).forEach(function (k) {
                        list[parseInt(k, 10)] = attrs[k];
                    });
                }
                attrs = list;
                changed = true;
            }
            for (var i = 0; i < 2; i++) {
                var a = attrs[i];
                if (!a || typeof a !== 'object') {
                    attrs[i] = { qExpression: '' };
                    changed = true;
                } else if (a.qExpression && typeof a.qExpression === 'object') {
                    var expr = a.qExpression.qStringExpression ? a.qExpression.qStringExpression.qExpr : (a.qExpression.qExpr || '');
                    attrs[i] = { qExpression: expr || '' };
                    changed = true;
                } else if (typeof a.qExpression !== 'string') {
                    a.qExpression = '';
                    changed = true;
                }
            }
            item.qAttributeExpressions = attrs;
        });
        return changed;
    }

    function repairProperties(backendApi, objectId) {
        if (repaired[objectId] || !backendApi.getProperties) {
            return;
        }
        repaired[objectId] = true;
        backendApi.getProperties().then(function (props) {
            var hcd = props.qHyperCubeDef || {};
            var changedDims = normaliseAttributes(hcd.qDimensions);
            var changedMeasures = normaliseAttributes(hcd.qMeasures);
            if (changedDims || changedMeasures) {
                backendApi.setProperties(props);
            }
        });
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
            var ctx = {
                backendApi: this.backendApi,
                app: qlik.currApp(this),
                editMode: isEditMode(this)
            };
            if (ctx.editMode) {
                repairProperties(ctx.backendApi, layout.qInfo.qId);
            }
            var work = fetchRows(ctx.backendApi, layout.qHyperCube).then(function (rows) {
                render($element, layout, rows, ctx);
            });
            return qlik.Promise.resolve(work);
        },
        beforeDestroy: function () {
            var objectId = this.$scope && this.$scope.layout ? this.$scope.layout.qInfo.qId : null;
            if (objectId) {
                closeSearch(objectId, qlik.currApp(this));
            }
        }
    };
});
