import * as vscode from 'vscode';
import * as https from 'https';
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
            const version = context.extension.packageJSON.version as string;
            collectorManager.showStatus(version);
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

function validateDynatraceCredentials(endpoint: string, token: string): Promise<{ valid: boolean; error?: string }> {
    return new Promise((resolve) => {
        try {
            const baseUrl = endpoint.replace(/\/api\/v2\/otlp\/?$/, '');
            const lookupUrl = new URL(`${baseUrl}/api/v2/apiTokens/lookup`);
            const body = JSON.stringify({ token });
            const req = https.request({
                hostname: lookupUrl.hostname,
                path: lookupUrl.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Api-Token ${token}`,
                    'Content-Length': Buffer.byteLength(body),
                },
            }, (res) => {
                if (res.statusCode === 200) {
                    resolve({ valid: true });
                } else if (res.statusCode === 401) {
                    resolve({ valid: false, error: 'Token inválido — verifique se o token está correto.' });
                } else if (res.statusCode === 403) {
                    resolve({ valid: false, error: 'Token sem os scopes necessários: openTelemetryTrace.ingest + metrics.ingest.' });
                } else {
                    resolve({ valid: false, error: `Endpoint respondeu HTTP ${res.statusCode} — verifique a URL.` });
                }
            });
            req.on('error', (err) => {
                resolve({ valid: false, error: `Não foi possível conectar ao Dynatrace: ${err.message}` });
            });
            req.setTimeout(8000, () => { req.destroy(); resolve({ valid: false, error: 'Timeout — verifique a URL e sua conexão.' }); });
            req.write(body);
            req.end();
        } catch (err) {
            resolve({ valid: false, error: `URL inválida: ${err}` });
        }
    });
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

    const validation = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Validando credenciais Dynatrace...' },
        () => validateDynatraceCredentials(endpoint, token)
    );
    if (!validation.valid) {
        const action = await vscode.window.showErrorMessage(
            `Dynatrace AI Obs: ${validation.error}`,
            'Corrigir',
            'Salvar mesmo assim'
        );
        if (action !== 'Salvar mesmo assim') { return; }
    }

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
