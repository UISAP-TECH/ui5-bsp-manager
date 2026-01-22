import * as vscode from 'vscode';
import { BspExplorerProvider } from '../views/BspExplorer';

export async function filterBspCommand(explorerProvider: BspExplorerProvider): Promise<void> {
    const currentSearch = explorerProvider.getSearchTerm();
    
    const searchTerm = await vscode.window.showInputBox({
        prompt: 'Search BSP applications (name, description, or package)',
        placeHolder: 'e.g., ZUI5 or $TMP',
        value: currentSearch,
        valueSelection: [0, currentSearch.length]
    });

    if (searchTerm === undefined) {
        // User cancelled
        return;
    }

    if (searchTerm.trim() === '') {
        explorerProvider.clearSearch();
        vscode.window.showInformationMessage('Search cleared - showing all BSP applications');
    } else {
        explorerProvider.setSearchTerm(searchTerm);
        vscode.window.showInformationMessage(`Filtering by: "${searchTerm}"`);
    }
}

export async function listBspCommand(explorerProvider: BspExplorerProvider): Promise<void> {
    const bspService = explorerProvider.getBspService();

    if (!bspService) {
        vscode.window.showErrorMessage('Please connect to a SAP profile first.');
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Loading BSP applications...',
            cancellable: false
        },
        async () => {
            try {
                const applications = await bspService.listBspApplications();
                
                const selected = await vscode.window.showQuickPick(
                    applications.map(app => ({
                        label: app.name,
                        description: app.description,
                        detail: `Package: ${app.package}`
                    })),
                    {
                        placeHolder: `Found ${applications.length} BSP applications`,
                        matchOnDescription: true,
                        matchOnDetail: true
                    }
                );

                if (selected) {
                    const action = await vscode.window.showQuickPick(
                        [
                            { label: '$(cloud-download) Download', value: 'download' },
                            { label: '$(info) View Details', value: 'details' }
                        ],
                        { placeHolder: `Action for ${selected.label}` }
                    );

                    if (action?.value === 'download') {
                        vscode.commands.executeCommand('bspManager.downloadBsp');
                    } else if (action?.value === 'details') {
                        const details = await bspService.getBspDetails(selected.label);
                        vscode.window.showInformationMessage(
                            `${selected.label}\nDescription: ${details.description}\nPackage: ${details.package}\nTransport: ${details.transport || 'N/A'}`
                        );
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to list BSP applications: ${error}`);
            }
        }
    );
}
