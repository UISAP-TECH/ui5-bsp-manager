import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SapProfile, SapConnectionConfig } from './SapConnection';

const PROFILES_KEY = 'bspManager.profiles';
const PASSWORDS_KEY = 'bspManager.passwords';

export interface NwabapConfig {
    base: string;
    conn_server: string;
    conn_client: string;
    conn_user: string;
    conn_password: string;
    conn_usestrictssl: boolean;
    abap_package: string;
    abap_bsp: string;
    abap_bsp_text: string;
    abap_transport: string;
}

export class ConfigService {
    private context: vscode.ExtensionContext;
    private profiles: Map<string, SapProfile> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadProfiles();
    }

    /**
     * Load profiles from global state
     */
    private loadProfiles(): void {
        const storedProfiles = this.context.globalState.get<Record<string, SapProfile>>(PROFILES_KEY, {});
        this.profiles = new Map(Object.entries(storedProfiles));
    }

    /**
     * Reload profiles from storage (for external refresh)
     */
    reload(): void {
        this.loadProfiles();
    }

    /**
     * Save profiles to global state
     */
    private async saveProfiles(): Promise<void> {
        const profilesObj = Object.fromEntries(this.profiles);
        await this.context.globalState.update(PROFILES_KEY, profilesObj);
    }

    /**
     * Get all profiles
     */
    getProfiles(): SapProfile[] {
        return Array.from(this.profiles.values());
    }

    /**
     * Get a specific profile by name
     */
    getProfile(name: string): SapProfile | undefined {
        return this.profiles.get(name);
    }

    /**
     * Add or update a profile
     */
    async saveProfile(profile: SapProfile): Promise<void> {
        this.profiles.set(profile.name, profile);
        await this.saveProfiles();
    }

    /**
     * Delete a profile
     */
    async deleteProfile(name: string): Promise<void> {
        this.profiles.delete(name);
        await this.context.secrets.delete(`${PASSWORDS_KEY}.${name}`);
        await this.saveProfiles();
    }

    /**
     * Store password securely
     */
    async storePassword(profileName: string, password: string): Promise<void> {
        await this.context.secrets.store(`${PASSWORDS_KEY}.${profileName}`, password);
    }

    /**
     * Get password securely
     */
    async getPassword(profileName: string): Promise<string | undefined> {
        return await this.context.secrets.get(`${PASSWORDS_KEY}.${profileName}`);
    }

    /**
     * Get full connection config with password
     */
    async getConnectionConfig(profileName: string): Promise<SapConnectionConfig | undefined> {
        const profile = this.getProfile(profileName);
        if (!profile) {
            return undefined;
        }

        const password = await this.getPassword(profileName);
        if (!password) {
            return undefined;
        }

        return {
            ...profile,
            password
        };
    }

    /**
     * Get default profile name
     */
    getDefaultProfile(): string {
        return vscode.workspace.getConfiguration('bspManager').get<string>('defaultProfile', '');
    }

    /**
     * Set default profile
     */
    async setDefaultProfile(profileName: string): Promise<void> {
        await vscode.workspace.getConfiguration('bspManager').update('defaultProfile', profileName, true);
    }

    /**
     * Read .nwabaprc file from a directory
     */
    readNwabaprc(directory: string): NwabapConfig | undefined {
        const configPath = path.join(directory, '.nwabaprc');
        
        if (!fs.existsSync(configPath)) {
            return undefined;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(content) as NwabapConfig;
        } catch (error) {
            console.error('Failed to parse .nwabaprc:', error);
            return undefined;
        }
    }

    /**
     * Write .nwabaprc file to a directory
     */
    writeNwabaprc(directory: string, config: NwabapConfig): void {
        const configPath = path.join(directory, '.nwabaprc');
        const content = JSON.stringify(config, null, 2);
        fs.writeFileSync(configPath, content, 'utf-8');
    }

    /**
     * Create .nwabaprc from a profile and BSP details
     */
    async createNwabaprcFromProfile(
        directory: string,
        profileName: string,
        bspDetails: {
            package: string;
            bspName: string;
            bspText: string;
            transport: string;
        }
    ): Promise<void> {
        const config = await this.getConnectionConfig(profileName);
        if (!config) {
            throw new Error(`Profile "${profileName}" not found or password not set`);
        }

        const nwabapConfig: NwabapConfig = {
            base: './dist',
            conn_server: config.server,
            conn_client: config.client,
            conn_user: config.user,
            conn_password: config.password,
            conn_usestrictssl: config.useStrictSSL,
            abap_package: bspDetails.package,
            abap_bsp: bspDetails.bspName,
            abap_bsp_text: bspDetails.bspText,
            abap_transport: bspDetails.transport
        };

        this.writeNwabaprc(directory, nwabapConfig);
    }

    /**
     * Prompt user to create a new profile
     */
    async promptNewProfile(): Promise<SapProfile | undefined> {
        const name = await vscode.window.showInputBox({
            prompt: 'Profile Name (e.g., DEV, TEST, PROD)',
            placeHolder: 'DEV',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Profile name is required';
                }
                if (this.profiles.has(value)) {
                    return 'Profile name already exists';
                }
                return undefined;
            }
        });

        if (!name) {
            return undefined;
        }

        const server = await vscode.window.showInputBox({
            prompt: 'SAP Server URL',
            placeHolder: 'http://sap-server:8000/',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Server URL is required';
                }
                try {
                    new URL(value);
                    return undefined;
                } catch {
                    return 'Invalid URL format';
                }
            }
        });

        if (!server) {
            return undefined;
        }

        const client = await vscode.window.showInputBox({
            prompt: 'SAP Client',
            placeHolder: '100',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Client is required';
                }
                if (!/^\d{3}$/.test(value)) {
                    return 'Client must be a 3-digit number';
                }
                return undefined;
            }
        });

        if (!client) {
            return undefined;
        }

        const user = await vscode.window.showInputBox({
            prompt: 'SAP Username',
            placeHolder: 'USERNAME'
        });

        if (!user) {
            return undefined;
        }

        const password = await vscode.window.showInputBox({
            prompt: 'SAP Password',
            password: true
        });

        if (!password) {
            return undefined;
        }

        const useStrictSSL = await vscode.window.showQuickPick(
            [
                { label: 'Yes', value: true },
                { label: 'No (for self-signed certificates)', value: false }
            ],
            { placeHolder: 'Use strict SSL?' }
        );

        if (!useStrictSSL) {
            return undefined;
        }

        const profile: SapProfile = {
            name,
            server,
            client,
            user,
            useStrictSSL: useStrictSSL.value
        };

        await this.saveProfile(profile);
        await this.storePassword(name, password);

        return profile;
    }
}
