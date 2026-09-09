import * as vscode from 'vscode';
import { CollectorManager } from './collector';
import { StatusBarManager } from './statusBar';
import { configureCopilotOtel } from './settings';
import { configureClaudeHooks, removeClaudeHooks, autoConfigureClaudeHooks, setLogger, writeAttrsFile, manageCustomAttributes } from './claudeHooks';

let collectorManager: CollectorManager;
let statusBarManager: StatusBarManager;

export async function activate(context: vscode.ExtensionContext) {
    statusBarManager = new StatusBarManager();

    // Canal único — tanto logs do coletor quanto logs dos hooks aparecem aqui
    const outputChannel = vscode.window.createOutputChannel('Dynatrace AI Observability');
    const ts = () => new Date().toISOString();
    setLogger((msg) => outputChannel.appendLine(`[${ts()}] ${msg}`));

    collectorManager = new CollectorManager(context, statusBarManager, outputChannel);

    context.subscriptions.push(
        vscode.commands.registerCommand('dt-ai-obs.start', () => collectorManager.start()),
        vscode.commands.registerCommand('dt-ai-obs.stop', () => collectorManager.stop()),
        vscode.commands.registerCommand('dt-ai-obs.configure', () => runConfigureFlow(context)),
        vscode.commands.registerCommand('dt-ai-obs.status', () => {
            vscode.window.showInformationMessage(
                `Dynatrace AI Obs: coletor está ${collectorManager.isRunning() ? 'RODANDO ✓' : 'PARADO ✗'}`
            );
        }),
        vscode.commands.registerCommand('dt-ai-obs.configureClaudeHooks', configureClaudeHooks),
        vscode.commands.registerCommand('dt-ai-obs.removeClaudeHooks', removeClaudeHooks),
        vscode.commands.registerCommand('dt-ai-obs.manageAttributes', manageCustomAttributes),
        statusBarManager.statusBarItem
    );

    statusBarManager.show();

    // Configurar hooks do Claude Code automaticamente (silencioso se não houver Claude instalado)
    autoConfigureClaudeHooks();

    // Quando customAttributes mudar, atualizar otel-attrs.json imediatamente e reiniciar o coletor
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async e => {
            if (e.affectsConfiguration('dynatraceAiObs.customAttributes')) {
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
        // start() já faz o download do binário se necessário
        await collectorManager.start();
        configureCopilotOtel();
    } else if (!(await hasCredentials(context))) {
        const action = await vscode.window.showInformationMessage(
            'Dynatrace AI Observability: configure suas credenciais para começar.',
            'Configurar Agora',
            'Depois'
        );
        if (action === 'Configurar Agora') {
            await runConfigureFlow(context);
        }
    }
}

export async function deactivate() {
    await collectorManager?.stop();
}

async function hasCredentials(context: vscode.ExtensionContext): Promise<boolean> {
    const token = await context.secrets.get('dt-ingest-token');
    const endpoint = vscode.workspace.getConfiguration('dynatraceAiObs').get<string>('endpoint', '');
    return !!(token && endpoint);
}

async function runConfigureFlow(context: vscode.ExtensionContext) {
    const currentEndpoint = vscode.workspace.getConfiguration('dynatraceAiObs').get<string>('endpoint', '');

    const endpoint = await vscode.window.showInputBox({
        title: 'Dynatrace OTLP Endpoint (1/3)',
        prompt: 'Use o domínio .live. (não .apps.)',
        placeHolder: 'https://abc12345.live.dynatrace.com/api/v2/otlp',
        value: currentEndpoint,
        ignoreFocusOut: true,
        validateInput: v => {
            if (!v) return 'Campo obrigatório';
            if (!v.startsWith('https://')) return 'Deve começar com https://';
            if (v.includes('.apps.')) return 'Use .live.dynatrace.com, não .apps.';
            return undefined;
        }
    });
    if (!endpoint) return;

    const token = await vscode.window.showInputBox({
        title: 'Dynatrace API Token (2/3)',
        prompt: 'Scopes: openTelemetryTrace.ingest + metrics.ingest',
        placeHolder: 'dt0c01.XXXXXXXXXX...',
        password: true,
        ignoreFocusOut: true,
        validateInput: v => {
            if (!v) return 'Campo obrigatório';
            if (!v.startsWith('dt0c01.')) return 'Token inválido — deve começar com dt0c01.';
            return undefined;
        }
    });
    if (!token) return;

    const currentEmail = vscode.workspace.getConfiguration('dynatraceAiObs').get<string>('userEmail', '');
    const email = await vscode.window.showInputBox({
        title: 'Seu e-mail (3/3)',
        prompt: 'Aparece nos spans no Dynatrace para identificar o dev (opcional)',
        placeHolder: 'dev@empresa.com',
        value: currentEmail,
        ignoreFocusOut: true
    });

    const cfg = vscode.workspace.getConfiguration('dynatraceAiObs');
    await cfg.update('endpoint', endpoint, vscode.ConfigurationTarget.Global);
    if (email) await cfg.update('userEmail', email, vscode.ConfigurationTarget.Global);
    await context.secrets.store('dt-ingest-token', token);

    vscode.window.showInformationMessage('✓ Credenciais salvas. Iniciando coletor (pode baixar o binário na 1ª vez)...');
    await collectorManager.start();
    configureCopilotOtel();
}
