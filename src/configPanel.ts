import * as vscode from 'vscode';
import { CollectorManager } from './collector';
import { EvalsManager } from './evals';

export class ConfigPanel {
    static currentPanel: ConfigPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private readonly onSaved: () => void;
    private readonly collectorManager: CollectorManager;
    private readonly evalsManager: EvalsManager;

    static open(
      context: vscode.ExtensionContext,
      onSaved: () => void,
      collectorManager: CollectorManager,
      evalsManager: EvalsManager
    ): void {
        if (ConfigPanel.currentPanel) {
            ConfigPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'dtAiObsConfig',
            'Dynatrace AI Observability — Configurações',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ConfigPanel.currentPanel = new ConfigPanel(panel, context, onSaved, collectorManager, evalsManager);
    }

      private constructor(
        panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        onSaved: () => void,
        collectorManager: CollectorManager,
        evalsManager: EvalsManager
      ) {
        this.panel = panel;
        this.context = context;
        this.onSaved = onSaved;
        this.collectorManager = collectorManager;
        this.evalsManager = evalsManager;

        this.panel.webview.html = this.getHtml();

        collectorManager.setLogLineListener((line) => {
          this.panel.webview.postMessage({ command: 'logAppend', line });
        });
        collectorManager.setStatusListener((running) => {
          this.panel.webview.postMessage({ command: 'collectorStatus', running, logLines: [] });
        });

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
            case 'load':
              await this.sendCurrentSettings();
              this.sendCollectorStatus();
              break;
                case 'validate': await this.handleValidate(msg.endpoint, msg.token); break;
                case 'save':     await this.handleSave(msg.data); break;
            case 'saveEvalsEnabled':
              await vscode.workspace.getConfiguration('dynatraceAiObs')
                .update('evalsEnabled', msg.evalsEnabled, vscode.ConfigurationTarget.Global);
              break;
            case 'getCollectorStatus': this.sendCollectorStatus(); break;
            case 'startCollector':
              await this.collectorManager.start();
              this.sendCollectorStatus();
              break;
            case 'stopCollector':
              await this.collectorManager.stop();
              this.sendCollectorStatus();
              break;
            case 'restartCollector':
              await this.collectorManager.stop();
              await this.collectorManager.start();
              this.sendCollectorStatus();
              break;
            case 'installEvals': await this.evalsManager.installInTerminal(); break;
            case 'configureEvals': await this.evalsManager.configure(); break;
            case 'runEvals': await this.evalsManager.run(); break;
            case 'validateEvals': await this.evalsManager.validate(); break;
            }
        });

        this.panel.onDidDispose(() => {
          collectorManager.setLogLineListener(undefined);
          collectorManager.setStatusListener(undefined);
          ConfigPanel.currentPanel = undefined;
        });
      }

      private sendCollectorStatus(): void {
        this.panel.webview.postMessage({
          command: 'collectorStatus',
          running: this.collectorManager.isRunning(),
          logLines: this.collectorManager.getLogBuffer(),
        });
    }

    private async sendCurrentSettings(): Promise<void> {
        const cfg = vscode.workspace.getConfiguration('dynatraceAiObs');
        const hasToken = !!(await this.context.secrets.get('dt-ingest-token'));
        const endpoint = cfg.get<string>('endpoint', '');

        const tenantMatch = endpoint.match(/https:\/\/([^.]+)\.live\.dynatrace\.com/);
        const tenantId  = tenantMatch ? tenantMatch[1] : '';
        const isStdUrl  = !!tenantMatch;

        this.panel.webview.postMessage({
            command: 'init',
            data: {
                endpoint,
                tenantId,
                isStdUrl,
                hasToken,
                email:          cfg.get<string>('userEmail', ''),
                capturePrompts: cfg.get<boolean>('capturePrompts', false),
                evalsEnabled:   cfg.get<boolean>('evalsEnabled', false),
                collectorPort:  cfg.get<number>('collectorPort', 4318),
                healthPort:     cfg.get<number>('healthCheckPort', 13133),
                customAttrs:    cfg.get<Record<string, string>>('customAttributes', {}),
            }
        });
    }

    private async handleValidate(endpoint: string, token: string): Promise<void> {
        this.panel.webview.postMessage({ command: 'validating' });
        const result = await validateDynatraceCredentials(endpoint, token);
        this.panel.webview.postMessage({ command: 'validationResult', ...result });
    }

    private async handleSave(data: {
        endpoint: string; token: string; email: string;
        capturePrompts: boolean; evalsEnabled: boolean;
        collectorPort: number; healthPort: number;
        customAttrs: Record<string, string>;
    }): Promise<void> {
        try {
            const cfg = vscode.workspace.getConfiguration('dynatraceAiObs');
            await cfg.update('endpoint',         data.endpoint,        vscode.ConfigurationTarget.Global);
            await cfg.update('userEmail',        data.email,           vscode.ConfigurationTarget.Global);
            await cfg.update('capturePrompts',   data.capturePrompts,  vscode.ConfigurationTarget.Global);
            await cfg.update('evalsEnabled',     data.evalsEnabled,    vscode.ConfigurationTarget.Global);
            await cfg.update('collectorPort',    data.collectorPort,   vscode.ConfigurationTarget.Global);
            await cfg.update('healthCheckPort',  data.healthPort,      vscode.ConfigurationTarget.Global);
            await cfg.update('customAttributes', data.customAttrs,     vscode.ConfigurationTarget.Global);
            if (data.token) {
                await this.context.secrets.store('dt-ingest-token', data.token);
            }
            this.panel.webview.postMessage({ command: 'saveResult', success: true });
            this.onSaved();
        } catch (err) {
            this.panel.webview.postMessage({ command: 'saveResult', success: false, error: String(err) });
        }
    }

    private getNonce(): string {
        let text = '';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
        return text;
    }

    private getHtml(): string {
        const nonce = this.getNonce();
        return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<title>Configurações</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0;
    max-width: 800px;
  }
  h1 { font-size: 1.3em; font-weight: 600; margin-bottom: 4px; }
  .header { padding: 20px 32px 0; }
  .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
  .tab-bar {
    display: flex; border-bottom: 1px solid var(--vscode-panel-border, #444);
    margin-top: 16px; padding: 0 32px;
  }
  .tab-btn {
    background: none; border: none; border-bottom: 2px solid transparent;
    padding: 8px 18px; margin-bottom: -1px; cursor: pointer;
    color: var(--vscode-foreground); font: inherit; opacity: 0.7;
  }
  .tab-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
  .tab-btn.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); font-weight: 500; }
  .tab-pane { display: none; padding: 24px 32px 48px; }
  .tab-pane.active { display: block; }
  section { margin-bottom: 28px; }
  section h2 {
    font-size: 0.78em; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-panel-border, #444);
    padding-bottom: 6px; margin-bottom: 14px;
  }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 0.9em; font-weight: 500; margin-bottom: 5px; }
  .hint { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
  .hint code { background: var(--vscode-textCodeBlock-background, #333); padding: 1px 4px; border-radius: 2px; }
  .generated-url {
    margin-top: 6px; padding: 5px 8px; border-radius: 2px;
    background: var(--vscode-textCodeBlock-background, #2a2a2a);
    font-family: monospace; font-size: 0.82em;
    color: var(--vscode-textPreformat-foreground, #aaa);
    display: none;
  }
  .generated-url.visible { display: block; }

  .toggle-row {
    display: flex; gap: 0; margin-bottom: 10px;
    border: 1px solid var(--vscode-input-border, #555); border-radius: 2px; overflow: hidden;
    width: fit-content;
  }
  .toggle-btn {
    background: transparent; border: none; cursor: pointer;
    padding: 5px 14px; font-family: inherit; font-size: 0.88em;
    color: var(--vscode-foreground); white-space: nowrap;
  }
  .toggle-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .toggle-btn:not(.active):hover { background: var(--vscode-toolbar-hoverBackground); }

  input[type=text], input[type=password], input[type=number] {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 2px; padding: 6px 8px;
    font-family: inherit; font-size: inherit; outline: none;
  }
  input:focus { border-color: var(--vscode-focusBorder); }

  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .checkbox-row { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 14px; }
  .checkbox-row input[type=checkbox] { margin-top: 3px; width: 15px; height: 15px; flex-shrink: 0; cursor: pointer; }
  .checkbox-row .lbl { font-size: 0.9em; font-weight: 500; cursor: pointer; }
  .checkbox-row.disabled .lbl,
  .checkbox-row.disabled .hint { opacity: 0.4; }
  .checkbox-row input[type=checkbox]:disabled { cursor: not-allowed; }

  .attr-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .attr-table th {
    text-align: left; font-size: 0.82em; font-weight: 600;
    color: var(--vscode-descriptionForeground);
    padding: 0 4px 6px; border-bottom: 1px solid var(--vscode-panel-border, #444);
  }
  .attr-table td { padding: 4px; }
  .attr-table input { font-size: 0.88em; }
  .btn-remove {
    background: none; border: none; cursor: pointer;
    color: var(--vscode-errorForeground, #f88); font-size: 1.1em; padding: 2px 6px; border-radius: 2px;
  }
  .btn-remove:hover { background: var(--vscode-toolbar-hoverBackground); }
  .btn-add-attr {
    font-size: 0.85em; background: none;
    border: 1px solid var(--vscode-button-secondaryBackground, #555);
    color: var(--vscode-foreground); padding: 4px 10px; border-radius: 2px; cursor: pointer;
  }
  .btn-add-attr:hover { background: var(--vscode-toolbar-hoverBackground); }

  #val-banner {
    display: none; padding: 8px 12px; border-radius: 2px;
    font-size: 0.88em; margin-bottom: 16px;
  }
  #val-banner.validating {
    display: block;
    background: var(--vscode-inputValidation-infoBackground, #1a3a5e);
    border: 1px solid var(--vscode-inputValidation-infoBorder, #4a9eff);
  }
  #val-banner.error {
    display: block;
    background: var(--vscode-inputValidation-errorBackground, #5a1a1a);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #f44);
  }
  #val-banner.ok {
    display: block;
    background: var(--vscode-inputValidation-warningBackground, #1a3a1a);
    border: 1px solid #2a7; color: #afa;
  }

  .footer { display: flex; gap: 12px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
  .btn-primary {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 7px 20px; border-radius: 2px;
    font-family: inherit; font-size: inherit; cursor: pointer; font-weight: 500;
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    border: none; padding: 7px 16px; border-radius: 2px;
    font-family: inherit; font-size: inherit; cursor: pointer;
  }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
  .status-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #888; flex-shrink: 0; }
  .status-dot.running { background: #3c3; animation: pulse 1.5s infinite; }
  .status-dot.stopped { background: #c33; }
  .status-dot.busy { background: #fa0; animation: pulse 1s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .log-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  #logBox {
    height: 320px; overflow-y: auto; padding: 10px;
    background: var(--vscode-terminal-background, #1e1e1e);
    color: var(--vscode-terminal-foreground, #d4d4d4);
    border: 1px solid var(--vscode-panel-border, #333); border-radius: 2px;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 0.82em;
    white-space: pre-wrap; word-break: break-word;
  }
  .btn-link {
    background: none; border: none; padding: 3px 8px; cursor: pointer;
    color: var(--vscode-textLink-foreground); font: inherit; font-size: 0.85em;
  }
  .btn-link:hover { background: var(--vscode-toolbar-hoverBackground); }
  .eval-actions { display: flex; flex-direction: column; gap: 10px; max-width: 390px; }
  .eval-actions button { text-align: left; }
  .warning { color: var(--vscode-editorWarning-foreground, #fa0); margin: -6px 0 14px; }
  @media (max-width: 560px) {
    .header, .tab-pane { padding-left: 16px; padding-right: 16px; }
    .tab-bar { padding: 0 8px; }
    .tab-btn { flex: 1; padding: 8px 6px; }
    .row-2 { grid-template-columns: 1fr; gap: 0; }
    .log-toolbar { align-items: flex-start; gap: 8px; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>Dynatrace AI Observability</h1>
  <p class="subtitle">Configure credenciais, gerencie o coletor e acesse os Evals.</p>
</div>

<div class="tab-bar" role="tablist" aria-label="Seções do painel">
  <button class="tab-btn active" id="tabBtnConfig" role="tab" aria-controls="paneConfig">Configurações</button>
  <button class="tab-btn" id="tabBtnColetor" role="tab" aria-controls="paneColetor">Coletor</button>
  <button class="tab-btn" id="tabBtnEvals" role="tab" aria-controls="paneEvals">Evals</button>
</div>

<div id="paneConfig" class="tab-pane active" role="tabpanel">

<section>
  <h2>Dynatrace</h2>

  <div class="field">
    <label>Endpoint <span style="color:var(--vscode-errorForeground)">*</span></label>
    <div class="toggle-row">
      <button class="toggle-btn active" id="btnModeTenant">Tenant ID</button>
      <button class="toggle-btn" id="btnModeUrl">OTLP Endpoint completo</button>
    </div>

    <div id="groupTenant">
      <input id="tenantId" type="text" placeholder="fov31014" autocomplete="off">
      <div class="hint">Somente o ID do tenant — o endereço completo é preenchido automaticamente.</div>
      <div class="generated-url" id="generatedUrl"></div>
    </div>

    <div id="groupUrl" style="display:none">
      <input id="endpoint" type="text" placeholder="https://abc12345.live.dynatrace.com/api/v2/otlp" autocomplete="off">
      <div class="hint">Use <code>.live.dynatrace.com</code> — não <code>.apps.</code></div>
    </div>
  </div>

  <div class="field">
    <label for="token">API Token <span style="color:var(--vscode-errorForeground)">*</span></label>
    <input id="token" type="password" placeholder="dt0c01.XXXXXXXXXX… (deixe em branco para manter o atual)" autocomplete="new-password">
    <div class="hint">Scopes: <code>openTelemetryTrace.ingest</code> + <code>metrics.ingest</code> · Armazenado no keychain do SO</div>
  </div>

  <div class="field">
    <label for="email">Email do desenvolvedor</label>
    <input id="email" type="text" placeholder="dev@empresa.com (opcional)" autocomplete="off">
    <div class="hint">Aparece nos spans para identificar o dev nos relatórios</div>
  </div>
</section>

<section>
  <h2>Coleta</h2>

  <div class="checkbox-row" id="rowCapture">
    <input type="checkbox" id="capturePrompts">
    <div>
      <div class="lbl">Capturar conteúdo de prompts e respostas</div>
      <div class="hint">Envia Input/Output nos spans (visível no Prompts stream). Desabilitado por padrão para privacidade.</div>
    </div>
  </div>

  <div class="checkbox-row disabled" id="rowEvals">
    <input type="checkbox" id="evalsEnabled" disabled>
    <div>
      <div class="lbl">Habilitar Dynatrace Evals (dt-evals)</div>
      <div class="hint">Requer "Capturar prompts" habilitado. Instala <code>@dynatrace-oss/dt-evals</code> e avalia spans gen_ai.*</div>
    </div>
  </div>
</section>

<section>
  <h2>Portas do coletor local</h2>
  <div class="row-2">
    <div class="field">
      <label for="collectorPort">Porta OTLP HTTP</label>
      <input id="collectorPort" type="number" min="1024" max="65535" value="4318">
      <div class="hint">Recebe spans da extensão e do hook</div>
    </div>
    <div class="field">
      <label for="healthPort">Porta Health Check</label>
      <input id="healthPort" type="number" min="1024" max="65535" value="13133">
      <div class="hint">Altere se a porta estiver em uso</div>
    </div>
  </div>
</section>

<section>
  <h2>Atributos customizados</h2>
  <table class="attr-table">
    <thead><tr><th style="width:40%">Chave</th><th>Valor</th><th style="width:40px"></th></tr></thead>
    <tbody id="attrRows"></tbody>
  </table>
  <button class="btn-add-attr" id="btnAddAttr">+ Adicionar atributo</button>
  <div class="hint" style="margin-top:6px">Adicionados a todos os spans. Ex: <code>squad</code>, <code>cost_center</code>, <code>project</code></div>
</section>

<div id="val-banner"></div>
<div class="footer">
  <button class="btn-primary" id="btnSave">Salvar configurações</button>
  <button class="btn-secondary" id="btnValidate">Validar credenciais</button>
</div>
</div>

<div id="paneColetor" class="tab-pane" role="tabpanel">
  <section>
    <h2>Status</h2>
    <div class="status-row">
      <span class="status-dot" id="statusDot" aria-hidden="true"></span>
      <span id="statusText">Verificando...</span>
    </div>
    <div class="btn-row">
      <button class="btn-primary" id="btnStart">Iniciar</button>
      <button class="btn-secondary" id="btnStop">Parar</button>
      <button class="btn-secondary" id="btnRestart">Reiniciar</button>
    </div>
  </section>
  <section>
    <div class="log-toolbar">
      <h2 style="margin-bottom:0">Log do coletor</h2>
      <div>
        <button class="btn-link" id="btnRefreshLog">Atualizar</button>
        <button class="btn-link" id="btnScrollBottom">Ir ao fim</button>
        <button class="btn-link" id="btnClearLog">Limpar</button>
      </div>
    </div>
    <pre id="logBox" aria-live="polite"></pre>
    <div class="hint" style="margin-top:6px">Até 300 linhas, atualizadas em tempo real.</div>
  </section>
</div>

<div id="paneEvals" class="tab-pane" role="tabpanel">
  <section>
    <h2>Dynatrace Evals</h2>
    <div class="checkbox-row" id="rowEvalsTab">
      <input type="checkbox" id="evalsEnabledTab">
      <div>
        <div class="lbl">Habilitar Dynatrace Evals</div>
        <div class="hint">Avalia spans gen_ai.* com os evaluators configurados.</div>
      </div>
    </div>
    <div id="evalsCaptureWarn" class="hint warning" style="display:none">
      Habilite "Capturar prompts" na aba Configurações para usar os Evals.
    </div>
  </section>
  <section>
    <h2>Ações</h2>
    <div class="eval-actions">
      <button class="btn-secondary" id="btnInstallEvals">Instalar dt-evals</button>
      <button class="btn-secondary" id="btnConfigureEvals">Abrir wizard de configuração</button>
      <button class="btn-primary" id="btnRunEvals">Rodar Evals</button>
      <button class="btn-secondary" id="btnValidateEvals">Validar setup</button>
    </div>
    <div class="hint" style="margin-top:14px">As ações são abertas no terminal integrado.</div>
  </section>
</div>

<script nonce="${nonce}">
(function() {
  var vscode = acquireVsCodeApi();
  var endpointMode = 'tenant';
  var collectorLogLines = [];

  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(function(button) { button.classList.remove('active'); });
    document.querySelectorAll('.tab-pane').forEach(function(pane) { pane.classList.remove('active'); });
    document.getElementById('tabBtn' + name).classList.add('active');
    document.getElementById('pane' + name).classList.add('active');
    if (name === 'Coletor') { vscode.postMessage({ command: 'getCollectorStatus' }); }
  }

  document.getElementById('tabBtnConfig').addEventListener('click', function() { switchTab('Config'); });
  document.getElementById('tabBtnColetor').addEventListener('click', function() { switchTab('Coletor'); });
  document.getElementById('tabBtnEvals').addEventListener('click', function() { switchTab('Evals'); });

  function setMode(mode) {
    endpointMode = mode;
    document.getElementById('groupTenant').style.display = mode === 'tenant' ? '' : 'none';
    document.getElementById('groupUrl').style.display    = mode === 'url'    ? '' : 'none';
    document.getElementById('btnModeTenant').classList.toggle('active', mode === 'tenant');
    document.getElementById('btnModeUrl').classList.toggle('active',    mode === 'url');
  }

  document.getElementById('btnModeTenant').addEventListener('click', function() { setMode('tenant'); updateGeneratedUrl(); });
  document.getElementById('btnModeUrl').addEventListener('click',    function() { setMode('url'); });

  function updateGeneratedUrl() {
    var tid = document.getElementById('tenantId').value.trim();
    var el  = document.getElementById('generatedUrl');
    if (tid) {
      el.textContent = 'https://' + tid + '.live.dynatrace.com/api/v2/otlp';
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }
  document.getElementById('tenantId').addEventListener('input', updateGeneratedUrl);

  function syncEvalsState() {
    var capture  = document.getElementById('capturePrompts').checked;
    var evalsChk = document.getElementById('evalsEnabled');
    var evalsRow = document.getElementById('rowEvals');
    var evalsTabChk = document.getElementById('evalsEnabledTab');
    evalsChk.disabled = !capture;
    evalsTabChk.disabled = !capture;
    if (!capture) { evalsChk.checked = false; evalsTabChk.checked = false; }
    evalsRow.classList.toggle('disabled', !capture);
    document.getElementById('rowEvalsTab').classList.toggle('disabled', !capture);
    document.getElementById('evalsCaptureWarn').style.display = capture ? 'none' : 'block';
  }
  document.getElementById('capturePrompts').addEventListener('change', syncEvalsState);
  document.getElementById('evalsEnabled').addEventListener('change', function() {
    document.getElementById('evalsEnabledTab').checked = this.checked;
  });
  document.getElementById('evalsEnabledTab').addEventListener('change', function() {
    document.getElementById('evalsEnabled').checked = this.checked;
    vscode.postMessage({ command: 'saveEvalsEnabled', evalsEnabled: this.checked });
  });

  function addAttrRow(key, val) {
    key = key || ''; val = val || '';
    var tr = document.createElement('tr');
    var tdKey = document.createElement('td');
    var tdVal = document.createElement('td');
    var tdDel = document.createElement('td');
    var inKey = document.createElement('input'); inKey.type = 'text'; inKey.placeholder = 'chave'; inKey.value = key;
    var inVal = document.createElement('input'); inVal.type = 'text'; inVal.placeholder = 'valor'; inVal.value = val;
    var btn   = document.createElement('button'); btn.className = 'btn-remove'; btn.textContent = '✕'; btn.title = 'Remover';
    btn.addEventListener('click', function() { tr.remove(); });
    tdKey.appendChild(inKey); tdVal.appendChild(inVal); tdDel.appendChild(btn);
    tr.appendChild(tdKey); tr.appendChild(tdVal); tr.appendChild(tdDel);
    document.getElementById('attrRows').appendChild(tr);
  }

  function collectAttrs() {
    var obj = {};
    document.querySelectorAll('#attrRows tr').forEach(function(tr) {
      var inputs = tr.querySelectorAll('input');
      var k = inputs[0].value.trim();
      var v = inputs[1].value.trim();
      if (k) { obj[k] = v; }
    });
    return obj;
  }

  document.getElementById('btnAddAttr').addEventListener('click', function() { addAttrRow('', ''); });

  function getEndpoint() {
    if (endpointMode === 'tenant') {
      var tid = document.getElementById('tenantId').value.trim();
      return tid ? 'https://' + tid + '.live.dynatrace.com/api/v2/otlp' : '';
    }
    return document.getElementById('endpoint').value.trim();
  }

  document.getElementById('btnValidate').addEventListener('click', function() {
    var endpoint = getEndpoint();
    var token    = document.getElementById('token').value.trim();
    if (!endpoint || !token) {
      showBanner('error', '✗ Preencha o Endpoint (ou Tenant ID) e o Token para validar.');
      return;
    }
    vscode.postMessage({ command: 'validate', endpoint: endpoint, token: token });
  });

  document.getElementById('btnSave').addEventListener('click', function() {
    var endpoint = getEndpoint();
    if (!endpoint) {
      showBanner('error', '✗ Endpoint ou Tenant ID é obrigatório.');
      return;
    }
    document.getElementById('btnSave').disabled = true;
    vscode.postMessage({
      command: 'save',
      data: {
        endpoint:       endpoint,
        token:          document.getElementById('token').value.trim(),
        email:          document.getElementById('email').value.trim(),
        capturePrompts: document.getElementById('capturePrompts').checked,
        evalsEnabled:   document.getElementById('evalsEnabled').checked,
        collectorPort:  parseInt(document.getElementById('collectorPort').value, 10) || 4318,
        healthPort:     parseInt(document.getElementById('healthPort').value, 10)    || 13133,
        customAttrs:    collectAttrs(),
      }
    });
  });

  function setCollectorBusy(busy, label) {
    ['btnStart', 'btnStop', 'btnRestart'].forEach(function(id) {
      document.getElementById(id).disabled = busy;
    });
    if (busy) {
      document.getElementById('statusDot').className = 'status-dot busy';
      document.getElementById('statusText').textContent = label;
    }
  }

  function renderCollectorLog(scrollToBottom) {
    var box = document.getElementById('logBox');
    box.textContent = collectorLogLines.join(String.fromCharCode(10));
    if (scrollToBottom) { box.scrollTop = box.scrollHeight; }
  }

  document.getElementById('btnStart').addEventListener('click', function() {
    setCollectorBusy(true, 'Iniciando...');
    vscode.postMessage({ command: 'startCollector' });
  });
  document.getElementById('btnStop').addEventListener('click', function() {
    setCollectorBusy(true, 'Parando...');
    vscode.postMessage({ command: 'stopCollector' });
  });
  document.getElementById('btnRestart').addEventListener('click', function() {
    setCollectorBusy(true, 'Reiniciando...');
    vscode.postMessage({ command: 'restartCollector' });
  });
  document.getElementById('btnRefreshLog').addEventListener('click', function() {
    vscode.postMessage({ command: 'getCollectorStatus' });
  });
  document.getElementById('btnScrollBottom').addEventListener('click', function() {
    var box = document.getElementById('logBox');
    box.scrollTop = box.scrollHeight;
  });
  document.getElementById('btnClearLog').addEventListener('click', function() {
    collectorLogLines = [];
    renderCollectorLog(false);
  });

  document.getElementById('btnInstallEvals').addEventListener('click', function() {
    vscode.postMessage({ command: 'installEvals' });
  });
  document.getElementById('btnConfigureEvals').addEventListener('click', function() {
    vscode.postMessage({ command: 'configureEvals' });
  });
  document.getElementById('btnRunEvals').addEventListener('click', function() {
    vscode.postMessage({ command: 'runEvals' });
  });
  document.getElementById('btnValidateEvals').addEventListener('click', function() {
    vscode.postMessage({ command: 'validateEvals' });
  });

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (msg.command === 'collectorStatus') {
      document.getElementById('statusDot').className = 'status-dot ' + (msg.running ? 'running' : 'stopped');
      document.getElementById('statusText').textContent = msg.running ? 'Rodando' : 'Parado';
      setCollectorBusy(false, '');
      if (msg.logLines) {
        collectorLogLines = msg.logLines.slice(-300);
        renderCollectorLog(true);
      }
    }
    if (msg.command === 'logAppend') {
      var logBox = document.getElementById('logBox');
      var nearBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 60;
      collectorLogLines.push(msg.line);
      if (collectorLogLines.length > 300) { collectorLogLines.shift(); }
      renderCollectorLog(nearBottom);
    }
    if (msg.command === 'init')             { populate(msg.data); }
    if (msg.command === 'validating')       { showBanner('validating', '⏳ Validando credenciais…'); }
    if (msg.command === 'validationResult') {
      if (msg.valid) { showBanner('ok', '✓ Credenciais válidas.'); }
      else           { showBanner('error', '✗ ' + msg.error); }
    }
    if (msg.command === 'saveResult') {
      document.getElementById('btnSave').disabled = false;
      if (msg.success) { showBanner('ok', '✓ Configurações salvas. Coletor iniciando…'); }
      else             { showBanner('error', '✗ Erro ao salvar: ' + msg.error); }
    }
  });

  function populate(d) {
    if (d.isStdUrl && d.tenantId) {
      setMode('tenant');
      document.getElementById('tenantId').value = d.tenantId;
      updateGeneratedUrl();
    } else if (d.endpoint) {
      setMode('url');
      document.getElementById('endpoint').value = d.endpoint;
    }

    if (d.hasToken) {
      document.getElementById('token').placeholder = '●●●●●●●● (token salvo — deixe em branco para manter)';
    }
    document.getElementById('email').value            = d.email || '';
    document.getElementById('capturePrompts').checked  = !!d.capturePrompts;
    document.getElementById('collectorPort').value    = d.collectorPort || 4318;
    document.getElementById('healthPort').value       = d.healthPort    || 13133;

    document.getElementById('evalsEnabled').checked = !!d.evalsEnabled;
    document.getElementById('evalsEnabledTab').checked = !!d.evalsEnabled;
    syncEvalsState();

    document.getElementById('attrRows').innerHTML = '';
    Object.entries(d.customAttrs || {}).forEach(function(entry) {
      addAttrRow(entry[0], entry[1]);
    });
  }

  function showBanner(type, text) {
    var b = document.getElementById('val-banner');
    b.className   = type;
    b.textContent = text;
  }

  vscode.postMessage({ command: 'load' });
})();
</script>
</body>
</html>`;
    }
}

export function validateDynatraceCredentials(endpoint: string, token: string): Promise<{ valid: boolean; error?: string }> {
    return new Promise((resolve) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const https = require('https') as typeof import('https');
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
            }, (res: import('http').IncomingMessage) => {
                if (res.statusCode === 200)      { resolve({ valid: true }); }
                else if (res.statusCode === 401) { resolve({ valid: false, error: 'Token inválido — verifique se está correto.' }); }
                else if (res.statusCode === 403) { resolve({ valid: false, error: 'Token sem os scopes: openTelemetryTrace.ingest + metrics.ingest.' }); }
                else                             { resolve({ valid: false, error: `Endpoint respondeu HTTP ${res.statusCode} — verifique a URL.` }); }
            });
            req.on('error', (err: Error) => resolve({ valid: false, error: `Não foi possível conectar: ${err.message}` }));
            req.setTimeout(8000, () => { req.destroy(); resolve({ valid: false, error: 'Timeout — verifique a URL e sua conexão.' }); });
            req.write(body);
            req.end();
        } catch (err) {
            resolve({ valid: false, error: `URL inválida: ${err}` });
        }
    });
}
