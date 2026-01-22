import * as vscode from 'vscode';
import { SapProfile } from '../services/SapConnection';
import { ConfigService } from '../services/ConfigService';

export class ProfileFormPanel {
    public static currentPanel: ProfileFormPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private configService: ConfigService;
    private editingProfile: string | undefined;
    private onProfileSaved: () => void;

    public static createOrShow(
        extensionUri: vscode.Uri,
        configService: ConfigService,
        editingProfile?: string,
        onProfileSaved?: () => void
    ) {
        const column = vscode.ViewColumn.One;

        if (ProfileFormPanel.currentPanel) {
            ProfileFormPanel.currentPanel._panel.reveal(column);
            ProfileFormPanel.currentPanel.editingProfile = editingProfile;
            ProfileFormPanel.currentPanel.onProfileSaved = onProfileSaved || (() => {});
            ProfileFormPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'profileForm',
            editingProfile ? `Edit Profile: ${editingProfile}` : 'Add SAP Profile',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ProfileFormPanel.currentPanel = new ProfileFormPanel(
            panel,
            extensionUri,
            configService,
            editingProfile,
            onProfileSaved || (() => {})
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        configService: ConfigService,
        editingProfile: string | undefined,
        onProfileSaved: () => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.configService = configService;
        this.editingProfile = editingProfile;
        this.onProfileSaved = onProfileSaved;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'saveProfile':
                        await this._saveProfile(message.data);
                        break;
                    case 'deleteProfile':
                        await this._deleteProfile(message.profileName);
                        break;
                    case 'testConnection':
                        await this._testConnection(message.data);
                        break;
                    case 'cancel':
                        this._panel.dispose();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async _saveProfile(data: {
        name: string;
        server: string;
        client: string;
        user: string;
        password: string;
        useStrictSSL: boolean;
        setAsDefault: boolean;
    }) {
        try {
            const profile: SapProfile = {
                name: data.name,
                server: data.server,
                client: data.client,
                user: data.user,
                useStrictSSL: data.useStrictSSL
            };

            await this.configService.saveProfile(profile);
            await this.configService.storePassword(data.name, data.password);

            if (data.setAsDefault) {
                await this.configService.setDefaultProfile(data.name);
            }

            this._panel.webview.postMessage({ command: 'saved', success: true });
            vscode.window.showInformationMessage(`Profile "${data.name}" saved successfully!`);
            
            this.onProfileSaved();
            this._panel.dispose();
        } catch (error) {
            this._panel.webview.postMessage({ 
                command: 'error', 
                message: `Failed to save profile: ${error}` 
            });
        }
    }

    private async _deleteProfile(profileName: string) {
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete profile "${profileName}"?`,
            { modal: true },
            'Delete'
        );

        if (confirm === 'Delete') {
            await this.configService.deleteProfile(profileName);
            vscode.window.showInformationMessage(`Profile "${profileName}" deleted.`);
            this.onProfileSaved();
            this._panel.dispose();
        }
    }

    private async _testConnection(data: {
        server: string;
        client: string;
        user: string;
        password: string;
        useStrictSSL: boolean;
    }) {
        try {
            this._panel.webview.postMessage({ command: 'testing' });

            const { SapConnection } = require('../services/SapConnection');
            const connection = new SapConnection({
                name: 'test',
                server: data.server,
                client: data.client,
                user: data.user,
                password: data.password,
                useStrictSSL: data.useStrictSSL
            });

            const success = await connection.testConnection();
            
            this._panel.webview.postMessage({ 
                command: 'testResult', 
                success,
                message: success ? 'Connection successful!' : 'Connection failed. Please check your settings.'
            });
        } catch (error) {
            this._panel.webview.postMessage({ 
                command: 'testResult', 
                success: false,
                message: `Connection error: ${error}`
            });
        }
    }

    private async _update() {
        const webview = this._panel.webview;
        
        let existingProfile: SapProfile | undefined;
        let existingPassword = '';
        
        if (this.editingProfile) {
            existingProfile = this.configService.getProfile(this.editingProfile);
            existingPassword = await this.configService.getPassword(this.editingProfile) || '';
            this._panel.title = `Edit Profile: ${this.editingProfile}`;
        } else {
            this._panel.title = 'Add SAP Profile';
        }

        webview.html = this._getHtmlForWebview(webview, existingProfile, existingPassword);
    }

    private _getHtmlForWebview(
        webview: vscode.Webview, 
        existingProfile?: SapProfile,
        existingPassword?: string
    ): string {
        const isEditing = !!existingProfile;
        const defaultProfile = this.configService.getDefaultProfile();
        const isCurrentDefault = existingProfile?.name === defaultProfile;

        // Icons (SVG)
        const iconServer = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>';
        const iconUser = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
        const iconPass = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
        const iconGlobe = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
        const iconFingerprint = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"></path><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"></path><path d="M8.63 7.17A2 2 0 0 1 9.71 5.5c.35-.15.74-.23 1.13-.23.39 0 .78.08 1.13.23 1.15.49 1.77 1.83 1.41 3a22.9 22.9 0 0 1-.34 2"></path><path d="M15.17 17.5c.5-1.5.83-4.5.83-7.5a9 9 0 0 0-.25-2"></path><path d="M18.8 14.5c-.32 1.34-1 4.5-2.8 5.5"></path></svg>';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${isEditing ? 'Edit' : 'Add'} SAP Profile</title>
    <style>
        :root {
            --primary: var(--vscode-button-background);
            --primary-hover: var(--vscode-button-hoverBackground);
            --text: var(--vscode-foreground);
            --text-secondary: var(--vscode-descriptionForeground);
            --bg: var(--vscode-editor-background);
            --card-bg: var(--vscode-sideBar-background);
            --border: var(--vscode-input-border);
            --input-bg: var(--vscode-input-background);
            --error: var(--vscode-errorForeground);
            --success: #4caf50;
        }

        * { box-sizing: border-box; transition: all 0.2s ease; }

        body {
            font-family: var(--vscode-font-family);
            background: var(--bg);
            color: var(--text);
            margin: 0;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow-y: auto;
            
            /* Professional Dot Grid Background */
            background-color: var(--bg);
            background-image: radial-gradient(var(--vscode-widget-border) 1px, transparent 1px);
            background-size: 20px 20px;
        }

        .container {
            width: 100%;
            max-width: 480px; /* Slightly narrower for modern look */
            background: var(--card-bg);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            padding: 40px;
            margin: 20px;
            position: relative;
            backdrop-filter: blur(10px); /* Glass effect */
            animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .header {
            text-align: center;
            margin-bottom: 35px;
        }

        .header h1 {
            font-size: 24px;
            font-weight: 300; /* Light elegant font */
            margin: 0 0 8px 0;
            letter-spacing: 0.5px;
        }

        .header p {
            color: var(--text-secondary);
            font-size: 13px;
            margin: 0;
        }

        /* Floating Label Styles */
        .input-group {
            position: relative;
            margin-bottom: 24px;
        }

        .input-field {
            width: 100%;
            background: transparent;
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 12px 14px 12px 42px; /* Left padding for icon */
            font-size: 14px;
            color: var(--text);
            outline: none;
            background: var(--input-bg);
        }

        .input-field:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.15);
        }

        .input-icon {
            position: absolute;
            left: 14px;
            top: 13px;
            color: var(--text-secondary);
            pointer-events: none;
        }

        .input-field:focus ~ .input-icon {
            color: var(--primary);
        }

        .floating-label {
            position: absolute;
            left: 42px;
            top: 12px;
            font-size: 14px;
            color: var(--text-secondary);
            pointer-events: none;
            transition: 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            background: var(--input-bg);
            padding: 0 4px;
        }

        /* Float up when focused or has value */
        .input-field:focus ~ .floating-label,
        .input-field:not(:placeholder-shown) ~ .floating-label {
            top: -9px;
            left: 10px;
            font-size: 11px;
            color: var(--primary);
            font-weight: 600;
        }

        /* Grid Layouts */
        .row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        
        .row-large {
             grid-template-columns: 2fr 1fr;
             gap: 16px;
        }

        /* Toggles */
        .toggles {
            display: flex;
            justify-content: space-between;
            margin-bottom: 30px;
            gap: 10px;
        }

        .toggle-btn {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px;
            border-radius: 6px;
            border: 1px solid var(--border);
            background: rgba(255,255,255,0.02);
            cursor: pointer;
            font-size: 12px;
            color: var(--text-secondary);
            user-select: none;
        }

        .toggle-btn:hover { background: rgba(255,255,255,0.05); }
        .toggle-btn.active {
            border-color: var(--primary);
            color: var(--primary);
            background: rgba(0, 120, 212, 0.08);
        }
        
        .toggle-btn input { display: none; }

        /* Buttons */
        .actions {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .btn {
            position: relative;
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            overflow: hidden;
        }

        .btn-primary {
            background: var(--primary);
            color: white;
            box-shadow: 0 4px 12px rgba(0, 120, 212, 0.3);
        }
        .btn-primary:hover {
            background: var(--primary-hover);
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(0, 120, 212, 0.4);
        }

        .btn-secondary {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text);
        }
        .btn-secondary:hover {
            background: rgba(255,255,255,0.05);
            border-color: var(--text-secondary);
        }

        .btn-danger {
            color: var(--error);
            background: transparent;
            opacity: 0.8;
            font-size: 12px;
        }
        .btn-danger:hover {
            text-decoration: underline;
            opacity: 1;
        }

        /* Loading Spinner inside Button */
        .btn-loader {
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top: 2px solid white;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            display: none;
        }
        .loading .btn-loader { display: block; }
        .loading .btn-text { display: none; }

        @keyframes spin { to { transform: rotate(360deg); } }

        /* Toast Notifications */
        .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .toast {
            background: var(--card-bg);
            border-left: 4px solid var(--primary);
            color: var(--text);
            padding: 14px 20px;
            border-radius: 4px;
            min-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 12px;
            transform: translateX(100%);
            opacity: 0;
            animation: slideIn 0.3s forwards;
        }

        .toast.success { border-color: var(--success); }
        .toast.error { border-color: var(--error); }
        .toast.closing { animation: slideOut 0.3s forwards; }

        @keyframes slideIn { to { transform: translateX(0); opacity: 1; } }
        @keyframes slideOut { to { transform: translateX(100%); opacity: 0; } }

    </style>
</head>
<body>
    <div class="toast-container" id="toastContainer"></div>

    <div class="container">
        <div class="header">
            <h1>${isEditing ? 'Edit Profile' : 'New Connection'}</h1>
            <p>${isEditing ? 'Updating connection details for ' + existingProfile?.name : 'Enter details to connect to an SAP system'}</p>
        </div>

        <form id="profileForm">
            <!-- ID (Name) -->
            <div class="input-group">
                <input type="text" id="name" class="input-field" placeholder=" " value="${existingProfile?.name || ''}" ${isEditing ? 'readonly' : ''} required>
                <div class="input-icon">${iconFingerprint}</div>
                <label for="name" class="floating-label">Profile Name / ID</label>
            </div>

            <!-- Server & Client Row -->
            <div class="row row-large">
                <div class="input-group">
                    <input type="text" id="server" class="input-field" placeholder=" " value="${existingProfile?.server || ''}" required>
                    <div class="input-icon">${iconGlobe}</div>
                    <label for="server" class="floating-label">Server URL</label>
                </div>
                <div class="input-group">
                    <input type="text" id="client" class="input-field" placeholder=" " maxlength="3" value="${existingProfile?.client || ''}" required>
                    <div class="input-icon">#</div>
                    <label for="client" class="floating-label">Client</label>
                </div>
            </div>

            <!-- User & Pass Row -->
            <div class="row">
                <div class="input-group">
                    <input type="text" id="user" class="input-field" placeholder=" " value="${existingProfile?.user || ''}" required>
                    <div class="input-icon">${iconUser}</div>
                    <label for="user" class="floating-label">Username</label>
                </div>
                <div class="input-group">
                    <input type="password" id="password" class="input-field" placeholder=" " value="${existingPassword || ''}" required>
                    <div class="input-icon">${iconPass}</div>
                    <label for="password" class="floating-label">Password</label>
                </div>
            </div>

            <!-- Toggles (Fancy Checkboxes) -->
            <div class="toggles">
                <label class="toggle-btn ${existingProfile?.useStrictSSL !== false ? 'active' : ''}" id="lblSSL">
                    <input type="checkbox" id="useStrictSSL" ${existingProfile?.useStrictSSL !== false ? 'checked' : ''}>
                    <span>🔒 Strict SSL</span>
                </label>
                <label class="toggle-btn ${isCurrentDefault || !isEditing ? 'active' : ''}" id="lblDefault">
                    <input type="checkbox" id="setAsDefault" ${isCurrentDefault || !isEditing ? 'checked' : ''}>
                    <span>⭐ Default</span>
                </label>
            </div>

            <!-- Action Buttons -->
            <div class="actions">
                <button type="submit" class="btn btn-primary" id="saveBtn">
                    <span class="btn-loader"></span>
                    <span class="btn-text">${isEditing ? 'Save Changes' : 'Create Connection'}</span>
                </button>
                
                <button type="button" class="btn btn-secondary" id="testBtn">
                    <span class="btn-loader"></span>
                    <span class="btn-text">Test Connection</span>
                </button>

                <div style="display: flex; justify-content: space-between; margin-top: 10px;">
                     <button type="button" class="btn btn-secondary" style="border:none; width:auto; font-size:12px; color:var(--text-secondary);" id="cancelBtn">Cancel</button>
                     ${isEditing ? '<button type="button" class="btn btn-danger" style="width:auto;" id="deleteBtn">Delete Profile</button>' : ''}
                </div>
            </div>
        </form>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // Toggle Visual Logic
        document.querySelectorAll('.toggle-btn input').forEach(input => {
            input.addEventListener('change', e => {
                e.target.parentElement.classList.toggle('active', e.target.checked);
            });
        });

        // Toast Logic
        function showToast(message, type = 'info') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.innerHTML = '<span>' + message + '</span>'; // can add icon here
            
            container.appendChild(toast);

            // Auto remove
            setTimeout(() => {
                toast.classList.add('closing');
                toast.addEventListener('animationend', () => toast.remove());
            }, 3000);
        }

        function setButtonLoading(id, isLoading) {
            const btn = document.getElementById(id);
            if (isLoading) btn.classList.add('loading');
            else btn.classList.remove('loading');
            btn.disabled = isLoading;
        }

        // Form Logic
        function getFormData() {
            return {
                name: document.getElementById('name').value.trim(),
                server: document.getElementById('server').value.trim(),
                client: document.getElementById('client').value.trim(),
                user: document.getElementById('user').value.trim(),
                password: document.getElementById('password').value,
                useStrictSSL: document.getElementById('useStrictSSL').checked,
                setAsDefault: document.getElementById('setAsDefault').checked
            };
        }

        function validate() {
            const data = getFormData();
            if (!data.name) { showToast('Profile Name is required', 'error'); return false; }
            if (!data.server) { showToast('Server URL is required', 'error'); return false; }
            try { new URL(data.server); } catch { showToast('Invalid Server URL', 'error'); return false; }
            if (!data.client || !/^\\d{3}$/.test(data.client)) { showToast('Client must be 3 digits (e.g. 100)', 'error'); return false; }
            if (!data.user) { showToast('Username is required', 'error'); return false; }
            if (!data.password) { showToast('Password is required', 'error'); return false; }
            return true;
        }

        document.getElementById('profileForm').addEventListener('submit', (e) => {
            e.preventDefault();
            if (validate()) {
                setButtonLoading('saveBtn', true);
                vscode.postMessage({ command: 'saveProfile', data: getFormData() });
            }
        });

        document.getElementById('testBtn').addEventListener('click', () => {
            if (validate()) {
                setButtonLoading('testBtn', true);
                vscode.postMessage({ command: 'testConnection', data: getFormData() });
            }
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        const deleteBtn = document.getElementById('deleteBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                vscode.postMessage({ 
                    command: 'deleteProfile', 
                    profileName: document.getElementById('name').value 
                });
            });
        }

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'testing':
                    showToast('Testing connection...', 'info');
                    break;
                case 'testResult':
                    setButtonLoading('testBtn', false);
                    showToast(message.message, message.success ? 'success' : 'error');
                    break;
                case 'error':
                    setButtonLoading('saveBtn', false);
                    showToast(message.message, 'error');
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    public dispose() {
        ProfileFormPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
