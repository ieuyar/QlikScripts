/*
Task Reload Table - property panel
*/

define([], function () {
    'use strict';

    // Per-column colour expressions, same idea as the native table
    // attribute 0 = background colour, attribute 1 = text colour
    var columnColours = {
        background: {
            type: "string",
            ref: "qAttributeExpressions.0.qExpression",
            label: "Background colour expression",
            expression: "always",
            defaultValue: ""
        },
        text: {
            type: "string",
            ref: "qAttributeExpressions.1.qExpression",
            label: "Text colour expression",
            expression: "always",
            defaultValue: ""
        }
    };

    return {
        type: "items",
        component: "accordion",
        items: {
            dimensions: {
                uses: "dimensions",
                min: 1,
                max: 15,
                items: columnColours
            },
            measures: {
                uses: "measures",
                min: 0,
                max: 10,
                items: columnColours
            },
            sorting: {
                uses: "sorting"
            },
            reload: {
                type: "items",
                label: "Reload button",
                items: {
                    taskColumn: {
                        type: "number",
                        ref: "props.taskColumn",
                        label: "Task ID column (1 = first column; dimensions are counted before measures)",
                        defaultValue: 0
                    },
                    hideTaskColumn: {
                        type: "boolean",
                        ref: "props.hideTaskColumn",
                        label: "Hide the task ID column",
                        defaultValue: true
                    },
                    buttonHeader: {
                        type: "string",
                        ref: "props.buttonHeader",
                        label: "Button column header",
                        expression: "optional",
                        defaultValue: ""
                    },
                    buttonLabel: {
                        type: "string",
                        ref: "props.buttonLabel",
                        label: "Button label (empty = default for the language)",
                        expression: "optional",
                        defaultValue: ""
                    },
                    buttonPosition: {
                        type: "string",
                        component: "dropdown",
                        ref: "props.buttonPosition",
                        label: "Button column position",
                        options: [
                            { value: "right", label: "Right (last column)" },
                            { value: "left", label: "Left (first column)" }
                        ],
                        defaultValue: "right"
                    },
                    confirm: {
                        type: "boolean",
                        ref: "props.confirm",
                        label: "Ask for confirmation (click twice to start)",
                        defaultValue: true
                    },
                    monitor: {
                        type: "boolean",
                        ref: "props.monitor",
                        label: "Monitor task status",
                        defaultValue: true
                    },
                    selectOnClick: {
                        type: "boolean",
                        ref: "props.selectOnClick",
                        label: "Select on dimension cell click",
                        defaultValue: true
                    },
                    language: {
                        type: "string",
                        component: "dropdown",
                        ref: "props.language",
                        label: "Language of button texts",
                        options: [
                            { value: "en", label: "English" },
                            { value: "tr", label: "Türkçe" }
                        ],
                        defaultValue: "en"
                    }
                }
            },
            addons: {
                uses: "addons",
                items: {
                    dataHandling: {
                        uses: "dataHandling"
                    }
                }
            },
            appearance: {
                uses: "settings"
            },
            about: {
                label: "About",
                type: "items",
                items: {
                    name: {
                        label: "Task Reload Table",
                        component: "text"
                    },
                    link: {
                        label: "Documentation on GitHub",
                        component: "link",
                        url: "https://github.com/ieuyar/QlikScripts/tree/main/task-reload-table"
                    }
                }
            }
        }
    };
});
