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
            
            const isConnected = await connection.testConnection();
            if (!isConnected) {
                this.errorMessage = 'Connection failed. Check profile settings.';
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
            this._view.webview.html = this._getHtmlForWebview();
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
        .refresh { 
            background: none; 
            border: none; 
            color: var(--vscode-textLink-foreground); 
            cursor: pointer; 
            font-size: 11px;
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
        }
        .error { color: var(--vscode-errorForeground); }
    </style>
</head>
<body>
    <div class="header">
        <input type="text" class="search" id="search" placeholder="Filter..." value="${this.escapeHtml(this.searchTerm)}" ${!this.hasLoaded ? 'disabled' : ''}>
        <div class="info">
            <span>${this._getInfoText()}</span>
            <button class="refresh" onclick="refresh()"${!this.currentProfile ? ' disabled' : ''}>↻ Refresh</button>
        </div>
    </div>
    <div class="list">
        ${this._generateList()}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const search = document.getElementById('search');
        let timer;
        search.addEventListener('input', e => {
            clearTimeout(timer);
            timer = setTimeout(() => vscode.postMessage({command:'search',value:e.target.value}), 150);
        });
        function download(name) { vscode.postMessage({command:'download',appName:name}); }
        function refresh() { vscode.postMessage({command:'refresh'}); }
    </script>
</body>
</html>`;
    }

    private _getInfoText(): string {
        if (this.isLoading) return 'Loading...';
        if (!this.hasLoaded) return 'Select a profile above';
        return `${this.filteredApplications.length} / ${this.applications.length}`;
    }

    private _generateList(): string {
        if (this.isLoading) {
            return '<div class="msg">⏳ Loading...</div>';
        }
        if (this.errorMessage) {
            return `<div class="msg error">${this.escapeHtml(this.errorMessage)}</div>`;
        }
        if (!this.hasLoaded) {
            return '<div class="msg">👆 Select a profile from SAP Profiles</div>';
        }
        if (this.filteredApplications.length === 0) {
            return '<div class="msg">No results</div>';
        }

        return this.filteredApplications.map(app => {
            const name = String(app.name || '');
            const pkg = String(app.package || '');
            return `<div class="item" onclick="download('${this.escapeHtml(name)}')">
                <span class="icon">📦</span>
                <span class="name">${this.escapeHtml(name)}</span>
                <span class="pkg">${this.escapeHtml(pkg)}</span>
            </div>`;
        }).join('');
    }

    private escapeHtml(text: string | undefined | null): string {
        if (text === null || text === undefined) return '';
        const str = String(text);
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
}
