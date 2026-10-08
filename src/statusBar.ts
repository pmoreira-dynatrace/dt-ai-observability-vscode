import * as vscode from 'vscode';

export class StatusBarManager {
    readonly statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'dt-ai-obs.configure';
        this.setStopped();
    }

    show(): void {
        this.statusBarItem.show();
    }

    setRunning(): void {
        this.statusBarItem.text = '$(circle-filled) AI Gov';
        this.statusBarItem.tooltip = 'Dynatrace AI Governance: collecting — click to configure';
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
    }

    setStarting(): void {
        this.statusBarItem.text = '$(loading~spin) AI Gov';
        this.statusBarItem.tooltip = 'Dynatrace AI Governance: starting...';
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = undefined;
    }

    setStopped(): void {
        this.statusBarItem.text = '$(circle-outline) AI Gov';
        this.statusBarItem.tooltip = 'Dynatrace AI Governance: stopped — click to configure';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.color = undefined;
    }
}
