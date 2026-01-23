import * as vscode from 'vscode';
import * as path from 'path';
import { SapProfile } from './SapConnection';

import { ConfigService } from './ConfigService';

export class DeployService {

    private configService: ConfigService;

    constructor(configService: ConfigService) {
        this.configService = configService;
    }

    /**
     * Checks if a BSP application exists on the server and returns its details.
     * This corresponds to the 'Smart Deployment' logic.
     */
    async checkApplication(profileName: string, appName: string): Promise<{ exists: boolean; transport?: string; package?: string; description?: string }> {
        try {
            const profile = this.configService.getProfile(profileName);
            if (!profile) return { exists: false };

            const password = await this.configService.getPassword(profileName);
            if (!password) return { exists: false };

            const { SapConnection } = require('./SapConnection');
            const connection = new SapConnection({ ...profile, password });
            
            // Create a temporary BspService to reuse its parsing logic
            const { BspService } = require('./BspService');
            const tempBspService = new BspService(connection);

            // We reuse BspService's getBspDetails which fetches properties including transport
            const details = await tempBspService.getBspDetails(appName);
            
            // If getBspDetails returns successfully, it likely exists. 
            // However, BspService.getBspDetails might return default '$TMP' if errored.
            // Let's rely on listBspApplications filter for strict existence check first?
            // Actually, querying the object direct is better.
            
            // If package is $TMP and description is the name, it might be the default error fallback from BspService.
            // But let's verify existence by trying to read it specifically.
            // BspService.getContents with empty path should work if app exists.
            const contents = await tempBspService.getContents(appName, '');
            if (!contents || contents.length === 0) {
                 // Maybe it's empty? or doesn't exist.
                 // Let's assume if we can't get contents, it's not there or accessible.
                 // A better check might be needed if BspService silently fails.
                 // BspService.getContents returns [] on error.
                 
                 // Let's try listing with filter which is more definitive for existence
                 const list = await tempBspService.listBspApplications({ name: appName });
                 const found = list.find((app: any) => app.name.toUpperCase() === appName.toUpperCase());
                 
                 if (found) {
                     return {
                         exists: true,
                         transport: details.transport, // details from getBspDetails might still be valid or we need a way to get TR from list item? List item normally doesn't have TR.
                         package: found.package,
                         description: found.description
                     };
                 }
                 return { exists: false };
            }

            return {
                exists: true,
                transport: details.transport,
                package: details.package,
                description: details.description
            };

        } catch (error) {
            console.error('Error checking BSP application:', error);
            return { exists: false };
        }
    }



    /**
     * Fetches the SAPUI5 version from the backend system.
     */
    async getUi5Version(profileName: string): Promise<string> {
        try {
            const profile = this.configService.getProfile(profileName);
            if (!profile) return 'Unknown';

            // We can check /sap/public/bc/ui5_ui5/index.html or similar, or specific ADT service if available.
            // A common way is to check the cache buster info or a specific file.
            // For now, let's try to fetch a well-known resource that might contain version info 
            // OR simpler: just return a placeholder or try to read /sap/bc/ui5_ui5/ui2/ushell/shells/abap/FioriLaunchpad.html if possible?
            // Actually, we can use the `SapConnection` to just fetch the root discovery which might have system info, 
            // but for UI5 version specifically, it's often in /sap/public/bc/ui5_ui5/resources/sap-ui-version.json
            
            // We need a temporary connection for this profile if not already active?
            // DeployService usually gets passed an active BspService which has a connection.
            // But BspService is tied to the *explorer* profile. 
            // The wizard allows picking a profile. So we might need to create a connection on the fly.
            
            // Let's create a temporary connection helper in DeployService or ConfigService?
            // For simplicity, let's assume we use the profile credentials to make a quick request.
            
            const { SapConnection } = require('./SapConnection');
            const password = await this.configService.getPassword(profileName);
            if (!password) return 'Unknown (No Password)';

            const connection = new SapConnection({ ...profile, password });
            
            try {
                const response = await connection.get('/sap/public/bc/ui5_ui5/resources/sap-ui-version.json');
                return response.version || response.buildTimestamp || 'Unknown';
            } catch (e) {
                // Fallback: try reading from a standard path or just generic
                return 'Unknown';
            }
        } catch (error) {
            console.error('Failed to get UI5 version:', error);
            return 'Unknown';
        }
    }

    /**
     * Fetches modifiable Transport Requests for the user.
     */
    async getTransportRequests(profileName: string): Promise<any[]> {
        try {
            const profile = this.configService.getProfile(profileName);
            if (!profile) return [];
            
            const password = await this.configService.getPassword(profileName);
            if (!password) return [];

            const { SapConnection } = require('./SapConnection');
            const connection = new SapConnection({ ...profile, password });

            // ADT Service for Transport Checks: /sap/bc/adt/cts/transportchecks
            // Or Discovery: /sap/bc/adt/discovery
            // We usually need to query for requests.
            // Use ADT: /sap/bc/adt/cts/transportrequests?user=<user>&requestType=K&status=D (Modifiable)
            
            // Note: URL might vary by system version.
            const user = profile.user.toUpperCase();
             // requestType=W (Customizing), K (Workbench) - usually we need Workbench for BSP
            const url = `/sap/bc/adt/cts/transportrequests?user=${user}&requestType=K&requestStatus=D`;
            
            const response = await connection.get(url, {
                headers: { 'Accept': 'application/vnd.sap.adt.transportrequests+xml' } 
            });

            // Parse XML response
            // We need to import XML parser here or use BspService's parser if we made it public.
            // Let's create a local parser for now.
            const { XMLParser } = require('fast-xml-parser');
            const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
            const parsed = parser.parse(response);

            // Extract requests
            const requests = [];
            const collection = parsed['cts:transportRequests'] || parsed.transportRequests;
            if (collection) {
                const entries = Array.isArray(collection['cts:transportRequest']) 
                    ? collection['cts:transportRequest'] 
                    : [collection['cts:transportRequest']].filter(Boolean);

                for (const entry of entries) {
                    requests.push({
                        trId: entry['@_number'] || entry.number,
                        description: entry['@_description'] || entry.description,
                        owner: entry['@_owner'] || entry.owner
                    });
                }
            }
            return requests;

        } catch (error) {
            console.error('Failed to get transport requests:', error);
            return []; // Return empty if failed
        }
    }

    /**
     * Lists sub-packages of a given parent package using ADT Node Structure (POST).
     * Implements user's specific Postman instructions:
     * - CSRF Token (handled by SapConnection)
     * - Content-Type: application/xml
     * - Query Params: parent_type, parent_name, withShortDescriptions
     */
    async searchPackages(profileName: string, query: string): Promise<any[]> {
        try {
            const profile = this.configService.getProfile(profileName);
            if (!profile) return [];
            
            const password = await this.configService.getPassword(profileName);
            if (!password) return [];

            const { SapConnection } = require('./SapConnection');
            const connection = new SapConnection({ ...profile, password });

            // Simplified API - fetch all packages with just parent_type
            const parentName = query ? query.toUpperCase() : '';
            
            const url = '/sap/bc/adt/repository/nodestructure';
            
            // Only use parent_type to get all packages
            const params: any = {
                parent_type: 'DEVC/K'
            };
            
            // If specific package requested, add parent_name
            if (parentName) {
                params.parent_name = parentName;
            }

            // Headers
            const config = {
                params: params,
                headers: {
                    'Content-Type': 'application/xml',
                    'Accept': 'application/vnd.sap.as+xml'
                }
            };
            
            // Sending empty string as body because some servers dislike null with Content-Type
            const response = await connection.post(url, '', config);
            
            // DEBUG: Log raw response
            console.log('=== RAW RESPONSE ===');
            console.log(typeof response);
            console.log(response);
            
            const { XMLParser } = require('fast-xml-parser');
            const parser = new XMLParser({ 
                ignoreAttributes: false, 
                attributeNamePrefix: '@_',
                removeNSPrefix: true
            });
            const parsed = parser.parse(response);
            
            // DEBUG: Log parsed structure
            console.log('=== PARSED XML ===');
            console.log(JSON.stringify(parsed, null, 2));

            // Navigation depending on ADT version: 
            // usually: asx:abap -> asx:values -> DATA -> TREE_CONTENT -> SEU_ADT_REPOSITORY_OBJ_NODE
            // With removeNSPrefix: abap -> values -> DATA -> TREE_CONTENT -> SEU_ADT_REPOSITORY_OBJ_NODE
            const abap = parsed.abap;
            const values = abap ? abap.values : null;
            const data = values ? values.DATA : null;
            const content = data ? data.TREE_CONTENT : null;
            const nodes = content ? content.SEU_ADT_REPOSITORY_OBJ_NODE : [];
            const nodeList = Array.isArray(nodes) ? nodes : (nodes ? [nodes] : []);

            console.log('=== NODES ===');
            console.log('Total nodes:', nodeList.length);

            // Extract ONLY Packages (DEVC/K type) that start with Z
            const packages: any[] = [];
            
            // Always add $TMP at the top for local development
            packages.push({
                label: '$TMP',
                description: 'Local Object (No transport)',
                detail: 'Recommended for testing'
            });

            for (const node of nodeList) {
                if (!node) continue;
                
                const objName = node.OBJECT_NAME;
                const objType = node.OBJECT_TYPE;
                const desc = node.DESCRIPTION;
                
                // ONLY include packages (DEVC/K type) that start with Z
                const isPackage = objType === 'DEVC/K' || objType === 'DEVC' || (objType && objType.includes('DEVC'));
                const startsWithZ = objName && objName.startsWith('Z');
                
                if (isPackage && startsWithZ) {
                    packages.push({
                        label: objName,
                        description: desc || '',
                        detail: 'Custom package'
                    });
                }
            }
            
            console.log('=== FILTERED PACKAGES (Z* + $TMP) ===', packages.length);
            return packages;

        } catch (error: any) {
            console.error('Failed to search packages (nodestructure):', error);
            // Log full error for debugging
             if (error.response) {
                console.error('Response Status:', error.response.status);
                console.error('Response Data:', error.response.data);
            }
            return [];
        }
    }

    /**
     * Deploys the application using nwabap-ui5uploader
     */
    async deploy(
        profileName: string, 
        params: { 
            bspName: string; 
            package: string; 
            description: string; 
            transport: string;
            sourceDir: string;
        },
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        
        const profile = this.configService.getProfile(profileName);
        if (!profile) {
            throw new Error(`Profile "${profileName}" not found`);
        }
        
        const password = await this.configService.getPassword(profileName);
        if (!password) {
            throw new Error(`Password for profile "${profileName}" not found`);
        }

        progress.report({ message: 'Initializing uploader...' });

        // nwabap-ui5uploader expects options object
        const uploader = require('nwabap-ui5uploader');

        const options = {
            conn: {
                server: profile.server,
                client: profile.client,
                useStrictSSL: profile.useStrictSSL
            },
            auth: {
                user: profile.user,
                pwd: password
            },
            ui5: {
                package: params.package,
                bspcontainer: params.bspName,
                bspcontainer_text: params.description,
                transportno: params.transport,
                create_transport: false, // We assume user provides TR or existing one
                calc_appindex: true // Usually good to recalculate
            }
        };

        // nwabap-ui5uploader typical usage:
        // uploader.uploadAll(options, sourceDir)
        // It returns a promise.

        progress.report({ message: 'Uploading files to SAP...' });
        
        try {
            // We need to capture stdout/logs from uploader if possible, but for now just await it.
            // The library prints to console. We might want to redirect console.log temporarily?
            // Or just trust it throws on error.
            
            await uploader.uploadAll(options, params.sourceDir);
            
            progress.report({ message: 'Deployment complete!' });

        } catch (error) {
            console.error('Upload failed:', error);
            throw new Error(`Upload failed: ${error}`);
        }
    }
}
