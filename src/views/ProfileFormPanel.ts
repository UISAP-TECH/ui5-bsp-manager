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

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${isEditing ? 'Edit' : 'Add'} SAP Profile</title>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            max-width: 600px;
            margin: 0 auto;
        }
        h1 {
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .form-group {
            margin-bottom: 16px;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }
        input[type="text"],
        input[type="password"],
        input[type="number"] {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 14px;
        }
        input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .checkbox-group input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }
        .checkbox-group label {
            margin-bottom: 0;
            cursor: pointer;
        }
        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 24px;
        }
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        button:hover {
            opacity: 0.9;
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-danger {
            background-color: #d32f2f;
            color: white;
        }
        .btn-test {
            background-color: #388e3c;
            color: white;
        }
        .message {
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 16px;
        }
        .message.error {
            background-color: #d32f2f20;
            border: 1px solid #d32f2f;
            color: #ff6b6b;
        }
        .message.success {
            background-color: #388e3c20;
            border: 1px solid #388e3c;
            color: #81c784;
        }
        .message.info {
            background-color: #1976d220;
            border: 1px solid #1976d2;
            color: #64b5f6;
        }
        .hidden {
            display: none;
        }
        .required::after {
            content: ' *';
            color: #f44336;
        }
        .hint {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
    </style>
</head>
<body>
    <h1>${isEditing ? 'Edit' : 'Add'} SAP Profile</h1>
    
    <div id="messageBox" class="message hidden"></div>

    <form id="profileForm">
        <div class="form-group">
            <label for="name" class="required">Profile Name</label>
            <input type="text" id="name" placeholder="e.g., DEV, TEST, PROD" 
                   value="${existingProfile?.name || ''}" 
                   ${isEditing ? 'readonly' : ''}>
            <div class="hint">Unique identifier for this profile</div>
        </div>

        <div class="form-group">
            <label for="server" class="required">SAP Server URL</label>
            <input type="text" id="server" placeholder="http://sap-server:8000/" 
                   value="${existingProfile?.server || ''}">
            <div class="hint">Include protocol (http/https) and port</div>
        </div>

        <div class="form-group">
            <label for="client" class="required">SAP Client</label>
            <input type="text" id="client" placeholder="100" maxlength="3" 
                   value="${existingProfile?.client || ''}">
        </div>

        <div class="form-group">
            <label for="user" class="required">Username</label>
            <input type="text" id="user" placeholder="USERNAME" 
                   value="${existingProfile?.user || ''}">
        </div>

        <div class="form-group">
            <label for="password" class="required">Password</label>
            <input type="password" id="password" placeholder="••••••••" 
                   value="${existingPassword || ''}">
            <div class="hint">Stored securely in VS Code's secret storage</div>
        </div>

        <div class="form-group checkbox-group">
            <input type="checkbox" id="useStrictSSL" 
                   ${existingProfile?.useStrictSSL !== false ? 'checked' : ''}>
            <label for="useStrictSSL">Use Strict SSL</label>
        </div>
        <div class="hint" style="margin-top: -10px; margin-bottom: 16px;">
            Uncheck for self-signed certificates
        </div>

        <div class="form-group checkbox-group">
            <input type="checkbox" id="setAsDefault" ${isCurrentDefault || !isEditing ? 'checked' : ''}>
            <label for="setAsDefault">Set as default profile</label>
        </div>

        <div class="button-group">
            <button type="submit" class="btn-primary" id="saveBtn">
                ${isEditing ? '💾 Save Changes' : '➕ Add Profile'}
            </button>
            <button type="button" class="btn-test" id="testBtn">
                🔌 Test Connection
            </button>
            <button type="button" class="btn-secondary" id="cancelBtn">
                Cancel
            </button>
            ${isEditing ? `
            <button type="button" class="btn-danger" id="deleteBtn">
                🗑️ Delete
            </button>
            ` : ''}
        </div>
    </form>

    <script>
        const vscode = acquireVsCodeApi();

        function showMessage(text, type) {
            const box = document.getElementById('messageBox');
            box.textContent = text;
            box.className = 'message ' + type;
        }

        function hideMessage() {
            document.getElementById('messageBox').className = 'message hidden';
        }

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
            if (!data.name) {
                showMessage('Profile name is required', 'error');
                return false;
            }
            if (!data.server) {
                showMessage('Server URL is required', 'error');
                return false;
            }
            try {
                new URL(data.server);
            } catch {
                showMessage('Invalid server URL format', 'error');
                return false;
            }
            if (!data.client || !/^\\d{3}$/.test(data.client)) {
                showMessage('Client must be a 3-digit number', 'error');
                return false;
            }
            if (!data.user) {
                showMessage('Username is required', 'error');
                return false;
            }
            if (!data.password) {
                showMessage('Password is required', 'error');
                return false;
            }
            hideMessage();
            return true;
        }

        document.getElementById('profileForm').addEventListener('submit', (e) => {
            e.preventDefault();
            if (validate()) {
                document.getElementById('saveBtn').disabled = true;
                document.getElementById('saveBtn').textContent = 'Saving...';
                vscode.postMessage({ command: 'saveProfile', data: getFormData() });
            }
        });

        document.getElementById('testBtn').addEventListener('click', () => {
            if (validate()) {
                document.getElementById('testBtn').disabled = true;
                document.getElementById('testBtn').textContent = '⏳ Testing...';
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
                    showMessage('Testing connection...', 'info');
                    break;
                case 'testResult':
                    document.getElementById('testBtn').disabled = false;
                    document.getElementById('testBtn').textContent = '🔌 Test Connection';
                    showMessage(message.message, message.success ? 'success' : 'error');
                    break;
                case 'error':
                    document.getElementById('saveBtn').disabled = false;
                    document.getElementById('saveBtn').textContent = '${isEditing ? '💾 Save Changes' : '➕ Add Profile'}';
                    showMessage(message.message, 'error');
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
