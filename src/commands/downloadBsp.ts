import * as vscode from 'vscode';
import * as path from 'path';
import { BspExplorerProvider, BspTreeItem } from '../views/BspExplorer';

export async function downloadBspCommand(
    explorerProvider: BspExplorerProvider,
    bspItem?: BspTreeItem
): Promise<void> {
    const bspService = explorerProvider.getBspService();
    const configService = explorerProvider.getConfigService();
    const currentProfile = explorerProvider.getCurrentProfile();

    if (!bspService || !currentProfile) {
        vscode.window.showErrorMessage('Please connect to a SAP profile first.');
        return;
    }

    // Get BSP name from parameter or prompt user
    let bspName: string | undefined;

    if (bspItem && bspItem.contextValue === 'bspApplication') {
        bspName = bspItem.label;
    } else {
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

        if (!selected) {
            return;
        }

        bspName = selected.label;
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

    // Download with progress
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Downloading BSP: ${bspName}`,
            cancellable: false
        },
        async (progress) => {
            try {
                await bspService.downloadBspApplication(bspName!, targetDirectory, progress);

                // Get BSP details for .nwabaprc
                const details = await bspService.getBspDetails(bspName!);

                // Create .nwabaprc automatically without prompting for transport
                const autoCreate = vscode.workspace.getConfiguration('bspManager').get<boolean>('autoCreateNwabaprc', true);
                
                if (autoCreate) {
                    const appDir = path.join(targetDirectory, bspName!);
                    
                    // Auto-create .nwabaprc with existing transport (if any) - no prompt
                    await configService.createNwabaprcFromProfile(
                        appDir,
                        currentProfile,
                        {
                            package: details.package,
                            bspName: bspName!,
                            bspText: details.description,
                            transport: details.transport || ''
                        }
                    );
                }

                vscode.window.showInformationMessage(
                    `Successfully downloaded "${bspName}" to ${targetDirectory}`,
                    'Open Folder'
                ).then(selection => {
                    if (selection === 'Open Folder') {
                        const appFolder = vscode.Uri.file(path.join(targetDirectory, bspName!));
                        vscode.commands.executeCommand('vscode.openFolder', appFolder, { forceNewWindow: true });
                    }
                });

            } catch (error) {
                vscode.window.showErrorMessage(`Failed to download BSP: ${error}`);
            }
        }
    );
}
