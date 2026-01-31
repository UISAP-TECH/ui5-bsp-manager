import * as vscode from 'vscode';
import { TemplateService, ProjectConfig } from '../services/TemplateService';
import { ConfigService } from '../services/ConfigService';
import { SapConnection } from '../services/SapConnection';
import * as fs from 'fs';
import * as path from 'path';

export class CreateProjectPanel {
    public static currentPanel: CreateProjectPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private templateService: TemplateService;
    private configService: ConfigService;

    public static createOrShow(extensionUri: vscode.Uri, configService: ConfigService) {
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

        CreateProjectPanel.currentPanel = new CreateProjectPanel(panel, extensionUri, configService);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, configService: ConfigService) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.templateService = new TemplateService(extensionUri);
        this.configService = configService;

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
                            this._panel.webview.postMessage({ 
                                command: 'ui5Versions', 
                                data: [
                                    { version: '1.136.0', maintained: true },
                                    { version: '1.132.0', maintained: true },
                                    { version: '1.128.0', maintained: true },
                                    { version: '1.120.0', maintained: true },
                                    { version: '1.108.0', maintained: true }
                                ]
                            });
                        }
                        break;
                    case 'getProfiles':
                        const profiles = this.configService.getProfiles();
                        this._panel.webview.postMessage({ 
                            command: 'profiles', 
                            data: profiles.map(p => ({ name: p.name, server: p.server, client: p.client }))
                        });
                        break;
                    case 'getServices':
                        await this._fetchServices(message.profileName, message.serviceType);
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
                    case 'checkDirectory':
                        try {
                            const fullPath = path.join(message.targetPath, message.projectName);
                            const exists = fs.existsSync(fullPath);
                            this._panel.webview.postMessage({ command: 'directoryCheck', exists: exists });
                        } catch (e) {
                            this._panel.webview.postMessage({ command: 'directoryCheck', exists: false });
                        }
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

    private async _fetchServices(profileName: string, serviceType: string) {
        try {
            const profile = this.configService.getProfile(profileName);
            if (!profile) {
                this._panel.webview.postMessage({ command: 'services', data: [], error: 'Profile not found' });
                return;
            }

            const password = await this.configService.getPassword(profileName);
            if (!password) {
                this._panel.webview.postMessage({ command: 'services', data: [], error: 'Password not found' });
                return;
            }

            const connection = new SapConnection({ ...profile, password });

            let services: { name: string; path: string; description?: string }[] = [];

            // For OData V2/V4, fetch from CATALOGSERVICE
            const catalogVersion = serviceType === 'ODataV4' ? '4' : '2';
            const catalogPath = `/sap/opu/odata/IWFND/CATALOGSERVICE;v=${catalogVersion}/ServiceCollection?sap-client=${profile.client}&$format=json`;
            
            try {
                const response = await connection.get(catalogPath, {
                    headers: { 'Accept': 'application/json' }
                });
                
                if (response && response.d && response.d.results) {
                    services = response.d.results.map((svc: any) => ({
                        name: svc.Title || svc.TechnicalServiceName,
                        path: svc.ServiceUrl || `/sap/opu/odata/sap/${svc.TechnicalServiceName}`,
                        description: svc.Description || svc.TechnicalServiceName
                    })).slice(0, 1000); // Limit to 1000 services
                }
                
                this._panel.webview.postMessage({ command: 'services', data: services });
            } catch (error) {
                console.error('Failed to fetch OData services:', error);
                this._panel.webview.postMessage({ command: 'services', data: [], error: 'Could not fetch services. Check connection.' });
            }
        } catch (error) {
            console.error('Error fetching services:', error);
            this._panel.webview.postMessage({ command: 'services', data: [], error: String(error) });
        }
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
            
            // Auto-close panel after a short delay
            setTimeout(() => {
                this._panel.dispose();
            }, 2000);

            // Show Native VS Code Notification (Non-blocking or after dispose trigger)
            const projectPath = vscode.Uri.file(`${config.targetPath}/${config.projectName}`);
            vscode.window.showInformationMessage(
                `Project "${config.projectName}" created successfully!`,
                'Open in Current Window',
                'Open in New Window'
            ).then(async (action) => {
                if (action === 'Open in Current Window') {
                    await vscode.commands.executeCommand('vscode.openFolder', projectPath, false);
                } else if (action === 'Open in New Window') {
                    await vscode.commands.executeCommand('vscode.openFolder', projectPath, true);
                }
            });

        } catch (error) {
            this._panel.webview.postMessage({ command: 'error', message: `${error}` });
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const iconFolder = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
        const iconCode = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
        const iconBox = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>';
        const iconServer = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>';
        const iconLayers = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>';
        const iconPalette = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"></circle><circle cx="17.5" cy="10.5" r=".5"></circle><circle cx="8.5" cy="7.5" r=".5"></circle><circle cx="6.5" cy="12.5" r=".5"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"></path></svg>';
        const iconChevron = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        const iconLink = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
        const iconSkip = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>';
        const iconCloud = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>';
        const iconSearch = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>';

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
            background-color: var(--bg);
            background-image: radial-gradient(var(--vscode-widget-border) 1px, transparent 1px);
            background-size: 20px 20px;
        }

        .container {
            width: 100%;
            max-width: 580px;
            background: var(--card-bg);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            padding: 40px;
            margin: 20px;
            backdrop-filter: blur(10px);
            animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .header { text-align: center; margin-bottom: 35px; }
        .header h1 { font-size: 24px; font-weight: 300; margin: 0 0 8px 0; letter-spacing: 0.5px; }
        .header p { color: var(--text-secondary); font-size: 13px; margin: 0; }

        .step-indicator { display: flex; justify-content: center; gap: 8px; margin-bottom: 30px; }
        .step-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); transition: all 0.3s; }
        .step-dot.active { background: var(--primary); transform: scale(1.2); }
        .step-dot.completed { background: var(--success); }

        .section { display: none; animation: fadeIn 0.3s ease; }
        .section.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        .section-title {
            font-size: 14px; font-weight: 600; margin-bottom: 16px;
            color: var(--text-secondary); display: flex; align-items: center; gap: 8px;
        }

        /* Template Cards */
        .template-grid { display: grid; gap: 12px; margin-bottom: 20px; }
        .template-card {
            padding: 16px; border: 1px solid var(--border); border-radius: 8px;
            cursor: pointer; background: rgba(255,255,255,0.02);
            display: flex; align-items: flex-start; gap: 12px;
        }
        .template-card:hover { background: rgba(255,255,255,0.05); border-color: var(--text-secondary); }
        .template-card.selected { border-color: var(--primary); background: rgba(0, 120, 212, 0.08); }
        .template-icon {
            width: 40px; height: 40px; border-radius: 8px; background: var(--primary);
            display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0;
        }
        .template-info h3 { margin: 0 0 4px 0; font-size: 14px; font-weight: 600; }
        .template-info p { margin: 0; font-size: 12px; color: var(--text-secondary); }

        /* Input Group */
        .input-group { position: relative; margin-bottom: 24px; }
        .input-field {
            width: 100%; background: var(--input-bg); border: 1px solid var(--border);
            border-radius: 6px; padding: 12px 14px 12px 42px; font-size: 14px;
            color: var(--text); outline: none;
        }
        .input-field:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.15); }
        .input-field.error { border-color: var(--error); }
        .input-icon { position: absolute; left: 14px; top: 13px; color: var(--text-secondary); pointer-events: none; }
        .input-field:focus ~ .input-icon { color: var(--primary); }
        .floating-label {
            position: absolute; left: 42px; top: 12px; font-size: 14px;
            color: var(--text-secondary); pointer-events: none;
            transition: 0.2s cubic-bezier(0.16, 1, 0.3, 1); background: var(--input-bg); padding: 0 4px;
        }
        .input-field:focus ~ .floating-label,
        .input-field:not(:placeholder-shown) ~ .floating-label {
            top: -9px; left: 10px; font-size: 11px; color: var(--primary); font-weight: 600;
        }
        .input-field.error ~ .floating-label { color: var(--error); }
        .error-message { color: var(--error); font-size: 11px; margin-top: 4px; display: none; }
        .error-message.show { display: block; }

        textarea.input-field { padding-left: 14px; min-height: 60px; resize: vertical; }
        textarea.input-field ~ .floating-label { left: 14px; }
        textarea.input-field:focus ~ .floating-label,
        textarea.input-field:not(:placeholder-shown) ~ .floating-label { left: 10px; }

        /* Custom Select */
        .select-group { position: relative; margin-bottom: 24px; }
        .select-label {
            font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;
            display: flex; align-items: center; gap: 6px;
            font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .custom-select { position: relative; }
        .select-trigger {
            display: flex; justify-content: space-between; align-items: center;
            padding: 14px 15px; background: rgba(0,0,0,0.1); border: 1px solid var(--border);
            border-radius: 8px; cursor: pointer; transition: all 0.2s;
            font-size: 14px; font-weight: 500; color: var(--text);
        }
        .select-trigger:hover { background: rgba(0, 120, 212, 0.05); border-color: var(--primary); }
        .select-trigger .arrow { font-size: 10px; opacity: 0.7; transition: transform 0.2s; }
        .custom-select.open .select-trigger .arrow { transform: rotate(180deg); }
        .custom-select.open .select-trigger { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.2); }
        .select-trigger.error { border-color: var(--error); }
        .select-options {
            position: absolute; top: 110%; left: 0; right: 0;
            background: rgba(30, 30, 30, 0.98); backdrop-filter: blur(10px);
            border: 1px solid var(--border); border-radius: 8px; z-index: 100;
            display: none; max-height: 250px; overflow-y: auto;
            box-shadow: 0 10px 20px rgba(0,0,0,0.3); animation: fadeInDown 0.2s ease;
        }
        .custom-select.open .select-options { display: block; }
        @keyframes fadeInDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .option-group-label {
            padding: 10px 15px 6px; font-size: 10px; font-weight: 600;
            text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); opacity: 0.7;
        }
        .option-item {
            padding: 12px 15px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05);
            transition: background 0.1s; font-size: 13px;
        }
        .option-item:last-child { border-bottom: none; }
        .option-item:hover { background: var(--primary); color: white; }
        .option-item.selected { background: rgba(0, 120, 212, 0.2); color: var(--primary); font-weight: bold; }

        /* Two Column Row */
        .two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .two-column .select-group { margin-bottom: 0; }

        /* Folder Selection */
        .folder-group { margin-bottom: 24px; }
        .folder-select { display: flex; gap: 10px; }
        .folder-select .input-field { flex: 1; padding-left: 14px; }
        .folder-btn {
            padding: 0 16px; background: var(--input-bg); border: 1px solid var(--border);
            border-radius: 6px; color: var(--text); cursor: pointer;
            display: flex; align-items: center; gap: 6px; font-size: 13px;
        }
        .folder-btn:hover { background: rgba(255,255,255,0.05); border-color: var(--primary); }

        /* Skip Checkbox */
        .skip-checkbox {
            display: flex; align-items: center; gap: 10px; padding: 14px 16px;
            border: 1px solid var(--border); border-radius: 8px;
            cursor: pointer; margin-bottom: 16px; background: rgba(0,0,0,0.05);
            font-size: 13px; color: var(--text);
        }
        .skip-checkbox:hover { border-color: var(--text-secondary); }
        .skip-checkbox input { display: none; }
        .skip-checkbox .checkmark {
            width: 18px; height: 18px; border: 2px solid var(--border); border-radius: 4px;
            position: relative; flex-shrink: 0; transition: all 0.2s;
        }
        .skip-checkbox input:checked + .checkmark { background: var(--primary); border-color: var(--primary); }
        .skip-checkbox input:checked + .checkmark::after {
            content: ''; position: absolute; left: 5px; top: 2px;
            width: 5px; height: 9px; border: solid white; border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }

        /* Service Config */
        .service-config { animation: fadeIn 0.2s ease; }
        .service-type-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .type-label { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
        .pill-toggle { display: flex; gap: 6px; }
        .pill-btn {
            padding: 8px 16px; border: 1px solid var(--border); border-radius: 20px;
            background: transparent; color: var(--text); cursor: pointer;
            font-size: 12px; font-weight: 600; transition: all 0.2s;
        }
        .pill-btn:hover { border-color: var(--primary); background: rgba(0, 120, 212, 0.05); }
        .pill-btn.selected { background: var(--primary); border-color: var(--primary); color: white; }

        /* Service Panels */
        .service-panel { display: none; }
        .service-panel.active { display: block; animation: fadeIn 0.2s ease; }

        /* OData Source Toggle */
        .odata-source-toggle { display: flex; margin-bottom: 16px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
        .source-btn {
            flex: 1; padding: 10px; border: none; background: transparent;
            color: var(--text); cursor: pointer; font-size: 12px; font-weight: 600;
            border-right: 1px solid var(--border); transition: all 0.2s;
        }
        .source-btn:last-child { border-right: none; }
        .source-btn:hover { background: rgba(255,255,255,0.05); }
        .source-btn.selected { background: var(--primary); color: white; }
        .odata-section { display: none; }
        .odata-section.active { display: block; animation: fadeIn 0.15s ease; }

        /* Service List */
        .service-list { max-height: 180px; overflow-y: auto; }
        .service-item {
            padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px;
            margin-bottom: 6px; cursor: pointer; background: rgba(0,0,0,0.05);
        }
        .service-item:hover { border-color: var(--primary); background: rgba(0, 120, 212, 0.05); }
        .service-item.selected { border-color: var(--primary); background: rgba(0, 120, 212, 0.1); }
        .service-item h5 { margin: 0 0 2px 0; font-size: 12px; font-weight: 600; }
        .service-item p { margin: 0; font-size: 10px; color: var(--text-secondary); }
        .service-loading { text-align: center; padding: 16px; color: var(--text-secondary); font-size: 12px; }
        .spinner {
            width: 16px; height: 16px; border: 2px solid var(--text-secondary);
            border-top-color: var(--primary); border-radius: 50%;
            animation: spin 0.8s linear infinite; display: inline-block; vertical-align: middle; margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .service-search { margin-bottom: 10px; position: relative; }
        .service-search input { width: 100%; padding: 10px 10px 10px 36px; }
        .service-search .search-icon { position: absolute; left: 12px; top: 10px; color: var(--text-secondary); }

        /* Buttons */
        .actions { display: flex; gap: 12px; margin-top: 30px; }
        .btn {
            flex: 1; padding: 12px; border: none; border-radius: 6px;
            font-size: 14px; font-weight: 600; cursor: pointer;
            display: flex; justify-content: center; align-items: center; gap: 8px;
        }
        .btn-primary { background: var(--primary); color: white; box-shadow: 0 4px 12px rgba(0, 120, 212, 0.3); }
        .btn-primary:hover { background: var(--primary-hover); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0, 120, 212, 0.4); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--text); }
        .btn-secondary:hover { background: rgba(255,255,255,0.05); border-color: var(--text-secondary); }
        .btn-loader { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top: 2px solid white; border-radius: 50%; animation: spin 0.8s linear infinite; display: none; }
        .loading .btn-loader { display: block; }
        .loading .btn-text { display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Toast */
        .toast-container { position: fixed; top: 20px; right: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; }
        .toast {
            background: var(--card-bg); border-left: 4px solid var(--primary); color: var(--text);
            padding: 14px 20px; border-radius: 4px; min-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-size: 13px;
            transform: translateX(100%); opacity: 0; animation: slideIn 0.3s forwards;
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
            <div class="section-title">${iconLayers} Select Template</div>
            <div class="template-grid" id="templateGrid">
                <div class="template-card" data-template="basic-app">
                    <div class="template-icon">${iconCode}</div>
                    <div class="template-info">
                        <h3>Basic Application</h3>
                        <p>Simple SAPUI5 app with routing & i18n</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Step 2: Project Details -->
        <div class="section" id="step2">
            <div class="section-title">${iconFolder} Project Details</div>

            <div class="input-group">
                <input type="text" id="projectName" class="input-field" placeholder=" ">
                <div class="input-icon">${iconBox}</div>
                <label class="floating-label">Project Name *</label>
                <div class="error-message" id="projectNameError">Project name is required</div>
            </div>

            <div class="input-group">
                <input type="text" id="namespace" class="input-field" placeholder=" ">
                <div class="input-icon">${iconCode}</div>
                <label class="floating-label">Namespace (e.g. com.company.app)</label>
            </div>

            <div class="input-group">
                <textarea id="description" class="input-field" placeholder=" " rows="2"></textarea>
                <label class="floating-label">Description (optional)</label>
            </div>

            <div class="two-column" style="margin-bottom: 24px;">
                <div class="select-group">
                    <div class="select-label">${iconLayers} SAPUI5 Version *</div>
                    <div class="custom-select" id="ui5VersionSelect">
                        <div class="select-trigger" id="ui5VersionTrigger">
                            <span id="ui5VersionText">Select version...</span>
                            <span class="arrow">${iconChevron}</span>
                        </div>
                        <div class="select-options" id="ui5VersionOptions">
                            <div class="option-item" data-value="">Loading...</div>
                        </div>
                    </div>
                    <input type="hidden" id="ui5Version" value="">
                    <div class="error-message" id="ui5VersionError">Required</div>
                </div>

                <div class="select-group">
                    <div class="select-label">${iconPalette} Theme *</div>
                    <div class="custom-select" id="themeSelect">
                        <div class="select-trigger" id="themeTrigger">
                            <span id="themeText">Morning Horizon</span>
                            <span class="arrow">${iconChevron}</span>
                        </div>
                        <div class="select-options" id="themeOptions">
                            <div class="option-group-label">SAP Horizon</div>
                            <div class="option-item selected" data-value="sap_horizon">Morning Horizon</div>
                            <div class="option-item" data-value="sap_horizon_dark">Evening Horizon</div>
                            <div class="option-item" data-value="sap_horizon_hcb">HC Black</div>
                            <div class="option-item" data-value="sap_horizon_hcw">HC White</div>
                            <div class="option-group-label">SAP Fiori 3</div>
                            <div class="option-item" data-value="sap_fiori_3">Quartz Light</div>
                            <div class="option-item" data-value="sap_fiori_3_dark">Quartz Dark</div>
                        </div>
                    </div>
                    <input type="hidden" id="theme" value="sap_horizon">
                </div>
            </div>

            <div class="folder-group">
                <div class="select-label">${iconFolder} Target Location *</div>
                <div class="folder-select">
                    <input type="text" id="targetPath" class="input-field" placeholder="Select folder..." readonly>
                    <button type="button" class="folder-btn" id="browseBtn">${iconFolder} Browse</button>
                </div>
                <div class="error-message" id="targetPathError">Required</div>
            </div>
        </div>

        <!-- Step 3: Service Configuration -->
        <div class="section" id="step3">
            <div class="section-title">${iconServer} Data Source (Optional)</div>

            <!-- Skip Checkbox -->
            <label class="skip-checkbox">
                <input type="checkbox" id="skipService" checked>
                <span class="checkmark"></span>
                <span>Skip for now - configure later</span>
            </label>

            <!-- Service Config (hidden when skip is checked) -->
            <div class="service-config" id="serviceConfig" style="display: none;">
                <!-- Service Type Toggle -->
                <div class="service-type-row">
                    <span class="type-label">Type:</span>
                    <div class="pill-toggle" id="serviceTypeToggle">
                        <button type="button" class="pill-btn selected" data-value="Rest">REST API</button>
                        <button type="button" class="pill-btn" data-value="ODataV2">OData Service</button>
                    </div>
                </div>

                <!-- REST: Direct URL Input -->
                <div id="restPanel" class="service-panel active">
                    <div class="input-group" style="margin-bottom: 0;">
                        <input type="text" id="restUrl" class="input-field" placeholder=" " style="padding-left: 14px;">
                        <label class="floating-label" style="left: 14px;">Service URL (e.g. /sap/bc/...)</label>
                        <div class="error-message" id="restUrlError">Required</div>
                    </div>
                </div>

                <!-- OData: Profile Selection & Service Discovery -->
                <div id="odataPanel" class="service-panel">
                    <!-- OData Source Toggle -->
                    <div class="odata-source-toggle">
                        <button type="button" class="source-btn selected" data-source="profile">Discover from SAP</button>
                        <button type="button" class="source-btn" data-source="manual">Enter URL</button>
                    </div>

                    <!-- Profile & Discovery -->
                    <div id="odataProfileSection" class="odata-section active">
                        <div class="select-group" style="margin-bottom: 12px;">
                            <div class="select-label">${iconServer} SAP Profile</div>
                            <div class="custom-select" id="profileSelect">
                                <div class="select-trigger" id="profileTrigger">
                                    <span id="profileText">Select profile...</span>
                                    <span class="arrow">${iconChevron}</span>
                                </div>
                                <div class="select-options" id="profileOptions"></div>
                            </div>
                            <input type="hidden" id="profileName" value="">
                            <div class="error-message" id="profileNameError">Please select a profile</div>
                        </div>
                        
                        <div id="serviceSection" style="display: none;">
                            <div class="service-search">
                                <span class="search-icon">${iconSearch}</span>
                                <input type="text" id="serviceSearch" class="input-field" placeholder="Search services..." style="padding-left: 36px;">
                            </div>
                            <div class="service-list" id="serviceList"></div>
                            <div class="error-message" id="serviceListError">Please select a service</div>
                        </div>
                        <input type="hidden" id="selectedServicePath" value="">
                    </div>

                    <!-- Manual URL -->
                    <div id="odataUrlSection" class="odata-section">
                        <div class="input-group" style="margin-bottom: 0;">
                            <input type="text" id="odataUrl" class="input-field" placeholder=" " style="padding-left: 14px;">
                            <label class="floating-label" style="left: 14px;">OData Service URL (e.g. /sap/opu/odata/...)</label>
                            <div class="error-message" id="odataUrlError">Required</div>
                        </div>
                    </div>
                </div>
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
        let selectedConfig = 'skip';
        let allServices = [];
        let profiles = [];
        let projectExists = false;

        function checkDirectory() {
            const name = document.getElementById('projectName').value.trim();
            const targetPath = document.getElementById('targetPath').value;
            if (name && targetPath) {
                vscode.postMessage({ command: 'checkDirectory', projectName: name, targetPath });
            }
        }

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

        function showError(inputId, errorId, message) {
            const input = document.getElementById(inputId);
            const trigger = document.getElementById(inputId + 'Trigger');
            const error = document.getElementById(errorId);
            if (input) input.classList.add('error');
            if (trigger) trigger.classList.add('error');
            if (error) { error.textContent = message; error.classList.add('show'); }
        }

        function clearError(inputId, errorId) {
            const input = document.getElementById(inputId);
            const trigger = document.getElementById(inputId + 'Trigger');
            const error = document.getElementById(errorId);
            if (input) input.classList.remove('error');
            if (trigger) trigger.classList.remove('error');
            if (error) error.classList.remove('show');
        }

        function clearAllErrors() {
            document.querySelectorAll('.input-field, .select-trigger').forEach(el => el.classList.remove('error'));
            document.querySelectorAll('.error-message').forEach(el => el.classList.remove('show'));
        }

        function setupCustomSelect(selectId, triggerId, optionsId, hiddenInputId, textId, onSelect) {
            const select = document.getElementById(selectId);
            const trigger = document.getElementById(triggerId);
            const options = document.getElementById(optionsId);
            const hiddenInput = document.getElementById(hiddenInputId);
            const text = document.getElementById(textId);

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.custom-select.open').forEach(s => {
                    if (s.id !== selectId) s.classList.remove('open');
                });
                select.classList.toggle('open');
            });

            options.addEventListener('click', (e) => {
                const item = e.target.closest('.option-item');
                if (item && item.dataset.value !== undefined) {
                    const value = item.dataset.value;
                    const label = item.textContent.trim();
                    options.querySelectorAll('.option-item').forEach(i => i.classList.remove('selected'));
                    item.classList.add('selected');
                    hiddenInput.value = value;
                    text.textContent = label;
                    select.classList.remove('open');
                    
                    // Clear error if exists
                    clearError(hiddenInputId, hiddenInputId + 'Error');
                    
                    if (onSelect) onSelect(value);
                }
            });
        }

        document.addEventListener('click', () => {
            document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
        });

        setupCustomSelect('ui5VersionSelect', 'ui5VersionTrigger', 'ui5VersionOptions', 'ui5Version', 'ui5VersionText');
        setupCustomSelect('themeSelect', 'themeTrigger', 'themeOptions', 'theme', 'themeText');
        setupCustomSelect('profileSelect', 'profileTrigger', 'profileOptions', 'profileName', 'profileText', (profileName) => {
            if (profileName) {
                document.getElementById('serviceSection').style.display = 'block';
                document.getElementById('serviceList').innerHTML = '<div class="service-loading"><span class="spinner"></span>Loading services...</div>';
                vscode.postMessage({ command: 'getServices', profileName, serviceType: selectedService });
            }
        });

        function renderServices(services, filter = '') {
            const list = document.getElementById('serviceList');
            const filtered = services.filter(s => 
                s.name.toLowerCase().includes(filter.toLowerCase()) || 
                (s.path && s.path.toLowerCase().includes(filter.toLowerCase()))
            );
            
            if (filtered.length === 0) {
                list.innerHTML = '<div class="service-loading">No services found</div>';
                return;
            }
            
            list.innerHTML = filtered.map(s => 
                '<div class="service-item" data-path="' + (s.path || '') + '">' +
                '<h5>' + s.name + '</h5>' +
                '<p>' + (s.path || s.description || '') + '</p>' +
                '</div>'
            ).join('');
            
            list.querySelectorAll('.service-item').forEach(item => {
                item.addEventListener('click', () => {
                    list.querySelectorAll('.service-item').forEach(i => i.classList.remove('selected'));
                    item.classList.add('selected');
                    document.getElementById('selectedServicePath').value = item.dataset.path;
                    document.getElementById('serviceListError').classList.remove('show');
                });
            });
        }

        document.getElementById('serviceSearch').addEventListener('input', (e) => {
            renderServices(allServices, e.target.value);
        });

        function updateStep(step) {
            currentStep = step;
            for (let i = 1; i <= 3; i++) {
                const dot = document.getElementById('dot' + i);
                dot.classList.remove('active', 'completed');
                if (i < step) dot.classList.add('completed');
                if (i === step) dot.classList.add('active');
            }
            document.querySelectorAll('.section').forEach((s, i) => {
                s.classList.toggle('active', i + 1 === step);
            });
            document.getElementById('backBtn').style.display = step > 1 ? 'flex' : 'none';
            document.getElementById('nextBtn').querySelector('.btn-text').textContent = step === 3 ? 'Create Project' : 'Next';

            if (step === 2) vscode.postMessage({ command: 'getUI5Versions' });
            if (step === 3) {
                vscode.postMessage({ command: 'getProfiles' });
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

        // Skip Checkbox
        document.getElementById('skipService').addEventListener('change', function() {
            const serviceConfig = document.getElementById('serviceConfig');
            serviceConfig.style.display = this.checked ? 'none' : 'block';
        });

        // Pill Toggle (Service Type)
        document.querySelectorAll('.pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedService = btn.dataset.value;
                
                // Toggle panels
                document.getElementById('restPanel').classList.toggle('active', selectedService === 'Rest');
                document.getElementById('odataPanel').classList.toggle('active', selectedService === 'ODataV2');
            });
        });

        // OData Source Toggle (Profile/URL)
        document.querySelectorAll('.source-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                const source = btn.dataset.source;
                document.getElementById('odataProfileSection').classList.toggle('active', source === 'profile');
                document.getElementById('odataUrlSection').classList.toggle('active', source === 'manual');
            });
        });

        document.getElementById('browseBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'selectFolder' });
        });

        document.getElementById('projectName').addEventListener('input', () => clearError('projectName', 'projectNameError'));

        document.getElementById('backBtn').addEventListener('click', () => {
            clearAllErrors();
            if (currentStep > 1) updateStep(currentStep - 1);
        });

        document.getElementById('nextBtn').addEventListener('click', () => {
            clearAllErrors();

            if (currentStep === 1) {
                if (!selectedTemplate) { showToast('Please select a template', 'error'); return; }
                updateStep(2);
            } else if (currentStep === 2) {
                let hasError = false;
                const name = document.getElementById('projectName').value.trim();
                const ui5Version = document.getElementById('ui5Version').value;
                const targetPath = document.getElementById('targetPath').value;
                
                if (!name) { showError('projectName', 'projectNameError', 'Project Name is required'); hasError = true; }
                else if (!/^[a-z][a-z0-9-]*$/.test(name)) { showError('projectName', 'projectNameError', 'Lowercase, start with letter'); hasError = true; }
                else if (projectExists) { showError('projectName', 'projectNameError', 'Project folder already exists'); hasError = true; }
                if (!ui5Version) { showError('ui5Version', 'ui5VersionError', 'SAPUI5 Version is required'); hasError = true; }
                if (!targetPath) { showError('targetPath', 'targetPathError', 'Target Location is required'); hasError = true; }
                if (hasError) return;
                updateStep(3);
            } else if (currentStep === 3) {
                const skipService = document.getElementById('skipService').checked;
                let hasError = false;
                
                // Validate service configuration if not skipped
                if (!skipService) {
                    if (selectedService === 'Rest') {
                        const restUrl = document.getElementById('restUrl').value.trim();
                        if (!restUrl) {
                            showError('restUrl', 'restUrlError', 'Service URL is required');
                            hasError = true;
                        }
                    } else if (selectedService === 'ODataV2') {
                        const profileSelected = document.querySelector('.source-btn[data-source="profile"]').classList.contains('selected');
                        if (profileSelected) {
                            const profileName = document.getElementById('profileName').value;
                            if (!profileName) {
                                showError('profileName', 'profileNameError', 'Please select a profile');
                                hasError = true;
                            } else {
                                const selectedPath = document.getElementById('selectedServicePath').value;
                                if (!selectedPath) {
                                    document.getElementById('serviceListError').classList.add('show');
                                    hasError = true;
                                }
                            }
                        } else {
                            const odataUrl = document.getElementById('odataUrl').value.trim();
                            if (!odataUrl) {
                                showError('odataUrl', 'odataUrlError', 'OData Service URL is required');
                                hasError = true;
                            }
                        }
                    }
                }
                
                if (hasError) return;

                const name = document.getElementById('projectName').value.trim();
                const ns = document.getElementById('namespace').value.trim();

                const nextBtn = document.getElementById('nextBtn');
                nextBtn.classList.add('loading');
                nextBtn.disabled = true;

                // Determine final service URL
                let finalServiceUrl = '';
                if (!skipService) {
                    if (selectedService === 'Rest') {
                        finalServiceUrl = document.getElementById('restUrl').value.trim();
                    } else {
                        const profileSelected = document.querySelector('.source-btn[data-source="profile"]').classList.contains('selected');
                        finalServiceUrl = profileSelected 
                            ? document.getElementById('selectedServicePath').value 
                            : document.getElementById('odataUrl').value.trim();
                    }
                }

                vscode.postMessage({
                    command: 'createProject',
                    data: {
                        templateId: selectedTemplate,
                        projectName: name,
                        namespace: ns || name.replace(/-/g, '.'),
                        description: document.getElementById('description').value.trim() || 'SAPUI5 Application',
                        serviceType: skipService ? '' : selectedService,
                        ui5Version: document.getElementById('ui5Version').value,
                        theme: document.getElementById('theme').value,
                        targetPath: document.getElementById('targetPath').value,
                        profileName: (!skipService && selectedService === 'ODataV2' && document.querySelector('.source-btn[data-source="profile"]').classList.contains('selected')) 
                            ? document.getElementById('profileName').value : '',
                        serviceUrl: finalServiceUrl
                    }
                });
            }
        });

        // Clear errors on input
        document.getElementById('restUrl').addEventListener('input', () => clearError('restUrl', 'restUrlError'));
        document.getElementById('restUrl').addEventListener('input', () => clearError('restUrl', 'restUrlError'));
        document.getElementById('odataUrl').addEventListener('input', () => clearError('odataUrl', 'odataUrlError'));
        document.getElementById('projectName').addEventListener('input', () => {
             clearError('projectName', 'projectNameError');
             checkDirectory();
        });
        
        // Clear service selection error when a service is selected (this will be handled in service selection logic)
         window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'ui5Versions':
                    const versions = message.data && message.data.length > 0 ? message.data : [
                        { version: '1.136.0', maintained: true },
                        { version: '1.132.0', maintained: true },
                        { version: '1.128.0', maintained: true }
                    ];
                    document.getElementById('ui5VersionOptions').innerHTML = versions.map((v, i) => 
                        '<div class="option-item' + (i === 0 ? ' selected' : '') + '" data-value="' + v.version + '">' + v.version + (v.maintained ? ' (LTS)' : '') + '</div>'
                    ).join('');
                    document.getElementById('ui5Version').value = versions[0].version;
                    document.getElementById('ui5VersionText').textContent = versions[0].version + ' (LTS)';
                    break;
                case 'profiles':
                    profiles = message.data || [];
                    const profileOpts = document.getElementById('profileOptions');
                    if (profiles.length > 0) {
                        profileOpts.innerHTML = profiles.map(p => '<div class="option-item" data-value="' + p.name + '">' + p.name + '</div>').join('');
                    } else {
                        profileOpts.innerHTML = '<div class="option-item" data-value="">No profiles</div>';
                    }
                    break;
                case 'services':
                    allServices = message.data || [];
                    if (message.error) {
                        showToast(message.error, 'error');
                    }
                    renderServices(allServices);
                    break;
                case 'folderSelected':
                    document.getElementById('targetPath').value = message.path;
                    clearError('targetPath', 'targetPathError');
                    checkDirectory();
                    break;
                case 'directoryCheck':
                    if (message.exists) {
                        showError('projectName', 'projectNameError', 'Project folder already exists');
                        projectExists = true;
                    } else {
                        const name = document.getElementById('projectName').value.trim();
                        if (/^[a-z][a-z0-9-]*$/.test(name)) {
                            clearError('projectName', 'projectNameError');
                        }
                        projectExists = false;
                    }
                    break;
                case 'created':
                    // Toast removed on user request
                    break;
                case 'error':
                    document.getElementById('nextBtn').classList.remove('loading');
                    document.getElementById('nextBtn').disabled = false;
                    showToast(message.message, 'error');
                    break;
            }
        });

        const firstTemplate = document.querySelector('.template-card');
        if (firstTemplate) firstTemplate.click();
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
