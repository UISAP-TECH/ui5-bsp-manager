import * as vscode from 'vscode';
import { ProfileExplorerProvider } from './views/BspExplorer';
import { BspWebviewProvider } from './views/BspWebviewProvider';
import { ProfileFormPanel } from './views/ProfileFormPanel';
import { ConfigService } from './services/ConfigService';
import { uploadBspCommand } from './commands/uploadBsp';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('BSP Manager extension is now active!');

    // Initialize SHARED config service
    const configService = new ConfigService(context);

    // Initialize BSP Webview provider (with inline search)
    const bspWebviewProvider = new BspWebviewProvider(
        context.extensionUri,
        context,
        configService
    );

    // Initialize Profile tree view provider
    const profileExplorerProvider = new ProfileExplorerProvider(context, configService);

    // Function to refresh all views
    const refreshAll = () => {
        configService.reload();
        bspWebviewProvider.loadApplications();
        profileExplorerProvider.refresh();
        updateStatusBar(configService);
    };

    // Register webview provider for BSP Explorer
    const bspWebviewDisposable = vscode.window.registerWebviewViewProvider(
        BspWebviewProvider.viewType,
        bspWebviewProvider
    );

    // Register tree view for profiles
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
        // List BSP applications (opens webview if closed)
        vscode.commands.registerCommand('bspManager.listBsp', () => {
            vscode.commands.executeCommand('bspExplorer.focus');
        }),

        // Download BSP application (shows quickpick if no name provided)
        vscode.commands.registerCommand('bspManager.downloadBsp', async () => {
            const bspService = bspWebviewProvider.getBspService();
            if (!bspService) {
                vscode.window.showErrorMessage('Please connect to a SAP profile first.');
                return;
            }

            // Show quick pick with BSP applications
            const applications = await bspService.listBspApplications();
            
            const selected = await vscode.window.showQuickPick(
                applications.map(app => ({
                    label: app.name,
                    description: app.description,
                    detail: `Package: ${app.package}`
                })),
                {
                    placeHolder: 'Select a BSP application to download',
                    matchOnDescription: true,
                    matchOnDetail: true
                }
            );

            if (selected) {
                vscode.commands.executeCommand('bspManager.downloadBspByName', selected.label);
            }
        }),

        // Download BSP by name (from webview)
        vscode.commands.registerCommand('bspManager.downloadBspByName', async (appName: string) => {
            const bspService = bspWebviewProvider.getBspService();
            const configService = bspWebviewProvider.getConfigService();
            const currentProfile = bspWebviewProvider.getCurrentProfile();

            if (!bspService || !currentProfile) {
                vscode.window.showErrorMessage('Please connect to a SAP profile first.');
                return;
            }

            // Get target directory
            const workspaceFolders = vscode.workspace.workspaceFolders;
            let defaultUri: vscode.Uri | undefined;
            
            const configDownloadDir = vscode.workspace.getConfiguration('bspManager').get<string>('downloadDirectory');
            
            if (configDownloadDir) {
                defaultUri = vscode.Uri.file(configDownloadDir);
            } else if (workspaceFolders && workspaceFolders.length > 0) {
                defaultUri = workspaceFolders[0].uri;
            }

            const targetFolder = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri,
                openLabel: 'Select Download Location'
            });

            if (!targetFolder || targetFolder.length === 0) {
                return;
            }

            const targetDirectory = targetFolder[0].fsPath;
            const path = await import('path');

            // Download with progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Downloading BSP: ${appName}`,
                    cancellable: false
                },
                async (progress) => {
                    try {
                        await bspService.downloadBspApplication(appName, targetDirectory, progress);

                        // Get BSP details for .nwabaprc
                        const details = await bspService.getBspDetails(appName);

                        // Create .nwabaprc automatically
                        const autoCreate = vscode.workspace.getConfiguration('bspManager').get<boolean>('autoCreateNwabaprc', true);
                        
                        if (autoCreate) {
                            const appDir = path.join(targetDirectory, appName);
                            
                            await configService.createNwabaprcFromProfile(
                                appDir,
                                currentProfile,
                                {
                                    package: details.package,
                                    bspName: appName,
                                    bspText: details.description,
                                    transport: details.transport || ''
                                }
                            );
                        }

                        vscode.window.showInformationMessage(
                            `Successfully downloaded "${appName}" to ${targetDirectory}`,
                            'Open Folder'
                        ).then(selection => {
                            if (selection === 'Open Folder') {
                                const appFolder = vscode.Uri.file(path.join(targetDirectory, appName));
                                vscode.commands.executeCommand('vscode.openFolder', appFolder, { forceNewWindow: true });
                            }
                        });

                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to download BSP: ${error}`);
                    }
                }
            );
        }),

        // Upload BSP application
        vscode.commands.registerCommand('bspManager.uploadBsp', () => {
            uploadBspCommand(configService);
        }),

        // Configure connection (opens profile form)
        vscode.commands.registerCommand('bspManager.configure', () => {
            ProfileFormPanel.createOrShow(context.extensionUri, configService, undefined, () => {
                refreshAll();
            });
        }),

        // Refresh BSP Explorer
        vscode.commands.registerCommand('bspManager.refreshExplorer', () => {
            bspWebviewProvider.loadApplications();
        }),

        // Add profile (opens profile form)
        vscode.commands.registerCommand('bspManager.addProfile', () => {
            ProfileFormPanel.createOrShow(context.extensionUri, configService, undefined, () => {
                refreshAll();
            });
        }),

        // Edit profile (opens profile form with existing data)
        vscode.commands.registerCommand('bspManager.editProfile', (profileName?: string) => {
            ProfileFormPanel.createOrShow(context.extensionUri, configService, profileName, () => {
                refreshAll();
            });
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
            await bspWebviewProvider.loadApplications(targetProfile);
            updateStatusBar(configService);
            vscode.window.showInformationMessage(`Switched to profile "${targetProfile}"`);
        }),

        // Filter BSP applications (now just focuses webview)
        vscode.commands.registerCommand('bspManager.filterBsp', () => {
            vscode.commands.executeCommand('bspExplorer.focus');
        }),

        // Delete profile
        vscode.commands.registerCommand('bspManager.deleteProfile', async (profileName?: string) => {
            const profiles = configService.getProfiles();
            
            if (profiles.length === 0) {
                vscode.window.showInformationMessage('No profiles to delete.');
                return;
            }

            let targetProfile = profileName;

            if (!targetProfile) {
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
                targetProfile = selected.label;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to delete profile "${targetProfile}"?`,
                { modal: true },
                'Delete'
            );

            if (confirm === 'Delete') {
                await configService.deleteProfile(targetProfile);
                refreshAll();
                
                // If deleted profile was default, switch to another
                const remaining = configService.getProfiles();
                if (remaining.length > 0) {
                    await configService.setDefaultProfile(remaining[0].name);
                    await bspWebviewProvider.loadApplications(remaining[0].name);
                }
                
                updateStatusBar(configService);
                vscode.window.showInformationMessage(`Profile "${targetProfile}" deleted.`);
            }
        })
    ];

    // Add all disposables to subscriptions
    context.subscriptions.push(
        bspWebviewDisposable,
        profileExplorerView,
        statusBarItem,
        ...commands
    );

    // DON'T auto-load BSP applications - wait for user to click a profile
    // The webview will show "Click a profile to load BSP applications"
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
