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
    type: 'file' | 'folder';
    mimeType?: string;
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
     * Get contents of a path within BSP application
     * @param appName - BSP application name
     * @param relativePath - relative path within the app (empty for root)
     */
    async getContents(appName: string, relativePath: string = ''): Promise<BspFile[]> {
        try {
            // Build URL - SAP expects paths encoded with %2f instead of /
            let url = `/sap/bc/adt/filestore/ui5-bsp/objects/${appName}`;
            if (relativePath) {
                // Encode the path: appName%2frelativePath
                const encodedPath = `${appName}%2f${relativePath.replace(/\//g, '%2f')}`;
                url = `/sap/bc/adt/filestore/ui5-bsp/objects/${encodedPath}`;
            }
            url += '/content';

            const response = await this.connection.get(url, {
                headers: {
                    'Accept': 'application/atom+xml'
                }
            });

            const parsed = this.xmlParser.parse(response);
            return this.parseContents(parsed);
        } catch (error) {
            console.error(`Failed to get contents for path "${relativePath}":`, error);
            return [];
        }
    }

    /**
     * Download a single file from BSP application
     */
    async downloadFile(appName: string, relativePath: string): Promise<Buffer> {
        // Build URL - SAP expects paths encoded with %2f instead of /
        // Full path: appName%2frelativePath
        const encodedPath = `${appName}%2f${relativePath.replace(/\//g, '%2f')}`;
        const url = `/sap/bc/adt/filestore/ui5-bsp/objects/${encodedPath}/content`;
        
        const response = await this.connection.getRaw(url);
        return response;
    }

    /**
     * Download entire BSP application to a local directory
     */
    async downloadBspApplication(
        appName: string,
        targetDirectory: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        // Create target directory with app name
        const appDirectory = path.join(targetDirectory, appName);
        if (!fs.existsSync(appDirectory)) {
            fs.mkdirSync(appDirectory, { recursive: true });
        }

        progress.report({ message: 'Getting application structure...' });
        
        // Get root contents (files and folders directly in the app)
        const rootContents = await this.getContents(appName, '');
        
        // Download all files recursively
        const filesDownloaded = await this.downloadRecursively(
            appName,
            appDirectory,
            rootContents,
            '', // Start with empty relative path
            progress
        );

        progress.report({ message: `Downloaded ${filesDownloaded} files` });
    }

    /**
     * Recursively download files and folders
     */
    private async downloadRecursively(
        appName: string,
        localBaseDir: string,
        items: BspFile[],
        currentRelativePath: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<number> {
        let count = 0;

        for (const item of items) {
            // Build relative path for API calls
            const itemRelativePath = currentRelativePath 
                ? `${currentRelativePath}/${item.name}` 
                : item.name;
            
            // Build local path
            const localPath = path.join(localBaseDir, item.name);

            if (item.type === 'folder') {
                // Create local folder
                if (!fs.existsSync(localPath)) {
                    fs.mkdirSync(localPath, { recursive: true });
                }

                // Get folder contents from SAP
                progress.report({ message: `Scanning: ${item.name}/` });
                const folderContents = await this.getContents(appName, itemRelativePath);
                
                // Recursively download folder contents
                const subCount = await this.downloadRecursively(
                    appName,
                    localPath,
                    folderContents,
                    itemRelativePath,
                    progress
                );
                count += subCount;
            } else {
                // Download file
                progress.report({ message: `Downloading: ${item.name}` });
                
                try {
                    const content = await this.downloadFile(appName, itemRelativePath);
                    fs.writeFileSync(localPath, content);
                    count++;
                } catch (error) {
                    console.error(`Error downloading ${itemRelativePath}:`, error);
                }
            }
        }

        return count;
    }

    /**
     * Get BSP application details (package, transport, etc.)
     */
    async getBspDetails(appName: string): Promise<{ package: string; description: string; transport?: string }> {
        try {
            const response = await this.connection.get(
                `/sap/bc/adt/filestore/ui5-bsp/objects/${appName}`,
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
        const content = entry.content || entry['atom:content'] || {};
        const properties = content['m:properties'] || content.properties || entry.properties || {};
        return properties['d:Package'] || properties.Package || properties.package || '$TMP';
    }

    private extractProperty(entry: any, propName: string): string | undefined {
        const content = entry.content || entry['atom:content'] || {};
        const properties = content['m:properties'] || content.properties || entry.properties || {};
        return properties[`d:${propName}`] || properties[propName];
    }

    /**
     * Parse XML response to get file/folder list
     */
    private parseContents(parsed: any): BspFile[] {
        const entries = this.getEntries(parsed);
        const files: BspFile[] = [];

        for (const entry of entries) {
            const fullTitle = this.getAttr(entry, 'title') || entry.title || '';
            
            // Skip if no title
            if (!fullTitle) {continue;}
            
            // SAP returns full path like "APP_NAME/folder/file.js"
            // We only need the last segment (filename or folder name)
            const pathParts = fullTitle.split('/');
            const name = pathParts[pathParts.length - 1];
            
            // Skip if empty name after parsing
            if (!name) {continue;}
            
            // Determine if folder or file based on category term
            const category = entry.category || entry['atom:category'];
            let isFolder = false;
            
            if (category) {
                const term = category['@_term'] || category.term || '';
                // Check for folder indicators
                isFolder = /folder|directory/i.test(term);
            }
            
            // Also check link for contents indicator (folders typically have contents link)
            if (!isFolder) {
                const links = entry.link || entry['atom:link'] || [];
                const linkArray = Array.isArray(links) ? links : [links];
                
                for (const link of linkArray) {
                    const rel = link['@_rel'] || link.rel || '';
                    if (rel === 'contents' || rel.includes('contents')) {
                        isFolder = true;
                        break;
                    }
                }
            }
            
            // Get content type for files
            const contentType = entry.content?.['@_type'] || entry['atom:content']?.['@_type'];

            files.push({
                name: name,
                type: isFolder ? 'folder' : 'file',
                mimeType: isFolder ? undefined : contentType
            });
        }

        return files;
    }
}
