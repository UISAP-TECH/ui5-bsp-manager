import * as vscode from 'vscode';

export class I18nEditorProvider implements vscode.CustomTextEditorProvider {

    public static readonly viewType = 'bspManager.i18nEditor';

    constructor(
        private readonly context: vscode.ExtensionContext
    ) { }

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new I18nEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(I18nEditorProvider.viewType, provider);
        return providerRegistration;
    }

    /**
     * Called when our custom editor is opened.
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        function updateWebview() {
            webviewPanel.webview.postMessage({
                type: 'update',
                text: document.getText(),
            });
        }

        // Hook up event handlers so that we can synchronize the webview with the text document.
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        // Make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        // Receive message from the webview.
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'update':
                    this.updateTextDocument(document, e.content);
                    return;
                case 'ready':
                    updateWebview();
                    return;
            }
        });
    }

    /**
     * Write contents back to the text document.
     */
    private updateTextDocument(document: vscode.TextDocument, content: any) {
        const edit = new vscode.WorkspaceEdit();

        // Convert JSON content back to .properties format
        let propertiesText = '';
        if (Array.isArray(content)) {
            content.forEach((item: { key: string, value: string }) => {
                if (item.key) {
                   // Clean format: key = value
                   propertiesText += `${item.key} = ${item.value}\n`;
                }
            });
        }

        // Just replace the entire document.
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            propertiesText
        );

        return vscode.workspace.applyEdit(edit);
    }

    /**
     * Get the static HTML used for the editor webviews.
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        // VS Code Codicons
        const icons = {
            add: '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>',
            trash: '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>',
            search: '<svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
            copy: '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M4 4h2v1H4v10h8V8h1v7H3V4h1zm3-3h7v7h-1V3H7V1zm1 5h4V3H8v3z"/></svg>' // Copy
        };

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
                <title>I18n Editor</title>
                <style>
                    :root {
                        --container-padding: 20px;
                    }

                    body {
                        padding: 0;
                        color: var(--vscode-editor-foreground);
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        background-color: var(--vscode-editor-background); 
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        overflow: hidden;
                    }

                    .toolbar {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 10px 20px;
                        background-color: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-widget-border);
                        flex-shrink: 0;
                    }

                    .search-container {
                        position: relative;
                        display: flex;
                        align-items: center;
                        width: 300px;
                    }

                    .search-icon {
                        position: absolute;
                        left: 8px;
                        top: 50%;
                        transform: translateY(-50%);
                        color: var(--vscode-input-placeholderForeground);
                        pointer-events: none;
                        display: flex;
                    }

                    #search {
                        width: 100%;
                        padding: 6px 6px 6px 30px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        outline: none;
                        border-radius: 2px;
                    }

                    #search:focus {
                        border-color: var(--vscode-focusBorder);
                    }

                    .btn {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 6px;
                        padding: 6px 12px;
                        border: none;
                        cursor: pointer;
                        font-family: inherit;
                        font-size: inherit;
                        border-radius: 2px;
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        margin-left: 8px;
                    }
                    
                    .btn:hover {
                         background-color: var(--vscode-button-secondaryHoverBackground);
                    }

                    .btn-primary {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }

                    .btn-primary:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }

                    .table-container {
                        flex-grow: 1;
                        overflow-y: auto;
                    }

                    table {
                        width: 100%;
                        border-collapse: collapse;
                        table-layout: fixed;
                    }

                    thead {
                        position: sticky;
                        top: 0;
                        z-index: 10;
                    }

                    th {
                        padding: 10px;
                        text-align: left;
                        font-weight: 600;
                        color: var(--vscode-foreground);
                        border-bottom: 1px solid var(--vscode-widget-border);
                        background-color: var(--vscode-editor-background);
                    }

                    td {
                        padding: 4px 10px;
                        border-bottom: 1px solid var(--vscode-editorGroup-border);
                        vertical-align: middle;
                        position: relative;
                    }

                    tr:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }
                    
                    tr:hover .copy-btn {
                        opacity: 0.8;
                    }

                    /* Input Styling */
                    td input {
                        width: 100%;
                        box-sizing: border-box;
                        background: transparent;
                        border: 1px solid transparent;
                        color: inherit;
                        padding: 6px;
                        font-family: var(--vscode-editor-font-family);
                        outline: none;
                        transition: border-color 0.2s;
                    }

                    td input:focus {
                        background-color: var(--vscode-input-background);
                        border-color: var(--vscode-focusBorder) !important;
                    }

                    /* Validation Classes */
                    td input.duplicate {
                        background-color: var(--vscode-inputValidation-errorBackground) !important;
                        border-color: var(--vscode-inputValidation-errorBorder) !important;
                    }
                    
                    td input.empty {
                        background-color: var(--vscode-inputValidation-warningBackground) !important;
                        border-color: var(--vscode-inputValidation-warningBorder) !important;
                    }
                    
                    /* Utility Icon Buttons */
                    .icon-btn {
                        background: transparent;
                        border: none;
                        color: var(--vscode-icon-foreground);
                        cursor: pointer;
                        padding: 6px;
                        border-radius: 4px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        opacity: 0.7;
                    }
                    .icon-btn:hover {
                        opacity: 1;
                        background-color: var(--vscode-toolbar-hoverBackground);
                    }
                    .delete-btn:hover { color: var(--vscode-errorForeground); }
                    
                    .copy-btn {
                        position: absolute;
                        right: 15px; /* Inside the Key column */
                        top: 50%;
                        transform: translateY(-50%);
                        opacity: 0; /* Hidden unless row hover */
                        background: var(--vscode-editor-background); 
                        padding: 4px;
                        border: 1px solid var(--vscode-widget-border);
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }

                    #status { font-size: 0.9em; opacity: 0.8; margin-right: 15px; }
                </style>
            </head>
            <body>
                <div class="toolbar">
                    <div class="search-container">
                        <div class="search-icon">${icons.search}</div>
                        <input type="text" id="search" placeholder="Search keys or values..." onkeyup="filterRows()">
                    </div>
                    <div style="display:flex; align-items:center;">
                        <span id="status">Loading...</span>

                        <button class="btn btn-primary" onclick="addRow()">
                            ${icons.add} Add Key
                        </button>
                    </div>
                </div>
                <div class="table-container">
                    <table id="grid">
                        <thead>
                            <tr>
                                <th style="width: 40px; text-align: center;"></th>
                                <th style="width: 40%">Key</th>
                                <th style="width: 60%">Value</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>

                <script>
                    const icons = {
                        trash: '${icons.trash.replace(/'/g, "\\'")}',
                        copy: '${icons.copy.replace(/'/g, "\\'")}'
                    };

                    try {
                        const vscode = acquireVsCodeApi();
                        let currentData = [];

                        function generateId() {
                            return 'id_' + Math.random().toString(36).substr(2, 9);
                        }

                        function parseProperties(text) {
                            if (!text) return [];
                            const lines = text.split(/\\r?\\n/);
                            const data = [];
                            lines.forEach(line => {
                                line = line.trim();
                                if (line && !line.startsWith('#')) {
                                    const parts = line.split('=');
                                    const key = parts.shift().trim();
                                    const value = parts.join('=').trim();
                                    data.push({ _id: generateId(), key, value });
                                }
                            });
                            return data;
                        }

                        function findDuplicates(data) {
                            const counts = {};
                            data.forEach(item => {
                                counts[item.key] = (counts[item.key] || 0) + 1;
                            });
                            return Object.keys(counts).filter(key => counts[key] > 1);
                        }

                        function render(data) {
                            const tbody = document.querySelector('tbody');
                            tbody.innerHTML = '';
                            const fragment = document.createDocumentFragment();
                            
                            const duplicates = findDuplicates(currentData);

                            data.forEach((item) => {
                                const row = document.createElement('tr');
                                
                                const isDup = duplicates.includes(item.key) ? 'duplicate' : '';
                                const isEmpty = !item.value ? 'empty' : '';

                                row.innerHTML = \`
                                    <td class="action-col" style="text-align: center;">
                                        <button class="icon-btn delete-btn" title="Delete Key" onclick="deleteRow('\${item._id}')">
                                            \${icons.trash}
                                        </button>
                                    </td>
                                    <td style="position: relative;">
                                        <input type="text" 
                                               class="\${isDup}" 
                                               value="\${escapeHtml(item.key)}" 
                                               title="\${isDup ? 'Duplicate Key' : ''}"
                                               onchange="updateRow('\${item._id}', 'key', this.value)" 
                                               placeholder="Key">
                                        <button class="icon-btn copy-btn" title="Copy Key" onclick="copyText('\${escapeHtml(item.key)}')">
                                            \${icons.copy}
                                        </button>
                                    </td>
                                    <td>
                                        <input type="text" 
                                               class="\${isEmpty}"
                                               value="\${escapeHtml(item.value)}" 
                                               title="\${isEmpty ? 'Empty Value' : ''}"
                                               onchange="updateRow('\${item._id}', 'value', this.value)" 
                                               placeholder="Value">
                                    </td>
                                \`;
                                fragment.appendChild(row);
                            });
                            tbody.appendChild(fragment);
                            document.getElementById('status').textContent = data.length + ' keys';
                        }
                        
                        function escapeHtml(unsafe) {
                            if (!unsafe) return "";
                            return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
                        }

                        window.addRow = function() {
                            currentData.unshift({ _id: generateId(), key: 'NEW_KEY', value: '' });
                            render(currentData);
                            filterRows();
                            document.querySelector('.table-container').scrollTop = 0;
                            notifyChange();
                        }

                        window.deleteRow = function(id) {
                            const index = currentData.findIndex(item => item._id === id);
                            if (index > -1) {
                                currentData.splice(index, 1);
                                render(currentData);
                                filterRows();
                                notifyChange();
                            }
                        }

                        window.updateRow = function(id, field, value) {
                            const item = currentData.find(item => item._id === id);
                            if (item) {
                                item[field] = value;
                                // Re-render only if we updated the KEY (to check for duplicates)
                                if (field === 'key') {
                                    render(currentData);
                                    filterRows();
                                }
                                notifyChange();
                            }
                        }
                        


                        window.copyText = function(text) {
                            navigator.clipboard.writeText(text).then(() => {
                                // show toast?
                            });
                        }

                        function notifyChange() {
                            vscode.postMessage({ type: 'update', content: currentData });
                        }

                        window.filterRows = function() {
                            const term = document.getElementById('search').value.toLowerCase();
                            const rows = document.querySelectorAll('tbody tr');
                            rows.forEach((row, index) => {
                                const item = currentData[index];
                                const match = !term || item.key.toLowerCase().includes(term) || item.value.toLowerCase().includes(term);
                                row.style.display = match ? '' : 'none';
                            });
                        }

                        window.addEventListener('message', event => {
                            const message = event.data;
                            if (message.type === 'update') {
                                currentData = parseProperties(message.text);
                                render(currentData);
                                filterRows();
                            }
                        });

                        vscode.postMessage({ type: 'ready' });
                        document.getElementById('status').textContent = 'Waiting...';
                        
                    } catch (err) {
                        console.error('Init failed', err);
                    }
                </script>
            </body>
            </html>`;
    }
}
