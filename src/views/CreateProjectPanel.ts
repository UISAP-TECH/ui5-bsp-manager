import * as vscode from 'vscode';
import { TemplateService, TemplateInfo, ProjectConfig, UI5Version } from '../services/TemplateService';

export class CreateProjectPanel {
    public static currentPanel: CreateProjectPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private templateService: TemplateService;

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.ViewColumn.One;

        if (CreateProjectPanel.currentPanel) {
            CreateProjectPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createProject',
            'Create SAPUI5 Project',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        CreateProjectPanel.currentPanel = new CreateProjectPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.templateService = new TemplateService(extensionUri);

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'getTemplates':
                        const templates = this.templateService.getTemplates();
                        this._panel.webview.postMessage({ command: 'templates', data: templates });
                        break;
                    case 'getUI5Versions':
                        try {
                            const versions = await this.templateService.getUI5Versions();
                            this._panel.webview.postMessage({ command: 'ui5Versions', data: versions });
                        } catch (error) {
                            this._panel.webview.postMessage({ command: 'error', message: `Failed to load UI5 versions: ${error}` });
                        }
                        break;
                    case 'selectFolder':
                        const folders = await vscode.window.showOpenDialog({
                            canSelectFolders: true,
                            canSelectFiles: false,
                            canSelectMany: false,
                            openLabel: 'Select Folder'
                        });
                        if (folders && folders.length > 0) {
                            this._panel.webview.postMessage({ command: 'folderSelected', path: folders[0].fsPath });
                        }
                        break;
                    case 'createProject':
                        await this._createProject(message.data);
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

    private async _createProject(config: ProjectConfig) {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Creating SAPUI5 Project',
                    cancellable: false
                },
                async (progress) => {
                    await this.templateService.generateProject(config, progress);
                }
            );

            this._panel.webview.postMessage({ command: 'created', success: true });
            
            const projectPath = vscode.Uri.file(`${config.targetPath}/${config.projectName}`);
            const action = await vscode.window.showInformationMessage(
                `Project "${config.projectName}" created successfully!`,
                'Open in Current Window',
                'Open in New Window'
            );

            if (action === 'Open in Current Window') {
                await vscode.commands.executeCommand('vscode.openFolder', projectPath, false);
            } else if (action === 'Open in New Window') {
                await vscode.commands.executeCommand('vscode.openFolder', projectPath, true);
            }

            this._panel.dispose();
        } catch (error) {
            this._panel.webview.postMessage({ command: 'error', message: `${error}` });
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        // Icons
        const iconFolder = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
        const iconCode = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
        const iconBox = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>';
        const iconServer = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>';
        const iconLayers = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create SAPUI5 Project</title>
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
            max-width: 520px;
            background: var(--card-bg);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            padding: 40px;
            margin: 20px;
            position: relative;
            backdrop-filter: blur(10px);
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
            font-weight: 300;
            margin: 0 0 8px 0;
            letter-spacing: 0.5px;
        }

        .header p {
            color: var(--text-secondary);
            font-size: 13px;
            margin: 0;
        }

        /* Step Indicator */
        .step-indicator {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-bottom: 30px;
        }

        .step-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--border);
            transition: all 0.3s;
        }

        .step-dot.active {
            background: var(--primary);
            transform: scale(1.2);
        }

        .step-dot.completed {
            background: var(--success);
        }

        /* Section */
        .section {
            display: none;
            animation: fadeIn 0.3s ease;
        }

        .section.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        /* Template Cards */
        .template-grid {
            display: grid;
            gap: 12px;
            margin-bottom: 20px;
        }

        .template-card {
            padding: 16px;
            border: 1px solid var(--border);
            border-radius: 8px;
            cursor: pointer;
            background: rgba(255,255,255,0.02);
            display: flex;
            align-items: flex-start;
            gap: 12px;
        }

        .template-card:hover {
            background: rgba(255,255,255,0.05);
            border-color: var(--text-secondary);
        }

        .template-card.selected {
            border-color: var(--primary);
            background: rgba(0, 120, 212, 0.08);
        }

        .template-icon {
            width: 40px;
            height: 40px;
            border-radius: 8px;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            flex-shrink: 0;
        }

        .template-info h3 {
            margin: 0 0 4px 0;
            font-size: 14px;
            font-weight: 600;
        }

        .template-info p {
            margin: 0;
            font-size: 12px;
            color: var(--text-secondary);
        }

        /* Input Group */
        .input-group {
            position: relative;
            margin-bottom: 20px;
        }

        .input-field {
            width: 100%;
            background: var(--input-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 12px 14px 12px 42px;
            font-size: 14px;
            color: var(--text);
            outline: none;
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

        .input-field:focus ~ .floating-label,
        .input-field:not(:placeholder-shown) ~ .floating-label {
            top: -9px;
            left: 10px;
            font-size: 11px;
            color: var(--primary);
            font-weight: 600;
        }

        textarea.input-field {
            padding-left: 14px;
            min-height: 60px;
            resize: vertical;
        }

        textarea.input-field ~ .floating-label {
            left: 14px;
        }

        textarea.input-field:focus ~ .floating-label,
        textarea.input-field:not(:placeholder-shown) ~ .floating-label {
            left: 10px;
        }

        /* Select Group */
        .select-group {
            position: relative;
            margin-bottom: 20px;
        }

        .select-field {
            width: 100%;
            background: var(--input-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 12px 14px 12px 42px;
            font-size: 14px;
            color: var(--text);
            outline: none;
            cursor: pointer;
            appearance: none;
        }

        .select-field:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.15);
        }

        .select-icon {
            position: absolute;
            left: 14px;
            top: 13px;
            color: var(--text-secondary);
            pointer-events: none;
        }

        .select-label {
            font-size: 12px;
            color: var(--text-secondary);
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        /* Service Type Buttons */
        .service-options {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 20px;
        }

        .service-btn {
            padding: 12px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: transparent;
            color: var(--text);
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            text-align: center;
        }

        .service-btn:hover {
            background: rgba(255,255,255,0.05);
        }

        .service-btn.selected {
            border-color: var(--primary);
            background: rgba(0, 120, 212, 0.08);
            color: var(--primary);
        }

        /* Folder Selection */
        .folder-select {
            display: flex;
            gap: 10px;
        }

        .folder-select .input-field {
            flex: 1;
        }

        .folder-btn {
            padding: 0 16px;
            background: var(--input-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
        }

        .folder-btn:hover {
            background: rgba(255,255,255,0.05);
            border-color: var(--primary);
        }

        /* Buttons */
        .actions {
            display: flex;
            gap: 12px;
            margin-top: 30px;
        }

        .btn {
            flex: 1;
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

        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
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

        /* Toast */
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
            <h1>Create SAPUI5 Project</h1>
            <p>Generate a new SAPUI5 application from template</p>
        </div>

        <div class="step-indicator">
            <div class="step-dot active" id="dot1"></div>
            <div class="step-dot" id="dot2"></div>
            <div class="step-dot" id="dot3"></div>
        </div>

        <!-- Step 1: Template Selection -->
        <div class="section active" id="step1">
            <div class="section-title">
                ${iconLayers}
                Select Template
            </div>
            <div class="template-grid" id="templateGrid">
                <div class="template-card" data-template="basic-app">
                    <div class="template-icon">${iconCode}</div>
                    <div class="template-info">
                        <h3>Basic Application</h3>
                        <p>Simple SAPUI5 app with routing & i18n</p>
                    </div>
                </div>
                <div class="template-card" data-template="sidebar-shellbar-app">
                    <div class="template-icon">${iconBox}</div>
                    <div class="template-info">
                        <h3>Sidebar Shellbar App</h3>
                        <p>Full-featured Fiori app with navigation</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Step 2: Project Details -->
        <div class="section" id="step2">
            <div class="section-title">
                ${iconFolder}
                Project Details
            </div>

            <div class="input-group">
                <input type="text" id="projectName" class="input-field" placeholder=" " pattern="^[a-z][a-z0-9-]*$">
                <div class="input-icon">${iconBox}</div>
                <label class="floating-label">Project Name</label>
            </div>

            <div class="input-group">
                <input type="text" id="namespace" class="input-field" placeholder=" " pattern="^[a-zA-Z][a-zA-Z0-9.]*$">
                <div class="input-icon">${iconCode}</div>
                <label class="floating-label">Namespace (e.g. com.company.app)</label>
            </div>

            <div class="input-group">
                <textarea id="description" class="input-field" placeholder=" " rows="2"></textarea>
                <label class="floating-label">Description (optional)</label>
            </div>
        </div>

        <!-- Step 3: Configuration -->
        <div class="section" id="step3">
            <div class="section-title">
                ${iconServer}
                Service Configuration
            </div>

            <div class="select-label">${iconServer} Service Type</div>
            <div class="service-options">
                <button type="button" class="service-btn selected" data-service="Rest">REST API</button>
                <button type="button" class="service-btn" data-service="ODataV2">OData V2</button>
                <button type="button" class="service-btn" data-service="ODataV4">OData V4</button>
            </div>

            <div class="select-group">
                <div class="select-label">${iconLayers} SAPUI5 Version</div>
                <select id="ui5Version" class="select-field">
                    <option value="">Loading versions...</option>
                </select>
            </div>

            <div class="select-label">${iconFolder} Target Location</div>
            <div class="folder-select">
                <input type="text" id="targetPath" class="input-field" placeholder="Select folder..." readonly style="padding-left: 14px;">
                <button type="button" class="folder-btn" id="browseBtn">
                    ${iconFolder} Browse
                </button>
            </div>
        </div>

        <div class="actions">
            <button type="button" class="btn btn-secondary" id="backBtn" style="display: none;">Back</button>
            <button type="button" class="btn btn-primary" id="nextBtn">
                <span class="btn-loader"></span>
                <span class="btn-text">Next</span>
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentStep = 1;
        let selectedTemplate = '';
        let selectedService = 'Rest';

        // Toast
        function showToast(message, type = 'info') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(() => {
                toast.classList.add('closing');
                toast.addEventListener('animationend', () => toast.remove());
            }, 3000);
        }

        // Step Navigation
        function updateStep(step) {
            currentStep = step;
            
            // Update dots
            for (let i = 1; i <= 3; i++) {
                const dot = document.getElementById('dot' + i);
                dot.classList.remove('active', 'completed');
                if (i < step) dot.classList.add('completed');
                if (i === step) dot.classList.add('active');
            }

            // Update sections
            document.querySelectorAll('.section').forEach((s, i) => {
                s.classList.toggle('active', i + 1 === step);
            });

            // Update buttons
            document.getElementById('backBtn').style.display = step > 1 ? 'flex' : 'none';
            
            const nextBtn = document.getElementById('nextBtn');
            if (step === 3) {
                nextBtn.querySelector('.btn-text').textContent = 'Create Project';
            } else {
                nextBtn.querySelector('.btn-text').textContent = 'Next';
            }
        }

        // Template Selection
        document.querySelectorAll('.template-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                selectedTemplate = card.dataset.template;
            });
        });

        // Service Type Selection
        document.querySelectorAll('.service-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.service-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedService = btn.dataset.service;
            });
        });

        // Browse Button
        document.getElementById('browseBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'selectFolder' });
        });

        // Navigation
        document.getElementById('backBtn').addEventListener('click', () => {
            if (currentStep > 1) updateStep(currentStep - 1);
        });

        document.getElementById('nextBtn').addEventListener('click', () => {
            if (currentStep === 1) {
                if (!selectedTemplate) {
                    showToast('Please select a template', 'error');
                    return;
                }
                updateStep(2);
            } else if (currentStep === 2) {
                const name = document.getElementById('projectName').value.trim();
                const ns = document.getElementById('namespace').value.trim();
                
                if (!name) { showToast('Project name is required', 'error'); return; }
                if (!/^[a-z][a-z0-9-]*$/.test(name)) { showToast('Project name must be lowercase, start with letter', 'error'); return; }
                if (!ns) { showToast('Namespace is required', 'error'); return; }
                if (!/^[a-zA-Z][a-zA-Z0-9.]*$/.test(ns)) { showToast('Invalid namespace format', 'error'); return; }
                
                updateStep(3);
                vscode.postMessage({ command: 'getUI5Versions' });
            } else if (currentStep === 3) {
                const targetPath = document.getElementById('targetPath').value;
                const ui5Version = document.getElementById('ui5Version').value;
                
                if (!targetPath) { showToast('Please select target folder', 'error'); return; }
                if (!ui5Version) { showToast('Please select UI5 version', 'error'); return; }

                const nextBtn = document.getElementById('nextBtn');
                nextBtn.classList.add('loading');
                nextBtn.disabled = true;

                vscode.postMessage({
                    command: 'createProject',
                    data: {
                        templateId: selectedTemplate,
                        projectName: document.getElementById('projectName').value.trim(),
                        namespace: document.getElementById('namespace').value.trim(),
                        description: document.getElementById('description').value.trim() || 'SAPUI5 Application',
                        serviceType: selectedService,
                        ui5Version: ui5Version,
                        targetPath: targetPath
                    }
                });
            }
        });

        // Messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'ui5Versions':
                    const select = document.getElementById('ui5Version');
                    select.innerHTML = message.data.map(v => 
                        '<option value="' + v.version + '">' + v.version + (v.maintained ? ' (LTS)' : '') + '</option>'
                    ).join('');
                    break;
                case 'folderSelected':
                    document.getElementById('targetPath').value = message.path;
                    break;
                case 'created':
                    showToast('Project created successfully!', 'success');
                    break;
                case 'error':
                    document.getElementById('nextBtn').classList.remove('loading');
                    document.getElementById('nextBtn').disabled = false;
                    showToast(message.message, 'error');
                    break;
            }
        });

        // Auto-select first template
        const firstTemplate = document.querySelector('.template-card');
        if (firstTemplate) {
            firstTemplate.click();
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        CreateProjectPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}
