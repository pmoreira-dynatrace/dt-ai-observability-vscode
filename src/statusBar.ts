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
        this.statusBarItem.text = '$(circle-filled) DT OTel';
        this.statusBarItem.tooltip = 'Dynatrace AI Observability: coletando — clique para configurar';
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
    }

    setStarting(): void {
        this.statusBarItem.text = '$(loading~spin) DT OTel';
        this.statusBarItem.tooltip = 'Dynatrace AI Observability: iniciando...';
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = undefined;
    }

    setStopped(): void {
        this.statusBarItem.text = '$(circle-outline) DT OTel';
        this.statusBarItem.tooltip = 'Dynatrace AI Observability: parado — clique para configurar';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.color = undefined;
    }
}
