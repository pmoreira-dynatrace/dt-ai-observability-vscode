import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';
import { getBinaryPath } from './downloader';
import { StatusBarManager } from './statusBar';

/**
 * Check if a TCP port is available on 0.0.0.0 (all interfaces).
 */
function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '0.0.0.0');
    });
}

/**
 * Starting from `startPort`, find the first available TCP port.
 * Tries up to `maxAttempts` consecutive ports.
 */
async function findAvailablePort(startPort: number, maxAttempts: number = 50): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        if (port > 65535) { break; }
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    throw new Error(`Nenhuma porta disponível encontrada a partir de ${startPort} (tentou ${maxAttempts} portas).`);
}

export class CollectorManager {
    private process: cp.ChildProcess | undefined;
    private readonly context: vscode.ExtensionContext;
    private readonly statusBar: StatusBarManager;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly pidFile: string;
    private logBuffer: string[] = [];
    private logLineListener?: (line: string) => void;
    private statusListener?: (running: boolean) => void;

    constructor(context: vscode.ExtensionContext, statusBar: StatusBarManager, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.statusBar = statusBar;
        this.outputChannel = outputChannel;
        this.pidFile = path.join(context.globalStorageUri.fsPath, 'otelcol.pid');
    }

    setLogLineListener(fn: ((line: string) => void) | undefined): void {
        this.logLineListener = fn;
    }

    setStatusListener(fn: ((running: boolean) => void) | undefined): void {
        this.statusListener = fn;
    }

    getLogBuffer(): string[] {
        return [...this.logBuffer];
    }

    private pushLog(line: string): void {
        this.logBuffer.push(line);
        if (this.logBuffer.length > 300) { this.logBuffer.shift(); }
        this.logLineListener?.(line);
    }

    private killStalePid(): void {
        try {
            const pid = parseInt(fs.readFileSync(this.pidFile, 'utf8').trim(), 10);
            if (!isNaN(pid)) {
                process.kill(pid, 'SIGTERM');
                this.log(`Processo anterior (PID ${pid}) finalizado via PID file.`);
            }
        } catch { /* process already gone or file missing */ }
        try { fs.unlinkSync(this.pidFile); } catch { /* ignore */ }
    }

    private killStaleCollector(): Promise<void> {
        // Kills any running otelcol process by name — safe because we only run one collector
        return new Promise((resolve) => {
            const cmd = process.platform === 'win32'
                ? 'taskkill /IM otelcol-contrib.exe /F /T 2>nul & taskkill /IM otelcol.exe /F /T 2>nul & exit /b 0'
                : 'pkill -9 -f otelcol-contrib 2>/dev/null; pkill -9 -f otelcol 2>/dev/null; true';
            cp.exec(cmd, () => setTimeout(resolve, 600));
        });
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
        await this.killStaleCollector();

        const token = await this.context.secrets.get('dt-ingest-token');
        const config = vscode.workspace.getConfiguration('dynatraceAiObs');
        const endpoint = config.get<string>('endpoint', '');
        const email = config.get<string>('userEmail', '');
        const configuredPort = config.get<number>('collectorPort', 4318);
        const configuredHealthPort = config.get<number>('healthCheckPort', 13133);

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

        // ── Auto-discover available ports ──────────────────────────────────
        let port = configuredPort;
        let healthPort = configuredHealthPort;

        try {
            if (!(await isPortAvailable(port))) {
                this.log(`Porta OTLP ${port} está ocupada. Buscando porta disponível...`);
                port = await findAvailablePort(port + 1);
                this.log(`Porta OTLP alternativa encontrada: ${port}`);
                await config.update('collectorPort', port, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(
                    `Dynatrace AI Obs: porta OTLP ${configuredPort} ocupada — usando ${port}.`
                );
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Dynatrace AI Obs: não foi possível encontrar porta OTLP disponível — ${msg}`);
            return;
        }

        try {
            if (!(await isPortAvailable(healthPort))) {
                this.log(`Porta health check ${healthPort} está ocupada. Buscando porta disponível...`);
                healthPort = await findAvailablePort(healthPort + 1);
                this.log(`Porta health check alternativa encontrada: ${healthPort}`);
                await config.update('healthCheckPort', healthPort, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(
                    `Dynatrace AI Obs: porta health check ${configuredHealthPort} ocupada — usando ${healthPort}.`
                );
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Dynatrace AI Obs: não foi possível encontrar porta health check disponível — ${msg}`);
            return;
        }
        // ── End auto-discover ──────────────────────────────────────────────

        const configPath = this.buildCollectorConfig(config.get<Record<string,string>>('customAttributes', {}));

        this.log(`Iniciando OTel Collector...`);
        this.log(`  Endpoint : ${endpoint}`);
        this.log(`  Email    : ${email || '(não definido)'}`);
        this.log(`  Porta    : ${port}`);
        this.log(`  Health   : ${healthPort}`);

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

        this.process.stdout?.on('data', (d: Buffer) => {
            const text = d.toString();
            this.outputChannel.append(text);
            text.split('\n').forEach(l => { if (l.trim()) { this.pushLog(l); } });
        });
        this.process.stderr?.on('data', (d: Buffer) => {
            const text = d.toString();
            this.outputChannel.append(text);
            text.split('\n').forEach(l => { if (l.trim()) { this.pushLog(l); } });
        });

        this.process.on('exit', (code) => {
            this.log(`Coletor parou (código: ${code})`);
            this.process = undefined;
            try { fs.unlinkSync(this.pidFile); } catch { /* ignore */ }
            this.statusBar.setStopped();
            this.statusListener?.(false);
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
                // Process died while health check was pending
                this.log(`ERRO: coletor parou antes de ficar pronto — verifique o log para detalhes.`);
                vscode.window.showErrorMessage(
                    `Dynatrace AI Obs: coletor falhou ao iniciar. Verifique o log de saída para mais detalhes.`,
                    'Ver Log'
                ).then(a => { if (a === 'Ver Log') this.outputChannel.show(); });
                return;
            }
            this.statusBar.setRunning();
            this.statusListener?.(true);
            this.log(`Coletor pronto na porta ${port} (health check: ${healthPort}).`);
        } catch {
            this.log(`ERRO: health check falhou na porta ${healthPort}.`);
            vscode.window.showErrorMessage(
                `Dynatrace AI Obs: não foi possível iniciar (porta OTLP: ${port}, health: ${healthPort}).`,
                'Ver Log'
            ).then(a => { if (a === 'Ver Log') this.outputChannel.show(); });
            await this.stop();
        }
    }

    async stop(): Promise<void> {
        if (this.process) {
            const proc = this.process;
            this.process = undefined;
            // Wait for the process to actually exit (up to 3s) before returning,
            // so the next start() doesn't race for the same ports.
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 3000);
                proc.once('exit', () => { clearTimeout(timeout); resolve(); });
                proc.kill('SIGTERM');
            });
            this.log('Coletor parado manualmente.');
        }
        this.statusBar.setStopped();
        this.statusListener?.(false);
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
        const line = `[${new Date().toISOString()}] ${msg}`;
        this.outputChannel.appendLine(line);
        this.pushLog(line);
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
