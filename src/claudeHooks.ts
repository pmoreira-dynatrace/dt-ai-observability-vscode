import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

let _log: ((msg: string) => void) | undefined;
export function setLogger(fn: (msg: string) => void): void { _log = fn; }
function log(msg: string): void { _log?.(`[hooks] ${msg}`); }

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const HOOK_SCRIPT_PATH = path.join(CLAUDE_DIR, 'otel-hook.py');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';
const HOOK_VERSION = '1.3.9';

// Script Python embutido — sem dependências externas, só stdlib
const HOOK_SCRIPT = `#!/usr/bin/env python3
# hook-version: 1.3.9
"""
Dynatrace AI Observability — Claude Code OTel Hook v2
Captura: prompt, model, tokens, custo, duração total e tool calls (input+output).
Requer: Python 3.6+ (sem dependências externas)
"""
import sys, json, time, random, os, glob, urllib.request, threading

COLLECTOR_URL = "http://localhost:4318/v1/traces"
SERVICE_NAME  = "claude-code"
GEN_AI_SYSTEM = "anthropic"
STATE_DIR     = os.path.expanduser("~/.claude/otel-state")
SETTINGS_FILE = os.path.expanduser("~/.claude/settings.json")
MAX_LEN       = 4096  # corta atributos muito longos

def trunc(v, n=MAX_LEN):
    s = json.dumps(v) if not isinstance(v, str) else v
    return s[:n] + " ...[truncated]" if len(s) > n else s

def rand_trace(): return f"{random.getrandbits(128):032x}"
def rand_span():  return f"{random.getrandbits(64):016x}"

def get_model():
    try:
        with open(SETTINGS_FILE, encoding='utf-8') as f:
            return json.load(f).get("model", "claude")
    except Exception:
        return os.environ.get("CLAUDE_MODEL", "claude")

def read_custom_attrs():
    """Read custom attributes written by the VS Code extension."""
    try:
        with open(os.path.expanduser("~/.claude/otel-attrs.json"), encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def read_last_assistant(session_id):
    """Read model, usage and last text response from the Claude Code session JSONL."""
    result = {"text": "", "model": "", "input_tokens": None, "output_tokens": None}
    try:
        pattern = os.path.expanduser(f"~/.claude/projects/*/{session_id}.jsonl")
        files = glob.glob(pattern)
        if not files:
            return result
        with open(files[0], encoding='utf-8') as f:
            for line in f:
                try:
                    r = json.loads(line)
                    msg = r.get("message") or r
                    if msg.get("role") != "assistant":
                        continue
                    # Model name (e.g. "claude-sonnet-4-6")
                    if msg.get("model"):
                        result["model"] = msg["model"]
                    # Token usage — sum input + cache tokens for real total
                    usage = msg.get("usage") or {}
                    if usage:
                        inp = (usage.get("input_tokens") or 0) + \
                              (usage.get("cache_read_input_tokens") or 0) + \
                              (usage.get("cache_creation_input_tokens") or 0)
                        out = usage.get("output_tokens") or 0
                        if inp: result["input_tokens"] = inp
                        if out: result["output_tokens"] = out
                    # Last text response
                    content = msg.get("content", [])
                    if isinstance(content, list):
                        texts = [b["text"] for b in content
                                 if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip()]
                        if texts:
                            result["text"] = texts[0]
                except Exception:
                    continue
    except Exception:
        pass
    return result

def send_spans(spans_list, resource_attrs=None):
    if not spans_list:
        return
    res_attrs = resource_attrs or []
    res_attrs += [
        {"key": "service.name",           "value": {"stringValue": SERVICE_NAME}},
        {"key": "deployment.environment", "value": {"stringValue": "dev"}},
    ]
    payload = {"resourceSpans": [{"resource": {"attributes": res_attrs},
        "scopeSpans": [{"scope": {"name": "claude-code-hooks", "version": "2.0"},
            "spans": spans_list}]}]}
    try:
        req = urllib.request.Request(
            COLLECTOR_URL, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3)
    except Exception:
        pass

def make_span(trace_id, span_id, name, start_ns, end_ns, attrs, parent_id=None, kind=1, events=None):
    s = {
        "traceId": trace_id, "spanId": span_id, "name": name, "kind": kind,
        "startTimeUnixNano": str(start_ns), "endTimeUnixNano": str(end_ns),
        "attributes": attrs, "status": {"code": 1}
    }
    if parent_id:
        s["parentSpanId"] = parent_id
    if events:
        s["events"] = events
    return s

def as_messages(role, text):
    """Format prompt/completion in OpenAI messages format for Dynatrace AI Observability."""
    return json.dumps([{"role": role, "content": trunc(text)}])

def content_event(name, attr_key, role, text, ts_ns):
    """Span event in OTel GenAI format — used by Dynatrace AI Observability app."""
    return {
        "name": name,
        "timeUnixNano": str(ts_ns),
        "attributes": [{"key": attr_key, "value": {"stringValue": as_messages(role, text)}}]
    }

def attr_s(k, v): return {"key": k, "value": {"stringValue": str(v)}}
def attr_d(k, v): return {"key": k, "value": {"doubleValue": float(v)}}
def attr_i(k, v): return {"key": k, "value": {"intValue": str(int(v))}}

def main():
    try:
        event = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    hook_event = event.get("hook_event_name", "unknown")
    tool_name  = event.get("tool_name", "")
    session_id = event.get("session_id") or "default"

    os.makedirs(STATE_DIR, exist_ok=True)
    state_file = os.path.join(STATE_DIR, f"{session_id}.json")

    state = {}
    if os.path.exists(state_file):
        try:
            with open(state_file, encoding='utf-8') as f:
                state = json.load(f)
        except Exception:
            pass

    if not state.get("trace_id"):
        state["trace_id"] = rand_trace()

    trace_id    = state["trace_id"]
    now_ns      = int(time.time() * 1e9)
    custom_attrs = [attr_s(k, v) for k, v in read_custom_attrs().items()]

    # ── UserPromptSubmit: gravar início da conversa ──────────────────────────
    if hook_event == "UserPromptSubmit":
        state["turn_start_ns"]  = now_ns
        state["turn_span_id"]   = rand_span()
        state["prompt_text"]    = event.get("prompt", "")
        state["model"]          = get_model()
        with open(state_file, "w", encoding='utf-8') as f:
            json.dump(state, f)
        sys.exit(0)

    # ── PreToolUse: gravar início da tool call ───────────────────────────────
    if hook_event == "PreToolUse" and tool_name:
        state.setdefault("tools", {})[tool_name] = {
            "start_ns":   now_ns,
            "span_id":    rand_span(),
            "tool_input": trunc(event.get("tool_input", "")),
        }
        with open(state_file, "w", encoding='utf-8') as f:
            json.dump(state, f)
        sys.exit(0)

    # ── PostToolUse: emitir span da tool com duração real ───────────────────
    if hook_event == "PostToolUse" and tool_name:
        ts = state.get("tools", {}).pop(tool_name, {})
        start_ns    = ts.get("start_ns", now_ns)
        span_id     = ts.get("span_id",  rand_span())
        tool_input  = ts.get("tool_input", "")
        tool_resp   = trunc(event.get("tool_response", ""))
        parent_id   = state.get("turn_span_id")
        dur_ms      = (now_ns - start_ns) / 1e6

        attrs = [
            attr_s("gen_ai.system",       GEN_AI_SYSTEM),
            attr_s("claude.session_id",   session_id),
            attr_s("claude.tool_name",    tool_name),
            attr_s("claude.tool_input",   tool_input),
            attr_s("claude.tool_response",tool_resp),
            attr_d("claude.duration_ms",  round(dur_ms, 2)),
        ] + custom_attrs
        send_spans([make_span(trace_id, span_id, f"claude.tool.{tool_name}",
                              start_ns, now_ns, attrs, parent_id)])
        with open(state_file, "w", encoding='utf-8') as f:
            json.dump(state, f)
        sys.exit(0)

    # ── Stop: emitir span raiz da conversa (UserPromptSubmit → Stop) ────────
    if hook_event == "Stop":
        span_id     = state.get("turn_span_id") or rand_span()
        start_ns    = state.get("turn_start_ns", now_ns)
        prompt_text = state.get("prompt_text", "")
        model       = state.get("model", get_model())
        dur_ms      = (now_ns - start_ns) / 1e6

        # Ler modelo, tokens e resposta diretamente do JSONL da sessão
        assistant   = read_last_assistant(session_id)
        completion  = assistant["text"]
        # JSONL tem o nome exato do modelo (ex: "claude-sonnet-4-6"); fallback para settings
        if assistant["model"]:
            model = assistant["model"]
        input_tok   = assistant["input_tokens"]
        output_tok  = assistant["output_tokens"]
        cost_usd    = event.get("cost_usd") or event.get("total_cost_usd")

        attrs = [
            attr_s("gen_ai.system",               GEN_AI_SYSTEM),
            attr_s("gen_ai.operation.name",       "chat"),
            attr_s("gen_ai.request.model",        model),
            attr_s("gen_ai.prompt.0.role",        "user"),
            attr_s("gen_ai.prompt.0.content",     trunc(prompt_text)),
            attr_s("gen_ai.completion.0.role",    "assistant"),
            attr_s("gen_ai.completion.0.content", trunc(completion)),
            attr_s("claude.session_id",           session_id),
            attr_d("claude.duration_ms",          round(dur_ms, 2)),
        ] + custom_attrs
        if input_tok  is not None: attrs.append(attr_i("gen_ai.usage.input_tokens",  input_tok))
        if output_tok is not None: attrs.append(attr_i("gen_ai.usage.output_tokens", output_tok))
        if cost_usd   is not None: attrs.append(attr_d("gen_ai.usage.cost_usd",      cost_usd))

        # Span events no formato OTel GenAI — necessário para o app AI Observability exibir Prompt trace
        events = []
        if prompt_text:
            events.append(content_event("gen_ai.content.prompt",     "gen_ai.prompt",     "user",      prompt_text, start_ns))
        if completion:
            events.append(content_event("gen_ai.content.completion",  "gen_ai.completion", "assistant", completion,  now_ns))

        # Span name "chat {model}" segue a convenção OTel GenAI — reconhecida pelo app AI Observability
        # kind=3 (CLIENT) identifica chamadas LLM no padrão GenAI semântico
        send_spans([make_span(trace_id, span_id, f"chat {model}",
                              start_ns, now_ns, attrs, kind=3, events=events)])

        try: os.remove(state_file)
        except Exception: pass
        sys.exit(0)

    # ── Outros eventos (Notification, etc.) ─────────────────────────────────
    attrs = [attr_s("gen_ai.system", GEN_AI_SYSTEM), attr_s("claude.session_id", session_id)]
    send_spans([make_span(trace_id, rand_span(), f"claude.{hook_event.lower()}",
                          now_ns, now_ns + 1_000_000, attrs)])
    with open(state_file, "w") as f:
        json.dump(state, f)

if __name__ == "__main__":
    t = threading.Thread(target=main, daemon=True)
    t.start()
    t.join(10)  # max 10s — prevents blocking Claude Code indefinitely
`;

function checkPython(): Promise<boolean> {
    return new Promise(resolve => {
        cp.exec(`${PYTHON_CMD} --version`, (err) => resolve(!err));
    });
}

function readSettings(): Record<string, unknown> {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function buildHookEntry() {
    return [{ hooks: [{ type: 'command', command: `${PYTHON_CMD} ${HOOK_SCRIPT_PATH}` }] }];
}

function getExistingHookVersion(): string {
    try {
        const content = fs.readFileSync(HOOK_SCRIPT_PATH, 'utf8');
        const match = content.match(/^# hook-version: (.+)$/m);
        return match?.[1]?.trim() || '';
    } catch {
        return '';
    }
}

export function autoConfigureClaudeHooks(): void {
    log(`Verificando Claude Code em: ${CLAUDE_DIR}`);

    if (!fs.existsSync(CLAUDE_DIR)) {
        log('~/.claude não encontrado — Claude Code não instalado, pulando.');
        return;
    }

    const isFirstTime = !fs.existsSync(HOOK_SCRIPT_PATH);
    const existingVersion = isFirstTime ? '' : getExistingHookVersion();
    const isUpdate = !isFirstTime && existingVersion !== HOOK_VERSION;

    try {
        writeFiles();
        log(`otel-hook.py v${HOOK_VERSION} atualizado em: ${HOOK_SCRIPT_PATH}`);
        log(`settings.json atualizado em: ${SETTINGS_PATH}`);
        if (isFirstTime) {
            vscode.window.showInformationMessage(
                '✓ Dynatrace AI Obs: hooks do Claude Code configurados. Reinicie o Claude Code para ativar.'
            );
        } else if (isUpdate) {
            vscode.window.showInformationMessage(
                `✓ Dynatrace AI Obs: hook do Claude Code atualizado (${existingVersion || 'anterior'} → ${HOOK_VERSION}). Reinicie o Claude Code para ativar.`
            );
        }
    } catch (err) {
        log(`ERRO ao configurar hooks: ${err}`);
        vscode.window.showWarningMessage(
            `Dynatrace AI Obs: não foi possível configurar hooks do Claude Code — ${err}`
        );
    }
}

function writeFiles(): void {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    fs.writeFileSync(HOOK_SCRIPT_PATH, HOOK_SCRIPT, { mode: 0o755, encoding: 'utf8' });

    const settings = readSettings();
    const hooks = (settings.hooks as Record<string, unknown>) || {};
    hooks['PreToolUse']       = buildHookEntry();
    hooks['PostToolUse']      = buildHookEntry();
    hooks['UserPromptSubmit'] = buildHookEntry();
    hooks['Stop']             = buildHookEntry();
    settings.hooks = hooks;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');

    writeAttrsFile();
}

function getSystemAttributes(): Record<string, string> {
    const osMap: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' };
    return {
        'ide.name':    vscode.env.appName,
        'ide.version': vscode.version,
        'os.type':     osMap[process.platform] || process.platform,
    };
}

export function writeAttrsFile(): void {
    try {
        const userAttrs = vscode.workspace.getConfiguration('dynatraceAiObs').get<Record<string, string>>('customAttributes', {});
        const merged = { ...getSystemAttributes(), ...userAttrs };
        fs.writeFileSync(
            path.join(CLAUDE_DIR, 'otel-attrs.json'),
            JSON.stringify(merged, null, 2),
            'utf8'
        );
    } catch { /* silently skip if ~/.claude not available */ }
}

export async function configureClaudeHooks(): Promise<void> {
    const hasPython = await checkPython();
    if (!hasPython) {
        vscode.window.showErrorMessage(
            `Dynatrace AI Obs: Python 3 não encontrado (comando: ${PYTHON_CMD}). Instale o Python 3 e tente novamente.`
        );
        return;
    }

    writeFiles();

    vscode.window.showInformationMessage(
        '✓ Claude Code hooks configurados. Reinicie o Claude Code para ativar.',
        'Ver o que foi instalado'
    ).then(action => {
        if (action === 'Ver o que foi instalado') {
            vscode.window.showInformationMessage(
                `Script: ${HOOK_SCRIPT_PATH}\nSettings: ${SETTINGS_PATH}`
            );
        }
    });
}

export async function removeClaudeHooks(): Promise<void> {
    const settings = readSettings();
    if (settings.hooks) {
        const hooks = settings.hooks as Record<string, unknown>;
        delete hooks['PreToolUse'];
        delete hooks['PostToolUse'];
        delete hooks['UserPromptSubmit'];
        delete hooks['Stop'];
        settings.hooks = hooks;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
    }
    if (fs.existsSync(HOOK_SCRIPT_PATH)) {
        fs.unlinkSync(HOOK_SCRIPT_PATH);
    }
    vscode.window.showInformationMessage('Dynatrace AI Obs: hooks do Claude Code removidos.');
}

export async function manageCustomAttributes(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('dynatraceAiObs');
    const current = cfg.get<Record<string, string>>('customAttributes', {});

    const ADD    = '$(add) Adicionar atributo';
    const REMOVE = '$(trash) Remover atributo';
    const DONE   = '$(check) Concluído';

    const entries = Object.entries(current);
    const items = [
        { label: ADD,  description: '' },
        ...entries.map(([k, v]) => ({ label: REMOVE, description: `${k} = ${v}`, key: k })),
        { label: DONE, description: '' },
    ];

    const pick = await vscode.window.showQuickPick(items, {
        title: `Dynatrace AI Obs — Atributos customizados (${entries.length} configurados)`,
        placeHolder: 'Escolha uma ação',
    });
    if (!pick || pick.label === DONE) return;

    if (pick.label === ADD) {
        const key = await vscode.window.showInputBox({
            title: 'Novo atributo — Nome',
            placeHolder: 'Ex: squad, cost_center, project',
            ignoreFocusOut: true,
            validateInput: v => (!v ? 'Obrigatório' : /\s/.test(v) ? 'Sem espaços' : undefined),
        });
        if (!key) return;
        const value = await vscode.window.showInputBox({
            title: `Novo atributo — Valor para "${key}"`,
            placeHolder: 'Ex: platform-team, cc-1234',
            ignoreFocusOut: true,
            validateInput: v => (!v ? 'Obrigatório' : undefined),
        });
        if (!value) return;
        const updated = { ...current, [key]: value };
        await cfg.update('customAttributes', updated, vscode.ConfigurationTarget.Global);
        writeAttrsFile();
        vscode.window.showInformationMessage(`✓ Atributo adicionado: ${key} = ${value}`);
    } else if (pick.label === REMOVE && 'key' in pick) {
        const updated = { ...current };
        delete updated[(pick as { key: string }).key];
        await cfg.update('customAttributes', updated, vscode.ConfigurationTarget.Global);
        writeAttrsFile();
        vscode.window.showInformationMessage(`✓ Atributo removido: ${(pick as { key: string }).key}`);
    }
}
