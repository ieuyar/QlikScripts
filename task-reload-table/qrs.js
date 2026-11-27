/*
Task Reload Table - QRS calls
*/

define(["jquery"], function ($) {
    'use strict';

    // Detect the virtual proxy prefix: https://server/<prefix>/sense/app/...
    var prefix = '';
    var match = window.location.pathname.match(/^(\/[^\/]+)\/sense\//);
    if (match !== null) {
        prefix = match[1];
    }

    var baseUrl = window.location.protocol + '//' + window.location.host + prefix;

    function newXrfkey() {
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var key = '';
        for (var i = 0; i < 16; i++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return key;
    }

    function qrs(method, path, query) {
        var key = newXrfkey();
        var url = baseUrl + '/qrs' + path + '?xrfkey=' + key + (query ? '&' + query : '');
        return new Promise(function (resolve, reject) {
            $.ajax({
                type: method,
                url: url,
                headers: { 'X-Qlik-Xrfkey': key },
                contentType: 'application/json',
                dataType: 'json'
            }).done(function (data) {
                resolve(data);
            }).fail(function (xhr) {
                reject({ status: xhr.status, message: xhr.responseText });
            });
        });
    }

    return {

        // Starts the task and returns its execution session id
        startTask: function (taskId) {
            return qrs('POST', '/task/' + taskId + '/start/synchronous').then(function (data) {
                return data && data.value ? data.value : null;
            });
        },

        // Last execution of several reload tasks at once (also runs started in QMC or by a trigger).
        // Returns { taskId: { status, start, stop } } for the tasks the user can read.
        getTaskStatuses: function (taskIds) {
            var chunks = [];
            for (var i = 0; i < taskIds.length; i += 40) {
                chunks.push(taskIds.slice(i, i + 40));
            }
            return Promise.all(chunks.map(function (ids) {
                var filter = ids.map(function (id) { return 'id eq ' + id; }).join(' or ');
                return qrs('GET', '/reloadtask/full', 'filter=' + encodeURIComponent(filter));
            })).then(function (pages) {
                var result = {};
                pages.forEach(function (tasks) {
                    (tasks || []).forEach(function (task) {
                        var last = task.operational && task.operational.lastExecutionResult;
                        if (!last) {
                            return;
                        }
                        result[String(task.id).toLowerCase()] = {
                            status: parseInt(last.status, 10),
                            start: last.startTime,
                            stop: last.stopTime
                        };
                    });
                });
                return result;
            });
        },

        // Returns the execution status code, or null if there is no result yet
        getStatus: function (executionId) {
            return qrs('GET', '/executionresult', 'filter=' + encodeURIComponent('ExecutionId eq ' + executionId)).then(function (data) {
                if (!data || !data.length) {
                    return null;
                }
                return parseInt(data[0].status, 10);
            });
        }
    };
});
