import * as vscode from 'vscode';
import { ConfigService } from '../services/ConfigService';
import { SapProfile } from '../services/SapConnection';
import { DeployService } from '../services/DeployService';

export class DeployFormPanel {
    public static currentPanel: DeployFormPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private configService: ConfigService;
    private deployService: DeployService;

    public static createOrShow(
        extensionUri: vscode.Uri,
        configService: ConfigService,
        deployService: DeployService,
        initialPath?: string // New optional arg
    ) {
        const column = vscode.ViewColumn.One;

        if (DeployFormPanel.currentPanel) {
            DeployFormPanel.currentPanel._panel.reveal(column);
            DeployFormPanel.currentPanel.deployService = deployService;
            // Update initial path if provided to existing panel
            if (initialPath) DeployFormPanel.currentPanel._initialPath = initialPath;
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'deployForm',
            'Deploy to SAP BSP (Wizard)',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        DeployFormPanel.currentPanel = new DeployFormPanel(
            panel,
            extensionUri,
            configService,
            deployService,
            initialPath
        );
    }

    private _initialPath?: string;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        configService: ConfigService,
        deployService: DeployService,
        initialPath?: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.configService = configService;
        this.deployService = deployService;
        this._initialPath = initialPath;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(message => this._handleMessage(message), null, this._disposables);
    }

    private async _handleMessage(message: any) {
        switch (message.command) {
            case 'getUi5Version':
                const version = await this.deployService.getUi5Version(message.profile);
                this._panel.webview.postMessage({ command: 'setUi5Version', version });
                break;

            case 'checkApp':
                try {
                    // Update checkApp to pass profile
                    const result = await this.deployService.checkApplication(message.profile, message.appName);
                    this._panel.webview.postMessage({ 
                        command: 'checkAppResult', 
                        exists: result.exists,
                        package: result.package,
                        description: result.description,
                        transport: result.transport
                    });
                } catch (e) {
                    this._panel.webview.postMessage({ command: 'checkAppResult', error: true });
                }
                break;

            case 'checkNewApp':
                try {
                    // Use simpler check logic for new apps
                    const exists = await this.deployService.checkApplicationExists(message.profile, message.appName);
                    this._panel.webview.postMessage({ 
                        command: 'checkNewAppResult', 
                        exists: exists
                    });
                } catch (e) {
                    this._panel.webview.postMessage({ command: 'checkNewAppResult', exists: false, error: true });
                }
                break;

            case 'getPackages':
                // Fetch all packages for ComboBox
                try {
                    const pkgs = await this.deployService.searchPackages(message.profile, '');
                    this._panel.webview.postMessage({ command: 'setPackages', packages: pkgs });
                } catch (e) {
                    this._panel.webview.postMessage({ command: 'setPackages', packages: [] });
                }
                break;

            case 'getTransportRequests':
                const trs = await this.deployService.getTransportRequests(message.profile);
                this._panel.webview.postMessage({ command: 'setTransportRequests', requests: trs });
                break;

            case 'checkTransport':
                try {
                    const trResult = await this.deployService.checkTransportRequired(
                        message.profile,
                        message.package,
                        message.bspName
                    );
                    this._panel.webview.postMessage({ 
                        command: 'transportCheckResult', 
                        required: trResult.required,
                        requests: trResult.availableRequests
                    });
                } catch (e) {
                    // Fallback to just getting requests
                    const fallbackTrs = await this.deployService.getTransportRequests(message.profile);
                    this._panel.webview.postMessage({ 
                        command: 'transportCheckResult', 
                        required: true,
                        requests: fallbackTrs.map((r: any) => ({ trId: r.trId, description: r.description }))
                    });
                }
                break;

            case 'createTransport':
                try {
                    const newTrId = await this.deployService.createTransportRequest(
                        message.profile, 
                        message.description,
                        message.package,
                        message.bspName
                    );
                    this._panel.webview.postMessage({ command: 'createTransportResult', success: true, trId: newTrId, description: message.description });
                    vscode.window.showInformationMessage(`Transport Request ${newTrId} created successfully!`);
                } catch (e: any) {
                    this._panel.webview.postMessage({ command: 'createTransportResult', success: false, message: String(e.message || e) });
                    vscode.window.showErrorMessage(`Failed to create Transport Request: ${e.message || e}`);
                }
                break;

            case 'getBspApplications':
                 try {
                     const apps = await this.deployService.getBspApplications(message.profile);
                     this._panel.webview.postMessage({ command: 'setBspList', apps: apps });
                 } catch (e) {
                     this._panel.webview.postMessage({ command: 'setBspList', apps: [] });
                 }
                 break;

            case 'deploy':
                 // Final Deploy Step
                 let sourceDir = '';

                 if (this._initialPath) {
                     // Use stored path from context menu
                     const fs = require('fs');
                     const p = require('path');
                     let dir = this._initialPath;
                     try {
                        const stats = fs.statSync(this._initialPath);
                        if(stats.isFile()) dir = p.dirname(this._initialPath);
                     } catch(e) {}
                     
                     // Auto-detect 'dist' if in 'webapp' or root
                     const distPath = p.join(dir, 'dist');
                     const siblingDist = p.join(p.dirname(dir), 'dist');
                     
                     if (fs.existsSync(distPath)) {
                         sourceDir = distPath;
                     } else if (p.basename(dir) === 'webapp' && fs.existsSync(siblingDist)) {
                         sourceDir = siblingDist;
                     } else {
                         sourceDir = dir; // Fallback
                     }
                 } else {
                     const folderUri = await vscode.window.showOpenDialog({
                         canSelectFiles: false,
                         canSelectFolders: true,
                         canSelectMany: false,
                         openLabel: 'Select Dist Folder to Upload'
                     });

                     if (!folderUri || folderUri.length === 0) {
                         this._panel.webview.postMessage({ command: 'deployFinished', success: false, message: 'Cancelled' });
                         return;
                     }
                     sourceDir = folderUri[0].fsPath;
                 }

                 vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Deploying ${message.data.appName}...`,
                    cancellable: false
                }, async (progress) => {
                    try {
                        let transportId = message.data.transport;
                        
                        // Logic: If 'create' mode was selected, we need to create TR first
                        if (message.data.trOption === 'create') {
                            vscode.window.showInformationMessage(`Creating Transport Request: ${message.data.trDescription}...`);
                            transportId = await this.deployService.createTransportRequest(
                                message.data.profile, 
                                message.data.trDescription,
                                message.data.package,
                                message.data.appName
                            );
                            vscode.window.showInformationMessage(`Created Transport Request: ${transportId}`);
                        }
                        await this.deployService.deploy(
                            message.data.profile, 
                            {
                                bspName: message.data.appName,
                                package: message.data.package,
                                description: message.data.description,
                                transport: transportId, // Use the potentially new transportId
                                sourceDir: sourceDir
                            }, 
                            progress
                        );
                        vscode.window.showInformationMessage(`Successfully deployed ${message.data.appName}!`);
                        this._panel.webview.postMessage({ command: 'deployFinished', success: true });
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Deployment failed: ${error.message || error}`);
                        this._panel.webview.postMessage({ command: 'deployFinished', success: false, message: String(error.message || error) });
                    }
                });
                break;

            case 'cancel':
                this._panel.dispose();
                break;
        }
    }

    private _update() {
        const profiles = this.configService.getProfiles();
        const defaultProfile = this.configService.getDefaultProfile();
        this._panel.webview.html = this._getHtmlForWebview(profiles, defaultProfile);
    }

    public dispose() {
        DeployFormPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _getHtmlForWebview(profiles: SapProfile[], defaultProfileName: string | undefined): string {
        const profileOptions = profiles.map(p => 
            `<option value="${p.name}" ${p.name === defaultProfileName ? 'selected' : ''}>${p.name} (${p.server})</option>`
        ).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Deploy Wizard</title>
    <style>
        :root {
            --primary: #007acc;
            --primary-hover: #0062a3;
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-foreground);
            --card-bg: var(--vscode-sideBar-background);
            --border-color: var(--vscode-input-border);
            --input-bg: var(--vscode-input-background);
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            --glass-bg: rgba(255, 255, 255, 0.05);
            --glass-border: rgba(255, 255, 255, 0.1);
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            background-image: radial-gradient(var(--border-color) 1px, transparent 1px);
            background-size: 20px 20px;
            color: var(--text-color);
            padding: 0; margin: 0;
            display: flex; flex-direction: column; height: 100vh;
            overflow: hidden;
        }

        /* Container */
        .wizard-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            width: 100%;
            max-width: 900px;
            margin: 40px auto;
            background: var(--card-bg); /* Fallback */
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            border: 1px solid var(--glass-border);
            border-radius: 12px;
            box-shadow: var(--shadow);
            height: 80vh;
            min-height: 500px;
        }

        /* Header / Stepper */
        .wizard-header {
            padding: 20px;
            border-bottom: 1px solid var(--glass-border);
        }

        .stepper {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 40px;
            position: relative;
        }
        
        /* Line behind circles */
        .stepper::before {
            content: '';
            position: absolute;
            top: 15px;
            left: 60px;
            right: 60px;
            height: 2px;
            background: var(--border-color);
            z-index: 0;
        }

        .step {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
            z-index: 1;
            opacity: 0.6;
            transition: all 0.3s ease;
        }
        .step.active { opacity: 1; }
        .step.completed { opacity: 1; color: var(--primary); }

        .step-circle {
            width: 32px; height: 32px;
            border-radius: 50%;
            background: var(--card-bg); /* cover line */
            border: 2px solid var(--border-color);
            display: flex; justify-content: center; align-items: center;
            font-weight: 600;
            margin-bottom: 8px;
            font-size: 14px;
            transition: all 0.3s ease;
        }
        
        .step.active .step-circle { 
            border-color: var(--primary); 
            background: var(--primary); 
            color: white; 
            box-shadow: 0 0 10px rgba(0, 122, 204, 0.5);
        }
        .step.completed .step-circle { 
            background: var(--primary); 
            border-color: var(--primary); 
            color: white; 
        }

        .step-label { font-size: 12px; font-weight: 500; }

        /* Content */
        .content {
            flex: 1;
            padding: 30px 50px;
            overflow-y: auto;
            position: relative;
        }

        .step-content { 
            display: none; 
            animation: slideIn 0.3s ease-out; 
            height: 100%;
        }
        .step-content.active { display: flex; flex-direction: column; }
        
        @keyframes slideIn { 
            from { opacity: 0; transform: translateX(10px); } 
            to { opacity: 1; transform: translateX(0); } 
        }

        h2 { 
            font-weight: 500; 
            margin: 0 0 25px 0; 
            font-size: 24px;
            letter-spacing: -0.5px;
        }

        /* Form Controls */
        .form-group { margin-bottom: 25px; position: relative; }
        
        label { 
            display: block; 
            margin-bottom: 8px; 
            font-size: 12px; 
            font-weight: 600; 
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-color); opacity: 0.8;
        }
        
        .sub-label { font-size: 10px; opacity: 0.6; margin-left: 5px; text-transform: none; }

        input, select {
            width: 100%;
            padding: 12px 15px;
            background: rgba(0,0,0,0.1); /* Slightly darker than card */
            border: 1px solid var(--border-color);
            color: var(--text-color);
            border-radius: 6px;
            font-size: 14px;
            outline: none;
            transition: 0.2s;
            box-sizing: border-box;
        }
        
        input:focus, select:focus {
            border-color: var(--primary);
            background: rgba(0,0,0,0.2);
        }

        /* Deployment Mode Cards */
        .mode-selection { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px; }
        
        .mode-card {
            border: 1px solid var(--border-color);
            background: rgba(255,255,255,0.03);
            padding: 20px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex; align-items: flex-start; gap: 12px;
        }
        
        .mode-card:hover { border-color: var(--primary); transform: translateY(-2px); }
        .mode-card.selected { 
            border-color: var(--primary); 
            background: rgba(0, 122, 204, 0.1); 
            box-shadow: 0 4px 12px rgba(0, 122, 204, 0.15);
        }

        .mode-icon { font-size: 20px; margin-top: 2px; }
        .mode-title { font-weight: 600; margin-bottom: 5px; font-size: 15px; }
        .mode-desc { font-size: 12px; opacity: 0.7; line-height: 1.4; }

        /* Package Search */
        .pkg-input-group { display: flex; gap: 10px; }
        .dropdown-results {
            border: 1px solid var(--border-color);
            background: var(--card-bg);
            max-height: 150px; overflow-y: auto;
            border-radius: 6px; margin-top: 5px;
            display: none; position: absolute; width: 100%; z-index: 100;
        }
        .dropdown-item { padding: 10px; cursor: pointer; border-bottom: 1px solid var(--glass-border); font-size:13px; }
        .dropdown-item:hover { background: var(--primary); color: white; }

        /* Check App Status */
        .status-box {
            margin-top: 10px; padding: 10px; border-radius: 6px; font-size: 13px;
            display: none; align-items: center; gap: 8px;
        }
        .status-success { background: rgba(76, 175, 80, 0.15); color: #4caf50; border: 1px solid #4caf50; }
        .status-error { background: rgba(244, 67, 54, 0.15); color: #f44336; border: 1px solid #f44336; }

        /* Footer */
        .wizard-footer {
            padding: 20px 40px;
            border-top: 1px solid var(--glass-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .btn {
            padding: 10px 24px;
            border: none; border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: 0.2s;
            display: flex; align-items: center; gap: 8px;
        }
        .btn-primary { background: var(--primary); color: white; box-shadow: 0 4px 10px rgba(0, 122, 204, 0.3); }
        .btn-primary:hover { background: var(--primary-hover); transform: translateY(-1px); }
        
        .btn-secondary { background: transparent; border: 1px solid var(--border-color); color: var(--text-color); }
        .btn-secondary:hover { background: rgba(255,255,255,0.05); }
        
        .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

        /* Custom Select */
        .custom-select {
            position: relative;
            width: 100%;
        }

        .select-trigger {
            display: flex; justify-content: space-between; align-items: center;
            padding: 14px 15px;
            background: rgba(0,0,0,0.1);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 14px;
            font-weight: 500;
        }

        .select-trigger:hover {
            background: rgba(0, 122, 204, 0.05);
            border-color: var(--primary);
        }
        
        .select-trigger .arrow { font-size: 10px; opacity: 0.7; transition: transform 0.2s; }
        .custom-select.open .select-trigger .arrow { transform: rotate(180deg); }
        .custom-select.open .select-trigger { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2); }

        .select-options {
            position: absolute;
            top: 110%; left: 0; right: 0;
            background: var(--card-bg); /* Opaque fallback */
            background: rgba(30, 30, 30, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            z-index: 100;
            display: none;
            max-height: 200px;
            overflow-y: auto;
            box-shadow: 0 10px 20px rgba(0,0,0,0.3);
            animation: fadeInDown 0.2s ease;
        }
        
        .custom-select.open .select-options { display: block; }
        
        @keyframes fadeInDown { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }

        .option-item {
            padding: 12px 15px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            transition: background 0.1s;
        }
        .option-item:last-child { border-bottom: none; }
        .option-item:hover { background: var(--primary); color: white; }
        .option-item.selected { background: rgba(0, 122, 204, 0.2); color: var(--primary); font-weight: bold; }
        .option-item.disabled { opacity: 0.5; cursor: default; } .option-item.disabled:hover { background: transparent; }

        /* Summary */
        .summary-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
        }
        .summary-row { display: flex; justify-content: space-between; border-bottom: 1px solid var(--glass-border); padding: 12px 0; }
        .summary-row:last-child { border-bottom: none; }
        .sum-label { font-weight: 600; opacity: 0.7; font-size: 13px; }
        .sum-val { font-weight: 500; font-size: 14px; }

        /* Package ComboBox Styles */
        .package-combobox {
            position: relative;
            width: 100%;
        }
        .package-combobox input {
            width: 100%;
            padding-right: 30px;
        }
        .pkg-dropdown {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 0 0 8px 8px;
            max-height: 250px;
            overflow-y: auto;
            z-index: 100;
            box-shadow: 0 10px 20px rgba(0,0,0,0.3);
        }
        .package-combobox.open .pkg-dropdown {
            display: block;
        }
        .pkg-item {
            padding: 10px 15px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 13px;
        }
        .pkg-item:hover { background: var(--primary); color: white; }
        .pkg-item.selected { background: rgba(0, 122, 204, 0.2); }
        .pkg-loading {
            padding: 20px;
            text-align: center;
            opacity: 0.7;
            font-style: italic;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        .pkg-loading::before {
            content: '';
            width: 16px;
            height: 16px;
            border: 2px solid var(--text-color);
            border-bottom-color: transparent;
            border-radius: 50%;
            display: inline-block;
            box-sizing: border-box;
            animation: rotation 1s linear infinite;
        }

        @keyframes rotation {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Transport Request Radio Items */
        .tr-item {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s;
            background: rgba(0,0,0,0.1);
        }
        .tr-item:hover {
            border-color: var(--primary);
            background: rgba(0, 122, 204, 0.05);
        }
        .tr-item.selected {
            border-color: var(--primary);
            background: rgba(0, 122, 204, 0.1);
            box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
        }
        .tr-item input[type="radio"] {
            margin-right: 12px;
            accent-color: var(--primary);
        }
        .tr-id {
            font-weight: 600;
            font-family: monospace;
            font-size: 13px;
            margin-right: 10px;
            color: var(--primary);
        }
        .tr-desc {
            font-size: 13px;
            opacity: 0.8;
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* Error Message */
        .error-message {
            display: none;
            color: #f44336;
            font-size: 12px;
            margin-top: 6px;
            padding-left: 2px;
            animation: shake 0.3s ease;
        }
        .error-message.visible {
            display: block;
        }
        .form-group.has-error .select-trigger {
            border-color: #f44336 !important;
        }
        .form-group.has-error input {
            border-color: #f44336 !important;
        }
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }

        /* Spinner */
        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255,255,255,0.1);
            border-left-color: var(--primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px auto;
        }
        @keyframes spin {
            100% { transform: rotate(360deg); }
        }

        </style>
        <style>
        /* TR Mode Buttons - Legacy (can be removed if unused, but keeping simple) */
        
        /* TR Options - Card Style */
        .tr-option-group {
            margin-bottom: 20px;
            border: 1px solid var(--border-color);
            background: rgba(255,255,255,0.02);
            padding: 15px;
            border-radius: 8px;
            transition: all 0.2s ease;
            position: relative;
            cursor: pointer;
        }
        .tr-option-group:hover {
            background: rgba(255,255,255,0.04);
            border-color: rgba(255,255,255,0.2);
        }
        .tr-option-group.selected {
            border-color: var(--primary);
            background: rgba(0, 122, 204, 0.05); /* very subtle blue tint */
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        .tr-option-group.selected::before { /* Left accent line */
            content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
            background: var(--primary); border-radius: 8px 0 0 8px;
        }

        .group-header {
            margin-bottom: 12px;
        }
        .option-label {
            font-weight: 600;
            font-size: 14px;
            color: var(--text-color);
        }
        .group-hint {
            font-size: 11px; opacity: 0.6; margin-top: 2px;
        }
        
        .option-content {
            transition: opacity 0.2s;
            opacity: 0.7; /* Dim by default */
            pointer-events: none; /* Prevent interaction when not selected */
        }
        .tr-option-group.selected .option-content {
            opacity: 1;
            pointer-events: auto;
        }

        /* Table Styles for TR List */
        .tr-table {
            border: 1px solid var(--border-color);
            background: rgba(0,0,0,0.2);
            border-radius: 4px;
            max-height: 250px;
            overflow-y: auto;
        }
        .tr-table-header {
            display: flex;
            background: var(--card-bg); /* Opaque background to hide scrolling content */
            border-bottom: 1px solid var(--border-color);
            padding: 8px 10px;
            font-size: 11px;
            text-transform: uppercase;
            font-weight: bold;
            opacity: 0.9; /* Slightly less opaque text/border but background is solid */
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .tr-table-row {
            display: flex;
            padding: 10px 10px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 13px;
            cursor: pointer;
            align-items: center;
            transition: background 0.1s;
        }
        .tr-table-row:hover {
            background-color: rgba(255,255,255,0.05);
        }
        .tr-table-row.selected {
            background-color: rgba(0, 120, 212, 0.25); /* Stronger blue */
            border-left: 3px solid var(--primary);
        }
        /* Columns */
        .tr-col-id { width: 140px; font-weight:600; font-family: 'Consolas', monospace; color: var(--primary-light); }
        .tr-col-user { width: 100px; opacity:0.7; font-size:12px; }
        .tr-col-desc { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight:500; }
        .tr-status-icon { width: 20px; text-align:right; opacity:0; font-weight:bold; color: var(--primary); }
        .tr-table-row.selected .tr-status-icon::after { content: '✓'; opacity: 1; }
        
        /* Remove Old inputs */
        input[type="radio"] { display: none; }

        
        /* Modal Styles */
        .modal-overlay {
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); z-index: 2000;
            justify-content: center; align-items: flex-start;
            padding-top: 50px;
            backdrop-filter: blur(4px);
            animation: fadeIn 0.2s ease;
        }
        .modal-content {
            background: var(--card-bg); 
            border: 1px solid var(--border-color);
            width: 500px; max-width: 90%; max-height: 80vh;
            border-radius: 10px; display: flex; flex-direction: column;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            animation: slideUp 0.2s ease;
        }
        .modal-header {
            padding: 15px; border-bottom: 1px solid var(--border-color);
            font-weight: 600; font-size: 16px;
            display: flex; justify-content: space-between; align-items: center;
            background: rgba(255,255,255,0.02);
        }
        .close-modal { cursor: pointer; opacity: 0.7; font-size: 18px; }
        .close-modal:hover { opacity: 1; color: var(--primary); }
        .modal-body { padding: 0; overflow-y: auto; flex: 1; }
        .modal-loading { padding: 20px; text-align: center; opacity: 0.7; }
        
        .pkg-list-item {
            padding: 12px 15px; border-bottom: 1px solid rgba(255,255,255,0.05);
            cursor: pointer; transition: background 0.1s;
        }
        .pkg-list-item:hover { background: var(--primary); color: white; }
        .pkg-list-item strong { display: block; font-size: 14px; margin-bottom: 2px; }
        .pkg-list-item small { opacity: 0.8; font-size: 11px; display: block; }
        
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    </style>
</head>
<body>

    <div class="wizard-container">
        
        <!-- Header -->
        <div class="wizard-header">
            <div class="stepper">
                <div class="step active" id="step-ind-1">
                    <div class="step-circle">1</div>
                    <span class="step-label">Mode</span>
                </div>
                <div class="step" id="step-ind-2">
                    <div class="step-circle">2</div>
                    <span class="step-label">Details</span>
                </div>
                <div class="step" id="step-ind-3">
                    <div class="step-circle">3</div>
                    <span class="step-label">Transport</span>
                </div>
                <div class="step" id="step-ind-4">
                    <div class="step-circle">4</div>
                    <span class="step-label">Deploy</span>
                </div>
            </div>
        </div>

        <!-- Content -->
        <div class="content">
            
            <!-- STEP 1: Options -->
            <div class="step-content active" id="step-1">
                <h2>Deployment Configuration</h2>
                
                <div class="form-group">
                    <label>Target System <span style="color: #f44336;">*</span></label>
                    
                    <!-- Custom Select Component -->
                    <div class="custom-select" id="customProfileSelect">
                        <div class="select-trigger" id="profileTrigger">
                            <span id="profileTriggerText">Select a System...</span>
                            <span class="arrow">▼</span>
                        </div>
                        <div class="select-options" id="profileOptions">
                            ${profileOptions ? profileOptions.replace(/<option value="(.*?)".*?>(.*?)<\/option>/g, '<div class="option-item" data-value="$1">$2</div>') : '<div class="option-item disabled">No profiles found</div>'}
                        </div>
                    </div>
                    <input type="hidden" id="profileSelect" value="${defaultProfileName || ''}">
                    <div class="error-message" id="profileError">Target System is required</div>

                    <div style="margin-top:8px; font-size:11px; opacity:0.6; display:flex; align-items:center; gap:5px;">
                        <span id="ui5VerSpinner">ℹ️</span> SAPUI5 Version: <span id="ui5Version" style="font-weight:600;">-</span>
                    </div>
                </div>

                <div class="form-group" style="margin-top:30px;">
                    <label>What would you like to do?</label>
                    <div class="mode-selection">
                        <div class="mode-card selected" onclick="selectMode('new')">
                            <div class="mode-icon">🚀</div>
                            <div>
                                <div class="mode-title">New Application</div>
                                <div class="mode-desc">Deploy a fresh BSP application.</div>
                            </div>
                            <input type="radio" name="mode" value="new" checked style="display:none;">
                        </div>
                        <div class="mode-card" onclick="selectMode('update')">
                            <div class="mode-icon">🔄</div>
                            <div>
                                <div class="mode-title">Update Existing</div>
                                <div class="mode-desc">Overwrite an existing application.</div>
                            </div>
                            <input type="radio" name="mode" value="update" style="display:none;">
                        </div>
                    </div>
                </div>
            </div>

            <!-- STEP 2: Application -->
            <div class="step-content" id="step-2">
                <h2 id="step2Title">Application Details</h2>
                
                <!-- Update Mode UI -->
                <div id="updateAppUI" style="display:none;">
                    
                    <!-- 1. Status Info (Top - for Locked message) -->
                    <div id="detectedInfo" class="summary-card" style="display:none; margin-bottom:15px; border:none; background:transparent; padding:0;">
                            <div id="infoMsg" style="font-size:13px; font-weight:500; color:#4fc3f7;"></div> 
                    </div>

                    <!-- 2. Application Name (Read Only) -->
                    <div class="form-group">
                        <label>Application Name <span style="color: #f44336;">*</span></label>
                        <div class="pkg-input-group">
                            <input type="text" id="existingAppName" placeholder="" readonly 
                                    style="text-transform:uppercase; font-weight:bold; letter-spacing:1px; background:rgba(255,255,255,0.05); color:var(--text-color); opacity:0.75; cursor:not-allowed;">
                            <!-- Hidden Check Button - Triggered by row selection -->
                            <button class="btn btn-secondary" id="btnCheckApp" style="display:none;">Check</button> 
                        </div>
                        <div class="error-message" id="existingAppError">Please select an application from the list</div>
                        <!-- Helper text for description -->
                        <div id="infoDesc" style="font-size:11px; opacity:0.6; margin-top:4px; font-style:italic; min-height:16px;"></div>
                    </div>

                    <!-- 3. Search Bar -->
                    <div class="search-bar-container" style="position:relative; margin-bottom:0px; margin-top:20px;">
                        <input type="text" id="bspAppSearch" placeholder="BSP Application Name" autocomplete="off" 
                                style="width:100%; padding:10px 10px 10px 35px; border-radius:6px 6px 0 0; border-bottom:none; background:rgba(255,255,255,0.02);">
                        <span style="position:absolute; left:12px; top:10px; opacity:0.5;">🔍</span>
                        <!-- Clear Button -->
                        <span id="btnClearSearch" style="position:absolute; right:12px; top:10px; opacity:0.5; cursor:pointer; font-weight:bold; display:none;">✕</span>
                    </div>

                    <!-- 4. Application Table -->
                    <div class="bsp-table-container" style="border:1px solid var(--border-color); border-radius:0 0 6px 6px; height:300px; overflow-y:auto; background:rgba(0,0,0,0.2);">
                        <div class="bsp-table-header" style="display:flex; background:var(--card-bg); padding:8px 10px; font-size:11px; font-weight:bold; opacity:1; border-bottom:1px solid var(--border-color); position:sticky; top:0; z-index:10;">
                            <div style="width:200px;">Name</div>
                            <div style="flex:1;">Description</div>
                        </div>
                        <div id="bspListContent">
                            <div class="pkg-loading">Waiting for system connection...</div>
                        </div>
                    </div>
                
                    <!-- Status Helper (Hidden) -->
                    <div id="checkStatus" class="status-box" style="margin-top:10px; display:none;"></div>
                </div>

                <!-- New Mode UI -->
                <div id="newAppUI">
                    <div class="form-group">
                        <label>Application Name <span style="color: #f44336;">*</span> <span class="sub-label">(Max 15 chars, must start with Z)</span></label>
                        <input type="text" id="newAppName" maxlength="15" placeholder="ZMY_APP" style="text-transform:uppercase; font-weight:bold; letter-spacing:1px;">
                        <div class="error-message" id="newAppNameError">Application Name is required</div>
                    </div>

                    <div class="form-group">
                        <label>Description <span style="color: #f44336;">*</span></label>
                        <input type="text" id="newAppDesc" placeholder="e.g., HR Dashboard App">
                        <div class="error-message" id="newAppDescError">Description is required</div>
                    </div>
                    
                    <div class="form-group">
                        <label>ABAP Package <span style="color: #f44336;">*</span></label>
                        <div class="package-combobox" id="pkgCombobox">
                            <input type="text" id="newAppPkg" placeholder="Search or select package..." autocomplete="off" style="text-transform:uppercase;">
                            <div class="pkg-dropdown" id="pkgDropdown">
                                <div class="pkg-loading">Loading packages...</div>
                            </div>
                            
                        </div>
                        <div class="error-message" id="newAppPkgError">ABAP Package is required</div>
                        <div style="font-size:10px; opacity:0.6; margin-top:4px;">Use $TMP for Local Objects (No transport needed).</div>
                    </div>
                </div>
            </div>

            <!-- STEP 3: Transport -->
            <div class="step-content" id="step-3">
                <h2>Select a Transport Request</h2>
                <div style="font-size:13px; opacity:0.7; margin-bottom:20px;">Provide a transport for the application</div>
                
                <!-- Loading indicator -->
                <div id="trLoading" style="text-align:center; padding:60px 20px;">
                    <div class="spinner"></div>
                    <div style="opacity:0.7;">Checking transport requirements...</div>
                </div>
                
                <!-- TR Section (shown after transport check) -->
                <div id="trSection" style="display:none;">
                    
                    <!-- OPTION 1: Choose from requests -->
                    <div class="tr-option-group" id="group-list" onclick="selectTrOption('list')">
                        <input type="radio" name="trOption" value="list" id="radioList" style="display:none;">
                        <div class="group-header">
                            <div class="option-label">Choose from existing requests</div>
                            <div class="group-hint">Select a request from your history</div>
                        </div>
                        
                        <div id="trOptionListContent" class="option-content">
                            <div class="form-group" style="padding:0;">
                                <input type="text" id="trFilter" placeholder="Filter requests..." oninput="filterTrList(this.value)" style="width:100%; margin-bottom:5px; padding:8px; border-radius:4px; border:1px solid var(--border-color); background:rgba(0,0,0,0.2); color:var(--text-color);">
                                <div class="error-message" id="trSelectError" style="margin-bottom:10px; margin-top:0;">Please select a request from the list</div>

                                <div class="tr-table">
                                    <div class="tr-table-header">
                                        <div class="tr-col-id">Request</div>
                                        <div class="tr-col-user">User</div>
                                        <div class="tr-col-desc">Description</div>
                                    </div>
                                    <div id="trList" class="tr-table-body">
                                        <!-- Rows injected by JS -->
                                    </div>
                                    <div id="noTrWarning" style="padding:40px; text-align:center; display:none; opacity:0.6;">
                                        No open transport requests found.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style="display:flex; gap:20px;">
                        <!-- OPTION 2: Create a new request -->
                        <div class="tr-option-group" id="group-create" style="flex:1;" onclick="selectTrOption('create')">
                            <input type="radio" name="trOption" value="create" id="radioCreate" style="display:none;">
                             <div class="group-header">
                                <div class="option-label">Create New Request</div>
                            </div>
                            
                            <div id="trOptionCreateContent" class="option-content">
                                <div class="form-group" style="padding:0;">
                                    <input type="text" id="newTrDesc" placeholder="Enter description for new request..." style="width:100%; margin-bottom:5px; padding:10px; border-radius:4px; border:1px solid var(--border-color); background:rgba(0,0,0,0.2); color:var(--text-color);">
                                    <div class="error-message" id="newTrDescError">Description is required</div>
                                    
                                    <div style="font-size:11px; opacity:0.5; margin-top:5px;">
                                        Generated automatically on deploy.
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- OPTION 3: Enter a request number -->
                        <div class="tr-option-group" id="group-manual" style="flex:1;" onclick="selectTrOption('manual')">
                             <input type="radio" name="trOption" value="manual" id="radioManual" style="display:none;">
                             <div class="group-header">
                                <div class="option-label">Manual Entry</div>
                            </div>
                            
                            <div id="trOptionManualContent" class="option-content">
                                <div class="form-group" style="padding:0;">
                                    <input type="text" id="manualTr" placeholder="DEVK900..." style="text-transform:uppercase; width:100%; padding:10px; border-radius:4px; border:1px solid var(--border-color); background:rgba(0,0,0,0.2); color:var(--text-color);">
                                    <div style="font-size:11px; opacity:0.5; margin-top:5px;">
                                        Enter existing Request ID directly.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                </div>
                
                <!-- Local Object Message -->
                <div class="status-box status-success" id="localObjMsg" style="display:none; text-align:center; justify-content:center;">
                    ✓ Local Object ($TMP) selected. No Transport Request required.
                </div>

            </div>

            <!-- STEP 4: Confirmation -->
            <div class="step-content" id="step-4">
                <h2>Ready to Deploy</h2>
                <p style="opacity:0.7; margin-bottom:20px;">Please review your configuration before proceeding.</p>
                
                <div class="summary-card">
                    <div class="summary-row">
                        <span class="sum-label">System</span>
                        <span class="sum-val" id="sumProfile"></span>
                    </div>
                    <div class="summary-row">
                        <span class="sum-label">Mode</span>
                        <span class="sum-val" id="sumMode"></span>
                    </div>
                    <div class="summary-row">
                        <span class="sum-label">Application</span>
                        <span class="sum-val" id="sumApp"></span>
                    </div>
                     <div class="summary-row">
                        <span class="sum-label">Package</span>
                        <span class="sum-val" id="sumPkg"></span>
                    </div>
                    <div class="summary-row">
                        <span class="sum-label">Transport</span>
                        <span class="sum-val" id="sumTr"></span>
                    </div>
                </div>
            </div>

        </div>

        <!-- Footer -->
        <div class="wizard-footer">
            <button class="btn btn-secondary" id="btnBack" onclick="goBack()" disabled>Back</button>
            <button class="btn btn-primary" id="btnNext" onclick="goNext()">Next ➔</button>
        </div>
    </div>

    <!-- MODAL for Package Selection -->
    <div class="modal-overlay" id="packageModal">
        <div class="modal-content">
            <div class="modal-header">
                <span id="modalTitle">Package Contents</span>
                <span class="close-modal" id="closeModal">✕</span>
            </div>
            <div class="modal-body" id="modalList">
                <div class="modal-loading">Waiting for input...</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentStep = 1;
        let wizardData = {
            profile: '',
            mode: 'new', // new | update
            appName: '',
            description: '',
            package: '',
            transport: '',
            trOption: '',
            trDescription: '',
            skippedStep3: false,
            isLocked: false
        };
        let availableTrs = [];

        // --- Step Logic ---

        function showStep(step) {
            document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.step').forEach(el => el.classList.remove('active', 'completed'));
            
            document.getElementById('step-' + step).classList.add('active');
            document.getElementById('step-ind-' + step).classList.add('active');
            
            // Mark previous as completed
            for(let i=1; i < step; i++) {
                document.getElementById('step-ind-' + i).classList.add('completed');
            }

            document.getElementById('btnBack').disabled = step === 1;
            document.getElementById('btnNext').innerText = step === 4 ? 'Deploy Now 🚀' : 'Next ➔';
            
            currentStep = step;
        }

        async function goNext() {
            if (!validateStep(currentStep)) return;

            if (currentStep === 1) {
                // Prepare Step 2 UI
                wizardData.profile = document.getElementById('profileSelect').value;
                const mode = document.querySelector('input[name="mode"]:checked').value;
                wizardData.mode = mode;
                
                document.getElementById('newAppUI').style.display = mode === 'new' ? 'block' : 'none';
                document.getElementById('updateAppUI').style.display = mode === 'update' ? 'block' : 'none';

                if (mode === 'update') {
                     // Check if list is loaded or needs refresh
                     // Trigger load
                     document.getElementById('bspListContent').innerHTML = '<div class="pkg-loading">Loading applications...</div>';
                     vscode.postMessage({ command: 'getBspApplications', profile: wizardData.profile });
                }
            }

            if (currentStep === 2) {
                // Capture App Data
                if (wizardData.mode === 'new') {
                    checkNewAppAndProceed();
                    return;
                } else {
                    wizardData.appName = document.getElementById('existingAppName').value.toUpperCase();
                }

                // Check if $TMP - skip Step 3 entirely
                if (wizardData.package === '$TMP') {
                    wizardData.transport = '';
                    wizardData.skippedStep3 = true;
                    prepareSummary();
                    showStep(4);
                    return;
                }
                
                // SKIPPING LOGIC: If app is already locked by a transport, skip step 3
                if(wizardData.isLocked && wizardData.transport) {
                    wizardData.skippedStep3 = true;
                    prepareSummary();
                    showStep(4);
                    return;
                }
                
                // Reset flag if not skipping
                wizardData.skippedStep3 = false;

                // Show loading and request transport check
                document.getElementById('trLoading').style.display = 'block';
                document.getElementById('trSection').style.display = 'none';
                document.getElementById('noTrWarning').style.display = 'none';
                document.getElementById('localObjMsg').style.display = 'none';
                
                // Request transport check from backend
                vscode.postMessage({ 
                    command: 'checkTransport', 
                    profile: wizardData.profile,
                    package: wizardData.package,
                    bspName: wizardData.appName
                });
            }
            
            if (currentStep === 3) {
                // Capture TR based on active option
                const trOption = document.querySelector('input[name="trOption"]:checked').value;
                wizardData.trOption = trOption; // Store mode for summary/deploy

                let finalTr = '';
                
                if (trOption === 'manual') {
                     finalTr = document.getElementById('manualTr').value.toUpperCase();
                } else if (trOption === 'list') {
                     // Get selected row from list instead of radio
                     const selectedRow = document.querySelector('.tr-table-row.selected');
                     finalTr = selectedRow ? selectedRow.dataset.id : '';
                     
                     // Capture Description for Summary
                     if(selectedRow) {
                         const descEl = selectedRow.querySelector('.tr-col-desc');
                         if(descEl) wizardData.trDescription = descEl.innerText;
                     }
                } else if (trOption === 'create') {
                     finalTr = 'will_create';
                     wizardData.trDescription = document.getElementById('newTrDesc').value;
                }
                
                wizardData.transport = finalTr;
                
                // Prepare Step 4 (Summary)
                prepareSummary();
            }

            if (currentStep === 4) {
                 vscode.postMessage({ command: 'deploy', data: wizardData });
                 return;
            }

            showStep(currentStep + 1);
        }
        
        function prepareSummary() {
            document.getElementById('sumProfile').innerText = wizardData.profile;
            document.getElementById('sumMode').innerText = wizardData.mode === 'new' ? 'New Application' : 'Update Existing';
            document.getElementById('sumApp').innerText = wizardData.appName;
            document.getElementById('sumPkg').innerText = wizardData.package;
            
            if (wizardData.package === '$TMP') {
                document.getElementById('sumTr').innerText = 'Local Object ($TMP)';
                document.getElementById('sumTr').style.opacity = '0.7';
                document.getElementById('sumTr').style.color = '';
            } else {
                if (wizardData.transport === 'will_create') {
                    document.getElementById('sumTr').innerText = \`New Request (\${wizardData.trDescription})\`;
                    document.getElementById('sumTr').style.opacity = '1';
                    document.getElementById('sumTr').style.color = '#2196F3'; // Info blue
                } else {

                    const descText = wizardData.trDescription ? ' (' + wizardData.trDescription + ')' : '';
                    document.getElementById('sumTr').innerText = (wizardData.transport || 'Not Selected!') + descText;
                    
                    document.getElementById('sumTr').style.opacity = '1';
                    if (!wizardData.transport) {
                        document.getElementById('sumTr').style.color = '#f44336';
                    } else {
                        document.getElementById('sumTr').style.color = '';
                    }
                }
            }
        }

        function goBack() {
            if (currentStep === 4 && wizardData.skippedStep3) {
                showStep(2);
                return;
            }
            if (currentStep > 1) showStep(currentStep - 1);
        }

        function validateStep(step) {
            // Clear previous errors
            document.querySelectorAll('.error-message').forEach(el => el.classList.remove('visible'));
            document.querySelectorAll('.form-group').forEach(el => el.classList.remove('has-error'));

            if (step === 1) {
                if (!document.getElementById('profileSelect').value) {
                    const errorEl = document.getElementById('profileError');
                    const formGroup = errorEl.closest('.form-group');
                    errorEl.classList.add('visible');
                    if (formGroup) formGroup.classList.add('has-error');
                    return false;
                }
            }
            if (step === 2) {
                let hasError = false;
                
                if (wizardData.mode === 'new') {
                    // Application Name
                    const appNameVal = document.getElementById('newAppName').value.toUpperCase();
                    if (!appNameVal) {
                        const errorEl = document.getElementById('newAppNameError');
                        errorEl.innerText = 'Application Name is required';
                        const formGroup = errorEl.closest('.form-group');
                        errorEl.classList.add('visible');
                        if (formGroup) formGroup.classList.add('has-error');
                        hasError = true;
                    } else if (!appNameVal.startsWith('Z')) {
                        const errorEl = document.getElementById('newAppNameError');
                        errorEl.innerText = 'Application Name must start with Z';
                        const formGroup = errorEl.closest('.form-group');
                        errorEl.classList.add('visible');
                        if (formGroup) formGroup.classList.add('has-error');
                        hasError = true;
                    }
                    // Description
                    if (!document.getElementById('newAppDesc').value) {
                        const errorEl = document.getElementById('newAppDescError');
                        const formGroup = errorEl.closest('.form-group');
                        errorEl.classList.add('visible');
                        if (formGroup) formGroup.classList.add('has-error');
                        hasError = true;
                    }
                    // Package - must be from the list
                    const pkgVal = document.getElementById('newAppPkg').value.toUpperCase();
                    if (!pkgVal) {
                        const errorEl = document.getElementById('newAppPkgError');
                        errorEl.innerText = 'ABAP Package is required';
                        const formGroup = errorEl.closest('.form-group');
                        errorEl.classList.add('visible');
                        if (formGroup) formGroup.classList.add('has-error');
                        hasError = true;
                    } else if (!allPackages.some(p => p.label === pkgVal)) {
                        const errorEl = document.getElementById('newAppPkgError');
                        errorEl.innerText = 'Please select a valid package from the list';
                        const formGroup = errorEl.closest('.form-group');
                        errorEl.classList.add('visible');
                        if (formGroup) formGroup.classList.add('has-error');
                        hasError = true;
                    }
                } else {
                    // Update mode - Existing Application Name
                    if (!document.getElementById('existingAppName').value) {
                        const errorEl = document.getElementById('existingAppError');
                        const formGroup = errorEl.closest('.form-group');
                        errorEl.classList.add('visible');
                        if (formGroup) formGroup.classList.add('has-error');
                        hasError = true;
                    }
                }
                
                if (hasError) return false;
            }
            
            // Step 3: Transport Request validation
            if (step === 3) {
                // Skip validation if $TMP (shouldn't reach here, but safety)
                if (wizardData.package === '$TMP') return true;
                
                const trOption = document.querySelector('input[name="trOption"]:checked').value;
                
                if (trOption === 'manual') {
                    const manual = document.getElementById('manualTr').value.trim();
                    if (!manual) {
                         // Show inline error for manual input
                         // We need an error element for manualTr if not exists, 
                         // or reuse trSelectError but positioning might be off.
                         // Let's assume we can add one or reuse general error.
                         // Actually, let's use trSelectError but update text
                         const err = document.getElementById('trSelectError');
                         err.innerText = "Please enter a Request Number";
                         err.style.marginTop = "5px"; 
                         // Ensure it's visible in the right place? 
                         // Since options are toggled, trSelectError is inside Option 1 usually.
                         // We should probably add specific error divs for each option in HTML if we want perfect placement,
                         // OR move trSelectError outside or duplicate it.
                         // Given previous HTML structure, let's look at option 3 HTML.
                         
                         // Option 3 HTML (Manual) didn't have specific error div in previous chunk.
                         // Let's add one dynamically if missing or relies on generic.
                         
                         // Better approach for now: Use the generic visual validation 
                         // and perhaps a specific error div if we can edit HTML too.
                         // But for this chunk, let's try to find an error div near manualTr.
                         
                         let manualErr = document.getElementById('manualTrError');
                         if(!manualErr) {
                             // Create if not exists (hacky but works without HTML edit)
                             manualErr = document.createElement('div');
                             manualErr.id = 'manualTrError';
                             manualErr.className = 'error-message';
                             manualErr.innerText = 'Request Number is required';
                             document.getElementById('manualTr').parentNode.appendChild(manualErr);
                         }
                         manualErr.classList.add('visible');
                         return false;
                    }
                } else if (trOption === 'create') {
                     const desc = document.getElementById('newTrDesc').value.trim();
                     if(!desc) {
                         const err = document.getElementById('newTrDescError');
                         err.classList.add('visible');
                         return false;
                     }
                } else {
                    // List mode logic (class based)
                    const selectedRow = document.querySelector('.tr-table-row.selected');
                    if (!selectedRow) {
                         const err = document.getElementById('trSelectError');
                         err.innerText = "Please select a request from the list";
                         err.classList.add('visible');
                         return false;
                    }
                }
            }
            
            return true;
        }

        // --- UI Interactions ---

        // Custom Select Logic
        const profileTrigger = document.getElementById('profileTrigger');
        const profileOptions = document.getElementById('profileOptions');
        const customSelect = document.getElementById('customProfileSelect');
        const hiddenInput = document.getElementById('profileSelect');
        const triggerText = document.getElementById('profileTriggerText');

        profileTrigger.addEventListener('click', () => {
             customSelect.classList.toggle('open');
        });

        // Click outside to close
        document.addEventListener('click', (e) => {
            if (!customSelect.contains(e.target)) {
                customSelect.classList.remove('open');
            }
        });

        // Option Click
        document.querySelectorAll('.option-item').forEach(item => {
            if (item.classList.contains('disabled')) return;
            
            // Set initial selected visual state if matches value
            if (item.dataset.value === hiddenInput.value) {
                item.classList.add('selected');
                triggerText.innerText = item.innerText;
                // Trigger check immediately if default present
                checkVer(item.dataset.value);
            }

            item.addEventListener('click', () => {
                // Update Value
                hiddenInput.value = item.dataset.value;
                triggerText.innerText = item.innerText;
                
                // Visual Update
                document.querySelectorAll('.option-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                
                customSelect.classList.remove('open');
                
                // Clear error when selection is made
                clearError('profileError');
                
                // Check Version
                checkVer(item.dataset.value);
            });
        });

        // Helper function to clear error
        function clearError(errorId) {
            const errorEl = document.getElementById(errorId);
            if (errorEl) {
                errorEl.classList.remove('visible');
                const formGroup = errorEl.closest('.form-group');
                if (formGroup) formGroup.classList.remove('has-error');
            }
        }

        // Clear errors on input for Step 2 fields
        document.getElementById('newAppName').addEventListener('input', () => clearError('newAppNameError'));
        document.getElementById('newAppDesc').addEventListener('input', () => clearError('newAppDescError'));
        document.getElementById('newAppPkg').addEventListener('input', () => clearError('newAppPkgError'));
        document.getElementById('existingAppName').addEventListener('input', () => clearError('existingAppError'));
        
        // Clear errors on input for Step 3 manual TR field
        // Clear errors on input for Step 3 manual TR field
        document.getElementById('manualTr').addEventListener('input', () => {
             const err = document.getElementById('manualTrError');
             if(err) err.classList.remove('visible');
             // Also clear generic if used
             clearError('trSelectError'); 
        });

        // TR item selection handler (for visual feedback in table)
        function selectTrRow(el) {
            // Check if already selected
            const isSelected = el.classList.contains('selected');
            
            // Clear all
            document.querySelectorAll('.tr-table-row').forEach(item => item.classList.remove('selected'));
            
            // Toggle
            if (!isSelected) {
                el.classList.add('selected');
                // Select list option automatically if a row is clicked
                selectTrOption('list');
            } else {
                // Deselecting - no op or maybe clear selection?
                // User said "geri kaldırmak isteyince kaldırıramıyorum"
                // So now we start with cleared state.
            }
        }
        
        // TR Option Switching (Main Cards)
        function selectTrOption(option) {
            // Update invisible radio checked state
            const radio = document.querySelector(\`input[name="trOption"][value="\${option}"]\`);
            if(radio) radio.checked = true;

            // Highlight selected group, unhighlight others
            document.querySelectorAll('.tr-option-group').forEach(el => el.classList.remove('selected'));
            
            const group = document.getElementById('group-' + option);
            if(group) group.classList.add('selected');
            
            // Visual feedback focus
            if(option === 'list') {
                 // maybe focus filter?
            } else if(option === 'create') {
                document.getElementById('newTrDesc').focus();
            } else if (option === 'manual') {
                document.getElementById('manualTr').focus();
            }
        }
        
        // Filter TR List
        function filterTrList(val) {
            const filter = val.toUpperCase();
            const rows = document.querySelectorAll('.tr-table-row');
            rows.forEach(row => {
                const text = row.innerText.toUpperCase();
                row.style.display = text.includes(filter) ? 'flex' : 'none';
            });
        }
        
        // Create TR Action
        function createTr() {
            const desc = document.getElementById('newTrDesc').value;
            if (!desc) {
                const err = document.getElementById('newTrDescError');
                err.classList.add('visible');
                return;
            }
            
            const btn = document.getElementById('btnDoCreate');
            btn.innerText = 'Creating...';
            btn.disabled = true;
            
            vscode.postMessage({ 
                command: 'createTransport', 
                profile: wizardData.profile,
                description: desc,
                package: wizardData.package,
                bspName: wizardData.bspName || (wizardData.mode === 'new' ? document.getElementById('newAppName').value : document.getElementById('existingAppName').value)
            });
        }
        
        document.getElementById('newTrDesc').addEventListener('input', () => clearError('newTrDescError'));

        function selectMode(mode) {
            document.querySelectorAll('.mode-card').forEach(el => el.classList.remove('selected'));
            const card = document.querySelector(\`input[value="\${mode}"]\`).closest('.mode-card');
            card.classList.add('selected');
            document.querySelector(\`input[value="\${mode}"]\`).checked = true;
        }

        // Check Version Helper
        function checkVer(profileVal) {
             if(!profileVal) return;
             document.getElementById('ui5Version').innerText = 'Checking...';
             vscode.postMessage({ command: 'getUi5Version', profile: profileVal });
        };


        // App Check
        document.getElementById('btnCheckApp').addEventListener('click', () => {
             const name = document.getElementById('existingAppName').value.toUpperCase();
             if (!name) return;
             // ... existing logic ...
             const status = document.getElementById('checkStatus');
             status.style.display = 'flex'; 
             status.className = 'status-box'; // reset
             status.innerText = 'Connecting to SAP...';
             vscode.postMessage({ command: 'checkApp', appName: name, profile: document.getElementById('profileSelect').value });
        });

        // New App Check (triggered by Next)
        async function checkNewAppAndProceed() {
             const name = document.getElementById('newAppName').value.toUpperCase();
             const btn = document.getElementById('btnNext');
             const originalText = btn.innerText;
             
             btn.disabled = true;
             btn.innerText = 'Checking...';
             
             // Request check
             vscode.postMessage({ command: 'checkNewApp', appName: name, profile: document.getElementById('profileSelect').value });
        }

        // Package ComboBox
        const pkgInput = document.getElementById('newAppPkg');
        const pkgCombobox = document.getElementById('pkgCombobox');
        const pkgDropdown = document.getElementById('pkgDropdown');
        let allPackages = []; // Store all packages for filtering
        let packagesLoaded = false;
        
        // Fetch packages when needed
        function fetchPackages() {
            if (packagesLoaded) return;
            pkgDropdown.innerHTML = '<div class="pkg-loading">Loading packages from SAP...</div>';
            vscode.postMessage({ command: 'getPackages', profile: document.getElementById('profileSelect').value });
        }
        
        // Open dropdown
        pkgInput.addEventListener('focus', () => {
            pkgCombobox.classList.add('open');
            if (!packagesLoaded) fetchPackages();
        });
        
        // Filter on input
        pkgInput.addEventListener('input', () => {
            const filter = pkgInput.value.toUpperCase();
            renderPackageList(filter);
        });
        
        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!pkgCombobox.contains(e.target)) {
                pkgCombobox.classList.remove('open');
            }
        });
        
        // Render package list
        function renderPackageList(filter) {
            pkgDropdown.innerHTML = '';
            const filtered = filter 
                ? allPackages.filter(p => p.label.includes(filter))
                : allPackages;
                
            if (filtered.length === 0) {
                pkgDropdown.innerHTML = '<div class="pkg-loading">No packages found</div>';
                return;
            }
            
            filtered.forEach(pkg => { // Show all Z packages
                const div = document.createElement('div');
                div.className = 'pkg-item';
                div.textContent = pkg.label;
                div.onclick = () => {
                    pkgInput.value = pkg.label;
                    pkgCombobox.classList.remove('open');
                };
                pkgDropdown.appendChild(div);
            });
        }

        // BSP List Logic
        let allBspApps = [];
        let bspAppsLoaded = false;
        
        const bspInput = document.getElementById('bspAppSearch');
        const clearBtn = document.getElementById('btnClearSearch');

        if(bspInput) {
            bspInput.addEventListener('input', () => {
                const val = bspInput.value;
                if(clearBtn) clearBtn.style.display = val ? 'block' : 'none';
                renderBspList(val.toUpperCase());
            });
        }
        
        if(clearBtn) {
            clearBtn.addEventListener('click', () => {
                bspInput.value = '';
                clearBtn.style.display = 'none';
                renderBspList('');
            });
        }

        function renderBspList(filter) {
            const container = document.getElementById('bspListContent');
            if(!container) return;
            
            container.innerHTML = '';
            
            if(!bspAppsLoaded) {
                 container.innerHTML = '<div class="pkg-loading">Waiting for list...</div>';
                 return;
            }

            const filtered = filter 
                ? allBspApps.filter(a => a.name.toUpperCase().includes(filter))
                : allBspApps;
                
            if (filtered.length === 0) {
                container.innerHTML = '<div class="tr-table-row" style="justify-content:center; opacity:0.6;">No applications found</div>';
                return;
            }
            
            filtered.forEach(app => {
                const row = document.createElement('div');
                row.className = 'tr-table-row'; // Reuse table style
                row.style.cursor = 'pointer';
                row.onclick = () => {
                    // Select App
                    document.getElementById('existingAppName').value = app.name;
                    
                    // Store description immediately
                    wizardData.description = app.description || '';
                    // RESET critical data when switching apps
                    wizardData.transport = ''; 
                    wizardData.package = '';
                    wizardData.isLocked = false;
                    
                    document.getElementById('infoDesc').innerText = app.description || ''; // Update UI info

                    // Trigger Check
                    document.getElementById('btnCheckApp').click();
                    
                    // Highlight row (visual only)
                    document.querySelectorAll('#bspListContent .tr-table-row').forEach(r => r.style.background = '');
                    row.style.background = 'rgba(255, 255, 255, 0.1)';
                };
                
                row.innerHTML = \`
                    <div style="width:200px; font-weight:bold;">\${app.name}</div>
                    <div style="flex:1; opacity:0.8;">\${app.description || '-'}</div>
                \`;
                
                container.appendChild(row);
            });
        }

        // Message Handling
        window.addEventListener('message', event => {
            const msg = event.data;
            switch(msg.command) {
                case 'setUi5Version':
                    document.getElementById('ui5Version').innerText = msg.version;
                    break;
                case 'setPackage':
                    document.getElementById('newAppPkg').value = msg.package;
                    break;
                case 'setPackages':
                    allPackages = msg.packages || [];
                    packagesLoaded = true;
                    renderPackageList(pkgInput.value.toUpperCase());
                    break;
                case 'checkAppResult':
                     const status = document.getElementById('checkStatus');
                     if (msg.error || !msg.exists) {
                         status.innerText = 'Application not found on this system.';
                         status.classList.add('status-error');
                         status.style.display = 'block'; // Ensure visible on error
                         document.getElementById('detectedInfo').style.display = 'none';
                         document.getElementById('existingAppName').value = ''; // clear invalid
                     } else {
                         // Success - Hide generic status
                         status.style.display = 'none'; 
                         status.classList.remove('status-success', 'status-error');
                         
                         // Populate Name if empty (logic consistency)
                         
                         // Show lock info only if transport exists
                         if (msg.transport) {
                             document.getElementById('infoMsg').innerText = \`This application is locked by transport \${msg.transport}\`;
                             document.getElementById('detectedInfo').style.display = 'block';
                         } else {
                             document.getElementById('detectedInfo').style.display = 'none';
                         }

                         wizardData.package = msg.package;
                         if (msg.description) wizardData.description = msg.description;
                         // Always update transport (clear it if undefined)
                         wizardData.transport = msg.transport || ''; 
                         wizardData.isLocked = !!msg.transport;
                     }
                    break;

                case 'checkNewAppResult':
                     const btn = document.getElementById('btnNext');
                     btn.disabled = false;
                     btn.innerText = 'Next ➔';
                     
                     if (msg.error) {
                         // Error checking?
                         alert('Error checking application existence.');
                         return;
                     }
                     
                     if (msg.exists) {
                         const errorEl = document.getElementById('newAppNameError');
                         errorEl.innerText = \`The Repository object \${document.getElementById('newAppName').value.toUpperCase()} already exists. Enter a unique name.\`;
                         errorEl.classList.add('visible');
                         const formGroup = errorEl.closest('.form-group');
                         if (formGroup) formGroup.classList.add('has-error');
                     } else {
                         // Valid! Collect data and move on
                         wizardData.appName = document.getElementById('newAppName').value.toUpperCase();
                         wizardData.description = document.getElementById('newAppDesc').value;
                         wizardData.package = document.getElementById('newAppPkg').value.toUpperCase();
                         
                         // Validate other fields again just in case
                         if(!document.getElementById('newAppDesc').value || !document.getElementById('newAppPkg').value) {
                              validateStep(2); // Show errors
                              return;
                         }

                         // Moving to Step 3
                         // Check if $TMP - skip Step 3 entirely
                         if (wizardData.package === '$TMP') {
                            wizardData.transport = '';
                            prepareSummary();
                            showStep(4);
                            return;
                         }
                         
                         // Transport Check (Create mode always needs Check?)
                         // Actually, for NEW app, we usually create a transport or select variable.
                         // Let's do standard transport check for consistency
                         
                         document.getElementById('trLoading').style.display = 'block';
                         document.getElementById('trSection').style.display = 'none';
                         document.getElementById('noTrWarning').style.display = 'none';
                         document.getElementById('localObjMsg').style.display = 'none';
                         
                         vscode.postMessage({ 
                            command: 'checkTransport', 
                            profile: wizardData.profile,
                            package: wizardData.package,
                            bspName: wizardData.appName
                         });
                         
                         showStep(3);
                     }
                     break;

                case 'setBspList':
                    allBspApps = msg.apps || [];
                    bspAppsLoaded = true;
                    // Sort by name
                    allBspApps.sort((a, b) => a.name.localeCompare(b.name));
                    renderBspList('');
                    break;
                
                case 'setTransportRequests':
                    // Legacy handler - kept for backwards compatibility
                    availableTrs = msg.requests || [];
                    break;
                    
                case 'transportCheckResult':
                    // Hide loading
                    document.getElementById('trLoading').style.display = 'none';
                    
                    // If TR not required (rare case), skip to Step 4
                    if (!msg.required) {
                        wizardData.transport = '';
                        prepareSummary();
                        showStep(4);
                        return;
                    }
                    
                    // Store available TRs
                    availableTrs = msg.requests || [];
                    
                    // Show TR section
                    document.getElementById('trSection').style.display = 'block';
                    
                    // Populate TR Table
                    const trList = document.getElementById('trList');
                    
                    if (availableTrs.length === 0) {
                        // No TRs available
                        document.getElementById('noTrWarning').style.display = 'block';
                        trList.innerHTML = '';
                        // Default to create mode if no list
                        selectTrOption('create');
                    } else {
                        // Show list and populate
                        document.getElementById('noTrWarning').style.display = 'none';
                        
                        trList.innerHTML = availableTrs.map((tr) => \`
                            <div class="tr-table-row" onclick="selectTrRow(this)" data-id="\${tr.trId}">
                                <div class="tr-col-id">\${tr.trId}</div>
                                <div class="tr-col-user">\${tr.owner || '-'}</div>
                                <div class="tr-col-desc">\${tr.description || ''}</div>
                                <div class="tr-status-icon"></div>
                            </div>
                        \`).join('');
                        
                        // Default to list mode
                        selectTrOption('list');
                    }
                    break;

                case 'createTransportResult':
                    document.getElementById('btnDoCreate').innerText = 'Create & Select';
                    document.getElementById('btnDoCreate').disabled = false;
                    
                    if (msg.success) {
                        // Add new TR to list (at top)
                        const newTr = { trId: msg.trId, description: msg.description, owner: 'YOU' };
                        availableTrs.unshift(newTr);
                        
                        // Re-render list
                        const trList = document.getElementById('trList');
                        
                        // Remove warning if it was there
                        document.getElementById('noTrWarning').style.display = 'none';
                        
                        trList.innerHTML = availableTrs.map((tr) => \`
                            <label class="tr-table-row \${tr.trId === msg.trId ? 'selected' : ''}" onclick="selectTrRow(this)">
                                <div class="tr-col-radio"><input type="radio" name="selectedTr" value="\${tr.trId}" \${tr.trId === msg.trId ? 'checked' : ''}></div>
                                <div class="tr-col-id">\${tr.trId}</div>
                                <div class="tr-col-user">\${tr.owner || '-'}</div>
                                <div class="tr-col-desc">\${tr.description || ''}</div>
                            </label>
                        \`).join('');
                        
                        clearError('trSelectError'); // Note: Error might be somewhere else now?
                        
                        // Switch to list mode and select it
                        selectTrOption('list');
                        
                    } else {
                        // Show error
                        const err = document.getElementById('newTrDescError');
                        err.innerText = msg.message;
                        err.classList.add('visible');
                    }
                    break;
            }
        });

    </script>
</body>
</html>`;
    }
}
