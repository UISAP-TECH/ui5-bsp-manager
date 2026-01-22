import * as vscode from 'vscode';
import { BspExplorerProvider } from '../views/BspExplorer';

export async function filterBspCommand(explorerProvider: BspExplorerProvider): Promise<void> {
    const filterType = await vscode.window.showQuickPick(
        [
            { label: '$(search) Filter by Name', value: 'name' },
            { label: '$(package) Filter by Package', value: 'package' },
            { label: '$(filter) Filter by Both', value: 'both' },
            { label: '$(close) Clear Filter', value: 'clear' }
        ],
        { placeHolder: 'Select filter type' }
    );

    if (!filterType) {
        return;
    }

    if (filterType.value === 'clear') {
        explorerProvider.clearFilter();
        vscode.window.showInformationMessage('Filter cleared');
        return;
    }

    let nameFilter: string | undefined;
    let packageFilter: string | undefined;

    if (filterType.value === 'name' || filterType.value === 'both') {
        nameFilter = await vscode.window.showInputBox({
            prompt: 'Enter BSP name filter (partial match)',
            placeHolder: 'e.g., ZUI5'
        });

        if (filterType.value === 'name' && !nameFilter) {
            return;
        }
    }

    if (filterType.value === 'package' || filterType.value === 'both') {
        packageFilter = await vscode.window.showInputBox({
            prompt: 'Enter package filter (partial match)',
            placeHolder: 'e.g., ZMY_PACKAGE'
        });

        if (filterType.value === 'package' && !packageFilter) {
            return;
        }
    }

    explorerProvider.setFilter(nameFilter, packageFilter);
    
    const filterDescription = [];
    if (nameFilter) {filterDescription.push(`Name: "${nameFilter}"`);}
    if (packageFilter) {filterDescription.push(`Package: "${packageFilter}"`);}
    
    vscode.window.showInformationMessage(`Filter applied: ${filterDescription.join(', ')}`);
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
