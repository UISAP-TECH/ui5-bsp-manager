import * as vscode from 'vscode';
import { BspApplication, BspService } from '../services/BspService';
import { SapConnection } from '../services/SapConnection';
import { ConfigService } from '../services/ConfigService';

export class BspExplorerProvider implements vscode.TreeDataProvider<BspTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BspTreeItem | undefined | null | void> = new vscode.EventEmitter<BspTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<BspTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private allApplications: BspApplication[] = []; // All loaded apps
    private applications: BspApplication[] = []; // Filtered apps
    private currentProfile: string | undefined;
    private bspService: BspService | undefined;
    private searchTerm: string = ''; // Current search term
    private isLoading: boolean = false;
    private errorMessage: string | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private configService: ConfigService
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Set search term and filter applications instantly (no server call)
     */
    setSearchTerm(term: string): void {
        this.searchTerm = term.toLowerCase().trim();
        this.filterApplications();
        this.refresh();
    }

    /**
     * Clear search and show all applications
     */
    clearSearch(): void {
        this.searchTerm = '';
        this.applications = [...this.allApplications];
        this.refresh();
    }

    /**
     * Get current search term
     */
    getSearchTerm(): string {
        return this.searchTerm;
    }

    /**
     * Filter applications locally based on search term
     */
    private filterApplications(): void {
        if (!this.searchTerm) {
            this.applications = [...this.allApplications];
            return;
        }

        this.applications = this.allApplications.filter(app => 
            app.name.toLowerCase().includes(this.searchTerm) ||
            app.description.toLowerCase().includes(this.searchTerm) ||
            app.package.toLowerCase().includes(this.searchTerm)
        );
    }

    async loadApplications(profileName?: string): Promise<void> {
        this.isLoading = true;
        this.errorMessage = undefined;
        this.refresh();

        try {
            const targetProfile = profileName || this.configService.getDefaultProfile();
            
            if (!targetProfile) {
                this.errorMessage = 'No SAP profile configured. Click + to add one.';
                this.isLoading = false;
                this.refresh();
                return;
            }

            const config = await this.configService.getConnectionConfig(targetProfile);
            if (!config) {
                this.errorMessage = `Profile "${targetProfile}" not found or password not set.`;
                this.isLoading = false;
                this.refresh();
                return;
            }

            const connection = new SapConnection(config);
            
            // Test connection first
            const isConnected = await connection.testConnection();
            if (!isConnected) {
                this.errorMessage = 'Failed to connect to SAP server. Check your configuration.';
                this.isLoading = false;
                this.refresh();
                return;
            }

            this.bspService = new BspService(connection);
            this.currentProfile = targetProfile;
            this.allApplications = await this.bspService.listBspApplications();
            this.filterApplications(); // Apply any existing search term
            
        } catch (error) {
            this.errorMessage = `Error: ${error}`;
            this.allApplications = [];
            this.applications = [];
        }

        this.isLoading = false;
        this.refresh();
    }

    // Deprecated: use setSearchTerm instead
    setFilter(name?: string, packageName?: string): void {
        if (name) {
            this.setSearchTerm(name);
        } else {
            this.clearSearch();
        }
    }

    // Deprecated: use clearSearch instead
    clearFilter(): void {
        this.clearSearch();
    }

    getTreeItem(element: BspTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: BspTreeItem): Thenable<BspTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        if (this.isLoading) {
            return Promise.resolve([
                new BspTreeItem('Loading...', '', '', vscode.TreeItemCollapsibleState.None, 'loading')
            ]);
        }

        if (this.errorMessage) {
            const errorItem = new BspTreeItem(
                this.errorMessage,
                '',
                '',
                vscode.TreeItemCollapsibleState.None,
                'error'
            );
            errorItem.command = {
                command: 'bspManager.addProfile',
                title: 'Add SAP Profile'
            };
            return Promise.resolve([errorItem]);
        }

        if (this.applications.length === 0) {
            return Promise.resolve([
                new BspTreeItem('No BSP applications found', '', '', vscode.TreeItemCollapsibleState.None, 'info')
            ]);
        }

        return Promise.resolve(
            this.applications.map(app => 
                new BspTreeItem(
                    app.name,
                    app.description,
                    app.package,
                    vscode.TreeItemCollapsibleState.None,
                    'bspApplication'
                )
            )
        );
    }

    getBspService(): BspService | undefined {
        return this.bspService;
    }

    getCurrentProfile(): string | undefined {
        return this.currentProfile;
    }

    getConfigService(): ConfigService {
        return this.configService;
    }
}

export class BspTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly packageName: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
        
        this.tooltip = this.buildTooltip();
        this.iconPath = this.getIcon();
    }

    private buildTooltip(): string {
        if (this.contextValue === 'bspApplication') {
            return `${this.label}\n${this.description}\nPackage: ${this.packageName}`;
        }
        return this.label;
    }

    private getIcon(): vscode.ThemeIcon | undefined {
        switch (this.contextValue) {
            case 'bspApplication':
                return new vscode.ThemeIcon('package');
            case 'loading':
                return new vscode.ThemeIcon('loading~spin');
            case 'error':
                return new vscode.ThemeIcon('error');
            case 'info':
                return new vscode.ThemeIcon('info');
            default:
                return undefined;
        }
    }
}

// Profile Explorer Provider - now receives shared ConfigService
export class ProfileExplorerProvider implements vscode.TreeDataProvider<ProfileTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProfileTreeItem | undefined | null | void> = new vscode.EventEmitter<ProfileTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProfileTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private context: vscode.ExtensionContext,
        private configService: ConfigService
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ProfileTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ProfileTreeItem): Thenable<ProfileTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const profiles = this.configService.getProfiles();
        const defaultProfile = this.configService.getDefaultProfile();

        if (profiles.length === 0) {
            const noProfileItem = new ProfileTreeItem(
                'No profiles configured',
                '',
                false,
                'noProfile'
            );
            noProfileItem.command = {
                command: 'bspManager.addProfile',
                title: 'Add Profile'
            };
            return Promise.resolve([noProfileItem]);
        }

        return Promise.resolve(
            profiles.map(profile => 
                new ProfileTreeItem(
                    profile.name,
                    `${profile.server} (Client: ${profile.client})`,
                    profile.name === defaultProfile,
                    'profile'
                )
            )
        );
    }

    getConfigService(): ConfigService {
        return this.configService;
    }
}

export class ProfileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly serverInfo: string,
        public readonly isDefault: boolean,
        public readonly contextValue: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        
        this.description = this.serverInfo;
        this.tooltip = `${this.label}\n${this.serverInfo}${this.isDefault ? '\n(Default)' : ''}`;
        this.iconPath = this.getIcon();

        if (contextValue === 'profile') {
            this.command = {
                command: 'bspManager.editProfile',
                title: 'Edit Profile',
                arguments: [this.label]
            };
        }
    }

    private getIcon(): vscode.ThemeIcon {
        if (this.contextValue === 'noProfile') {
            return new vscode.ThemeIcon('add');
        }
        return this.isDefault 
            ? new vscode.ThemeIcon('star-full') 
            : new vscode.ThemeIcon('account');
    }
}
