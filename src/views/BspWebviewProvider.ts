import * as vscode from 'vscode';
import { BspApplication, BspService } from '../services/BspService';
import { SapConnection } from '../services/SapConnection';
import { ConfigService } from '../services/ConfigService';

export class BspWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'bspExplorer';

    private _view?: vscode.WebviewView;
    private applications: BspApplication[] = [];
    private filteredApplications: BspApplication[] = [];
    private searchTerm: string = '';
    private isLoading: boolean = false;
    private hasLoaded: boolean = false; // Track if we've ever loaded
    private errorMessage: string | undefined;
    private bspService: BspService | undefined;
    private currentProfile: string | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext,
        private readonly configService: ConfigService
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'search':
                    this.searchTerm = message.value || '';
                    this.filterApplications();
                    this._updateView();
                    break;
                case 'download':
                    if (message.appName) {
                        vscode.commands.executeCommand('bspManager.downloadBspByName', message.appName);
                    }
                    break;
                case 'refresh':
                    await this.loadApplications();
                    break;
                case 'load':
                    await this.loadApplications();
                    break;
            }
        });

        // DON'T auto-load - wait for user to click a profile or refresh
        // Initial view just shows "Click a profile to load BSP applications"
    }

    public async loadApplications(profileName?: string): Promise<void> {
        this.isLoading = true;
        this.errorMessage = undefined;
        this._updateView();

        try {
            const targetProfile = profileName || this.configService.getDefaultProfile();
            
            if (!targetProfile) {
                this.errorMessage = 'No SAP profile configured. Add one in SAP Profiles.';
                this.isLoading = false;
                this._updateView();
                return;
            }

            const config = await this.configService.getConnectionConfig(targetProfile);
            if (!config) {
                this.errorMessage = `Profile "${targetProfile}" not found or password not set.`;
                this.isLoading = false;
                this._updateView();
                return;
            }

            const connection = new SapConnection(config);
            
            const isConnected = await connection.testConnection();
            if (!isConnected) {
                this.errorMessage = 'Failed to connect to SAP server.';
                this.isLoading = false;
                this._updateView();
                return;
            }

            this.bspService = new BspService(connection);
            this.currentProfile = targetProfile;
            this.applications = await this.bspService.listBspApplications();
            this.filterApplications();
            this.hasLoaded = true;
            
        } catch (error) {
            this.errorMessage = `Error: ${error}`;
            this.applications = [];
            this.filteredApplications = [];
        }

        this.isLoading = false;
        this._updateView();
    }

    private filterApplications(): void {
        if (!this.searchTerm) {
            this.filteredApplications = [...this.applications];
            return;
        }

        const term = this.searchTerm.toLowerCase();
        this.filteredApplications = this.applications.filter(app => {
            const name = String(app.name || '');
            const desc = String(app.description || '');
            const pkg = String(app.package || '');
            return name.toLowerCase().includes(term) ||
                   desc.toLowerCase().includes(term) ||
                   pkg.toLowerCase().includes(term);
        });
    }

    public getBspService(): BspService | undefined {
        return this.bspService;
    }

    public getCurrentProfile(): string | undefined {
        return this.currentProfile;
    }

    public getConfigService(): ConfigService {
        return this.configService;
    }

    private _updateView() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const appListHtml = this._generateAppListHtml();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BSP Applications</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 8px;
        }
        .search-container {
            position: sticky;
            top: 0;
            background-color: var(--vscode-sideBar-background);
            padding-bottom: 8px;
            z-index: 10;
        }
        .search-input {
            width: 100%;
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 12px;
        }
        .search-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .search-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .stats {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .refresh-btn {
            background: none;
            border: none;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            font-size: 11px;
        }
        .refresh-btn:hover {
            text-decoration: underline;
        }
        .app-list {
            margin-top: 8px;
        }
        .app-item {
            padding: 8px 10px;
            margin-bottom: 4px;
            background-color: var(--vscode-list-hoverBackground);
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.15s;
        }
        .app-item:hover {
            background-color: var(--vscode-list-activeSelectionBackground);
        }
        .app-name {
            font-weight: 600;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .app-name .icon {
            opacity: 0.7;
        }
        .app-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .app-package {
            font-size: 10px;
            color: var(--vscode-badge-foreground);
            background-color: var(--vscode-badge-background);
            padding: 1px 6px;
            border-radius: 10px;
            margin-top: 4px;
            display: inline-block;
        }
        .download-btn {
            float: right;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 10px;
            cursor: pointer;
        }
        .download-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .loading, .error, .empty {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
        .error {
            color: var(--vscode-errorForeground);
        }
        .highlight {
            background-color: var(--vscode-editor-findMatchHighlightBackground);
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="search-container">
        <input 
            type="text" 
            class="search-input" 
            id="searchInput"
            placeholder="🔍 Search by name, description or package..."
            value="${this.escapeHtml(this.searchTerm)}"
        />
        <div class="stats">
            <span>${this.isLoading ? 'Loading...' : `${this.filteredApplications.length} of ${this.applications.length} apps`}</span>
            <button class="refresh-btn" onclick="refresh()">↻ Refresh</button>
        </div>
    </div>
    
    <div class="app-list">
        ${appListHtml}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const searchInput = document.getElementById('searchInput');
        
        let debounceTimer;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                vscode.postMessage({ command: 'search', value: e.target.value });
            }, 200);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                vscode.postMessage({ command: 'search', value: '' });
            }
        });

        function download(appName) {
            event.stopPropagation();
            vscode.postMessage({ command: 'download', appName: appName });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        // Focus search on load
        searchInput.focus();
    </script>
</body>
</html>`;
    }

    private _generateAppListHtml(): string {
        if (this.isLoading) {
            return '<div class="loading">⏳ Loading BSP applications...</div>';
        }

        if (this.errorMessage) {
            return `<div class="error">❌ ${this.escapeHtml(this.errorMessage)}</div>`;
        }

        // If never loaded, show instruction
        if (!this.hasLoaded) {
            return '<div class="empty">👆 Click a profile in SAP Profiles to load BSP applications, or click ↻ Refresh</div>';
        }

        if (this.filteredApplications.length === 0) {
            if (this.searchTerm) {
                return `<div class="empty">No applications match "${this.escapeHtml(this.searchTerm)}"</div>`;
            }
            return '<div class="empty">No BSP applications found</div>';
        }

        return this.filteredApplications.map(app => `
            <div class="app-item" onclick="download('${this.escapeHtml(app.name)}')">
                <div class="app-name">
                    <span class="icon">📦</span>
                    ${this.highlightMatch(app.name)}
                    <button class="download-btn" onclick="download('${this.escapeHtml(app.name)}')">⬇ Download</button>
                </div>
                <div class="app-desc">${this.highlightMatch(app.description) || 'No description'}</div>
                <span class="app-package">${this.highlightMatch(app.package)}</span>
            </div>
        `).join('');
    }

    private highlightMatch(text: string | undefined | null): string {
        const safeText = String(text || '');
        if (!this.searchTerm || !safeText) {
            return this.escapeHtml(safeText);
        }
        
        const escapedText = this.escapeHtml(safeText);
        const escapedTerm = this.escapeHtml(this.searchTerm);
        const regex = new RegExp(`(${escapedTerm})`, 'gi');
        return escapedText.replace(regex, '<span class="highlight">$1</span>');
    }

    private escapeHtml(text: string | undefined | null): string {
        if (text === null || text === undefined) {return '';}
        const str = String(text);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
