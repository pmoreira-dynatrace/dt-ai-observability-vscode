import * as vscode from 'vscode';
import { CollectorManager } from './collector';
import { StatusBarManager } from './statusBar';
import { configureCopilotOtel } from './settings';
import { configureClaudeHooks, removeClaudeHooks, autoConfigureClaudeHooks, watchForClaudeDir, setLogger, writeAttrsFile, manageCustomAttributes } from './claudeHooks';
import { EvalsManager } from './evals';
import { ConfigPanel } from './configPanel';

let collectorManager: CollectorManager;
let statusBarManager: StatusBarManager;
let evalsManager: EvalsManager;

export async function activate(context: vscode.ExtensionContext) {
    statusBarManager = new StatusBarManager();

    const outputChannel = vscode.window.createOutputChannel('Dynatrace AI Observability');
    const ts = () => new Date().toISOString();
    setLogger((msg) => outputChannel.appendLine(`[${ts()}] ${msg}`));

    collectorManager = new CollectorManager(context, statusBarManager, outputChannel);
    evalsManager = new EvalsManager(context);

    const onConfigSaved = async () => {
        writeAttrsFile();
        configureCopilotOtel();
        if (collectorManager.isRunning()) {
            const action = await vscode.window.showInformationMessage(
                'Dynatrace AI Obs: configurações salvas. O coletor já está em execução.',
                'Reiniciar coletor',
                'Manter atual'
            );
            if (action === 'Reiniciar coletor') {
                await collectorManager.stop();
                await collectorManager.start();
            }
        } else {
            await collectorManager.start();
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('dt-ai-obs.start', () => collectorManager.start()),
        vscode.commands.registerCommand('dt-ai-obs.stop', () => collectorManager.stop()),
        vscode.commands.registerCommand('dt-ai-obs.configure', () => ConfigPanel.open(context, onConfigSaved)),
        vscode.commands.registerCommand('dt-ai-obs.status', () => {
            const version = context.extension.packageJSON.version as string;
            collectorManager.showStatus(version);
        }),
        vscode.commands.registerCommand('dt-ai-obs.configureClaudeHooks', configureClaudeHooks),
        vscode.commands.registerCommand('dt-ai-obs.removeClaudeHooks', removeClaudeHooks),
        vscode.commands.registerCommand('dt-ai-obs.manageAttributes', manageCustomAttributes),
        vscode.commands.registerCommand('dt-ai-obs.evalsConfigure', () => evalsManager.configure()),
        vscode.commands.registerCommand('dt-ai-obs.evalsRun', () => evalsManager.run()),
        vscode.commands.registerCommand('dt-ai-obs.evalsValidate', () => evalsManager.validate()),
        vscode.commands.registerCommand('dt-ai-obs.evalsStatus', () => evalsManager.status()),
        statusBarManager.statusBarItem
    );

    statusBarManager.show();
    autoConfigureClaudeHooks();
    watchForClaudeDir(); // handles case where Claude Code is installed after this extension

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async e => {
            if (e.affectsConfiguration('dynatraceAiObs.customAttributes') ||
                e.affectsConfiguration('dynatraceAiObs.capturePrompts')) {
                writeAttrsFile();
                if (collectorManager.isRunning()) {
                    await collectorManager.stop();
                    await collectorManager.start();
                }
            }
        })
    );

    const autoStart = vscode.workspace.getConfiguration('dynatraceAiObs').get<boolean>('autoStart', true);
    if (autoStart && await hasCredentials(context)) {
        await collectorManager.start();
        configureCopilotOtel();
    } else if (!(await hasCredentials(context))) {
        const action = await vscode.window.showInformationMessage(
            'Dynatrace AI Observability: configure suas credenciais para começar.',
            'Configurar Agora',
            'Depois'
        );
        if (action === 'Configurar Agora') {
            ConfigPanel.open(context, onConfigSaved);
        }
    }

    await evalsManager.maybePromptInstall();
}

export async function deactivate() {
    await collectorManager?.stop();
}

async function hasCredentials(context: vscode.ExtensionContext): Promise<boolean> {
    const token = await context.secrets.get('dt-ingest-token');
    const endpoint = vscode.workspace.getConfiguration('dynatraceAiObs').get<string>('endpoint', '');
    return !!(token && endpoint);
}
