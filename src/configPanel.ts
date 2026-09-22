import * as vscode from 'vscode';
import { CollectorManager } from './collector';
import { EvalsManager } from './evals';
import { Language, translations, t, tf, normalizeLanguage, DEFAULT_LANGUAGE } from './i18n';

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

        const currentLang = normalizeLanguage(
            vscode.workspace.getConfiguration('dynatraceAiObs').get<string>('language')
        );
        this.panel.webview.html = this.getHtml(currentLang);

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
                case 'saveAttrs': await this.handleSaveAttrs(msg.customAttrs); break;
            case 'saveLanguage':
              await vscode.workspace.getConfiguration('dynatraceAiObs')
                .update('language', normalizeLanguage(msg.language), vscode.ConfigurationTarget.Global);
              break;
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

    private getLanguage(): Language {
        return normalizeLanguage(vscode.workspace.getConfiguration('dynatraceAiObs').get<string>('language'));
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
                language:       this.getLanguage(),
            }
        });
    }

    private async handleValidate(endpoint: string, token: string): Promise<void> {
        this.panel.webview.postMessage({ command: 'validating' });
        const result = await validateDynatraceCredentials(endpoint, token, this.getLanguage());
        this.panel.webview.postMessage({ command: 'validationResult', ...result });
    }

    private async handleSave(data: {
        endpoint: string; token: string; email: string;
        capturePrompts: boolean; evalsEnabled: boolean;
        collectorPort: number; healthPort: number;
        customAttrs: Record<string, string>;
    }): Promise<void> {
        const lang = this.getLanguage();
        try {
            // ── Validate credentials before saving ─────────────────────────
            const tokenToValidate = data.token || await this.context.secrets.get('dt-ingest-token');
            if (data.endpoint && tokenToValidate) {
                this.panel.webview.postMessage({ command: 'validating' });
                const validation = await validateDynatraceCredentials(data.endpoint, tokenToValidate, lang);
                if (!validation.valid) {
                    this.panel.webview.postMessage({
                        command: 'saveResult',
                        success: false,
                        error: `${t(lang, 'errInvalidCredentialsPrefix')}${validation.error}`
                    });
                    return;
                }
            }
            // ── End validation ─────────────────────────────────────────────

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

    /** Save only custom attributes and restart if the collector is running */
    private async handleSaveAttrs(customAttrs: Record<string, string>): Promise<void> {
        try {
            const cfg = vscode.workspace.getConfiguration('dynatraceAiObs');
            await cfg.update('customAttributes', customAttrs, vscode.ConfigurationTarget.Global);
            this.panel.webview.postMessage({ command: 'saveAttrsResult', success: true });
        } catch (err) {
            this.panel.webview.postMessage({ command: 'saveAttrsResult', success: false, error: String(err) });
        }
    }

    private getNonce(): string {
        let text = '';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
        return text;
    }

    private getHtml(lang: Language = DEFAULT_LANGUAGE): string {
        const nonce = this.getNonce();
        const L = (key: string) => t(lang, key);
        const i18nJson = JSON.stringify(translations);
        return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<title>${L('appTitle')}</title>
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
  .header { padding: 20px 32px 0; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .header-text { flex: 1; min-width: 0; }
  .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
  .lang-select {
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, #555));
    border-radius: 2px; padding: 4px 8px; font-family: inherit; font-size: 0.85em;
    cursor: pointer; flex-shrink: 0; margin-top: 2px;
  }
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

  .attr-actions { display: flex; gap: 10px; align-items: center; margin-top: 10px; }

  #attr-banner {
    display: none; padding: 6px 10px; border-radius: 2px;
    font-size: 0.85em; margin-top: 8px;
  }
  #attr-banner.ok {
    display: block;
    background: var(--vscode-inputValidation-warningBackground, #1a3a1a);
    border: 1px solid #2a7; color: #afa;
  }
  #attr-banner.error {
    display: block;
    background: var(--vscode-inputValidation-errorBackground, #5a1a1a);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #f44);
  }

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
  <div class="header-text">
    <h1 data-i18n="appTitle">${L('appTitle')}</h1>
    <p class="subtitle" data-i18n="appSubtitle">${L('appSubtitle')}</p>
  </div>
  <select class="lang-select" id="langSelect" aria-label="${L('langSelectLabel')}">
    <option value="pt-BR"${lang === 'pt-BR' ? ' selected' : ''}>Português (BR)</option>
    <option value="en"${lang === 'en' ? ' selected' : ''}>English</option>
    <option value="es"${lang === 'es' ? ' selected' : ''}>Español</option>
  </select>
</div>

<div class="tab-bar" role="tablist" aria-label="${L('tabBarAria')}">
  <button class="tab-btn active" id="tabBtnConfig" role="tab" aria-controls="paneConfig" data-i18n="tabConfig">${L('tabConfig')}</button>
  <button class="tab-btn" id="tabBtnColetor" role="tab" aria-controls="paneColetor" data-i18n="tabCollector">${L('tabCollector')}</button>
  <button class="tab-btn" id="tabBtnEvals" role="tab" aria-controls="paneEvals" data-i18n="tabEvals">${L('tabEvals')}</button>
</div>

<div id="paneConfig" class="tab-pane active" role="tabpanel">

<section>
  <h2 data-i18n="secDynatrace">${L('secDynatrace')}</h2>

  <div class="field">
    <label><span data-i18n="endpointLabel">${L('endpointLabel')}</span> <span style="color:var(--vscode-errorForeground)">*</span></label>
    <div class="toggle-row">
      <button class="toggle-btn active" id="btnModeTenant" data-i18n="modeTenant">${L('modeTenant')}</button>
      <button class="toggle-btn" id="btnModeUrl" data-i18n="modeUrl">${L('modeUrl')}</button>
    </div>

    <div id="groupTenant">
      <input id="tenantId" type="text" placeholder="fov31014" autocomplete="off">
      <div class="hint" data-i18n="tenantIdHint">${L('tenantIdHint')}</div>
      <div class="generated-url" id="generatedUrl"></div>
    </div>

    <div id="groupUrl" style="display:none">
      <input id="endpoint" type="text" placeholder="https://abc12345.live.dynatrace.com/api/v2/otlp" autocomplete="off">
      <div class="hint" data-i18n-html="endpointHintHtml">${L('endpointHintHtml')}</div>
    </div>
  </div>

  <div class="field">
    <label for="token"><span data-i18n="tokenLabel">${L('tokenLabel')}</span> <span style="color:var(--vscode-errorForeground)">*</span></label>
    <input id="token" type="password" placeholder="${L('tokenPlaceholder')}" data-i18n-placeholder="tokenPlaceholder" autocomplete="new-password">
    <div class="hint" data-i18n-html="tokenHintHtml">${L('tokenHintHtml')}</div>
  </div>

  <div class="field">
    <label for="email" data-i18n="emailLabel">${L('emailLabel')}</label>
    <input id="email" type="text" placeholder="${L('emailPlaceholder')}" data-i18n-placeholder="emailPlaceholder" autocomplete="off">
    <div class="hint" data-i18n="emailHint">${L('emailHint')}</div>
  </div>
</section>

<section>
  <h2 data-i18n="secColeta">${L('secColeta')}</h2>

  <div class="checkbox-row" id="rowCapture">
    <input type="checkbox" id="capturePrompts">
    <div>
      <div class="lbl" data-i18n="captureLabel">${L('captureLabel')}</div>
      <div class="hint" data-i18n="captureHint">${L('captureHint')}</div>
    </div>
  </div>

  <div class="checkbox-row disabled" id="rowEvals">
    <input type="checkbox" id="evalsEnabled" disabled>
    <div>
      <div class="lbl" data-i18n="evalsCheckboxLabel">${L('evalsCheckboxLabel')}</div>
      <div class="hint" data-i18n-html="evalsCheckboxHintHtml">${L('evalsCheckboxHintHtml')}</div>
    </div>
  </div>
</section>

<section>
  <h2 data-i18n="secPorts">${L('secPorts')}</h2>
  <div class="row-2">
    <div class="field">
      <label for="collectorPort" data-i18n="collectorPortLabel">${L('collectorPortLabel')}</label>
      <input id="collectorPort" type="number" min="1024" max="65535" value="4318">
      <div class="hint" data-i18n="collectorPortHint">${L('collectorPortHint')}</div>
    </div>
    <div class="field">
      <label for="healthPort" data-i18n="healthPortLabel">${L('healthPortLabel')}</label>
      <input id="healthPort" type="number" min="1024" max="65535" value="13133">
      <div class="hint" data-i18n="healthPortHint">${L('healthPortHint')}</div>
    </div>
  </div>
</section>

<section>
  <h2 data-i18n="secAttrs">${L('secAttrs')}</h2>
  <table class="attr-table">
    <thead><tr><th style="width:40%" data-i18n="attrKeyHeader">${L('attrKeyHeader')}</th><th data-i18n="attrValHeader">${L('attrValHeader')}</th><th style="width:40px"></th></tr></thead>
    <tbody id="attrRows"></tbody>
  </table>
  <div class="attr-actions">
    <button class="btn-add-attr" id="btnAddAttr" data-i18n="btnAddAttr">${L('btnAddAttr')}</button>
    <button class="btn-primary" id="btnSaveAttrs" style="font-size:0.85em;padding:5px 14px;" data-i18n="btnSaveAttrs">${L('btnSaveAttrs')}</button>
  </div>
  <div class="hint" style="margin-top:6px" data-i18n-html="attrsHintHtml">${L('attrsHintHtml')}</div>
  <div id="attr-banner"></div>
</section>

<div id="val-banner"></div>
<div class="footer">
  <button class="btn-primary" id="btnSave" data-i18n="btnSaveConfig">${L('btnSaveConfig')}</button>
  <button class="btn-secondary" id="btnValidate" data-i18n="btnValidateCreds">${L('btnValidateCreds')}</button>
</div>
</div>

<div id="paneColetor" class="tab-pane" role="tabpanel">
  <section>
    <h2 data-i18n="secStatus">${L('secStatus')}</h2>
    <div class="status-row">
      <span class="status-dot" id="statusDot" aria-hidden="true"></span>
      <span id="statusText" data-i18n="statusChecking">${L('statusChecking')}</span>
    </div>
    <div class="btn-row">
      <button class="btn-primary" id="btnStart" data-i18n="btnStart">${L('btnStart')}</button>
      <button class="btn-secondary" id="btnStop" data-i18n="btnStop">${L('btnStop')}</button>
      <button class="btn-secondary" id="btnRestart" data-i18n="btnRestart">${L('btnRestart')}</button>
    </div>
  </section>
  <section>
    <div class="log-toolbar">
      <h2 style="margin-bottom:0" data-i18n="secCollectorLog">${L('secCollectorLog')}</h2>
      <div>
        <button class="btn-link" id="btnRefreshLog" data-i18n="btnRefreshLog">${L('btnRefreshLog')}</button>
        <button class="btn-link" id="btnScrollBottom" data-i18n="btnScrollBottom">${L('btnScrollBottom')}</button>
        <button class="btn-link" id="btnClearLog" data-i18n="btnClearLog">${L('btnClearLog')}</button>
      </div>
    </div>
    <pre id="logBox" aria-live="polite"></pre>
    <div class="hint" style="margin-top:6px" data-i18n="logHint">${L('logHint')}</div>
  </section>
</div>

<div id="paneEvals" class="tab-pane" role="tabpanel">
  <section>
    <h2 data-i18n="secEvals">${L('secEvals')}</h2>
    <div class="checkbox-row" id="rowEvalsTab">
      <input type="checkbox" id="evalsEnabledTab">
      <div>
        <div class="lbl" data-i18n="evalsEnableLabel">${L('evalsEnableLabel')}</div>
        <div class="hint" data-i18n="evalsEnableHint">${L('evalsEnableHint')}</div>
      </div>
    </div>
    <div id="evalsCaptureWarn" class="hint warning" style="display:none" data-i18n="evalsCaptureWarn">
      ${L('evalsCaptureWarn')}
    </div>
  </section>
  <section>
    <h2 data-i18n="secActions">${L('secActions')}</h2>
    <div class="eval-actions">
      <button class="btn-secondary" id="btnInstallEvals" data-i18n="btnInstallEvals">${L('btnInstallEvals')}</button>
      <button class="btn-secondary" id="btnConfigureEvals" data-i18n="btnConfigureEvals">${L('btnConfigureEvals')}</button>
      <button class="btn-primary" id="btnRunEvals" data-i18n="btnRunEvals">${L('btnRunEvals')}</button>
      <button class="btn-secondary" id="btnValidateEvals" data-i18n="btnValidateEvals">${L('btnValidateEvals')}</button>
    </div>
    <div class="hint" style="margin-top:14px" data-i18n="evalsActionsHint">${L('evalsActionsHint')}</div>
  </section>
</div>

<script nonce="${nonce}">
(function() {
  var vscode = acquireVsCodeApi();
  var endpointMode = 'tenant';
  var collectorLogLines = [];
  var I18N = ${i18nJson};
  var currentLang = ${JSON.stringify(lang)};
  var collectorState = 'stopped';

  function t(key) {
    var dict = I18N[currentLang] || I18N['pt-BR'];
    return (dict && dict[key]) || (I18N['pt-BR'][key]) || key;
  }

  function applyLanguage(newLang) {
    currentLang = I18N[newLang] ? newLang : 'pt-BR';
    document.documentElement.setAttribute('lang', currentLang);

    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });

    document.querySelectorAll('.attr-key-input').forEach(function(el) { el.placeholder = t('attrKeyPlaceholder'); });
    document.querySelectorAll('.attr-val-input').forEach(function(el) { el.placeholder = t('attrValPlaceholder'); });
    document.querySelectorAll('.btn-remove').forEach(function(el) { el.title = t('attrRemoveTitle'); });

    var tokenInput = document.getElementById('token');
    if (tokenInput.dataset.hasToken === '1') { tokenInput.placeholder = t('tokenSavedPlaceholder'); }

    document.getElementById('statusText').textContent = collectorState === 'running' ? t('statusRunning') : t('statusStopped');

    document.getElementById('langSelect').value = currentLang;
  }

  document.getElementById('langSelect').addEventListener('change', function() {
    applyLanguage(this.value);
    vscode.postMessage({ command: 'saveLanguage', language: this.value });
  });

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
    var inKey = document.createElement('input'); inKey.type = 'text'; inKey.className = 'attr-key-input'; inKey.placeholder = t('attrKeyPlaceholder'); inKey.value = key;
    var inVal = document.createElement('input'); inVal.type = 'text'; inVal.className = 'attr-val-input'; inVal.placeholder = t('attrValPlaceholder'); inVal.value = val;
    var btn   = document.createElement('button'); btn.className = 'btn-remove'; btn.textContent = '✕'; btn.title = t('attrRemoveTitle');
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

  // ── Save / Update Attributes button ──────────────────────────────
  document.getElementById('btnSaveAttrs').addEventListener('click', function() {
    var attrs = collectAttrs();
    document.getElementById('btnSaveAttrs').disabled = true;
    vscode.postMessage({ command: 'saveAttrs', customAttrs: attrs });
  });

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
      showBanner('error', t('bannerFillRequired'));
      return;
    }
    vscode.postMessage({ command: 'validate', endpoint: endpoint, token: token });
  });

  document.getElementById('btnSave').addEventListener('click', function() {
    var endpoint = getEndpoint();
    if (!endpoint) {
      showBanner('error', t('bannerEndpointRequired'));
      return;
    }
    document.getElementById('btnSave').disabled = true;
    showBanner('validating', t('bannerValidatingSave'));
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
    setCollectorBusy(true, t('statusStarting'));
    vscode.postMessage({ command: 'startCollector' });
  });
  document.getElementById('btnStop').addEventListener('click', function() {
    setCollectorBusy(true, t('statusStopping'));
    vscode.postMessage({ command: 'stopCollector' });
  });
  document.getElementById('btnRestart').addEventListener('click', function() {
    setCollectorBusy(true, t('statusRestarting'));
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
      collectorState = msg.running ? 'running' : 'stopped';
      document.getElementById('statusDot').className = 'status-dot ' + collectorState;
      document.getElementById('statusText').textContent = msg.running ? t('statusRunning') : t('statusStopped');
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
    if (msg.command === 'validating')       { showBanner('validating', t('bannerValidatingOnly')); }
    if (msg.command === 'validationResult') {
      if (msg.valid) { showBanner('ok', t('bannerCredsValid')); }
      else           { showBanner('error', t('bannerCrossPrefix') + msg.error); }
    }
    if (msg.command === 'saveResult') {
      document.getElementById('btnSave').disabled = false;
      if (msg.success) { showBanner('ok', t('bannerSaveSuccess')); }
      else             { showBanner('error', t('bannerCrossPrefix') + msg.error); }
    }
    if (msg.command === 'saveAttrsResult') {
      document.getElementById('btnSaveAttrs').disabled = false;
      var ab = document.getElementById('attr-banner');
      if (msg.success) {
        ab.className = 'ok';
        ab.textContent = t('bannerAttrsSuccess');
      } else {
        ab.className = 'error';
        ab.textContent = t('bannerAttrsErrorPrefix') + msg.error;
      }
      setTimeout(function() { ab.className = ''; ab.style.display = 'none'; }, 5000);
    }
  });

  function populate(d) {
    if (d.language && d.language !== currentLang) { applyLanguage(d.language); }

    if (d.isStdUrl && d.tenantId) {
      setMode('tenant');
      document.getElementById('tenantId').value = d.tenantId;
      updateGeneratedUrl();
    } else if (d.endpoint) {
      setMode('url');
      document.getElementById('endpoint').value = d.endpoint;
    }

    if (d.hasToken) {
      document.getElementById('token').dataset.hasToken = '1';
      document.getElementById('token').placeholder = t('tokenSavedPlaceholder');
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

export function validateDynatraceCredentials(
    endpoint: string,
    token: string,
    lang: Language = DEFAULT_LANGUAGE
): Promise<{ valid: boolean; error?: string }> {
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
                else if (res.statusCode === 401) { resolve({ valid: false, error: t(lang, 'errInvalidToken') }); }
                else if (res.statusCode === 403) { resolve({ valid: false, error: t(lang, 'errMissingScopes') }); }
                else                             { resolve({ valid: false, error: tf(lang, 'errHttpStatus', String(res.statusCode)) }); }
            });
            req.on('error', (err: Error) => resolve({ valid: false, error: tf(lang, 'errConnect', err.message) }));
            req.setTimeout(8000, () => { req.destroy(); resolve({ valid: false, error: t(lang, 'errTimeout') }); });
            req.write(body);
            req.end();
        } catch (err) {
            resolve({ valid: false, error: tf(lang, 'errInvalidUrl', String(err)) });
        }
    });
}
