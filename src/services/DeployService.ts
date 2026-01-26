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

            // NEW LOGIC: Use 2-step transportchecks to discover Package and Locks
            // Step 1: Check with $new to find Package
            const url = '/sap/bc/adt/cts/transportchecks';
            const headers = {
                'Content-Type': 'application/vnd.sap.as+xml; charset=utf-8; dataname=com.sap.adt.transport.service.checkData',
                'Accept': 'application/vnd.sap.as+xml; dataname=com.sap.adt.transport.service.checkData'
            };

            const body1 = `<?xml version="1.0" encoding="UTF-8" ?>
<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml">
	<asx:values>
		<DATA>
			<PGMID></PGMID>
			<OBJECT></OBJECT>
			<OBJECTNAME></OBJECTNAME>
			<DEVCLASS></DEVCLASS>
			<OPERATION></OPERATION>
			<URI>/sap/bc/adt/filestore/ui5-bsp/objects/${appName}/$new</URI>
		</DATA>
	</asx:values>
</asx:abap>`;

            const response1 = await connection.post(url, body1, { headers });
            
            const { XMLParser } = require('fast-xml-parser');
            const parser = new XMLParser({ 
                ignoreAttributes: false, 
                attributeNamePrefix: '@_',
                removeNSPrefix: true 
            });
            const parsed1 = parser.parse(response1);
            
            // Extract Package (DEVCLASS) from response
            let packageVal = '';
            try {
                const data = parsed1?.abap?.values?.DATA || parsed1?.['asx:abap']?.['asx:values']?.DATA;
                if (data && data.DEVCLASS) {
                    packageVal = data.DEVCLASS;
                }
            } catch (e) {
                console.warn('Could not extract package from check 1', e);
            }

            // Step 2: Check with discovered package to find Locks
            const body2 = `<?xml version="1.0" encoding="UTF-8" ?>
<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml">
	<asx:values>
		<DATA>
			<PGMID></PGMID>
			<OBJECT></OBJECT>
			<OBJECTNAME></OBJECTNAME>
			<DEVCLASS>${packageVal}</DEVCLASS>
			<OPERATION>I</OPERATION>
			<URI>/sap/bc/adt/filestore/ui5-bsp/objects/${appName}/$create</URI>
		</DATA>
	</asx:values>
</asx:abap>`;

            const response2 = await connection.post(url, body2, { headers });
            const parsed2 = parser.parse(response2);
            
            // Extract Lock Info
            let transport = undefined;
            try {
                const data2 = parsed2?.abap?.values?.DATA || parsed2?.['asx:abap']?.['asx:values']?.DATA;
                // Check LOCKS node
                if (data2 && data2.LOCKS && data2.LOCKS.CTS_OBJECT_LOCK) {
                    const lock = data2.LOCKS.CTS_OBJECT_LOCK;
                    if (lock.LOCK_HOLDER && lock.LOCK_HOLDER.TRKORR) {
                        transport = lock.LOCK_HOLDER.TRKORR;
                    }
                }
            } catch (e) {
                console.warn('Could not extract lock info', e);
            }
            
            // Get description from BspService as fallback/detail
            // If packageVal is found, it effectively EXISTS.
            // If packageVal is empty, it might NOT exist (or is $TMP local).
            
            const details = await tempBspService.getBspDetails(appName);

            return {
                exists: !!packageVal || details.package !== '$TMP' || (await tempBspService.getContents(appName, '')).length > 0, // Robust existence check
                transport: transport || details.transport,
                package: packageVal || details.package,
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
    private findAllByKey(obj: any, key: string): any[] {
        let results: any[] = [];
        if (!obj || typeof obj !== 'object') return results;

        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (Array.isArray(value)) {
                results = results.concat(value);
            } else if (value) {
                results.push(value);
            }
        }

        for (const k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k) && typeof obj[k] === 'object') {
                results = results.concat(this.findAllByKey(obj[k], key));
            }
        }
        return results;
    }

    /**
     * Tries to fetch the UI5 version from the backend
     */
    async getUi5Version(profileName: string): Promise<string> {
        try {
            const profile = this.configService.getProfile(profileName);
            if (!profile) return 'Unknown';
            
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

            const user = profile.user.toUpperCase();
            // status=D (Modifiable), requestType=K (Workbench)
            const url = `/sap/bc/adt/cts/transportrequests?user=${user}&status=D&requestType=K`;
            
            const response = await connection.get(url, {
                headers: { 'Accept': 'application/vnd.sap.adt.transportorganizertree.v1+xml' } 
            });

            // Parse XML response
            const { XMLParser } = require('fast-xml-parser');
            const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
            const parsed = parser.parse(response);

            // Extract requests generically to support both flat list and tree structures
            const requests = [];
            const rawEntries = this.findAllByKey(parsed, 'cts:transportRequest');
            
            for (const entry of rawEntries) {
                requests.push({
                    trId: entry['@_cts:id'] || entry['@_id'] || entry['@_number'] || entry.number,
                    description: entry['cts:description'] || entry['@_description'] || entry.description || '',
                    owner: entry['@_cts:owner'] || entry['@_owner'] || entry.owner
                });
            }

            return requests;

        } catch (error) {
            console.error('Failed to get transport requests:', error);
            return []; // Return empty if failed
        }
    }

    /**
     * Creates a new Workbench Transport Request
     */
    async createTransportRequest(profileName: string, description: string, packageName: string, bspName: string): Promise<string> {
        const profile = this.configService.getProfile(profileName);
        if (!profile) throw new Error("Profile not found");
        
        const password = await this.configService.getPassword(profileName);
        if (!password) throw new Error("Password not found");

        const { SapConnection } = require('./SapConnection');
        const connection = new SapConnection({ ...profile, password });

        const url = '/sap/bc/adt/cts/transports';
        
        const body = `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><OPERATION>I</OPERATION><DEVCLASS>${packageName}</DEVCLASS><REQUEST_TEXT>${description}</REQUEST_TEXT><REF>/sap/bc/adt/filestore/ui5-bsp/objects/${bspName}/$create</REF></DATA></asx:values></asx:abap>`;

        const headers = {
            'Content-Type': 'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest', 
            'Accept': 'text/plain'
        };

        try {
            const response = await connection.post(url, body, { headers });
            // Parsing response logic (handling text/plain where server returns path)
            if (typeof response === 'string') {
                 // Example: /com.sap.cts/object_record/T4DK955259
                 const parts = response.split('/');
                 const lastPart = parts[parts.length - 1];
                 
                 // If looks like a TR ID, return it
                 if (lastPart && /[A-Z0-9]{3}K[0-9]{6}/.test(lastPart)) {
                     return lastPart;
                 }
                 
                 // Try standard regex match
                 const match = response.match(/[A-Z0-9]{3}K[0-9]{6}/);
                 if (match) return match[0];
            }
            
            throw new Error(`Could not parse TR number from response: ${response}`);

        } catch (error: any) {
            console.error('[DeployService] Create Transport Failed:', error);
            if (error.response) {
                 console.error('[DeployService] Error Status:', error.response.status);
                 console.error('[DeployService] Error Data:', error.response.data);
                 console.error('[DeployService] Error Headers:', error.response.headers);
            }
            throw error;
        }
    }

    /**
     * Pre-creation check: Is Transport Request required?
     * Also returns user's open transport requests if available.
     */
    async checkTransportRequired(
        profileName: string, 
        packageName: string, 
        bspName: string
    ): Promise<{
        required: boolean;
        availableRequests: Array<{ trId: string; description: string }>;
    }> {
        try {
            const profile = this.configService.getProfile(profileName);
            if (!profile) return { required: true, availableRequests: [] };
            
            const password = await this.configService.getPassword(profileName);
            if (!password) return { required: true, availableRequests: [] };

            const { SapConnection } = require('./SapConnection');
            const connection = new SapConnection({ ...profile, password });

            const url = '/sap/bc/adt/cts/transportchecks';
            
            const body = `<?xml version="1.0" encoding="UTF-8" ?>
<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml">
	<asx:values>
		<DATA>
			<PGMID></PGMID>
			<OBJECT></OBJECT>
			<OBJECTNAME></OBJECTNAME>
			<DEVCLASS>${packageName}</DEVCLASS>
			<OPERATION>I</OPERATION>
			<URI>/sap/bc/adt/filestore/ui5-bsp/objects/${bspName}/$create</URI>
		</DATA>
	</asx:values>
</asx:abap>`;

            const headers = {
                'Content-Type': 'application/vnd.sap.as+xml; charset=utf-8; dataname=com.sap.adt.transport.service.checkData',
                'Accept': 'application/vnd.sap.as+xml; dataname=com.sap.adt.transport.service.checkData'
            };

            const response = await connection.post(url, body, { headers });

            // Parse response
            const { XMLParser } = require('fast-xml-parser');
            const parser = new XMLParser({ 
                ignoreAttributes: false, 
                attributeNamePrefix: '@_',
                removeNSPrefix: true 
            });
            const parsed = parser.parse(response);

            // Check if TR is required
            let required = false;
            
            // Basic string check
            if (typeof response === 'string') {
                required = response.includes('<REQ_REQUIRED>X</REQ_REQUIRED>') || 
                           response.includes('LOCKS') ||
                           !response.includes('<REQ_REQUIRED></REQ_REQUIRED>');
            }

            // Extract using parsed object
            const availableRequests: Array<{ trId: string; description: string, owner: string }> = [];
            
            try {
                const abap = parsed.abap || parsed['asx:abap'] || parsed;
                const values = abap?.values || abap?.['asx:values'];
                const data = values?.DATA;
                
                // Detailed check
                if (data && data.REQ_REQUIRED === 'X') required = true;

                const requestsNode = data?.REQUESTS;
                
                if (requestsNode && requestsNode.CTS_REQUEST) {
                    const ctsRequests = Array.isArray(requestsNode.CTS_REQUEST) 
                        ? requestsNode.CTS_REQUEST 
                        : [requestsNode.CTS_REQUEST];

                    for(const req of ctsRequests) {
                        const header = req.REQ_HEADER;
                        if(header && header.TRKORR) {
                            availableRequests.push({ 
                                trId: header.TRKORR, 
                                description: header.AS4TEXT || '',
                                owner: header.AS4USER || ''
                            });
                        }
                    }
                }
            } catch (parseError) {
                console.warn('Error parsing transport check response:', parseError);
            }

            // No fallback to getTransportRequests as user stated it is not needed/URL is wrong.
            // If the list is empty, it means no requests returned by check.

            return { required, availableRequests };

        } catch (error) {
            console.error('Failed to check transport requirements:', error);
            const fallbackRequests = await this.getTransportRequests(profileName);
            return { 
                required: true, 
                availableRequests: fallbackRequests.map(r => ({ trId: r.trId, description: r.description }))
            };
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
            
            const { XMLParser } = require('fast-xml-parser');
            const parser = new XMLParser({ 
                ignoreAttributes: false, 
                attributeNamePrefix: '@_',
                removeNSPrefix: true
            });
            const parsed = parser.parse(response);
            
            const abap = parsed.abap;
            const values = abap ? abap.values : null;
            const data = values ? values.DATA : null;
            const content = data ? data.TREE_CONTENT : null;
            const nodes = content ? content.SEU_ADT_REPOSITORY_OBJ_NODE : [];
            const nodeList = Array.isArray(nodes) ? nodes : (nodes ? [nodes] : []);

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

        const fs = require('fs');
        const path = require('path');
        const cp = require('child_process');

        // Check for package.json to trigger build
        let projectRoot = params.sourceDir;
        if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
             // Try parent folder if sourceDir is already 'dist' or similar
             const parent = path.dirname(projectRoot);
             if (fs.existsSync(path.join(parent, 'package.json'))) {
                 projectRoot = parent;
             }
        }

        if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
             progress.report({ message: 'Building project (npm run build)...' });
             
             await new Promise<void>((resolve, reject) => {
                 const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
                 // Run install first to ensure deps
                 // Note: Skipping install to save time if node_modules exists? 
                 // Let's assume deps are there or run install if missing? 
                 // Better to just run build. If it fails, user should fix deps.
                 
                 const buildProcess = cp.spawn(npmCommand, ['run', 'build'], {
                     cwd: projectRoot,
                     shell: true
                 });

                 buildProcess.stdout.on('data', (d: any) => console.log(d.toString()));
                 buildProcess.stderr.on('data', (d: any) => console.error(d.toString()));

                 buildProcess.on('close', (code: number) => {
                     if (code === 0) resolve();
                     else reject(new Error('Build failed'));
                 });
             });
        }

        // After build (or if skipped), determine the correct source directory to upload from.
        // Priority:
        // 1. 'dist' folder (if built successfully)
        // 2. 'webapp' folder (standard UI5 source)
        // 3. Project root (fallback, but risky as it uploads everything)
        
        let cwd = params.sourceDir;
        
        if (fs.existsSync(path.join(projectRoot, 'dist'))) {
            cwd = path.join(projectRoot, 'dist');
        } else if (fs.existsSync(path.join(projectRoot, 'webapp'))) {
             // Fallback: if no dist, use webapp folder to ensure we upload contents, not the folder itself
             cwd = path.join(projectRoot, 'webapp');
        }

        // Create a temporary .nwabaprc configuration
        const nwabapConfig = {
            base: './', // The sourceDir is passed as cwd to the process, so base is relative to it
            files: "**",
            conn_server: profile.server,
            conn_client: profile.client,
            conn_user: profile.user,
            conn_password: password,
            conn_usestrictssl: profile.useStrictSSL,
            abap_package: params.package,
            abap_bsp: params.bspName,
            abap_bsp_text: params.description,
            abap_transport: params.transport,
            abap_language: "EN",
            calcappindex: true
        };

        const configPath = path.join(cwd, '.nwabaprc');

        try {
            // Write config file
            fs.writeFileSync(configPath, JSON.stringify(nwabapConfig, null, 4));

            progress.report({ message: 'Uploading files...' });

            await new Promise<void>((resolve, reject) => {
                const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
                
                // Using --nwabaprc option to point to our generated config if needed, 
                // but since we wrote it to cwd, it should pick it up automatically or we pass explicitly.
                // FIX: use --package to ensure npx finds the correct package even if not in node_modules of dist
                const uploadProcess = cp.spawn(npxCommand, ['--package', 'nwabap-ui5uploader', 'nwabap', 'upload'], {
                    cwd: cwd,
                    shell: true,
                    env: { ...process.env }
                });

                let stdout = '';
                let stderr = '';

                uploadProcess.stdout.on('data', (data: any) => {
                    const message = data.toString();
                    stdout += message;
                    if (message.includes('Uploading')) {
                        progress.report({ message: message.trim() });
                    }
                });

                uploadProcess.stderr.on('data', (data: any) => {
                    stderr += data.toString();
                });

                uploadProcess.on('close', (code: number) => {
                    // Clean up config file
                    try { fs.unlinkSync(configPath); } catch (e) {}

                    if (code === 0) {
                        progress.report({ message: 'Deployment complete!' });
                        resolve();
                    } else {
                        const errorMessage = stderr || stdout || `Process exited with code ${code}`;
                        reject(new Error(errorMessage));
                    }
                });

                uploadProcess.on('error', (error: any) => {
                     // Clean up config file
                    try { fs.unlinkSync(configPath); } catch (e) {}
                    reject(error);
                });
            });

        } catch (error: any) {
            console.error('Upload failed:', error);
            // Try clean up in case of error
            try { if (fs.existsSync(configPath)) fs.unlinkSync(configPath); } catch (e) {}
            throw error;
        }
    }
}
