import * as vscode from 'vscode';
import * as cp from 'child_process';

/**
 * Integração com o CLI @dynatrace-oss/dt-evals.
 *
 * Fluxo:
 *   1. "Configurar Evals"  → roda o wizard interativo `dt-evals configure`
 *      (conecta na tenant, escolhe o LLM judge e grava `.dt-eval.yaml`).
 *   2. "Rodar Evals"       → puxa spans gen_ai.* recentes, aplica os evaluators
 *      escolhidos (ex.: prompt-injection) e grava os resultados como bizevents.
 *
 * O CLI é executado via `npx` (sem exigir instalação global) num terminal
 * integrado, pois `configure` é interativo e a saída do `run` é melhor
 * acompanhada em tempo real.
 */

const DT_EVALS_PKG = '@dynatrace-oss/dt-evals';

// Chave no globalState para não repetir o prompt de opt-in a cada ativação.
const EVALS_PROMPTED_KEY = 'dt-ai-obs.evalsPrompted';

// Catálogo de evaluators built-in (dt-evals). id = nome usado no --metric.
interface Evaluator {
    id: string;
    label: string;
    description: string;
}

const BUILTIN_EVALUATORS: Evaluator[] = [
    { id: 'prompt-injection', label: 'Prompt Injection', description: 'Tentativas de prompt injection na entrada' },
    { id: 'output-prompt-injection', label: 'Output Prompt Injection', description: 'Payload de injection emitido na saída para sequestrar um agente downstream' },
    { id: 'pii-leakage', label: 'PII Leakage', description: 'Informação pessoal identificável na resposta' },
    { id: 'toxicity', label: 'Toxicity', description: 'Conteúdo tóxico, ofensivo ou inseguro' },
    { id: 'bias', label: 'Bias', description: 'Viés prejudicial ou enquadramento injusto' },
    { id: 'hallucination', label: 'Hallucination', description: 'Afirmações não fundamentadas ou fabricadas' },
    { id: 'faithfulness', label: 'Faithfulness', description: 'Se a resposta está fundamentada no contexto fornecido' },
    { id: 'factual-accuracy', label: 'Factual Accuracy', description: 'Correção factual usando conhecimento de mundo' },
    { id: 'relevance', label: 'Relevance', description: 'Se a resposta atende ao pedido do usuário' },
    { id: 'context-relevance', label: 'Context Relevance', description: 'Qualidade do contexto recuperado (retrieval)' },
    { id: 'answer-completeness', label: 'Answer Completeness', description: 'Se todas as partes do pedido foram respondidas' },
    { id: 'conciseness', label: 'Conciseness', description: 'Se a resposta evita enrolação e verbosidade' },
    { id: 'fluency', label: 'Fluency', description: 'Gramática, clareza e naturalidade' },
    { id: 'summarization-quality', label: 'Summarization Quality', description: 'Fidelidade, cobertura e concisão de resumos' },
    { id: 'user-frustration', label: 'User Frustration', description: 'Sinais de frustração na mensagem do usuário' },
];

const SINCE_OPTIONS = ['30m', '1h', '6h', '24h'];
const SAMPLE_OPTIONS = ['10', '25', '50', '100'];

export class EvalsManager {
    private terminal: vscode.Terminal | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Pergunta de opt-in exibida na ativação, uma única vez.
     * "Deseja instalar o Dynatrace Evals (dt-evals)?"
     */
    async maybePromptInstall(): Promise<void> {
        const cfg = vscode.workspace.getConfiguration('dynatraceAiObs');
        // Já habilitado ou já perguntamos antes → não perguntar de novo.
        if (cfg.get<boolean>('evalsEnabled', false)) return;
        if (this.context.globalState.get<boolean>(EVALS_PROMPTED_KEY, false)) return;

        const action = await vscode.window.showInformationMessage(
            'Deseja instalar o Dynatrace Evals (dt-evals)? Ele avalia seus spans gen_ai.* ' +
            '(ex.: Prompt Injection, PII, Toxicity) usando um LLM judge.',
            'Instalar', 'Agora não'
        );
        await this.context.globalState.update(EVALS_PROMPTED_KEY, true);

        if (action === 'Instalar') {
            await cfg.update('evalsEnabled', true, vscode.ConfigurationTarget.Global);
            const ok = await this.install();
            if (ok) {
                const next = await vscode.window.showInformationMessage(
                    'Dynatrace Evals instalado. Deseja configurar agora (conectar tenant e LLM judge)?',
                    'Configurar', 'Depois'
                );
                if (next === 'Configurar') await this.configure();
            }
        }
    }

    /** Verifica se o CLI dt-evals já está instalado globalmente. */
    private isCliInstalled(): Promise<boolean> {
        return new Promise((resolve) => {
            cp.exec('dt-evals --version', (err: cp.ExecException | null) => resolve(!err));
        });
    }

    /** Confere se o npm está disponível no PATH (dependência para instalar o CLI). */
    private checkNpm(): Promise<string | undefined> {
        return new Promise((resolve) => {
            cp.exec('npm --version', (err: cp.ExecException | null, stdout: string) =>
                resolve(err ? undefined : stdout.trim())
            );
        });
    }

    /** Heurística: erro de permissão (EACCES/EPERM) na instalação global do npm. */
    private isPermissionError(text: string): boolean {
        return /EACCES|EPERM|permission denied|not permitted|access is denied|operation not permitted/i.test(text);
    }

    /** Instala o CLI dt-evals globalmente via npm, com barra de progresso. */
    async install(): Promise<boolean> {
        if (!(await this.checkNode())) return false;

        // npm é dependência para a instalação global — se faltar, avisa e para.
        const npmVersion = await this.checkNpm();
        if (!npmVersion) {
            const action = await vscode.window.showErrorMessage(
                'Dynatrace Evals: npm não encontrado no PATH. O npm (incluso no Node.js) é necessário para instalar o dt-evals.',
                'Abrir nodejs.org'
            );
            if (action === 'Abrir nodejs.org') {
                vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
            }
            return false;
        }

        if (await this.isCliInstalled()) {
            vscode.window.showInformationMessage('Dynatrace Evals (dt-evals) já está instalado.');
            return true;
        }

        return vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Instalando Dynatrace Evals (dt-evals)...' },
            () => new Promise<boolean>((resolve) => {
                cp.exec(`npm install -g ${DT_EVALS_PKG}`, (err: cp.ExecException | null, _stdout: string, stderr: string) => {
                    if (!err) {
                        vscode.window.showInformationMessage('✓ Dynatrace Evals (dt-evals) instalado com sucesso.');
                        resolve(true);
                        return;
                    }

                    const details = stderr || err.message;
                    if (this.isPermissionError(details)) {
                        // Máquina sem permissão para instalar pacote global.
                        vscode.window.showErrorMessage(
                            'Dynatrace Evals: sem permissão para instalar o pacote global (npm EACCES/EPERM). ' +
                            'Sua máquina não permite "npm install -g". Peça ao seu admin ou configure um prefix de npm no seu usuário ' +
                            '(ex.: "npm config set prefix ~/.npm-global" e adicione ao PATH). Alternativa: o comando "Rodar Evals" usa "npx" sem instalação global.',
                            'Ver como resolver'
                        ).then(a => {
                            if (a === 'Ver como resolver') {
                                vscode.env.openExternal(vscode.Uri.parse('https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally'));
                            }
                        });
                    } else {
                        vscode.window.showErrorMessage(
                            `Dynatrace Evals: falha ao instalar — ${details}. ` +
                            'Você pode instalar manualmente com "npm install -g @dynatrace-oss/dt-evals" ou usar "Rodar Evals" (via npx, sem instalação global).'
                        );
                    }
                    resolve(false);
                });
            })
        );
    }

    /** Abre a instalação no terminal para que o usuário acompanhe a saída. */
    async installInTerminal(): Promise<void> {
        if (!(await this.checkNode())) return;
        if (!(await this.checkNpm())) {
            vscode.window.showErrorMessage('Dynatrace Evals: npm não encontrado no PATH.');
            return;
        }
        const term = this.getTerminal();
        term.show();
        term.sendText(`npm install -g ${DT_EVALS_PKG}`);
    }

    /** Deriva a environmentUrl (.live.) a partir do endpoint OTLP configurado. */
    private getEnvironmentUrl(): string {
        const endpoint = vscode.workspace.getConfiguration('dynatraceAiObs').get<string>('endpoint', '');
        if (!endpoint) return '';
        try {
            const u = new URL(endpoint);
            return `${u.protocol}//${u.host}`;
        } catch {
            return '';
        }
    }

    /** Confere se há Node.js >= 20 disponível (exigência do dt-evals). */
    private async checkNode(): Promise<boolean> {
        const version = await new Promise<string | undefined>((resolve) => {
            cp.exec('node --version', (err: cp.ExecException | null, stdout: string) =>
                resolve(err ? undefined : stdout.trim())
            );
        });
        if (!version) {
            const action = await vscode.window.showErrorMessage(
                'Dynatrace Evals: Node.js não encontrado no PATH. É necessário Node.js >= 20 para rodar o dt-evals.',
                'Abrir nodejs.org'
            );
            if (action === 'Abrir nodejs.org') {
                vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
            }
            return false;
        }
        const major = parseInt(version.replace(/^v/, '').split('.')[0], 10);
        if (isNaN(major) || major < 20) {
            const action = await vscode.window.showErrorMessage(
                `Dynatrace Evals: Node.js ${version} detectado, mas o dt-evals exige >= 20.`,
                'Abrir nodejs.org'
            );
            if (action === 'Abrir nodejs.org') {
                vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
            }
            return false;
        }
        return true;
    }

    private getTerminal(): vscode.Terminal {
        if (!this.terminal || this.terminal.exitStatus !== undefined) {
            const envUrl = this.getEnvironmentUrl();
            this.terminal = vscode.window.createTerminal({
                name: 'Dynatrace Evals',
                // Pré-preenche o DT_ENV_URL para o wizard/run já apontar para a tenant certa.
                env: envUrl ? { DT_ENV_URL: envUrl } : undefined,
            });
        }
        return this.terminal;
    }

    /** Roda o wizard interativo de configuração do dt-evals. */
    async configure(): Promise<void> {
        if (!(await this.checkNode())) return;

        const envUrl = this.getEnvironmentUrl();
        const flags = envUrl ? ` --env-url ${envUrl}` : '';

        const proceed = await vscode.window.showInformationMessage(
            'O wizard do dt-evals vai abrir no terminal. Ele conecta na sua tenant Dynatrace, ' +
            'pede o token (scopes storage:spans:read, storage:buckets:read, storage:events:write) e ' +
            'o provider do LLM judge (OpenAI/Anthropic/Azure). Ao final grava um .dt-eval.yaml.',
            'Continuar', 'Cancelar'
        );
        if (proceed !== 'Continuar') return;

        const term = this.getTerminal();
        term.show();
        term.sendText(`npx -y ${DT_EVALS_PKG} configure${flags}`);
    }

    /** Seleciona evaluators + janela + amostragem e roda a avaliação. */
    async run(): Promise<void> {
        if (!(await this.checkNode())) return;

        const picks = await vscode.window.showQuickPick(
            BUILTIN_EVALUATORS.map(e => ({ label: e.label, description: e.description, id: e.id })),
            {
                title: 'Evaluators (1/4)',
                placeHolder: 'Selecione um ou mais evaluators (ex.: Prompt Injection)',
                canPickMany: true,
                ignoreFocusOut: true,
            }
        );
        if (!picks || picks.length === 0) return;

        const since = await vscode.window.showQuickPick(SINCE_OPTIONS, {
            title: 'Janela de tempo (2/4)',
            placeHolder: 'Puxar spans gen_ai.* dos últimos...',
            ignoreFocusOut: true,
        });
        if (!since) return;

        const sample = await vscode.window.showQuickPick(SAMPLE_OPTIONS, {
            title: 'Amostragem % (3/4)',
            placeHolder: 'Porcentagem de traces a avaliar',
            ignoreFocusOut: true,
        });
        if (!sample) return;

        const mode = await vscode.window.showQuickPick(
            [
                { label: 'Executar avaliação', description: 'Chama o LLM judge e grava resultados no Dynatrace', dryRun: false },
                { label: 'Dry-run (prévia)', description: 'Mostra o trabalho sem chamar o judge nem gravar resultados', dryRun: true },
            ],
            { title: 'Modo (4/4)', placeHolder: 'Como executar', ignoreFocusOut: true }
        );
        if (!mode) return;

        // --metric aceita apenas um evaluator por execução. Com múltiplos selecionados,
        // usamos os evaluators habilitados no .dt-eval.yaml (sem --metric).
        const metricFlag = picks.length === 1 ? ` --metric ${picks[0].id}` : '';
        const dryRunFlag = mode.dryRun ? ' --dry-run' : '';

        const cmd = `npx -y ${DT_EVALS_PKG} run --since ${since} --sample ${sample}${metricFlag}${dryRunFlag}`;

        if (picks.length > 1) {
            vscode.window.showInformationMessage(
                `Vários evaluators selecionados — o dt-evals usará os metrics habilitados no .dt-eval.yaml. ` +
                `Garanta que ${picks.map(p => p.id).join(', ')} estejam em metrics.enabled.`
            );
        }

        const term = this.getTerminal();
        term.show();
        term.sendText(cmd);
    }

    /** Mostra a config resolvida e status do dt-evals. */
    async status(): Promise<void> {
        if (!(await this.checkNode())) return;
        const term = this.getTerminal();
        term.show();
        term.sendText(`npx -y ${DT_EVALS_PKG} status`);
    }

    /** Valida config, conectividade Dynatrace e provider do judge. */
    async validate(): Promise<void> {
        if (!(await this.checkNode())) return;
        const term = this.getTerminal();
        term.show();
        term.sendText(`npx -y ${DT_EVALS_PKG} validate`);
    }
}
