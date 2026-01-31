import * as vscode from 'vscode';
import { ProfileExplorerProvider } from './views/BspExplorer';
import { BspWebviewProvider } from './views/BspWebviewProvider';
import { ProfileFormPanel } from './views/ProfileFormPanel';
import { DeployFormPanel } from './views/DeployFormPanel';
import { CreateProjectPanel } from './views/CreateProjectPanel';
import { DeployService } from './services/DeployService';
import { ConfigService } from './services/ConfigService';
import { uploadBspCommand } from './commands/uploadBsp';
import { I18nEditorProvider } from './editors/I18nEditorProvider';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    try {
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

        // Register Custom I18n Editor Provider
        context.subscriptions.push(I18nEditorProvider.register(context));

        // Update status bar based on CURRENTLY LOADED profile (not default)
        const updateStatusBar = () => {
            const currentProfileName = bspWebviewProvider.getCurrentProfile();
            
            if (currentProfileName) {
                const profile = configService.getProfile(currentProfileName);
                if (profile) {
                    statusBarItem.text = `$(server) ${profile.name}`;
                    statusBarItem.tooltip = `Active SAP Profile: ${profile.name}\n${profile.server} (Client: ${profile.client})`;
                    statusBarItem.show();
                } else {
                    statusBarItem.hide();
                }
            } else {
                statusBarItem.hide(); // Hide if no profile loaded
            }
        };

        // Function to refresh all views
        const refreshAll = () => {
            configService.reload();
            // Don't auto-load webview. User must explicitly "Load BSP Applications".
            profileExplorerProvider.refresh();
            updateStatusBar();
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

        // Create status bar item for Active Profile
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        // Remove command from status bar if user just wants display? 
        // Or keep 'switchProfile'? User said "seçili olmasın".
        // If hidden, command doesn't matter.
        statusBarItem.command = 'bspManager.switchProfile'; 
        updateStatusBar(); // Will hide initially if no profile loaded
        
        // Create status bar item for Add Profile (Persistent accessibility)
        const addProfileStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        addProfileStatusBar.text = "$(add) New Profile";
        addProfileStatusBar.command = 'bspManager.addProfile';
        addProfileStatusBar.tooltip = "Add a new SAP Profile";
        addProfileStatusBar.show();
        context.subscriptions.push(addProfileStatusBar);

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

            // Upload BSP application (Deploy)
            vscode.commands.registerCommand('bspManager.uploadBsp', async () => {
                // Decoupled from active BspService to allow Wizard to handle connection
                const deployService = new DeployService(configService);
                DeployFormPanel.createOrShow(context.extensionUri, configService, deployService);
            }),

            // Deploy from Context Menu (File/Folder)
            vscode.commands.registerCommand('bspManager.deployFromContext', async (uri: vscode.Uri) => {
                const deployService = new DeployService(configService);
                
                // If triggered from command palette, uri might be undefined
                // If from context menu, it's the file/folder uri
                let targetPath = uri ? uri.fsPath : undefined;
                
                // If no path, try active editor (loose context)
                if (!targetPath) {
                    if (vscode.window.activeTextEditor) {
                        targetPath = vscode.window.activeTextEditor.document.uri.fsPath;
                    }
                }

                if (targetPath) {
                    // Open wizard with pre-selected path
                    DeployFormPanel.createOrShow(context.extensionUri, configService, deployService, targetPath);
                } else {
                    vscode.window.showErrorMessage('No file or project context found for deployment.');
                }
            }),

            // Configure connection (opens profile form)
            vscode.commands.registerCommand('bspManager.configure', () => {
                ProfileFormPanel.createOrShow(context.extensionUri, configService, undefined, () => {
                    refreshAll();
                });
            }),

            // Refresh BSP Explorer
            vscode.commands.registerCommand('bspManager.refreshExplorer', () => {
                // Loading manually triggers status bar update in loadApplications? 
                // updateStatusBar logic reads currentProfile.
                // But loadApplications is valid. 
                // We should call updateStatusBar AFTER loadApplications completes?
                // loadApplications is async. It sets currentProfile.
                bspWebviewProvider.loadApplications().then(() => {
                    updateStatusBar();
                });
            }),

            // Add profile (opens profile form)
            vscode.commands.registerCommand('bspManager.addProfile', () => {
                ProfileFormPanel.createOrShow(context.extensionUri, configService, undefined, () => {
                    refreshAll();
                });
            }),

            // Edit profile
            vscode.commands.registerCommand('bspManager.editProfile', (arg?: any) => {
                const profileName = getProfileName(arg);
                ProfileFormPanel.createOrShow(context.extensionUri, configService, profileName, () => {
                    refreshAll();
                });
            }),

            // Switch profile
            vscode.commands.registerCommand('bspManager.switchProfile', async (arg?: any) => {
                // Check context menu/arg call
                let targetProfile = getProfileName(arg);
                
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

                if (!targetProfile) {
                    const currentProfile = bspWebviewProvider.getCurrentProfile(); // Use loaded profile for check
                    
                    const selected = await vscode.window.showQuickPick(
                        profiles.map(p => ({
                            label: p.name === currentProfile ? `$(star-full) ${p.name}` : p.name,
                            description: `${p.server} (Client: ${p.client})`,
                            profileName: p.name
                        })),
                        { placeHolder: 'Select SAP profile to switch to' }
                    );

                    if (!selected) return;
                    targetProfile = selected.profileName;
                }

                // Switch = Load
                // await configService.setDefaultProfile(targetProfile); // User doesn't want default change on switch?
                // The command is "Switch Profile".
                
                await bspWebviewProvider.loadApplications(targetProfile);
                updateStatusBar();
                
                // Select/Reveal in Tree View
                const item = await profileExplorerProvider.getTreeItemByProfileName(targetProfile);
                if (item) {
                    profileExplorerView.reveal(item, { select: true, focus: false });
                }

                vscode.window.showInformationMessage(`Switched to profile "${targetProfile}"`);
            }),

            // Load BSPs from profile (Run/Load context menu action)
            vscode.commands.registerCommand('bspManager.loadBspFromProfile', async (arg?: any) => {
                const profileName = getProfileName(arg);
                if (profileName) {
                    await bspWebviewProvider.loadApplications(profileName);
                    updateStatusBar(); // Update status bar after load
                    
                    // Select/Reveal in Tree View
                    const item = await profileExplorerProvider.getTreeItemByProfileName(profileName);
                    if (item) {
                        profileExplorerView.reveal(item, { select: true, focus: false });
                    }

                    // Focus the webview after a short delay to allow it to render
                    setTimeout(() => {
                        vscode.commands.executeCommand('bspExplorer.focus');
                    }, 100);

                } else {
                    vscode.window.showErrorMessage('Could not determine profile name.');
                }
            }),

            // Set Default Profile
            vscode.commands.registerCommand('bspManager.setDefaultProfile', async (arg?: any) => {
                const profileName = getProfileName(arg);
                if (profileName) {
                    await configService.setDefaultProfile(profileName);
                    refreshAll(); 
                    vscode.window.showInformationMessage(`"${profileName}" is now the default profile.`);
                }
            }),

            // Unset Default Profile
            vscode.commands.registerCommand('bspManager.unsetDefaultProfile', async (arg?: any) => {
                await configService.setDefaultProfile(''); // Clear default
                refreshAll();
                vscode.window.showInformationMessage('Default profile cleared.');
            }),

            // Filter BSP applications (now just focuses webview)
            vscode.commands.registerCommand('bspManager.filterBsp', () => {
                vscode.commands.executeCommand('bspExplorer.focus');
            }),

            // Delete profile
            vscode.commands.registerCommand('bspManager.deleteProfile', async (arg?: any) => {
                const profiles = configService.getProfiles();
                if (profiles.length === 0) {
                    vscode.window.showInformationMessage('No profiles to delete.');
                    return;
                }

                let targetProfile = getProfileName(arg);

                // ... selection logic same as before ...
                if (!targetProfile) {
                    const selected = await vscode.window.showQuickPick(
                        profiles.map(p => ({
                            label: p.name,
                            description: p.server
                        })),
                        { placeHolder: 'Select profile to delete' }
                    );
                    if (!selected) return;
                    targetProfile = selected.label;
                }

                const confirm = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete profile "${targetProfile}"?`,
                    { modal: true },
                    'Delete'
                );

                if (confirm === 'Delete') {
                    await configService.deleteProfile(targetProfile);
                    
                    // If deleted was current view, clear view?
                    if (bspWebviewProvider.getCurrentProfile() === targetProfile) {
                        bspWebviewProvider.loadApplications(''); // Clear
                    }
                    
                    refreshAll();
                    vscode.window.showInformationMessage(`Profile "${targetProfile}" deleted.`);
                }
            }),

            // Create SAPUI5 Project
            vscode.commands.registerCommand('bspManager.createProject', () => {
                CreateProjectPanel.createOrShow(context.extensionUri, configService);
            }),

            // Open I18n Visual Editor (from toolbar)
            vscode.commands.registerCommand('bspManager.openI18nEditor', (uri: vscode.Uri) => {
                if (uri) {
                    vscode.commands.executeCommand('vscode.openWith', uri, 'bspManager.i18nEditor');
                } else if (vscode.window.activeTextEditor) {
                    vscode.commands.executeCommand('vscode.openWith', vscode.window.activeTextEditor.document.uri, 'bspManager.i18nEditor');
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
    } catch (error) {
        console.error('Failed to activate extension:', error);
        vscode.window.showErrorMessage(`BSP Manager Activation Failed: ${error}`);
    }
}

// Helper to handle mixed argument types (string | TreeItem) from commands
function getProfileName(arg: any): string | undefined {
    if (typeof arg === 'string') return arg;
    if (arg && typeof arg === 'object') {
        if (arg.label) {
            // Check if label is string or TreeItemLabel
            return typeof arg.label === 'string' ? arg.label : arg.label.label;
        }
    }
    return undefined;
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
