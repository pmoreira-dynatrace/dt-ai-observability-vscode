import * as vscode from 'vscode';

export class ConfigPanel {
    static currentPanel: ConfigPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private readonly onSaved: () => void;

    static open(context: vscode.ExtensionContext, onSaved: () => void): void {
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
        ConfigPanel.currentPanel = new ConfigPanel(panel, context, onSaved);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, onSaved: () => void) {
        this.panel = panel;
        this.context = context;
        this.onSaved = onSaved;

        this.panel.webview.html = this.getHtml();

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'load': await this.sendCurrentSettings(); break;
                case 'validate': await this.handleValidate(msg.endpoint, msg.token); break;
                case 'save': await this.handleSave(msg.data); break;
            }
        });

        this.panel.onDidDispose(() => { ConfigPanel.currentPanel = undefined; });
    }

    private async sendCurrentSettings(): Promise<void> {
        const cfg = vscode.workspace.getConfiguration('dynatraceAiObs');
        const hasToken = !!(await this.context.secrets.get('dt-ingest-token'));
        this.panel.webview.postMessage({
            command: 'init',
            data: {
                endpoint:       cfg.get<string>('endpoint', ''),
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
            this.panel.dispose();
        } catch (err) {
            this.panel.webview.postMessage({ command: 'saveResult', success: false, error: String(err) });
        }
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configurações</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 32px 48px;
    max-width: 720px;
  }

  h1 { font-size: 1.3em; font-weight: 600; margin-bottom: 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 28px; font-size: 0.92em; }

  section { margin-bottom: 28px; }
  section h2 {
    font-size: 0.8em; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-panel-border, #444);
    padding-bottom: 6px; margin-bottom: 14px;
  }

  .field { margin-bottom: 14px; }
  .field label {
    display: block; font-size: 0.9em; font-weight: 500;
    margin-bottom: 5px; color: var(--vscode-foreground);
  }
  .field .hint {
    font-size: 0.82em; color: var(--vscode-descriptionForeground);
    margin-top: 4px;
  }

  input[type=text], input[type=password], input[type=number] {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 2px;
    padding: 6px 8px;
    font-family: inherit;
    font-size: inherit;
    outline: none;
  }
  input:focus {
    border-color: var(--vscode-focusBorder);
  }
  input.error { border-color: var(--vscode-inputValidation-errorBorder, #f44); }

  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .checkbox-row {
    display: flex; align-items: flex-start; gap: 10px;
    margin-bottom: 14px; cursor: pointer;
  }
  .checkbox-row input[type=checkbox] {
    margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; cursor: pointer;
  }
  .checkbox-row .label-wrap label { font-size: 0.9em; font-weight: 500; cursor: pointer; }
  .checkbox-row .label-wrap .hint {
    font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-top: 2px;
  }

  /* Custom attributes table */
  .attr-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .attr-table th {
    text-align: left; font-size: 0.82em; font-weight: 600;
    color: var(--vscode-descriptionForeground);
    padding: 0 4px 6px; border-bottom: 1px solid var(--vscode-panel-border, #444);
  }
  .attr-table td { padding: 4px; }
  .attr-table input { font-size: 0.88em; }
  .attr-table .btn-remove {
    background: none; border: none; cursor: pointer;
    color: var(--vscode-errorForeground, #f44); font-size: 1.1em; padding: 2px 6px;
    border-radius: 2px;
  }
  .attr-table .btn-remove:hover { background: var(--vscode-toolbar-hoverBackground); }

  .btn-add-attr {
    font-size: 0.85em;
    background: none;
    border: 1px solid var(--vscode-button-secondaryBackground, #555);
    color: var(--vscode-foreground);
    padding: 4px 10px; border-radius: 2px; cursor: pointer;
  }
  .btn-add-attr:hover { background: var(--vscode-toolbar-hoverBackground); }

  /* Validation banner */
  #val-banner {
    display: none; padding: 8px 12px; border-radius: 2px;
    font-size: 0.88em; margin-bottom: 16px;
  }
  #val-banner.validating {
    display: block;
    background: var(--vscode-inputValidation-infoBackground, #1a3a5e);
    border: 1px solid var(--vscode-inputValidation-infoBorder, #4a9eff);
    color: var(--vscode-inputValidation-infoForeground, #cce5ff);
  }
  #val-banner.error {
    display: block;
    background: var(--vscode-inputValidation-errorBackground, #5a1a1a);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #f44);
    color: var(--vscode-inputValidation-errorForeground, #fcc);
  }
  #val-banner.ok {
    display: block;
    background: var(--vscode-inputValidation-warningBackground, #1a3a1a);
    border: 1px solid #2a7; color: #afa;
  }

  /* Footer buttons */
  .footer { display: flex; gap: 12px; align-items: center; margin-top: 8px; }
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; padding: 7px 20px; border-radius: 2px;
    font-family: inherit; font-size: inherit; cursor: pointer; font-weight: 500;
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none; padding: 7px 16px; border-radius: 2px;
    font-family: inherit; font-size: inherit; cursor: pointer;
  }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .save-msg { font-size: 0.88em; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h1>Dynatrace AI Observability</h1>
<p class="subtitle">Configure as credenciais e preferências da extensão.</p>

<!-- ── Dynatrace ─────────────────────────────────────────── -->
<section>
  <h2>Dynatrace</h2>

  <div class="field">
    <label for="endpoint">OTLP Endpoint <span style="color:var(--vscode-errorForeground)">*</span></label>
    <input id="endpoint" type="text" placeholder="https://abc12345.live.dynatrace.com/api/v2/otlp" autocomplete="off">
    <div class="hint">Use <code>.live.dynatrace.com</code> (não <code>.apps.</code>)</div>
  </div>

  <div class="field">
    <label for="token">API Token <span style="color:var(--vscode-errorForeground)">*</span></label>
    <input id="token" type="password" placeholder="dt0c01.XXXXXXXXXX… (deixe em branco para manter o atual)" autocomplete="new-password">
    <div class="hint">Scopes: <code>openTelemetryTrace.ingest</code> + <code>metrics.ingest</code> &nbsp;·&nbsp; Armazenado no keychain do SO</div>
  </div>

  <div class="field">
    <label for="email">Email do desenvolvedor</label>
    <input id="email" type="text" placeholder="dev@empresa.com (opcional)" autocomplete="off">
    <div class="hint">Aparece nos spans para identificar o dev nos relatórios</div>
  </div>
</section>

<!-- ── Coleta ─────────────────────────────────────────────── -->
<section>
  <h2>Coleta</h2>

  <label class="checkbox-row" for="capturePrompts">
    <input type="checkbox" id="capturePrompts">
    <div class="label-wrap">
      <label for="capturePrompts">Capturar conteúdo de prompts e respostas</label>
      <div class="hint">Envia Input/Output nos spans (visível no Prompts stream). Desabilitado por padrão para privacidade.</div>
    </div>
  </label>

  <label class="checkbox-row" for="evalsEnabled">
    <input type="checkbox" id="evalsEnabled">
    <div class="label-wrap">
      <label for="evalsEnabled">Habilitar Dynatrace Evals (dt-evals)</label>
      <div class="hint">Instala o CLI <code>@dynatrace-oss/dt-evals</code> globalmente e avalia spans gen_ai.* (ex.: Prompt Injection).</div>
    </div>
  </label>
</section>

<!-- ── Portas ─────────────────────────────────────────────── -->
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

<!-- ── Atributos customizados ─────────────────────────────── -->
<section>
  <h2>Atributos customizados</h2>
  <table class="attr-table">
    <thead><tr><th>Chave</th><th>Valor</th><th></th></tr></thead>
    <tbody id="attrRows"></tbody>
  </table>
  <button class="btn-add-attr" onclick="addAttrRow()">+ Adicionar atributo</button>
  <div class="hint" style="margin-top:6px">Adicionados a todos os spans do Claude Code e Copilot. Ex: <code>squad</code>, <code>cost_center</code></div>
</section>

<!-- ── Footer ─────────────────────────────────────────────── -->
<div id="val-banner"></div>
<div class="footer">
  <button class="btn-primary" id="btnSave" onclick="save()">Salvar e iniciar coletor</button>
  <button class="btn-secondary" onclick="validateOnly()">Validar credenciais</button>
  <span class="save-msg" id="saveMsg"></span>
</div>

<script>
const vscode = acquireVsCodeApi();

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.command === 'init') populate(msg.data);
  if (msg.command === 'validating') showBanner('validating', '⏳ Validando credenciais…');
  if (msg.command === 'validationResult') {
    if (msg.valid) showBanner('ok', '✓ Credenciais válidas.');
    else showBanner('error', '✗ ' + msg.error);
  }
  if (msg.command === 'saveResult') {
    if (msg.success) {
      showBanner('ok', '✓ Configurações salvas. Coletor iniciando…');
      document.getElementById('btnSave').disabled = false;
    } else {
      showBanner('error', '✗ Erro ao salvar: ' + msg.error);
      document.getElementById('btnSave').disabled = false;
    }
  }
});

vscode.postMessage({ command: 'load' });

// ── Populate ─────────────────────────────────────────────────
function populate(d) {
  document.getElementById('endpoint').value       = d.endpoint || '';
  document.getElementById('email').value          = d.email || '';
  document.getElementById('capturePrompts').checked = !!d.capturePrompts;
  document.getElementById('evalsEnabled').checked   = !!d.evalsEnabled;
  document.getElementById('collectorPort').value  = d.collectorPort || 4318;
  document.getElementById('healthPort').value     = d.healthPort || 13133;
  if (d.hasToken) {
    document.getElementById('token').placeholder = '●●●●●●●● (token salvo — deixe em branco para manter)';
  }
  const tbody = document.getElementById('attrRows');
  tbody.innerHTML = '';
  Object.entries(d.customAttrs || {}).forEach(([k, v]) => addAttrRow(k, v));
}

// ── Custom attrs ──────────────────────────────────────────────
function addAttrRow(key = '', val = '') {
  const tr = document.createElement('tr');
  tr.innerHTML =
    '<td><input type="text" placeholder="chave" value="' + esc(key) + '"></td>' +
    '<td><input type="text" placeholder="valor" value="' + esc(val) + '"></td>' +
    '<td><button class="btn-remove" onclick="this.closest(\'tr\').remove()" title="Remover">✕</button></td>';
  document.getElementById('attrRows').appendChild(tr);
}

function collectAttrs() {
  const rows = document.querySelectorAll('#attrRows tr');
  const obj = {};
  rows.forEach(r => {
    const inputs = r.querySelectorAll('input');
    const k = inputs[0].value.trim();
    const v = inputs[1].value.trim();
    if (k) obj[k] = v;
  });
  return obj;
}

// ── Validate ──────────────────────────────────────────────────
function validateOnly() {
  const endpoint = document.getElementById('endpoint').value.trim();
  const token    = document.getElementById('token').value.trim();
  if (!endpoint || !token) {
    showBanner('error', '✗ Preencha o Endpoint e o Token para validar.');
    return;
  }
  vscode.postMessage({ command: 'validate', endpoint, token });
}

// ── Save ──────────────────────────────────────────────────────
function save() {
  const endpoint = document.getElementById('endpoint').value.trim();
  const token    = document.getElementById('token').value.trim();
  if (!endpoint) { showBanner('error', '✗ Endpoint é obrigatório.'); return; }
  document.getElementById('btnSave').disabled = true;
  document.getElementById('saveMsg').textContent = '';
  vscode.postMessage({
    command: 'save',
    data: {
      endpoint,
      token,
      email:          document.getElementById('email').value.trim(),
      capturePrompts: document.getElementById('capturePrompts').checked,
      evalsEnabled:   document.getElementById('evalsEnabled').checked,
      collectorPort:  parseInt(document.getElementById('collectorPort').value) || 4318,
      healthPort:     parseInt(document.getElementById('healthPort').value) || 13133,
      customAttrs:    collectAttrs(),
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────
function showBanner(type, msg) {
  const b = document.getElementById('val-banner');
  b.className = type;
  b.textContent = msg;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
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
                if (res.statusCode === 200)       resolve({ valid: true });
                else if (res.statusCode === 401)  resolve({ valid: false, error: 'Token inválido — verifique se está correto.' });
                else if (res.statusCode === 403)  resolve({ valid: false, error: 'Token sem os scopes necessários: openTelemetryTrace.ingest + metrics.ingest.' });
                else                              resolve({ valid: false, error: `Endpoint respondeu HTTP ${res.statusCode} — verifique a URL.` });
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
