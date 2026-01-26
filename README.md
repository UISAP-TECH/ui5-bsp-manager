# UI5 BSP Manager for VS Code

Manage your SAP UI5 BSP applications directly from VS Code. Inspect, download, and deploy applications to your ABAP backend with ease.

## Features

### 📡 SAP Connection Management

- Manage multiple SAP system profiles (Dev, Test, Prod).
- **Secure Storage**: Passwords are saved securely using VS Code's Secret Storage.
- Support for both standard and custom ports/clients.

### 📂 BSP Explorer

- **List Applications**: View all BSP applications (filtered by 'Z' prefix by default) in a hierarchical tree view.
- **Search**: Quickly find applications by name.
- **Inspect**: Browse files and folders within a BSP application without downloading.
- **UI5 Version**: Auto-detects the backend SAPUI5 version.

### ⬇️ Download

- **Full Project Download**: Download an entire BSP application to your local workspace.
- **Smart Structure**: Preserves the folder structure compatible with standard UI5 projects.

### 🚀 Smart Deployment (Upload)

- **Wizard-based Deployment**: Step-by-step guide to deploy your app.
- **Transport Request Integration**:
  - Automatically checks if a Transport Request (TR) is required.
  - Lists your modifiable Transport Requests.
  - **Create TR**: Create a new Workbench Request directly from the wizard.
- **Safety Checks**:
  - Validates package assignments.
  - Checks for locked objects.
  - Prevents overwriting valid Transport locks.
- **New & Update Modes**: seamless workflow for both creating new BSPs and updating existing ones.

## Requirements

- **backend**: SAP NetWeaver AS ABAP with ADT (ABAP Development Tools) services enabled.
- **client**: `nwabap-ui5uploader` (installed automatically or via `npm`).

## Extension Settings

This extension contributes the following settings:

- `bspManager.defaultProfile`: The name of the profile to use by default.

## Getting Started

1.  Open the **UI5 BSP Manager** view in the Activity Bar.
2.  Click **Add Profile** to configure your SAP system.
3.  Click on a profile to connect.
4.  Browse applications or right-click to **Download**.
5.  To deploy, open your local project and click the **Deploy to BSP** icon in the editor title or use the Command Palette.

## Release Notes

### 0.0.1

- Initial release with Explorer, Download, and Smart Deploy features.
