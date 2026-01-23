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
        deployService: DeployService
    ) {
        const column = vscode.ViewColumn.One;

        if (DeployFormPanel.currentPanel) {
            DeployFormPanel.currentPanel._panel.reveal(column);
            DeployFormPanel.currentPanel.deployService = deployService;
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
            deployService
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        configService: ConfigService,
        deployService: DeployService
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.configService = configService;
        this.deployService = deployService;

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

            case 'deploy':
                 // Final Deploy Step
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
                 
                 const sourceDir = folderUri[0].fsPath;

                 vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Deploying ${message.data.bspName}...`,
                    cancellable: false
                }, async (progress) => {
                    try {
                        await this.deployService.deploy(
                            message.data.profile, 
                            {
                                bspName: message.data.bspName,
                                package: message.data.package,
                                description: message.data.description,
                                transport: message.data.transport,
                                sourceDir: sourceDir
                            }, 
                            progress
                        );
                        vscode.window.showInformationMessage(`Successfully deployed ${message.data.bspName}!`);
                        this._panel.webview.postMessage({ command: 'deployFinished', success: true });
                    } catch (error) {
                        vscode.window.showErrorMessage(`Deployment failed: ${error}`);
                        this._panel.webview.postMessage({ command: 'deployFinished', success: false, message: String(error) });
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
        .pkg-loading { padding: 15px; text-align: center; opacity: 0.7; }

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
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }

    </style>
    <style>
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
                    <div class="form-group">
                        <label>Existing Application Name</label>
                        <div class="pkg-input-group">
                            <input type="text" id="existingAppName" placeholder="ZMY_APP" style="text-transform:uppercase; font-weight:bold; letter-spacing:1px;">
                            <button class="btn btn-secondary" id="btnCheckApp">Check</button>
                        </div>
                        <div id="checkStatus" class="status-box"></div>
                    </div>
                    
                    <div id="detectedInfo" class="summary-card" style="display:none; margin-top:20px;">
                        <div class="summary-row"><span class="sum-label">Package</span> <span class="sum-val" id="infoPkg"></span></div>
                        <div class="summary-row"><span class="sum-label">Description</span> <span class="sum-val" id="infoDesc"></span></div>
                        <div class="summary-row"><span class="sum-label">Locked TR</span> <span class="sum-val" id="infoTr"></span></div>
                    </div>
                </div>

                <!-- New Mode UI -->
                <div id="newAppUI">
                    <div class="form-group">
                        <label>Application Name <span class="sub-label">(Max 15 chars)</span></label>
                        <input type="text" id="newAppName" maxlength="15" placeholder="ZMY_APP" style="text-transform:uppercase; font-weight:bold; letter-spacing:1px;">
                    </div>

                    <div class="form-group">
                        <label>Description</label>
                        <input type="text" id="newAppDesc" placeholder="e.g., HR Dashboard App">
                    </div>
                    
                    <div class="form-group">
                        <label>ABAP Package</label>
                        <div class="package-combobox" id="pkgCombobox">
                            <input type="text" id="newAppPkg" placeholder="Search or select package..." autocomplete="off" style="text-transform:uppercase;">
                            <div class="pkg-dropdown" id="pkgDropdown">
                                <div class="pkg-loading">Loading packages...</div>
                            </div>
                            
                        </div>
                        <div style="font-size:10px; opacity:0.6; margin-top:4px;">Use $TMP for Local Objects (No transport needed).</div>
                    </div>
                </div>
            </div>

            <!-- STEP 3: Transport -->
            <div class="step-content" id="step-3">
                <h2>Transport Request</h2>
                
                <div id="trSection">
                    <div class="form-group">
                        <label>Select Transport Request</label>
                        <select id="trSelect">
                            <option value="">Fetching...</option>
                        </select>
                    </div>
                    
                    <div style="text-align:center; margin: 10px 0; opacity:0.5; font-size:12px;">— OR —</div>

                    <div class="form-group">
                        <label>Enter Manually</label>
                        <input type="text" id="manualTr" placeholder="DEVK900000">
                    </div>
                </div>
                
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
            transport: ''
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
            }

            if (currentStep === 2) {
                // Capture App Data
                if (wizardData.mode === 'new') {
                    wizardData.appName = document.getElementById('newAppName').value.toUpperCase();
                    wizardData.description = document.getElementById('newAppDesc').value;
                    wizardData.package = document.getElementById('newAppPkg').value.toUpperCase();
                } else {
                    wizardData.appName = document.getElementById('existingAppName').value.toUpperCase();
                }

                // Prepare Step 3 (Transport)
                if (wizardData.package === '$TMP') {
                    document.getElementById('trSection').style.display = 'none';
                    document.getElementById('localObjMsg').style.display = 'flex';
                    wizardData.transport = '';
                } else {
                    document.getElementById('trSection').style.display = 'block';
                    document.getElementById('localObjMsg').style.display = 'none';
                    
                    // Fetch TRs if not already fetched
                    if (availableTrs.length === 0) {
                        vscode.postMessage({ command: 'getTransportRequests', profile: wizardData.profile });
                    }
                }
            }
            
            if (currentStep === 3) {
                // Capture TR
                const manual = document.getElementById('manualTr').value;
                const selected = document.getElementById('trSelect').value;
                wizardData.transport = manual || selected;
                
                // Prepare Step 4 (Summary)
                document.getElementById('sumProfile').innerText = wizardData.profile;
                document.getElementById('sumMode').innerText = wizardData.mode === 'new' ? 'New Application' : 'Update Existing';
                document.getElementById('sumApp').innerText = wizardData.appName;
                document.getElementById('sumPkg').innerText = wizardData.package;
                
                if (wizardData.package === '$TMP') {
                    document.getElementById('sumTr').innerText = 'Local Object ($TMP)';
                    document.getElementById('sumTr').style.opacity = '0.7';
                } else {
                    document.getElementById('sumTr').innerText = wizardData.transport || 'Not Selected!';
                    if(!wizardData.transport) document.getElementById('sumTr').style.color = '#f44336';
                }
            }

            if (currentStep === 4) {
                 vscode.postMessage({ command: 'deploy', data: wizardData });
                 return;
            }

            showStep(currentStep + 1);
        }

        function goBack() {
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
                if (wizardData.mode === 'new') {
                    if (!document.getElementById('newAppName').value) { alert('Application Name is required'); return false; }
                    if (!document.getElementById('newAppPkg').value) { alert('Package is required'); return false; }
                } else {
                    if (!document.getElementById('existingAppName').value) { alert('Please enter the Existing Application Name'); return false; }
                    // Should we force check? Maybe not, but good practice.
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
                
                // Check Version
                checkVer(item.dataset.value);
            });
        });

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
            const status = document.getElementById('checkStatus');
            status.style.display = 'flex';
            status.className = 'status-box'; // reset
            status.innerText = 'Connecting to SAP...';
            // Include profile in message
            vscode.postMessage({ command: 'checkApp', appName: name, profile: document.getElementById('profileSelect').value });
        });

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
                         document.getElementById('detectedInfo').style.display = 'none';
                     } else {
                         status.innerText = 'Application found! Details loaded.';
                         status.classList.add('status-success');
                         
                         // Fill info
                         document.getElementById('infoPkg').innerText = msg.package;
                         document.getElementById('infoDesc').innerText = msg.description;
                         document.getElementById('infoTr').innerText = msg.transport || 'None';
                         document.getElementById('detectedInfo').style.display = 'block';

                         wizardData.package = msg.package;
                         wizardData.description = msg.description;
                         if (msg.transport) wizardData.transport = msg.transport; 
                     }
                    break;

                case 'setTransportRequests':
                    const trSel = document.getElementById('trSelect');
                    trSel.innerHTML = '<option value="">-- Select Transport --</option>';
                    availableTrs = msg.requests || [];
                    availableTrs.forEach(tr => {
                        const opt = document.createElement('option');
                        opt.value = tr.trId;
                        opt.innerText = \`\${tr.trId} - \${tr.description}\`;
                        trSel.appendChild(opt);
                    });
                    if (wizardData.transport) trSel.value = wizardData.transport;
                    break;
            }
        });

    </script>
</body>
</html>`;
    }
}
