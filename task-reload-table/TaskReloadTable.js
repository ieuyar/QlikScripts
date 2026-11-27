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
            lastRun: 'Last run: ',
            invalidColumn: 'Task ID column not found: ',
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
            lastRun: 'Son çalışma: ',
            invalidColumn: 'Task ID kolonu bulunamadı: ',
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
    var RUNNING = [1, 2, 3, 4, 5, 10];         // executionresult codes of a run in progress
    var LIVE_MIN_SECONDS = 10;                // shortest QMC status refresh interval
    var LIST_FETCH = 5000;                    // values loaded into the search list
    var LIST_SHOW = 200;                      // values shown in the search list

    // State that survives repaints
    var taskState = {};   // taskId -> { stage, text }
    var sortState = {};   // objectId -> { column, ascending }
    var searchState = {}; // objectId -> { dim, text } (open search box)
    var listModels = {};  // objectId -> { field, model, values }
    var themeCache = {};  // appId -> styles read from the app theme
    var sessionWidths = {}; // objectId -> column widths dragged in analysis mode
    var resizeGuard = {};   // objectId -> time of the last resize (to skip the click that follows)
    var liveState = {};     // taskId -> { running, tip } from QMC (runs started outside this object)

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
        $btn.prop('disabled', stage === 'running');
        var live = liveState[$btn.attr('data-task')];
        $btn.attr('title', live && live.tip ? live.tip : '');
    }

    // The same task can appear in several rows or objects: update all of them
    function refreshButtons(taskId) {
        var state = taskState[taskId];
        $('.trt-btn[data-task="' + taskId + '"]').each(function () {
            paintButton($(this), state);
        });
    }

    function setState(taskId, stage, text, mine) {
        if (stage === null) {
            delete taskState[taskId];
        } else {
            var prev = taskState[taskId];
            taskState[taskId] = { stage: stage, text: text, mine: mine === undefined ? !!(prev && prev.mine && stage === 'running') : mine };
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
                    setState(taskId, 'running', t.status[status] || t.status[2], true);
                }
            }, function () {
                // temporary error: try again on the next poll
            });
        }, POLL_INTERVAL);
    }

    function startTask(taskId, watch, t) {
        setState(taskId, 'running', t.starting, true);
        qrs.startTask(taskId).then(function (executionId) {
            if (!watch || !executionId) {
                setState(taskId, 'done', t.started + ' ' + clock());
                return;
            }
            setState(taskId, 'running', t.status[3], true);
            monitor(taskId, executionId, t);
        }, function (error) {
            setState(taskId, 'failed', errorText(error, t));
        });
    }

    // ---------- Live status from QMC ----------

    // Every few seconds, ask QRS for the last execution of the task IDs on screen,
    // so runs started by a schedule, a trigger or someone in QMC disable the button too.
    // One request for all visible tasks; paused while the browser tab is hidden.
    var liveLastPoll = 0;
    var liveLastIds = '';
    var liveBusy = false;
    var liveTimer = null;

    function hhmm(iso) {
        var d = new Date(iso);
        if (!iso || isNaN(d.getTime()) || d.getFullYear() < 2000) {
            return '';
        }
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    function fullTime(iso) {
        var d = new Date(iso);
        if (!iso || isNaN(d.getTime()) || d.getFullYear() < 2000) {
            return '';
        }
        var p2 = function (n) { return ('0' + n).slice(-2); };
        return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    }

    function liveTick() {
        var $wraps = $('.trt-wrap[data-live="1"]');
        if (!$wraps.length) {
            clearInterval(liveTimer);
            liveTimer = null;
            return;
        }
        if (liveBusy || document.hidden) {
            return;
        }
        var interval = Infinity;
        var lang = 'en';
        var ids = {};
        $wraps.each(function () {
            interval = Math.min(interval, parseInt($(this).attr('data-interval'), 10) || 15);
            lang = $(this).attr('data-lang') || lang;
            $(this).find('.trt-btn[data-task]').each(function () {
                ids[String($(this).attr('data-task')).toLowerCase()] = true;
            });
        });
        var list = Object.keys(ids).sort();
        if (!list.length) {
            return;
        }
        var key = list.join(',');
        // Poll at once when new tasks appear (new selection), otherwise on the interval
        if (key === liveLastIds && Date.now() - liveLastPoll < Math.max(interval, LIVE_MIN_SECONDS) * 1000) {
            return;
        }
        liveLastIds = key;
        liveLastPoll = Date.now();
        liveBusy = true;
        var t = texts(lang);
        qrs.getTaskStatuses(list).then(function (result) {
            liveBusy = false;
            list.forEach(function (taskId) {
                var r = result[taskId];
                if (!r) {
                    return; // not readable for this user: leave the button as it is
                }
                var live = liveState[taskId] || {};
                var running = RUNNING.indexOf(r.status) > -1;
                live.tip = running ? '' : (fullTime(r.stop) ? t.lastRun + fullTime(r.stop) + ' (' + (t.status[r.status] || '') + ')' : '');
                var own = taskState[taskId];
                if (running) {
                    live.running = true;
                    liveState[taskId] = live;
                    setState(taskId, 'running', (t.status[r.status] || t.status[2]) + (hhmm(r.start) ? ' ' + hhmm(r.start) : ''));
                } else if (live.running) {
                    // A run we only saw through QMC has just finished
                    live.running = false;
                    liveState[taskId] = live;
                    if (!(own && own.stage === 'running' && own.mine)) {
                        var ok = FINISHED_OK.indexOf(r.status) > -1;
                        setState(taskId, ok ? 'done' : 'failed', (ok ? t.done : (t.status[r.status] || t.status[8])) + (hhmm(r.stop) ? ' ' + hhmm(r.stop) : ''));
                    }
                } else {
                    liveState[taskId] = live;
                    refreshButtons(taskId);
                }
            });
        }, function () {
            liveBusy = false; // try again on the next interval
        });
    }

    function watchLive() {
        liveLastIds = ''; // poll right after a repaint
        if (!liveTimer) {
            liveTimer = setInterval(liveTick, 2000);
        }
        setTimeout(liveTick, 300);
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
        var style = String(values[2] && values[2].qText ? values[2].qText : '').toLowerCase();
        return {
            background: toCss(values[0]),
            text: toCss(values[1]),
            bold: /<b>|bold/.test(style),
            italic: /<i>|italic/.test(style),
            underline: /<u>|underline/.test(style)
        };
    }

    function cellText(cell) {
        if (!cell || cell.qIsNull || cell.qText === undefined || cell.qText === null) {
            return '-';
        }
        return cell.qText;
    }

    function isNullCell(cell) {
        return !cell || cell.qIsNull || cell.qText === undefined || cell.qText === null ||
            cell.qText === '' || cell.qText === '-';
    }

    // Sort two cells; empty values always go last, in both directions
    function sortCells(a, b, ascending) {
        var aNull = isNullCell(a);
        var bNull = isNullCell(b);
        if (aNull && bNull) {
            return 0;
        }
        if (aNull) {
            return 1;
        }
        if (bNull) {
            return -1;
        }
        return compare(a, b) * (ascending ? 1 : -1);
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

    // ---------- Presentation (styling) ----------

    var PADDING = { compact: '2px 8px', medium: '4px 8px', spacious: '8px 10px' };
    var THEME_TIMEOUT = 2000;

    // Read the styles of the applied app theme once per app
    function loadTheme(app) {
        var key = app && app.id ? app.id : 'app';
        if (themeCache[key]) {
            return Promise.resolve(themeCache[key]);
        }
        if (!app || !app.theme || !app.theme.getApplied) {
            themeCache[key] = {};
            return Promise.resolve(themeCache[key]);
        }
        var themed = Promise.resolve(app.theme.getApplied()).then(function (theme) {
            function style(base, path, attribute) {
                try {
                    return theme.getStyle(base, path, attribute);
                } catch (e) {
                    return undefined;
                }
            }
            return {
                headerColor: style('object.straightTable', 'header', 'color') || style('object', 'label.name', 'color'),
                headerFontSize: style('object.straightTable', 'header', 'fontSize'),
                bodyColor: style('object.straightTable', 'content', 'color') || style('', '', 'color'),
                bodyFontSize: style('object.straightTable', 'content', 'fontSize'),
                fontFamily: style('', '', 'fontFamily')
            };
        }, function () {
            return {};
        });
        var timeout = new Promise(function (resolve) {
            setTimeout(function () { resolve({}); }, THEME_TIMEOUT);
        });
        return Promise.race([themed, timeout]).then(function (styles) {
            themeCache[key] = styles || {};
            return themeCache[key];
        });
    }

    // Colour picker value { index, color } -> CSS colour
    function pickColour(value, fallback) {
        return value && typeof value === 'object' && value.color ? value.color : fallback;
    }

    function pixels(value, fallback) {
        var n = parseFloat(value);
        return isNaN(n) || n <= 0 ? fallback : n + 'px';
    }

    // Light tint of a colour, for button state backgrounds
    function tint(colour, alpha) {
        var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour || '');
        if (m) {
            return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
        }
        return 'color-mix(in srgb, ' + colour + ' ' + Math.round(alpha * 100) + '%, white)';
    }

    function rule(selector, declarations) {
        var body = Object.keys(declarations).filter(function (k) {
            return declarations[k] !== undefined && declarations[k] !== null && declarations[k] !== '';
        }).map(function (k) {
            return k + ':' + declarations[k];
        }).join(';');
        return body ? selector + '{' + body + '}' : '';
    }

    // CSS for one object, scoped to its own class
    function buildCss(scope, p, theme) {
        var css = [];
        var headerCustom = p.headerStyle === 'custom';
        var rowCustom = p.rowStyle === 'custom';
        var grid = p.gridLines || 'horizontal';
        var line = '1px solid ' + pickColour(p.borderColor, '#ECECEC');
        var t = scope + ' .trt-table';

        css.push(rule(t, { 'font-family': theme.fontFamily }));

        css.push(rule(t + ' th', {
            'color': headerCustom ? pickColour(p.headerColor, '#5F6368') : theme.headerColor,
            'background-color': headerCustom ? pickColour(p.headerBackground, '#FFFFFF') : null,
            'font-size': headerCustom ? pixels(p.headerFontSize, '12px') : theme.headerFontSize,
            'font-weight': headerCustom ? (p.headerBold === false ? 'normal' : '600') : null,
            'text-align': p.headerAlign && p.headerAlign !== 'auto' ? p.headerAlign + ' !important' : null,
            'border-right': grid === 'both' ? line : null
        }));

        css.push(rule(t + ' td', {
            'color': rowCustom ? pickColour(p.bodyColor, '#2B2B2B') : theme.bodyColor,
            'font-size': rowCustom ? pixels(p.bodyFontSize, '12px') : theme.bodyFontSize,
            'padding': PADDING[p.rowHeight] || PADDING.medium,
            'border-bottom': grid === 'none' ? 'none' : line,
            'border-right': grid === 'both' ? line : null
        }));

        if (p.wrap === false) {
            css.push(rule(t + ' th,' + t + ' td', {
                'white-space': 'nowrap',
                'overflow': 'hidden',
                'text-overflow': 'ellipsis'
            }));
        }

        if (p.zebra) {
            css.push(rule(t + ' tbody tr:nth-child(even) td', {
                'background-color': pickColour(p.zebraColor, '#F7F7F7')
            }));
        }

        // Hover: cells with a colour expression keep their colour (only darkened slightly)
        css.push(rule(t + ' tbody tr:hover td:not([style*="background-color"])', {
            'background-color': pickColour(p.hoverColor, '#F2F2F2')
        }));

        css.push(rule(scope + ' .trt-btn', { 'min-width': pixels(p.buttonWidth, '110px') }));

        if (p.buttonColours === 'custom') {
            var accent = pickColour(p.colorAccent, '#C8102E');
            var running = pickColour(p.colorRunning, '#FFB81C');
            var done = pickColour(p.colorDone, '#509E2F');
            var failed = pickColour(p.colorFailed, '#C8102E');
            css.push(rule(scope + ' .trt-btn:hover:not(:disabled)', { 'border-color': accent, 'color': accent }));
            css.push(rule(scope + ' .trt-btn.trt-confirm,' + scope + ' .trt-btn.trt-confirm:hover:not(:disabled)', {
                'background': accent, 'border-color': accent, 'color': '#FFFFFF'
            }));
            css.push(rule(scope + ' .trt-btn.trt-running', { 'background': tint(running, 0.25), 'border-color': running }));
            css.push(rule(scope + ' .trt-btn.trt-done', { 'background': tint(done, 0.2), 'border-color': done }));
            css.push(rule(scope + ' .trt-btn.trt-failed', { 'background': tint(failed, 0.12), 'border-color': failed, 'color': failed }));
        }

        return css.filter(Boolean).join('\n');
    }

    function parseWidths(text) {
        var list = String(text || '').split(',').map(function (w) {
            var n = parseInt(w, 10);
            return isNaN(n) || n <= 0 ? null : n;
        });
        return list.some(function (w) { return w !== null; }) ? list : null;
    }

    function buttonColumnWidth(p) {
        return (parseInt(p.buttonWidth, 10) || 110) + 20;
    }

    // Column widths: dragged widths (this session) or saved fixed widths win,
    // otherwise auto or fit to content
    function applyColumnWidths($table, p, visibleCount, hasButton, buttonLeft, widths) {
        $table.find('colgroup').remove();
        if (!widths) {
            if (p.columnWidth === 'fit') {
                $table.css({ 'table-layout': 'auto', 'width': 'auto' });
            }
            return;
        }
        var buttonWidth = buttonColumnWidth(p);
        var $group = $('<colgroup></colgroup>');
        var total = 0;
        if (hasButton && buttonLeft) {
            $group.append($('<col>').css('width', buttonWidth + 'px'));
            total += buttonWidth;
        }
        for (var i = 0; i < visibleCount; i++) {
            var w = widths[i] || 120;
            $group.append($('<col class="trt-col-data">').css('width', w + 'px'));
            total += w;
        }
        if (hasButton && !buttonLeft) {
            $group.append($('<col>').css('width', buttonWidth + 'px'));
            total += buttonWidth;
        }
        $table.prepend($group).css({ 'table-layout': 'fixed', 'width': total + 'px' });
    }

    // In edit mode, dragged widths are saved in the object (as fixed widths)
    function saveWidths(backendApi, widths) {
        backendApi.getProperties().then(function (props) {
            props.props = props.props || {};
            props.props.columnWidth = 'fixed';
            props.props.columnWidths = widths.join(',');
            return backendApi.setProperties(props);
        });
    }

    // Border and shadow around the whole object (title included), like native objects
    function applyObjectStyle($element, p) {
        var $object = $element.closest('.qv-object');
        if (!$object.length) {
            $object = $element;
        }
        var width = parseInt(p.objectBorderWidth, 10);
        var radius = parseInt(p.objectRadius, 10);
        var styled = p.objectBorder || p.objectShadow;
        $object.css({
            'border': p.objectBorder ? (isNaN(width) || width < 1 ? 1 : width) + 'px solid ' + pickColour(p.objectBorderColor, '#BFBFBF') : '',
            'border-radius': styled ? (isNaN(radius) || radius < 0 ? 4 : radius) + 'px' : '',
            'box-shadow': p.objectShadow ? '0 1px 4px rgba(0, 0, 0, 0.18)' : ''
        });
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

    // Task ID column by field name / column label (robust when columns are added or moved).
    // A plain number is still accepted for older objects (1 = first column).
    // Tolerates "=", "Only(...)" and [brackets]: "=Only([KOK TASK ID])" -> KOK TASK ID
    function cleanName(value) {
        var s = String(value).trim().replace(/^=\s*/, '');
        var m = /^only\s*\(\s*(.*?)\s*\)$/i.exec(s);
        if (m) {
            s = m[1];
        }
        return s.replace(/^\[(.*)\]$/, '$1').trim().toLowerCase();
    }

    function findTaskColumn(setting, columns, hc) {
        if (setting === undefined || setting === null) {
            return -1;
        }
        var raw = String(setting).trim();
        if (raw === '' || raw === '0') {
            return -1;
        }
        if (/^\d+$/.test(raw)) {
            var n = parseInt(raw, 10) - 1;
            return n >= 0 && n < columns.length ? n : -1;
        }
        var name = cleanName(raw);
        var found = -1;
        columns.forEach(function (c) {
            if (found > -1) {
                return;
            }
            var candidates = [c.title];
            if (c.type === 'dim') {
                var info = hc.qDimensionInfo[c.index] || {};
                (info.qGroupFieldDefs || []).forEach(function (f) {
                    candidates.push(f);
                });
            }
            for (var i = 0; i < candidates.length; i++) {
                if (candidates[i] !== undefined && cleanName(candidates[i]) === name) {
                    found = c.pos;
                    return;
                }
            }
        });
        return found;
    }

    function render($element, layout, rows, ctx, theme) {
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

        var taskColumn = findTaskColumn(p.taskColumn, columns, hc);
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
                return sortCells(a[sort.column], b[sort.column], sort.ascending);
            });
        }

        var scopeClass = 'trt-o-' + String(objectId).replace(/[^a-zA-Z0-9_-]/g, '');
        var $wrap = $('<div class="trt-wrap"></div>').addClass(scopeClass).toggleClass('trt-edit', ctx.editMode);
        if (hasButton && p.liveStatus !== false && !ctx.editMode) {
            $wrap.attr({
                'data-live': '1',
                'data-interval': Math.max(parseInt(p.liveInterval, 10) || 15, LIVE_MIN_SECONDS),
                'data-lang': p.language || 'en'
            });
        }
        $wrap.append($('<style></style>').text(buildCss('.' + scopeClass, p, theme || {})));

        if (!hasButton && String(p.taskColumn == null ? '' : p.taskColumn).trim() !== '' && String(p.taskColumn).trim() !== '0') {
            $wrap.append($('<div class="trt-note"></div>').text(t.invalidColumn + p.taskColumn));
        }

        var $table = $('<table class="trt-table"></table>');
        var $headerRow = $('<tr></tr>');
        var $buttonTh = $('<th class="trt-btn-col"></th>').text(p.buttonHeader || '');

        if (hasButton && buttonLeft) {
            $headerRow.append($buttonTh);
        }
        visible.forEach(function (c) {
            var $th = $('<th></th>').append($('<span></span>').text(c.title)).attr('data-pos', c.pos)
                .append('<span class="trt-resize"></span>');
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
                if (p.wrap === false) {
                    $td.attr('title', cellText(cell));
                }
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
                if (colours.bold) {
                    $td.css('font-weight', 'bold');
                }
                if (colours.italic) {
                    $td.css('font-style', 'italic');
                }
                if (colours.underline) {
                    $td.css('text-decoration', 'underline');
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
        var widths = sessionWidths[objectId] || (p.columnWidth === 'fixed' ? parseWidths(p.columnWidths) : null);
        applyColumnWidths($table, p, visible.length, hasButton, buttonLeft, widths);
        $wrap.append($table);

        $element.css('position', 'relative').empty().append($wrap);
        applyObjectStyle($element, p);
        if ($wrap.attr('data-live') === '1') {
            watchLive();
        }

        // Column resize: drag the right edge of a header (also in edit mode, where it is saved)
        $wrap.on('mousedown', '.trt-resize', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var $handle = $(this).addClass('trt-resizing');
            var $ths = $table.find('thead th[data-pos]');
            var index = $ths.index($handle.closest('th'));
            var current = $ths.map(function () {
                return Math.round($(this).outerWidth());
            }).get();
            applyColumnWidths($table, p, visible.length, hasButton, buttonLeft, current);
            var $cols = $table.find('col.trt-col-data');
            var extra = hasButton ? buttonColumnWidth(p) : 0;
            var startX = e.pageX;
            var startWidth = current[index];
            var ns = '.trtresize' + scopeClass;

            $(document).on('mousemove' + ns, function (ev) {
                current[index] = Math.max(40, Math.round(startWidth + ev.pageX - startX));
                $cols.eq(index).css('width', current[index] + 'px');
                $table.css('width', (current.reduce(function (a, b) { return a + b; }, 0) + extra) + 'px');
            }).on('mouseup' + ns, function () {
                $(document).off(ns);
                $handle.removeClass('trt-resizing');
                resizeGuard[objectId] = Date.now();
                sessionWidths[objectId] = current.slice();
                if (ctx.editMode) {
                    saveWidths(backendApi, current);
                }
            });
        }).on('click', '.trt-resize', function (e) {
            e.stopPropagation();
        });

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

        // Header click: ascending -> descending -> original order (empty values always last)
        $wrap.on('click', 'th[data-pos]', function () {
            if (resizeGuard[objectId] && Date.now() - resizeGuard[objectId] < 300) {
                return;
            }
            var column = parseInt($(this).attr('data-pos'), 10);
            var current = sortState[objectId];
            if (!current || current.column !== column) {
                sortState[objectId] = { column: column, ascending: true };
            } else if (current.ascending) {
                sortState[objectId] = { column: column, ascending: false };
            } else {
                delete sortState[objectId];
            }
            render($element, layout, rows, ctx, theme);
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

    // ---------- Property sync ----------

    // The property panel edits qDef.trtBackground / trtText / trtStyle with the
    // normal fx editor. The engine only evaluates per row what is in
    // qAttributeExpressions (as plain strings), so the extension copies the
    // panel values there. Objects from older versions (expressions only in
    // qAttributeExpressions) are migrated once into the panel fields.
    // Only the changed paths are patched, so a panel edit is never overwritten.
    var ATTR_KEYS = ['trtBackground', 'trtText', 'trtStyle'];
    var syncBusy = {};   // objectId -> true while a sync is in progress
    var syncSeen = {};   // objectId|path|value -> already patched once (no loops)

    function exprText(value) {
        if (value === undefined || value === null) {
            return '';
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'object') {
            if (value.qStringExpression) {
                return value.qStringExpression.qExpr || '';
            }
            if (value.qValueExpression) {
                return value.qValueExpression.qExpr || '';
            }
            if (value.qExpr !== undefined) {
                return value.qExpr || '';
            }
        }
        return '';
    }

    function currentAttributes(item) {
        var attrs = item.qAttributeExpressions;
        var list = [];
        if (Array.isArray(attrs)) {
            list = attrs;
        } else if (attrs && typeof attrs === 'object') {
            Object.keys(attrs).forEach(function (k) {
                list[parseInt(k, 10)] = attrs[k];
            });
        }
        return [0, 1, 2].map(function (i) {
            return list[i] && typeof list[i] === 'object' ? exprText(list[i].qExpression) : '';
        });
    }

    function addPatch(objectId, path, value, patches, state) {
        var key = objectId + '|' + path + '|' + value + '|' + (state || '');
        if (syncSeen[key]) {
            return;
        }
        syncSeen[key] = true;
        patches.push({ qOp: 'add', qPath: path, qValue: value });
    }

    function collectPatches(items, path, objectId, patches) {
        (items || []).forEach(function (item, i) {
            item = item || {};
            var base = path + '/' + i;
            var def = item.qDef && typeof item.qDef === 'object' ? item.qDef : null;
            var current = currentAttributes(item);
            var panelSet = def && ATTR_KEYS.some(function (k) { return def[k] !== undefined; });

            if (!panelSet) {
                // Older object: move existing expressions into the panel fields
                if (current.join('') === '') {
                    return;
                }
                var migrated = {};
                ATTR_KEYS.forEach(function (k, n) {
                    migrated[k] = current[n];
                });
                if (def) {
                    ATTR_KEYS.forEach(function (k) {
                        addPatch(objectId, base + '/qDef/' + k, JSON.stringify(migrated[k]), patches);
                    });
                } else {
                    addPatch(objectId, base + '/qDef', JSON.stringify(migrated), patches);
                }
                return;
            }

            var wanted = ATTR_KEYS.map(function (k) { return exprText(def[k]); });
            var attrsOk = Array.isArray(item.qAttributeExpressions) && item.qAttributeExpressions.length >= 3 &&
                item.qAttributeExpressions.every(function (a) { return a && typeof a.qExpression === 'string'; });
            if (attrsOk && wanted.join('\u0001') === current.join('\u0001')) {
                return;
            }
            var list = wanted.map(function (w) { return { qExpression: w }; });
            addPatch(objectId, base + '/qAttributeExpressions', JSON.stringify(list), patches, JSON.stringify(item.qAttributeExpressions || null));
        });
    }

    // Runs on paint in edit mode, so changes from the panel are applied right away.
    // It only writes what differs, and never the same patch twice.
    function repairProperties(backendApi, objectId) {
        if (syncBusy[objectId] || !backendApi.getProperties) {
            return;
        }
        syncBusy[objectId] = true;
        backendApi.getProperties().then(function (props) {
            var hcd = props.qHyperCubeDef || {};
            var patches = [];
            collectPatches(hcd.qDimensions, '/qHyperCubeDef/qDimensions', objectId, patches);
            collectPatches(hcd.qMeasures, '/qHyperCubeDef/qMeasures', objectId, patches);
            if (!patches.length) {
                return null;
            }
            if (backendApi.applyPatches) {
                return backendApi.applyPatches(patches, false);
            }
            if (backendApi.model && backendApi.model.applyPatches) {
                return backendApi.model.applyPatches(patches, false);
            }
            return null;
        }).then(function () {
            syncBusy[objectId] = false;
        }, function () {
            syncBusy[objectId] = false;
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
                taskColumn: '',
                hideTaskColumn: true,
                buttonHeader: '',
                buttonLabel: '',
                buttonPosition: 'right',
                confirm: true,
                monitor: true,
                liveStatus: true,
                liveInterval: 15,
                selectOnClick: true,
                language: 'en',
                headerStyle: 'theme',
                headerAlign: 'auto',
                rowStyle: 'theme',
                rowHeight: 'medium',
                zebra: false,
                gridLines: 'horizontal',
                columnWidth: 'auto',
                columnWidths: '',
                wrap: true,
                buttonWidth: 110,
                buttonColours: 'default',
                objectBorder: false,
                objectShadow: false
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
            var work = Promise.all([
                loadTheme(ctx.app),
                fetchRows(ctx.backendApi, layout.qHyperCube)
            ]).then(function (results) {
                render($element, layout, results[1], ctx, results[0]);
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
