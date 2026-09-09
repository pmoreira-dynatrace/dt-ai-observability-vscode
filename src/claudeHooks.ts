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

// Script Python embutido — sem dependências externas, só stdlib
const HOOK_SCRIPT = `#!/usr/bin/env python3
"""
Dynatrace AI Observability — Claude Code OTel Hook v2
Captura: prompt, model, tokens, custo, duração total e tool calls (input+output).
Requer: Python 3.6+ (sem dependências externas)
"""
import sys, json, time, random, os, urllib.request

COLLECTOR_URL = "http://localhost:4318/v1/traces"
SERVICE_NAME  = "claude-code"
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
        with open(SETTINGS_FILE) as f:
            return json.load(f).get("model", "claude")
    except Exception:
        return os.environ.get("CLAUDE_MODEL", "claude")

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

def make_span(trace_id, span_id, name, start_ns, end_ns, attrs, parent_id=None):
    s = {
        "traceId": trace_id, "spanId": span_id, "name": name, "kind": 1,
        "startTimeUnixNano": str(start_ns), "endTimeUnixNano": str(end_ns),
        "attributes": attrs, "status": {"code": 1}
    }
    if parent_id:
        s["parentSpanId"] = parent_id
    return s

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
            with open(state_file) as f:
                state = json.load(f)
        except Exception:
            pass

    if not state.get("trace_id"):
        state["trace_id"] = rand_trace()

    trace_id = state["trace_id"]
    now_ns   = int(time.time() * 1e9)

    # ── UserPromptSubmit: gravar início da conversa ──────────────────────────
    if hook_event == "UserPromptSubmit":
        state["turn_start_ns"]  = now_ns
        state["turn_span_id"]   = rand_span()
        state["prompt_text"]    = event.get("prompt", "")
        state["model"]          = get_model()
        with open(state_file, "w") as f:
            json.dump(state, f)
        sys.exit(0)

    # ── PreToolUse: gravar início da tool call ───────────────────────────────
    if hook_event == "PreToolUse" and tool_name:
        state.setdefault("tools", {})[tool_name] = {
            "start_ns":   now_ns,
            "span_id":    rand_span(),
            "tool_input": trunc(event.get("tool_input", "")),
        }
        with open(state_file, "w") as f:
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
            attr_s("gen_ai.system",       "anthropic"),
            attr_s("claude.session_id",   session_id),
            attr_s("claude.tool_name",    tool_name),
            attr_s("claude.tool_input",   tool_input),
            attr_s("claude.tool_response",tool_resp),
            attr_d("claude.duration_ms",  round(dur_ms, 2)),
        ]
        send_spans([make_span(trace_id, span_id, f"claude.tool.{tool_name}",
                              start_ns, now_ns, attrs, parent_id)])
        with open(state_file, "w") as f:
            json.dump(state, f)
        sys.exit(0)

    # ── Stop: emitir span raiz da conversa (UserPromptSubmit → Stop) ────────
    if hook_event == "Stop":
        span_id     = state.get("turn_span_id") or rand_span()
        start_ns    = state.get("turn_start_ns", now_ns)
        prompt_text = state.get("prompt_text", "")
        model       = state.get("model", get_model())
        dur_ms      = (now_ns - start_ns) / 1e6

        # Tentar ler tokens/custo do evento Stop (disponível em versões recentes)
        usage       = event.get("usage") or {}
        input_tok   = usage.get("input_tokens") or event.get("input_tokens")
        output_tok  = usage.get("output_tokens") or event.get("output_tokens")
        cost_usd    = event.get("cost_usd") or event.get("total_cost_usd")

        attrs = [
            attr_s("gen_ai.system",        "anthropic"),
            attr_s("gen_ai.request.model", model),
            attr_s("gen_ai.prompt",        trunc(prompt_text)),
            attr_s("claude.session_id",    session_id),
            attr_d("claude.duration_ms",   round(dur_ms, 2)),
        ]
        if input_tok  is not None: attrs.append(attr_i("gen_ai.usage.input_tokens",  input_tok))
        if output_tok is not None: attrs.append(attr_i("gen_ai.usage.output_tokens", output_tok))
        if cost_usd   is not None: attrs.append(attr_d("gen_ai.usage.cost_usd",      cost_usd))

        send_spans([make_span(trace_id, span_id, "claude.conversation.turn",
                              start_ns, now_ns, attrs)])

        try: os.remove(state_file)
        except Exception: pass
        sys.exit(0)

    # ── Outros eventos (Notification, etc.) ─────────────────────────────────
    attrs = [attr_s("gen_ai.system", "anthropic"), attr_s("claude.session_id", session_id)]
    send_spans([make_span(trace_id, rand_span(), f"claude.{hook_event.lower()}",
                          now_ns, now_ns + 1_000_000, attrs)])
    with open(state_file, "w") as f:
        json.dump(state, f)

if __name__ == "__main__":
    main()
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

export function autoConfigureClaudeHooks(): void {
    log(`Verificando Claude Code em: ${CLAUDE_DIR}`);

    if (!fs.existsSync(CLAUDE_DIR)) {
        log('~/.claude não encontrado — Claude Code não instalado, pulando.');
        return;
    }

    const isFirstTime = !fs.existsSync(HOOK_SCRIPT_PATH);

    try {
        writeFiles();
        log(`otel-hook.py atualizado em: ${HOOK_SCRIPT_PATH}`);
        log(`settings.json atualizado em: ${SETTINGS_PATH}`);
        if (isFirstTime) {
            vscode.window.showInformationMessage(
                '✓ Dynatrace AI Obs: hooks do Claude Code configurados. Reinicie o Claude Code para ativar.'
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
