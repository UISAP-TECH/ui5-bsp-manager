import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { SapConnection } from './SapConnection';

export interface BspApplication {
    name: string;
    description: string;
    package: string;
    createdBy?: string;
    createdAt?: string;
    changedBy?: string;
    changedAt?: string;
}

export interface BspFile {
    name: string;
    path: string;
    type: 'file' | 'folder';
    mimeType?: string;
    children?: BspFile[];
}

export class BspService {
    private connection: SapConnection;
    private xmlParser: XMLParser;

    constructor(connection: SapConnection) {
        this.connection = connection;
        this.xmlParser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });
    }

    /**
     * List all BSP applications with optional filtering
     */
    async listBspApplications(filter?: { name?: string; package?: string }): Promise<BspApplication[]> {
        try {
            // Get list of UI5 BSP applications using ADT filestore API
            const response = await this.connection.get('/sap/bc/adt/filestore/ui5-bsp/objects', {
                headers: {
                    'Accept': 'application/atom+xml'
                }
            });

            const parsed = this.xmlParser.parse(response);
            const entries = this.getEntries(parsed);

            let applications: BspApplication[] = entries.map((entry: any) => ({
                name: this.getAttr(entry, 'title') || entry.title || '',
                description: this.getAttr(entry, 'summary') || entry.summary || '',
                package: this.extractPackage(entry),
                createdBy: this.extractProperty(entry, 'createdBy'),
                createdAt: this.extractProperty(entry, 'createdAt'),
                changedBy: this.extractProperty(entry, 'changedBy'),
                changedAt: this.extractProperty(entry, 'changedAt')
            }));

            // Apply filters
            if (filter?.name) {
                const nameFilter = filter.name.toLowerCase();
                applications = applications.filter(app => 
                    app.name.toLowerCase().includes(nameFilter)
                );
            }

            if (filter?.package) {
                const packageFilter = filter.package.toLowerCase();
                applications = applications.filter(app => 
                    app.package.toLowerCase().includes(packageFilter)
                );
            }

            return applications.sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            console.error('Failed to list BSP applications:', error);
            throw new Error(`Failed to list BSP applications: ${error}`);
        }
    }

    /**
     * Get the structure of a BSP application (files and folders)
     */
    async getBspStructure(appName: string): Promise<BspFile[]> {
        try {
            const response = await this.connection.get(
                `/sap/bc/adt/filestore/ui5-bsp/objects/${encodeURIComponent(appName)}/content`,
                {
                    headers: {
                        'Accept': 'application/atom+xml'
                    }
                }
            );

            const parsed = this.xmlParser.parse(response);
            return this.parseFileStructure(parsed, '');
        } catch (error) {
            console.error('Failed to get BSP structure:', error);
            throw new Error(`Failed to get BSP structure for "${appName}": ${error}`);
        }
    }

    /**
     * Download a single file from BSP application
     */
    async downloadFile(appName: string, filePath: string): Promise<Buffer> {
        try {
            // Clean the file path (remove leading slash if present)
            const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
            
            const response = await this.connection.getRaw(
                `/sap/bc/adt/filestore/ui5-bsp/objects/${encodeURIComponent(appName)}/${encodeURIComponent(cleanPath)}/content`
            );

            return response;
        } catch (error) {
            console.error(`Failed to download file ${filePath}:`, error);
            throw new Error(`Failed to download file "${filePath}": ${error}`);
        }
    }

    /**
     * Download entire BSP application to a local directory
     */
    async downloadBspApplication(
        appName: string,
        targetDirectory: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        // Get application structure
        progress.report({ message: 'Getting application structure...' });
        const structure = await this.getBspStructure(appName);
        
        // Count total files for progress
        const totalFiles = this.countFiles(structure);
        let downloadedFiles = 0;

        // Create target directory if it doesn't exist
        const appDirectory = path.join(targetDirectory, appName);
        if (!fs.existsSync(appDirectory)) {
            fs.mkdirSync(appDirectory, { recursive: true });
        }

        // Download all files recursively
        await this.downloadFilesRecursively(
            appName,
            structure,
            appDirectory,
            '',
            progress,
            totalFiles,
            (count) => { downloadedFiles = count; }
        );

        progress.report({ message: `Downloaded ${downloadedFiles} files`, increment: 100 });
    }

    /**
     * Get BSP application details (package, transport, etc.)
     */
    async getBspDetails(appName: string): Promise<{ package: string; description: string; transport?: string }> {
        try {
            const response = await this.connection.get(
                `/sap/bc/adt/filestore/ui5-bsp/objects/${encodeURIComponent(appName)}`,
                {
                    headers: {
                        'Accept': 'application/atom+xml'
                    }
                }
            );

            const parsed = this.xmlParser.parse(response);
            
            return {
                package: this.extractPackage(parsed) || '$TMP',
                description: this.getAttr(parsed, 'summary') || parsed.summary || appName,
                transport: this.extractProperty(parsed, 'transport')
            };
        } catch (error) {
            console.error('Failed to get BSP details:', error);
            return {
                package: '$TMP',
                description: appName
            };
        }
    }

    // ===== Private Helper Methods =====

    private getEntries(parsed: any): any[] {
        const feed = parsed.feed || parsed['atom:feed'] || parsed;
        const entries = feed.entry || feed['atom:entry'] || [];
        return Array.isArray(entries) ? entries : [entries].filter(Boolean);
    }

    private getAttr(obj: any, name: string): string | undefined {
        if (!obj) {return undefined;}
        return obj[name] || obj[`atom:${name}`] || obj[`@_${name}`];
    }

    private extractPackage(entry: any): string {
        // Try to find package in different possible locations
        const content = entry.content || entry['atom:content'] || {};
        const properties = content['m:properties'] || content.properties || entry.properties || {};
        return properties['d:Package'] || properties.Package || properties.package || '$TMP';
    }

    private extractProperty(entry: any, propName: string): string | undefined {
        const content = entry.content || entry['atom:content'] || {};
        const properties = content['m:properties'] || content.properties || entry.properties || {};
        return properties[`d:${propName}`] || properties[propName];
    }

    private parseFileStructure(parsed: any, basePath: string): BspFile[] {
        const entries = this.getEntries(parsed);
        const files: BspFile[] = [];

        for (const entry of entries) {
            const title = this.getAttr(entry, 'title') || entry.title || '';
            const category = entry.category || entry['atom:category'];
            const term = category?.['@_term'] || category?.term || '';
            
            const isFolder = term.includes('folder') || term.includes('directory');
            const filePath = basePath ? `${basePath}/${title}` : title;

            files.push({
                name: title,
                path: filePath,
                type: isFolder ? 'folder' : 'file',
                mimeType: isFolder ? undefined : (entry['atom:content']?.['@_type'] || 'application/octet-stream')
            });
        }

        return files;
    }

    private countFiles(files: BspFile[]): number {
        let count = 0;
        for (const file of files) {
            if (file.type === 'file') {
                count++;
            }
            if (file.children) {
                count += this.countFiles(file.children);
            }
        }
        return count || 1; // At least 1 to avoid division by zero
    }

    private async downloadFilesRecursively(
        appName: string,
        files: BspFile[],
        targetDir: string,
        currentPath: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        totalFiles: number,
        updateCount: (count: number) => void
    ): Promise<number> {
        let downloadedCount = 0;

        for (const file of files) {
            const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
            const localPath = path.join(targetDir, file.name);

            if (file.type === 'folder') {
                // Create directory
                if (!fs.existsSync(localPath)) {
                    fs.mkdirSync(localPath, { recursive: true });
                }

                // Get folder contents
                try {
                    const folderStructure = await this.getFolderContents(appName, filePath);
                    const subCount = await this.downloadFilesRecursively(
                        appName,
                        folderStructure,
                        localPath,
                        filePath,
                        progress,
                        totalFiles,
                        updateCount
                    );
                    downloadedCount += subCount;
                } catch (error) {
                    console.error(`Failed to get folder contents for ${filePath}:`, error);
                }
            } else {
                // Download file
                try {
                    progress.report({ 
                        message: `Downloading: ${file.name}`,
                        increment: (1 / totalFiles) * 100
                    });

                    const content = await this.downloadFile(appName, filePath);
                    fs.writeFileSync(localPath, content);
                    downloadedCount++;
                    updateCount(downloadedCount);
                } catch (error) {
                    console.error(`Failed to download ${filePath}:`, error);
                }
            }
        }

        return downloadedCount;
    }

    private async getFolderContents(appName: string, folderPath: string): Promise<BspFile[]> {
        try {
            const response = await this.connection.get(
                `/sap/bc/adt/filestore/ui5-bsp/objects/${encodeURIComponent(appName)}/${encodeURIComponent(folderPath)}/content`,
                {
                    headers: {
                        'Accept': 'application/atom+xml'
                    }
                }
            );

            const parsed = this.xmlParser.parse(response);
            return this.parseFileStructure(parsed, folderPath);
        } catch (error) {
            console.error(`Failed to get folder contents for ${folderPath}:`, error);
            return [];
        }
    }
}
