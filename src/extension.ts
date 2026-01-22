import * as vscode from 'vscode';
import { BspExplorerProvider, ProfileExplorerProvider } from './views/BspExplorer';
import { ConfigService } from './services/ConfigService';
import { downloadBspCommand } from './commands/downloadBsp';
import { uploadBspCommand } from './commands/uploadBsp';
import { filterBspCommand, listBspCommand } from './commands/listBsp';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('BSP Manager extension is now active!');

    // Initialize services
    const configService = new ConfigService(context);

    // Initialize tree view providers
    const bspExplorerProvider = new BspExplorerProvider(context);
    const profileExplorerProvider = new ProfileExplorerProvider(context);

    // Register tree views
    const bspExplorerView = vscode.window.createTreeView('bspExplorer', {
        treeDataProvider: bspExplorerProvider,
        showCollapseAll: true
    });

    const profileExplorerView = vscode.window.createTreeView('bspProfiles', {
        treeDataProvider: profileExplorerProvider
    });

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'bspManager.switchProfile';
    updateStatusBar(configService);
    statusBarItem.show();

    // Register commands
    const commands = [
        // List BSP applications
        vscode.commands.registerCommand('bspManager.listBsp', () => {
            listBspCommand(bspExplorerProvider);
        }),

        // Download BSP application
        vscode.commands.registerCommand('bspManager.downloadBsp', (item) => {
            downloadBspCommand(bspExplorerProvider, item);
        }),

        // Upload BSP application
        vscode.commands.registerCommand('bspManager.uploadBsp', () => {
            uploadBspCommand(configService);
        }),

        // Configure connection (alias for add profile)
        vscode.commands.registerCommand('bspManager.configure', async () => {
            const profile = await configService.promptNewProfile();
            if (profile) {
                profileExplorerProvider.refresh();
                await configService.setDefaultProfile(profile.name);
                await bspExplorerProvider.loadApplications(profile.name);
                updateStatusBar(configService);
                vscode.window.showInformationMessage(`Profile "${profile.name}" added and set as default.`);
            }
        }),

        // Refresh BSP Explorer
        vscode.commands.registerCommand('bspManager.refreshExplorer', () => {
            bspExplorerProvider.loadApplications();
        }),

        // Add profile
        vscode.commands.registerCommand('bspManager.addProfile', async () => {
            const profile = await configService.promptNewProfile();
            if (profile) {
                profileExplorerProvider.refresh();
                
                // If this is the first profile, set it as default
                if (configService.getProfiles().length === 1) {
                    await configService.setDefaultProfile(profile.name);
                    await bspExplorerProvider.loadApplications(profile.name);
                }
                
                updateStatusBar(configService);
                vscode.window.showInformationMessage(`Profile "${profile.name}" added successfully.`);
            }
        }),

        // Switch profile
        vscode.commands.registerCommand('bspManager.switchProfile', async (profileName?: string) => {
            const profiles = configService.getProfiles();
            
            if (profiles.length === 0) {
                const create = await vscode.window.showWarningMessage(
                    'No SAP profiles configured.',
                    'Add Profile'
                );
                if (create === 'Add Profile') {
                    vscode.commands.executeCommand('bspManager.addProfile');
                }
                return;
            }

            let targetProfile: string | undefined = profileName;

            if (!targetProfile) {
                const currentProfile = configService.getDefaultProfile();
                
                const selected = await vscode.window.showQuickPick(
                    profiles.map(p => ({
                        label: p.name === currentProfile ? `$(star-full) ${p.name}` : p.name,
                        description: `${p.server} (Client: ${p.client})`,
                        profileName: p.name
                    })),
                    { placeHolder: 'Select SAP profile to use' }
                );

                if (!selected) {
                    return;
                }

                targetProfile = selected.profileName;
            }

            await configService.setDefaultProfile(targetProfile);
            await bspExplorerProvider.loadApplications(targetProfile);
            updateStatusBar(configService);
            vscode.window.showInformationMessage(`Switched to profile "${targetProfile}"`);
        }),

        // Filter BSP applications
        vscode.commands.registerCommand('bspManager.filterBsp', () => {
            filterBspCommand(bspExplorerProvider);
        }),

        // Delete profile
        vscode.commands.registerCommand('bspManager.deleteProfile', async () => {
            const profiles = configService.getProfiles();
            
            if (profiles.length === 0) {
                vscode.window.showInformationMessage('No profiles to delete.');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                profiles.map(p => ({
                    label: p.name,
                    description: p.server
                })),
                { placeHolder: 'Select profile to delete' }
            );

            if (!selected) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to delete profile "${selected.label}"?`,
                { modal: true },
                'Delete'
            );

            if (confirm === 'Delete') {
                await configService.deleteProfile(selected.label);
                profileExplorerProvider.refresh();
                
                // If deleted profile was default, clear default
                if (configService.getDefaultProfile() === selected.label) {
                    const remaining = configService.getProfiles();
                    if (remaining.length > 0) {
                        await configService.setDefaultProfile(remaining[0].name);
                        await bspExplorerProvider.loadApplications(remaining[0].name);
                    }
                }
                
                updateStatusBar(configService);
                vscode.window.showInformationMessage(`Profile "${selected.label}" deleted.`);
            }
        })
    ];

    // Add all disposables to subscriptions
    context.subscriptions.push(
        bspExplorerView,
        profileExplorerView,
        statusBarItem,
        ...commands
    );

    // Auto-load BSP applications if default profile is set
    const defaultProfile = configService.getDefaultProfile();
    if (defaultProfile) {
        bspExplorerProvider.loadApplications(defaultProfile);
    }
}

function updateStatusBar(configService: ConfigService): void {
    const defaultProfile = configService.getDefaultProfile();
    
    if (defaultProfile) {
        const profile = configService.getProfile(defaultProfile);
        if (profile) {
            statusBarItem.text = `$(server) ${profile.name}`;
            statusBarItem.tooltip = `SAP Profile: ${profile.name}\n${profile.server} (Client: ${profile.client})\nClick to switch profile`;
        } else {
            statusBarItem.text = '$(server) No Profile';
            statusBarItem.tooltip = 'Click to configure SAP profile';
        }
    } else {
        statusBarItem.text = '$(server) No Profile';
        statusBarItem.tooltip = 'Click to configure SAP profile';
    }
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
