import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as ejs from 'ejs';

export interface TemplateInfo {
    id: string;
    name: string;
    description: string;
    icon: string;
}

export interface ProjectConfig {
    templateId: string;
    projectName: string;
    namespace: string;
    description: string;
    serviceType: 'Rest' | 'ODataV2' | 'ODataV4';
    ui5Version: string;
    theme: string;
    targetPath: string;
    dataSourceType?: 'skip' | 'profile' | 'url';
    profileName?: string;
    serviceUrl?: string;
}

export interface UI5Version {
    version: string;
    released: boolean;
    eom?: string;
    maintained: boolean;
}

export class TemplateService {
    private templatesPath: string;

    constructor(private extensionUri: vscode.Uri) {
        this.templatesPath = path.join(extensionUri.fsPath, 'resources', 'templates');
    }

    /**
     * Get available templates
     */
    getTemplates(): TemplateInfo[] {
        return [
            {
                id: 'basic-app',
                name: 'Basic Application',
                description: 'Simple SAPUI5 application with routing, i18n, and service layer',
                icon: '$(file-code)'
            }
        ];
    }

    /**
     * Fetch JSON from URL using native https
     */
    private fetchJson(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const request = https.get(url, { timeout: 10000 }, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }

                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            request.on('error', reject);
            request.on('timeout', () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    /**
     * Fetch available SAPUI5 versions from SAP CDN
     */
    async getUI5Versions(): Promise<UI5Version[]> {
        try {
            const data = await this.fetchJson('https://sapui5.hana.ondemand.com/versionoverview.json');

            const versions: UI5Version[] = [];

            if (data.libraries) {
                const ui5Core = data.libraries.find((lib: any) => lib.name === 'sap.ui.core');
                if (ui5Core && ui5Core.versions) {
                    for (const v of ui5Core.versions) {
                        versions.push({
                            version: v.version,
                            released: true,
                            maintained: !v.eom,
                            eom: v.eom
                        });
                    }
                }
            } else if (data.patches) {
                for (const major of Object.keys(data.patches)) {
                    const minors = data.patches[major];
                    for (const minor of Object.keys(minors)) {
                        const patchList = minors[minor];
                        if (Array.isArray(patchList) && patchList.length > 0) {
                            const latestPatch = patchList[patchList.length - 1];
                            versions.push({
                                version: `${major}.${minor}.${latestPatch}`,
                                released: true,
                                maintained: true
                            });
                        }
                    }
                }
            }

            versions.sort((a, b) => {
                const aParts = a.version.split('.').map(Number);
                const bParts = b.version.split('.').map(Number);
                for (let i = 0; i < 3; i++) {
                    if (aParts[i] !== bParts[i]) {
                        return bParts[i] - aParts[i];
                    }
                }
                return 0;
            });

            return versions.slice(0, 20);

        } catch (error) {
            console.error('Failed to fetch UI5 versions:', error);
            return [
                { version: '1.136.0', released: true, maintained: true },
                { version: '1.132.0', released: true, maintained: true },
                { version: '1.128.0', released: true, maintained: true },
                { version: '1.120.0', released: true, maintained: true },
                { version: '1.108.0', released: true, maintained: true }
            ];
        }
    }

    /**
     * Generate project from template
     */
    async generateProject(config: ProjectConfig, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        const templatePath = path.join(this.templatesPath, config.templateId);
        const projectPath = path.join(config.targetPath, config.projectName);

        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template "${config.templateId}" not found at ${templatePath}`);
        }

        if (fs.existsSync(projectPath)) {
            throw new Error(`Directory "${config.projectName}" already exists at ${config.targetPath}`);
        }

        progress.report({ message: 'Creating project directory...', increment: 10 });
        fs.mkdirSync(projectPath, { recursive: true });

        progress.report({ message: 'Processing template files...', increment: 10 });

        let backendUrl = 'https://your-sap-server.com';
        let servicePath = '/sap/opu/odata/sap/YOUR_SERVICE_SRV/';

        if (config.serviceUrl) {
            try {
                const urlObj = new URL(config.serviceUrl);
                backendUrl = urlObj.origin;
                servicePath = urlObj.pathname;
                // Ensure service path ends with / for OData if mostly expected, but maybe not for Rest.
                // For now, raw pathname is safer, user should provide full path.
            } catch (e) {
                console.warn('Invalid serviceUrl provided, using defaults', e);
            }
        }

        const templateData = {
            projectName: config.projectName,
            namespace: config.namespace,
            description: config.description,
            serviceType: config.serviceType,
            ui5Version: config.ui5Version,
            theme: config.theme || 'sap_horizon',
            backendUrl: backendUrl,
            servicePath: servicePath,
            includeLogin: false // Temporarily disable login for ALL service types based on user request
        };

        await this.processDirectory(templatePath, projectPath, templateData, progress);

        progress.report({ message: 'Finalizing project...', increment: 10 });

        const gitignoreTemplate = path.join(projectPath, 'gitignore.template');
        const gitignore = path.join(projectPath, '.gitignore');
        if (fs.existsSync(gitignoreTemplate)) {
            fs.renameSync(gitignoreTemplate, gitignore);
        }

        progress.report({ message: 'Project created successfully!', increment: 10 });
    }

    /**
     * Recursively process directory and render templates
     */
    private async processDirectory(
        sourcePath: string,
        targetPath: string,
        data: Record<string, any>, // Changed to any to support boolean includeLogin
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        const entries = fs.readdirSync(sourcePath, { withFileTypes: true });

        for (const entry of entries) {
            const entryName = entry.name;
            const sourceFile = path.join(sourcePath, entryName);
            const targetFile = path.join(targetPath, entryName);
            const parentDir = path.basename(sourcePath);

            // 1. Conditional Filtering
            // Force disable Login files for ALL service types based on user request
            if (!data.includeLogin) {
                const isLoginView = entryName === 'Login.view.xml';
                const isLoginController = entryName === 'Login.controller.js';
                if (isLoginView || isLoginController) {
                    continue;
                }
            }

            if (data.serviceType !== 'Rest') {
                 // Not Rest - filter Rest specific files
                 const isRestCss = parentDir === 'css' && entryName === 'style.css';
                 const isRestBg = parentDir === 'backgrounds' && entryName === 'bg.png';
                 if (isRestCss || isRestBg) {
                     continue;
                 }
            }

            if (entry.isDirectory()) {
                // 2. Service Directory Logic
                if (entryName === 'service') {
                    // If no service type is selected (Skip), do not create service folder
                    if (!data.serviceType) {
                        continue;
                    }

                    // Create service directory
                    fs.mkdirSync(targetFile, { recursive: true });

                    // Determine which files to copy
                    const serviceFilesToCopy: string[] = [];
                    if (data.serviceType === 'Rest') {
                        serviceFilesToCopy.push('RestService.js');
                        if (data.includeLogin) {
                            serviceFilesToCopy.push('UserService.js', 'SessionManager.js');
                        }
                    } else if (data.serviceType === 'OData' || data.serviceType === 'ODataV2') {
                        serviceFilesToCopy.push('ODataV2Service.js');
                        if (data.includeLogin) {
                             serviceFilesToCopy.push('UserService.js', 'SessionManager.js');
                        }
                    } else if (data.serviceType === 'ODataV4') {
                        serviceFilesToCopy.push('ODataV4Service.js');
                        if (data.includeLogin) {
                             serviceFilesToCopy.push('UserService.js', 'SessionManager.js');
                        }
                    }

                    // Copy selected files manually
                    for (const sFile of serviceFilesToCopy) {
                        const sSource = path.join(sourceFile, sFile);
                        const sTarget = path.join(targetFile, sFile);
                        if (fs.existsSync(sSource)) {
                             await this.processFile(sSource, sTarget, data);
                        }
                    }

                    // Do not recurse into service directory since we handled it manually
                    continue;
                }

                // Normal Directory Recursion
                fs.mkdirSync(targetFile, { recursive: true });
                await this.processDirectory(sourceFile, targetFile, data, progress);

            } else {
                // Regular File Processing
                await this.processFile(sourceFile, targetFile, data);
            }
        }
    }

    /**
     * Process a single file - render with EJS
     */
    private async processFile(
        sourcePath: string,
        targetPath: string,
        data: Record<string, string>
    ): Promise<void> {
        const ext = path.extname(sourcePath).toLowerCase();
        const textExtensions = ['.js', '.ts', '.json', '.xml', '.html', '.css', '.yaml', '.yml', '.md', '.properties', '.template'];

        if (textExtensions.includes(ext) || path.basename(sourcePath).startsWith('.')) {
            try {
                const content = fs.readFileSync(sourcePath, 'utf-8');
                const rendered = ejs.render(content, data, {
                    // Don't escape HTML characters
                    escape: (s: string) => s
                });
                fs.writeFileSync(targetPath, rendered, 'utf-8');
            } catch (error) {
                console.warn(`Failed to render ${sourcePath}, copying as-is:`, error);
                fs.copyFileSync(sourcePath, targetPath);
            }
        } else {
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
}
