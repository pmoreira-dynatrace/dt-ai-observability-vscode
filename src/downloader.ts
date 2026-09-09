import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as cp from 'child_process';

const RELEASES_API = 'https://api.github.com/repos/open-telemetry/opentelemetry-collector-releases/releases/latest';
const VERSION_FILE = 'otelcol-version.txt';

interface PlatformTarget {
    os: string;
    arch: string;
    binary: string;
}

function detectPlatform(): PlatformTarget {
    const osMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
    const archMap: Record<string, string> = { x64: 'amd64', arm64: 'arm64' };

    const otelOs = osMap[process.platform];
    const otelArch = archMap[process.arch];

    if (!otelOs || !otelArch) {
        throw new Error(`Plataforma não suportada: ${process.platform}/${process.arch}`);
    }

    return {
        os: otelOs,
        arch: otelArch,
        binary: process.platform === 'win32' ? 'otelcol-contrib.exe' : 'otelcol-contrib',
    };
}

export async function getBinaryPath(context: vscode.ExtensionContext): Promise<string> {
    const target = detectPlatform();
    const storageDir = context.globalStorageUri.fsPath;
    const binaryPath = path.join(storageDir, target.binary);

    if (fs.existsSync(binaryPath)) {
        return binaryPath;
    }

    return download(storageDir, target, binaryPath);
}

async function download(storageDir: string, target: PlatformTarget, binaryPath: string): Promise<string> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Dynatrace AI Obs', cancellable: false },
        async (progress) => {
            progress.report({ message: 'Verificando versão do OTel Collector...' });

            const version = await fetchLatestVersion();
            const fileName = `otelcol-contrib_${version}_${target.os}_${target.arch}.tar.gz`;
            const url = `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${version}/${fileName}`;

            progress.report({ message: `Baixando v${version} para ${target.os}/${target.arch}...` });

            fs.mkdirSync(storageDir, { recursive: true });

            const tarPath = path.join(storageDir, fileName);
            await downloadFile(url, tarPath, (pct) => {
                progress.report({ message: `Baixando v${version}... ${pct}%` });
            });

            progress.report({ message: 'Extraindo binário...' });
            await extractBinary(tarPath, storageDir, target.binary);

            fs.unlinkSync(tarPath);
            fs.writeFileSync(path.join(storageDir, VERSION_FILE), version, 'utf8');

            if (process.platform !== 'win32') {
                fs.chmodSync(binaryPath, 0o755);
            }

            progress.report({ message: 'Pronto! OTel Collector instalado.' });
            return binaryPath;
        }
    );
}

function fetchLatestVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(RELEASES_API, { headers: { 'User-Agent': 'dt-ai-observability-vscode' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const tag = JSON.parse(data).tag_name as string;
                    resolve(tag.replace(/^v/, ''));
                } catch {
                    reject(new Error('Falha ao obter versão do OTel Collector. Verifique sua conexão.'));
                }
            });
        }).on('error', reject);
    });
}

function downloadFile(url: string, destPath: string, onProgress: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const follow = (location: string) => {
            https.get(location, { headers: { 'User-Agent': 'dt-ai-observability-vscode' } }, (res) => {
                if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                    follow(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Download falhou: HTTP ${res.statusCode}`));
                    return;
                }

                const total = parseInt(res.headers['content-length'] || '0', 10);
                let received = 0;

                const file = fs.createWriteStream(destPath);
                res.on('data', (chunk: Buffer) => {
                    received += chunk.length;
                    if (total > 0) onProgress(Math.round((received / total) * 100));
                });
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve()));
                file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
            }).on('error', reject);
        };
        follow(url);
    });
}

function extractBinary(tarPath: string, destDir: string, binaryName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        cp.execFile('tar', ['-xzf', tarPath, '-C', destDir, binaryName], (err, _stdout, stderr) => {
            if (err) {
                reject(new Error(`Falha ao extrair binário: ${stderr || err.message}`));
            } else {
                resolve();
            }
        });
    });
}
