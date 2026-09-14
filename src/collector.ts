import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { getBinaryPath } from './downloader';
import { StatusBarManager } from './statusBar';

export class CollectorManager {
    private process: cp.ChildProcess | undefined;
    private readonly context: vscode.ExtensionContext;
    private readonly statusBar: StatusBarManager;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly pidFile: string;

    constructor(context: vscode.ExtensionContext, statusBar: StatusBarManager, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.statusBar = statusBar;
        this.outputChannel = outputChannel;
        this.pidFile = path.join(context.globalStorageUri.fsPath, 'otelcol.pid');
    }

    private killStalePid(): void {
        try {
            const pid = parseInt(fs.readFileSync(this.pidFile, 'utf8').trim(), 10);
            if (!isNaN(pid)) {
                process.kill(pid, 'SIGTERM');
                this.log(`Processo anterior (PID ${pid}) finalizado.`);
            }
        } catch { /* process already gone or file missing */ }
        try { fs.unlinkSync(this.pidFile); } catch { /* ignore */ }
    }

    private writePid(pid: number): void {
        try {
            fs.mkdirSync(path.dirname(this.pidFile), { recursive: true });
            fs.writeFileSync(this.pidFile, String(pid), 'utf8');
        } catch { /* ignore */ }
    }

    async start(): Promise<void> {
        if (this.process) {
            await this.stop();
        }
        this.killStalePid();

        const token = await this.context.secrets.get('dt-ingest-token');
        const config = vscode.workspace.getConfiguration('dynatraceAiObs');
        const endpoint = config.get<string>('endpoint', '');
        const email = config.get<string>('userEmail', '');
        const port = config.get<number>('collectorPort', 4318);
        const healthPort = config.get<number>('healthCheckPort', 13133);

        if (!token || !endpoint) {
            vscode.window.showErrorMessage(
                'Dynatrace AI Obs: credenciais não configuradas. Use "Dynatrace AI Obs: Configurar Credenciais".'
            );
            return;
        }

        let binaryPath: string;
        try {
            binaryPath = await getBinaryPath(this.context);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Dynatrace AI Obs: falha ao obter o coletor — ${msg}`);
            return;
        }

        const configPath = this.buildCollectorConfig(config.get<Record<string,string>>('customAttributes', {}));

        this.log(`Iniciando OTel Collector...`);
        this.log(`  Endpoint : ${endpoint}`);
        this.log(`  Email    : ${email || '(não definido)'}`);
        this.log(`  Porta    : ${port}`);

        this.statusBar.setStarting();

        const osMap: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' };
        this.process = cp.spawn(binaryPath, ['--config', configPath], {
            env: {
                ...process.env,
                DT_OTLP_ENDPOINT: endpoint,
                DT_INGEST_TOKEN: token,
                USER_EMAIL: email,
                COLLECTOR_PORT: String(port),
                HEALTH_PORT: String(healthPort),
                IDE_NAME:    vscode.env.appName,
                IDE_VERSION: vscode.version,
                OS_TYPE:     osMap[process.platform] || process.platform,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        if (this.process.pid) {
            this.writePid(this.process.pid);
        }

        this.process.stdout?.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
        this.process.stderr?.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));

        this.process.on('exit', (code) => {
            this.log(`Coletor parou (código: ${code})`);
            this.process = undefined;
            try { fs.unlinkSync(this.pidFile); } catch { /* ignore */ }
            this.statusBar.setStopped();
            if (code !== 0 && code !== null) {
                vscode.window.showWarningMessage(
                    `Dynatrace AI Obs: coletor parou inesperadamente (código ${code}).`,
                    'Ver Log'
                ).then(a => { if (a === 'Ver Log') this.outputChannel.show(); });
            }
        });

        try {
            await this.waitForHealth(healthPort);
            if (!this.process) {
                // Process died while health check was pending (e.g. port conflict on healthPort)
                this.log(`ERRO: coletor parou antes de ficar pronto — a porta ${healthPort} pode estar em uso por outro processo.`);
                vscode.window.showErrorMessage(
                    `Dynatrace AI Obs: coletor falhou ao iniciar. Porta ${healthPort} pode estar em uso. Altere dynatraceAiObs.healthCheckPort nas configurações.`,
                    'Abrir Configurações'
                ).then(a => { if (a === 'Abrir Configurações') vscode.commands.executeCommand('workbench.action.openSettings', 'dynatraceAiObs.healthCheckPort'); });
                return;
            }
            this.statusBar.setRunning();
            this.log(`Coletor pronto na porta ${port} (health check: ${healthPort}).`);
        } catch {
            this.log(`ERRO: health check falhou. Porta ${healthPort} pode estar ocupada.`);
            vscode.window.showErrorMessage(
                `Dynatrace AI Obs: não foi possível iniciar (porta OTLP: ${port}, health: ${healthPort}).`,
                'Ver Log'
            ).then(a => { if (a === 'Ver Log') this.outputChannel.show(); });
            await this.stop();
        }
    }

    async stop(): Promise<void> {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = undefined;
            this.log('Coletor parado manualmente.');
        }
        this.statusBar.setStopped();
    }

    isRunning(): boolean {
        return !!this.process;
    }

    showLog(): void {
        this.outputChannel.show();
    }

    showStatus(extensionVersion: string): void {
        const config = vscode.workspace.getConfiguration('dynatraceAiObs');
        const endpoint = config.get<string>('endpoint', '');
        const email = config.get<string>('userEmail', '');
        const port = config.get<number>('collectorPort', 4318);
        const healthPort = config.get<number>('healthCheckPort', 13133);

        let tenant = '(não configurado)';
        try {
            tenant = new URL(endpoint).hostname;
        } catch { /* ignore */ }

        const running = this.isRunning();
        const lines = [
            '─────────────────────────────────────────────',
            `  Dynatrace AI Observability — Status`,
            '─────────────────────────────────────────────',
            `  Estado          : ${running ? 'RODANDO ✓' : 'PARADO ✗'}`,
            `  Versão          : ${extensionVersion}`,
            `  Tenant          : ${tenant || '(não configurado)'}`,
            `  Porta OTLP      : ${port}`,
            `  Porta health    : ${healthPort}`,
            `  Email           : ${email || '(não definido)'}`,
            `  IDE             : ${vscode.env.appName} ${vscode.version}`,
            '─────────────────────────────────────────────',
        ];
        lines.forEach(l => this.outputChannel.appendLine(l));
        this.outputChannel.show(true);
    }

    private buildCollectorConfig(customAttrs: Record<string, string>): string {
        const staticPath = path.join(this.context.extensionPath, 'resources', 'otel-collector.yaml');
        if (Object.keys(customAttrs).length === 0) {
            return staticPath;
        }
        const base = fs.readFileSync(staticPath, 'utf8');
        const extraLines = Object.entries(customAttrs)
            .map(([k, v]) => `      - { key: "${k}", value: "${v.replace(/"/g, '\\"')}", action: upsert }`)
            .join('\n');
        const generated = base.replace(
            /(\s*- \{ key: deployment\.environment.*?\})/,
            `$1\n${extraLines}`
        );
        const runtimePath = path.join(this.context.globalStorageUri.fsPath, 'otel-collector-runtime.yaml');
        fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
        fs.writeFileSync(runtimePath, generated, 'utf8');
        return runtimePath;
    }

    private log(msg: string): void {
        this.outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
    }

    private waitForHealth(healthPort: number, timeoutMs = 15000): Promise<void> {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + timeoutMs;
            const check = () => {
                const req = http.get(`http://localhost:${healthPort}`, (res) => {
                    if (res.statusCode === 200) { resolve(); } else { retry(); }
                });
                req.on('error', retry);
                req.setTimeout(1000, () => { req.destroy(); retry(); });
            };
            const retry = () => {
                if (Date.now() > deadline) { reject(new Error('timeout')); return; }
                setTimeout(check, 600);
            };
            setTimeout(check, 1500);
        });
    }
}
