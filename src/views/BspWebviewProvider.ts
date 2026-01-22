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
    private hasLoaded: boolean = false;
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

        webviewView.webview.html = this._getHtmlForWebview();

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
                    // Only refresh if we have a profile
                    if (this.currentProfile) {
                        await this.loadApplications(this.currentProfile);
                    } else {
                        vscode.window.showWarningMessage('Please select a profile first from SAP Profiles');
                    }
                    break;
            }
        });
    }

    public async loadApplications(profileName?: string): Promise<void> {
        this.isLoading = true;
        this.errorMessage = undefined;
        // Clear existing data immediately to avoid showing stale data while loading
        this.applications = [];
        this.filteredApplications = [];
        this.hasLoaded = false;
        this.currentProfile = undefined; // Reset current profile so status bar clears on error
        this.searchTerm = ''; // Reset filter when loading new profile
        this._updateView();

        try {
            const targetProfile = profileName || this.configService.getDefaultProfile();
            
            if (!targetProfile) {
                this.errorMessage = 'Select a profile from SAP Profiles above';
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
            
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: `Loading BSPs from ${targetProfile}...`,
                cancellable: false
            }, async () => {
                const isConnected = await connection.testConnection();
                if (!isConnected) {
                    const msg = `Connection failed to "${targetProfile}" (${config.server}). Check profile settings.`;
                    this.errorMessage = msg;
                    this.isLoading = false;
                    this.currentProfile = undefined;
                    this._updateView();
                    vscode.window.showErrorMessage(msg);
                    return;
                }

                this.bspService = new BspService(connection);
                this.currentProfile = targetProfile;
                this.applications = await this.bspService.listBspApplications();
                this.filterApplications(true);
                this.hasLoaded = true;
            });
            
        } catch (error) {
            this.errorMessage = `Error: ${error}`;
            this.applications = [];
            this.filteredApplications = [];
            vscode.window.showErrorMessage(`Error loading BSP applications: ${error}`);
        }

        this.isLoading = false;
        this._updateView();
    }

    private filterApplications(fullUpdate: boolean = false): void {
        if (!this.searchTerm) {
            this.filteredApplications = [...this.applications];
        } else {
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
        
        if (fullUpdate) {
            this._updateView();
        } else {
            this._updateListOnly();
        }
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
            this._view.webview.html = this._getHtmlForWebview();
        }
    }

    private _updateListOnly() {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateList',
                content: this._generateList(),
                info: this._getInfoText()
            });
        }
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: 13px;
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
        }
        .header {
            position: sticky;
            top: 0;
            background: var(--vscode-sideBar-background);
            padding: 6px;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
        }
        .search {
            width: 100%;
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 12px;
            border-radius: 2px;
        }
        .search:focus { outline: 1px solid var(--vscode-focusBorder); }
        .info {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 4px 0;
            display: flex;
            justify-content: space-between;
        }
        .list { padding: 2px 0; }
        .item {
            display: flex;
            align-items: center;
            padding: 3px 8px;
            cursor: pointer;
        }
        .item:hover { background: var(--vscode-list-hoverBackground); }
        .icon { margin-right: 6px; font-size: 14px; }
        .name { flex: 1; font-size: 13px; }
        .pkg {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-left: 8px;
        }
        .msg { 
            padding: 20px; 
            text-align: center; 
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
        }
        .placeholder-icon {
            font-size: 48px;
            margin-bottom: 12px;
            opacity: 0.5;
        }
        .placeholder-hint {
            margin-top: 8px;
            font-size: 11px;
            opacity: 0.8;
            max-width: 200px;
        }
        .error-container {
            color: var(--vscode-errorForeground);
            text-align: center;
            max-width: 80%;
        }
        .error-icon {
            font-size: 48px;
            margin-bottom: 12px;
        }
        .spinner {
            border: 3px solid var(--vscode-scrollbarSlider-background);
            border-top: 3px solid var(--vscode-progressBar-background);
            border-radius: 50%;
            width: 24px;
            height: 24px;
            animation: spin 1s linear infinite;
            margin-bottom: 12px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="header">
        <input type="text" class="search" id="search" placeholder="Search..." value="${this.escapeHtml(this.searchTerm)}" ${!this.hasLoaded ? 'disabled' : ''}>
        <div class="info" id="infoText">
            <span>${this._getInfoText()}</span>
        </div>
    </div>
    <div class="list" id="listContainer">
        ${this._generateList()}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const search = document.getElementById('search');
        const listContainer = document.getElementById('listContainer');
        const infoText = document.getElementById('infoText');
        
        let timer;
        search.addEventListener('input', e => {
            clearTimeout(timer);
            // Send search (debounce reduced for responsiveness but extension logic is fast)
            // Actually, we don't need to postMessage if we handle filtering in extension and push updates
            // But we need to tell extension the term.
            timer = setTimeout(() => vscode.postMessage({command:'search',value:e.target.value}), 50);
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateList':
                    listContainer.innerHTML = message.content;
                    if (infoText && message.info !== undefined) {
                        infoText.querySelector('span').innerText = message.info;
                    }
                    break;
            }
        });

        function download(name) { vscode.postMessage({command:'download',appName:name}); }
    </script>
</body>
</html>`;
    }

    private _getInfoText(): string {
        if (this.isLoading) return ''; // Don't show loading here, it's shown in the list
        if (!this.hasLoaded) return '';
        return `${this.filteredApplications.length} / ${this.applications.length}`;
    }

    private _generateList(): string {
        if (this.isLoading) {
            return `
                <div class="msg">
                    <div class="spinner"></div>
                    <div>Loading BSP Applications...</div>
                </div>`;
        }
        if (this.errorMessage) {
            return `
                <div class="msg">
                    <div class="error-icon">⚠️</div>
                    <div class="error-container">${this.escapeHtml(this.errorMessage)}</div>
                </div>`;
        }
        if (!this.hasLoaded) {
            return `
                <div class="msg placeholder">
                    <div class="placeholder-icon">📋</div>
                    <div>No profile loaded</div>
                    <div class="placeholder-hint">Right-click a profile in "SAP Profiles" and select "Load BSP Applications"</div>
                </div>`;
        }
        if (this.filteredApplications.length === 0) {
            return '<div class="msg">No results</div>';
        }

        return this.filteredApplications.map(app => {
            const name = this.extractText(app.name);
            const desc = this.extractText(app.description);
            let pkg = this.extractText(app.package);
            
            if (!pkg || pkg === 'undefined') {
                pkg = ''; // Don't show package if missing/TMP, user wants description instead
            }

            // User request: Show Description on the right instead of Package
            // Name on left, Description on right
            
            return `<div class="item" onclick="download('${this.escapeHtml(name)}')" title="${this.escapeHtml(desc)}">
                <span class="icon">📦</span>
                <span class="name">${this.escapeHtml(name)}</span>
                <span class="pkg">${this.escapeHtml(desc)}</span>
            </div>`;
        }).join('');
    }

    private extractText(val: any): string {
        if (val === null || val === undefined) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'object') {
            return val['#text'] || val['text'] || val['content'] || val['summary'] || '';
        }
        return String(val);
    }

    private escapeHtml(text: string | undefined | null): string {
        if (text === null || text === undefined) return '';
        const str = String(text);
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
}
