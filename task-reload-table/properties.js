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
            label: "Background colour expression (e.g. =RGB(200,16,46))",
            defaultValue: ""
        },
        text: {
            type: "string",
            ref: "qAttributeExpressions.1.qExpression",
            label: "Text colour expression (e.g. =If(x>0, Green()))",
            defaultValue: ""
        }
    };


    // Colour picker (theme palette + custom colour), stores { index, color }
    function colour(ref, label, defaultColour, show) {
        var item = {
            type: "object",
            component: "color-picker",
            ref: ref,
            label: label,
            dualOutput: true,
            defaultValue: { index: -1, color: defaultColour }
        };
        if (show) {
            item.show = show;
        }
        return item;
    }

    function isCustom(key) {
        return function (data) {
            return !!(data.props && data.props[key] === "custom");
        };
    }

    var presentation = {
        type: "items",
        label: "Presentation",
        items: {
            header: {
                type: "items",
                label: "Header",
                items: {
                    headerStyle: {
                        type: "string",
                        component: "dropdown",
                        ref: "props.headerStyle",
                        label: "Header style",
                        options: [
                            { value: "theme", label: "Theme default" },
                            { value: "custom", label: "Custom" }
                        ],
                        defaultValue: "theme"
                    },
                    headerFontSize: {
                        type: "number",
                        ref: "props.headerFontSize",
                        label: "Font size (px)",
                        defaultValue: 12,
                        show: isCustom("headerStyle")
                    },
                    headerColor: colour("props.headerColor", "Text colour", "#5F6368", isCustom("headerStyle")),
                    headerBackground: colour("props.headerBackground", "Background colour", "#FFFFFF", isCustom("headerStyle")),
                    headerBold: {
                        type: "boolean",
                        ref: "props.headerBold",
                        label: "Bold",
                        defaultValue: true,
                        show: isCustom("headerStyle")
                    },
                    headerAlign: {
                        type: "string",
                        component: "dropdown",
                        ref: "props.headerAlign",
                        label: "Text alignment",
                        options: [
                            { value: "auto", label: "Auto (text left, numbers right)" },
                            { value: "left", label: "Left" },
                            { value: "center", label: "Center" },
                            { value: "right", label: "Right" }
                        ],
                        defaultValue: "auto"
                    }
                }
            },
            rows: {
                type: "items",
                label: "Rows",
                items: {
                    rowStyle: {
                        type: "string",
                        component: "dropdown",
                        ref: "props.rowStyle",
                        label: "Row style",
                        options: [
                            { value: "theme", label: "Theme default" },
                            { value: "custom", label: "Custom" }
                        ],
                        defaultValue: "theme"
                    },
                    bodyFontSize: {
                        type: "number",
                        ref: "props.bodyFontSize",
                        label: "Font size (px)",
                        defaultValue: 12,
                        show: isCustom("rowStyle")
                    },
                    bodyColor: colour("props.bodyColor", "Text colour", "#2B2B2B", isCustom("rowStyle")),
                    rowHeight: {
                        type: "string",
                        component: "dropdown",
                        ref: "props.rowHeight",
                        label: "Row height",
                        options: [
                            { value: "compact", label: "Compact" },
                            { value: "medium", label: "Medium" },
                            { value: "spacious", label: "Spacious" }
                        ],
                        defaultValue: "medium"
                    },
                    zebra: {
                        type: "boolean",
                        ref: "props.zebra",
                        label: "Alternating row colour",
                        defaultValue: false
                    },
                    zebraColor: colour("props.zebraColor", "Alternating row colour", "#F7F7F7", function (data) {
                        return !!(data.props && data.props.zebra);
                    }),
                    hoverColor: colour("props.hoverColor", "Hover colour", "#F2F2F2"),
                    gridLines: {
                        type: "string",
                        component: "dropdown",
                        ref: "props.gridLines",
                        label: "Grid lines",
                        options: [
                            { value: "horizontal", label: "Horizontal" },
                            { value: "both", label: "Horizontal and vertical" },
                            { value: "none", label: "None" }
                        ],
                        defaultValue: "horizontal"
                    },
                    borderColor: colour("props.borderColor", "Grid line colour", "#ECECEC", function (data) {
                        return !(data.props && data.props.gridLines === "none");
                    })
                }
            },
            columns: {
                type: "items",
                label: "Columns",
                items: {
                    columnWidth: {
                        type: "string",
                        component: "dropdown",
                        ref: "props.columnWidth",
                        label: "Column width",
                        options: [
                            { value: "auto", label: "Auto (fill the object)" },
                            { value: "fit", label: "Fit to content" },
                            { value: "fixed", label: "Fixed (px per column)" }
                        ],
                        defaultValue: "auto"
                    },
                    columnWidths: {
                        type: "string",
                        ref: "props.columnWidths",
                        label: "Widths in px, comma separated, in visible column order (e.g. 200,150,120)",
                        defaultValue: "",
                        show: function (data) {
                            return !!(data.props && data.props.columnWidth === "fixed");
                        }
                    },
                    wrap: {
                        type: "boolean",
                        ref: "props.wrap",
                        label: "Wrap text",
                        defaultValue: true
                    }
                }
            },
            button: {
                type: "items",
                label: "Button",
                items: {
                    buttonWidth: {
                        type: "number",
                        ref: "props.buttonWidth",
                        label: "Minimum width (px)",
                        defaultValue: 110
                    },
                    buttonColours: {
                        type: "string",
                        component: "dropdown",
                        ref: "props.buttonColours",
                        label: "Button colours",
                        options: [
                            { value: "default", label: "Default" },
                            { value: "custom", label: "Custom" }
                        ],
                        defaultValue: "default"
                    },
                    colorAccent: colour("props.colorAccent", "Hover / confirm", "#C8102E", isCustom("buttonColours")),
                    colorRunning: colour("props.colorRunning", "Running", "#FFB81C", isCustom("buttonColours")),
                    colorDone: colour("props.colorDone", "Finished", "#509E2F", isCustom("buttonColours")),
                    colorFailed: colour("props.colorFailed", "Failed", "#C8102E", isCustom("buttonColours"))
                }
            }
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
            presentation: presentation,
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
                        label: "Task Reload Table v1.3.0",
                        component: "text"
                    },
                    copyright: {
                        label: "© 2026 Etem Uyar · Etem Visuals",
                        component: "text"
                    },
                    license: {
                        label: "MIT License",
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
