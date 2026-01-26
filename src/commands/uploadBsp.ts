import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '../services/ConfigService';

export async function uploadBspCommand(configService: ConfigService): Promise<void> {
    // Get current workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Please open a folder containing a BSP project first.');
        return;
    }

    // Check for .nwabaprc file
    let projectFolder: string | undefined;
    
    for (const folder of workspaceFolders) {
        const nwabaprcPath = path.join(folder.uri.fsPath, '.nwabaprc');
        if (fs.existsSync(nwabaprcPath)) {
            projectFolder = folder.uri.fsPath;
            break;
        }
    }

    if (!projectFolder) {
        // Try to find in subdirectories
        for (const folder of workspaceFolders) {
            const entries = fs.readdirSync(folder.uri.fsPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const nwabaprcPath = path.join(folder.uri.fsPath, entry.name, '.nwabaprc');
                    if (fs.existsSync(nwabaprcPath)) {
                        projectFolder = path.join(folder.uri.fsPath, entry.name);
                        break;
                    }
                }
            }
            if (projectFolder) {break;}
        }
    }

    if (!projectFolder) {
        const createConfig = await vscode.window.showErrorMessage(
            'No .nwabaprc configuration file found. Would you like to create one?',
            'Create Configuration',
            'Cancel'
        );

        if (createConfig !== 'Create Configuration') {
            return;
        }

        await createNwabaprcWizard(configService, workspaceFolders[0].uri.fsPath);
        projectFolder = workspaceFolders[0].uri.fsPath;
    }

    // Read the config to show what we're deploying
    const config = configService.readNwabaprc(projectFolder);
    if (!config) {
        vscode.window.showErrorMessage('Failed to read .nwabaprc configuration.');
        return;
    }

    // Confirm deployment
    const confirm = await vscode.window.showInformationMessage(
        `Deploy to BSP "${config.abap_bsp}" on ${config.conn_server}?`,
        { modal: true },
        'Deploy',
        'Cancel'
    );

    if (confirm !== 'Deploy') {
        return;
    }

    // Run nwabap upload
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Deploying BSP: ${config.abap_bsp}`,
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: 'Starting upload...' });

            return new Promise<void>(async (resolve, reject) => {
                try {
                    const { DeployService } = require('../services/DeployService');
                    await DeployService.runNwabapUpload(projectFolder!, progress);
                    
                    vscode.window.showInformationMessage(
                        `Successfully deployed "${config!.abap_bsp}" to SAP!`
                    );
                    resolve();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Deployment failed: ${error.message}`);
                    reject(error);
                }
            });
        }
    );
}

async function createNwabaprcWizard(configService: ConfigService, directory: string): Promise<void> {
    // Select profile
    const profiles = configService.getProfiles();
    
    if (profiles.length === 0) {
        vscode.window.showErrorMessage('No SAP profiles configured. Please add a profile first.');
        return;
    }

    const selectedProfile = await vscode.window.showQuickPick(
        profiles.map(p => ({
            label: p.name,
            description: `${p.server} (Client: ${p.client})`
        })),
        { placeHolder: 'Select SAP profile' }
    );

    if (!selectedProfile) {
        return;
    }

    // Get BSP details
    const bspName = await vscode.window.showInputBox({
        prompt: 'BSP Application Name',
        placeHolder: 'ZUI5_MY_APP',
        validateInput: (value) => {
            if (!value.trim()) {
                return 'BSP name is required';
            }
            if (!/^[A-Z0-9_]+$/i.test(value)) {
                return 'BSP name can only contain letters, numbers and underscores';
            }
            return undefined;
        }
    });

    if (!bspName) {
        return;
    }

    const bspText = await vscode.window.showInputBox({
        prompt: 'BSP Application Description',
        placeHolder: 'My UI5 Application'
    });

    if (!bspText) {
        return;
    }

    const abapPackage = await vscode.window.showInputBox({
        prompt: 'ABAP Package',
        placeHolder: 'ZMY_PACKAGE or $TMP',
        value: '$TMP'
    });

    if (!abapPackage) {
        return;
    }

    let transport = '';
    if (abapPackage !== '$TMP') {
        transport = await vscode.window.showInputBox({
            prompt: 'Transport Request',
            placeHolder: 'e.g., S4DK900046'
        }) || '';
    }

    const baseDir = await vscode.window.showInputBox({
        prompt: 'Source Directory (relative to project root)',
        placeHolder: './dist',
        value: './dist'
    });

    if (!baseDir) {
        return;
    }

    // Create the config
    await configService.createNwabaprcFromProfile(
        directory,
        selectedProfile.label,
        {
            package: abapPackage,
            bspName: bspName.toUpperCase(),
            bspText,
            transport
        }
    );

    // Update base directory in the config
    const config = configService.readNwabaprc(directory);
    if (config) {
        config.base = baseDir;
        configService.writeNwabaprc(directory, config);
    }

    vscode.window.showInformationMessage('.nwabaprc configuration created successfully!');
}
