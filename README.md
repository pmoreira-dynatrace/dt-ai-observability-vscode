# Dynatrace AI Observability — VS Code Extension

Observe AI assistant usage (GitHub Copilot Chat, Claude Code) via OpenTelemetry and send traces directly to Dynatrace — with no Docker, no manual collector setup, and no extra infrastructure.

```
VS Code / Cursor
  ├─ GitHub Copilot Chat  ──┐
  └─ Claude Code (hooks)  ──┤─→ OTel Collector (local process, ~50 MB RAM)
                             └─→ HTTPS → Dynatrace SaaS (Grail)
```

**What gets captured:**

| Source | Prompt | Model | Duration | Tokens | Tool calls |
|---|---|---|---|---|---|
| GitHub Copilot Chat | ✓ (opt-in) | ✓ | ✓ | ✓ | — |
| Claude Code | ✓ | ✓ | ✓ | ✓ (if available) | ✓ with input/output |

---

## Prerequisites

### Dynatrace tenant

| Requirement | Detail |
|---|---|
| Tenant type | SaaS Latest or Managed with Grail enabled |
| App | AI & LLM Observability (install from Hub) |
| API token | Scopes: `openTelemetryTrace.ingest` + `metrics.ingest` |

Generate a token: **Ctrl+K → Access Tokens → Generate new token**

### Developer machine

#### Hardware

| Resource | Minimum | Notes |
|---|---|---|
| RAM | 4 GB | Collector uses ~50–80 MB extra |
| CPU | Any | < 2% additional usage |
| Disk | 200 MB free | ~100 MB for cached collector binary |
| Network | Internet access | Required once on first activation (binary download) |

#### Operating System

| OS | Minimum version | Architectures |
|---|---|---|
| **macOS** | 10.15 Catalina | x64 (Intel), arm64 (Apple Silicon) |
| **Windows** | 10 build 17134 (1803) | x64 |
| **Linux** | Ubuntu 20.04 / Debian 11 / RHEL 8 / Fedora 36 | x64 |

> Windows 1803+ is required for the built-in `tar` command used to extract the collector binary.

#### IDE

| IDE | Minimum version |
|---|---|
| **VS Code** | 1.99.0 |
| **Cursor** | 0.40+ |

#### Software (end-user)

| Software | Version | Required for | Notes |
|---|---|---|---|
| **Python 3** | 3.6+ | Claude Code hooks | Already included on most Linux/macOS. Windows: install from [python.org](https://www.python.org/downloads/) and check **Add Python to PATH** |
| **tar** | Any | Extracting collector binary | Pre-installed on all supported OSes |

> **macOS Python note:** If installed via Homebrew, confirm it works by running `python3 --version` in a terminal. On macOS 12.3+ the system Python was removed — install via `brew install python3`.

---

## Installation (end users)

### Step 1 — Get the VSIX file

Download `dt-ai-observability.vsix` from the [Releases](../../releases/latest) page or request it from your team.

### Step 2 — Install in VS Code / Cursor

**Via UI (recommended):**
1. Open VS Code or Cursor
2. Click the **Extensions** icon (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Click `···` (three dots) at the top of the Extensions panel
4. Select **Install from VSIX...**
5. Pick the downloaded `dt-ai-observability.vsix`
6. Click **Reload**

**Via terminal (if `code` is in PATH):**
```bash
code --install-extension dt-ai-observability.vsix
```

**Via terminal without `code` in PATH (macOS):**
```bash
/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code \
  --install-extension dt-ai-observability.vsix
```

### Step 3 — Configure credentials

On first launch a prompt appears:

> *"Dynatrace AI Observability: configure suas credenciais para começar."*

Click **Configurar Agora** and fill in three fields:

| Field | Example | Notes |
|---|---|---|
| OTLP Endpoint | `https://abc12345.live.dynatrace.com/api/v2/otlp` | Use `.live.`, not `.apps.` |
| API Token | `dt0c01.XXXXXXXXXX...` | Must start with `dt0c01.` |
| Email (optional) | `dev@company.com` | Appears in spans to identify the developer |

The token is stored in the **OS keychain** via VS Code SecretStorage — never in plain text.

To reconfigure: `Ctrl+Shift+P` → **Dynatrace AI Obs: Configurar Credenciais**

### Step 4 — First-time binary download

On the first activation the extension automatically:
1. Detects your OS and architecture
2. Downloads the correct OTel Collector binary (~100 MB) from GitHub Releases
3. Caches it permanently (not re-downloaded on future extension updates)
4. Starts the collector

A progress bar shows the download status.

### Step 5 — Verify it's working

**Status bar** (bottom-right corner):

| Icon | Meaning |
|---|---|
| `⊙ DT OTel` (orange) | Stopped or not configured |
| `↺ DT OTel` (spinning) | Starting / downloading binary |
| `● DT OTel` (normal) | Running and collecting |

**Check the collector process:**
```bash
# macOS / Linux
curl http://localhost:13133
# Expected: {"status":"Server available","upSince":"..."}

# Windows PowerShell
Invoke-WebRequest http://localhost:13133
```

**Check the Output panel:**

`View → Output → Dynatrace AI Observability`

You should see:
```
[...] [hooks] otel-hook.py atualizado em: ...
[...] Iniciando OTel Collector...
[...] Coletor pronto na porta 4318.
```

---

## Validating data in Dynatrace

Open **Notebooks** in your tenant and run these DQL queries.

### Claude Code spans

```dql
fetch spans, from:now()-1h
| filter service.name == "claude-code"
| filter span.name == "claude.conversation.turn"
| fields timestamp, gen_ai.prompt, gen_ai.request.model,
         claude.duration_ms, gen_ai.usage.input_tokens,
         gen_ai.usage.output_tokens, gen_ai.usage.cost_usd
| sort timestamp desc
```

### Claude Code tool calls

```dql
fetch spans, from:now()-1h
| filter service.name == "claude-code"
| filter startsWith(span.name, "claude.tool.")
| fields timestamp, span.name, claude.tool_input, claude.tool_response, claude.duration_ms
| sort timestamp desc
```

### GitHub Copilot Chat spans

```dql
fetch spans, from:now()-1h
| filter service.name == "copilot-chat"
| fields timestamp, span.name, gen_ai.request.model,
         gen_ai.usage.input_tokens, gen_ai.usage.output_tokens
| sort timestamp desc
```

> To capture Copilot prompt/response content, add to your VS Code settings:
> ```json
> "github.copilot.chat.otel.captureContent": true
> ```

### Response time analysis

```dql
fetch spans, from:now()-24h
| filter service.name == "claude-code"
| filter span.name == "claude.conversation.turn"
| fieldsAdd dur_ms = toDouble(claude.duration_ms)
| summarize p50 = percentile(dur_ms, 50),
            p95 = percentile(dur_ms, 95),
            p99 = percentile(dur_ms, 99),
            requests = count()
```

### Cost estimate (last 24h)

```dql
fetch spans, from:now()-24h
| filter service.name == "claude-code"
| filter isNotNull(gen_ai.usage.cost_usd)
| summarize total_cost_usd = sum(toDouble(gen_ai.usage.cost_usd)),
            requests = count(),
            by:{gen_ai.request.model}
| sort total_cost_usd desc
```

---

## Available commands

`Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac):

| Command | Description |
|---|---|
| `Dynatrace AI Obs: Configurar Credenciais` | Set or update endpoint and API token |
| `Dynatrace AI Obs: Iniciar Coletor` | Start the collector manually |
| `Dynatrace AI Obs: Parar Coletor` | Stop the collector |
| `Dynatrace AI Obs: Ver Status` | Show whether the collector is running |
| `Dynatrace AI Obs: Configurar Hooks do Claude Code` | Set up Claude Code hooks manually |
| `Dynatrace AI Obs: Remover Hooks do Claude Code` | Remove Claude Code hooks |

---

## Extension settings

| Key | Default | Description |
|---|---|---|
| `dynatraceAiObs.endpoint` | `""` | Dynatrace OTLP endpoint |
| `dynatraceAiObs.userEmail` | `""` | Developer email (appears in spans) |
| `dynatraceAiObs.autoStart` | `true` | Auto-start collector when VS Code opens |
| `dynatraceAiObs.collectorPort` | `4318` | Local OTLP HTTP port |

---

## Cursor (without GitHub Copilot)

Cursor uses its own AI and doesn't support the `github.copilot.chat.otel.*` settings. To capture Cursor spans, add these environment variables to your shell profile **before** opening Cursor:

**macOS / Linux** — add to `~/.zshrc` or `~/.bashrc`:
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=cursor-ide
```

**Windows PowerShell** — add to `$PROFILE`:
```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318"
$env:OTEL_SERVICE_NAME            = "cursor-ide"
```

Then restart the terminal and open Cursor from it to inherit the variables.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Orange status bar after setup | Binary still downloading | Wait — it's ~100 MB on first run |
| `curl localhost:13133` fails | Port 4318 or 13133 already in use | Change `dynatraceAiObs.collectorPort` in settings |
| No spans in Dynatrace | Invalid token or endpoint uses `.apps.` | Reconfigure via **Configurar Credenciais** |
| `user.email` null in spans | Email not filled during setup | Reconfigure and add email |
| Download fails | No access to `github.com` | Check proxy/firewall; allow `github.com` and `objects.githubusercontent.com` |
| Copilot sends data but Claude Code doesn't | Python 3 not found by the hook | Run `python3 --version` in terminal; install Python 3 if missing |
| Claude Code hooks not executing | Claude Code wasn't restarted after hook setup | Close and reopen Claude Code (terminal or VS Code) |
| Notification about hooks didn't appear | `~/.claude` didn't exist yet | Run `Cmd+Shift+P` → **Dynatrace AI Obs: Configurar Hooks do Claude Code** manually |

---

## Building from source

### Prerequisites

```bash
node --version   # >= 18.0 LTS
npm --version    # >= 9.0
```

### Steps

```bash
# 1. Clone
git clone https://github.com/pmoreira-dynatrace/dt-ai-observability-vscode
cd dt-ai-observability-vscode

# 2. Install dependencies
npm install

# 3. Build VSIX (~27 KB, no binary bundled)
./scripts/package.sh

# Output: dt-ai-observability.vsix
```

The binary (~100 MB) is downloaded automatically on first activation — it is never bundled in the VSIX.

### Project structure

```
vscode-dt-ai-observability/
├── src/
│   ├── extension.ts      — entry point, activation and configure flow
│   ├── collector.ts      — OTel Collector process lifecycle
│   ├── downloader.ts     — platform detection, binary download and cache
│   ├── claudeHooks.ts    — Claude Code hook script (Python) + auto-install
│   ├── settings.ts       — GitHub Copilot OTel settings auto-config
│   └── statusBar.ts      — VS Code status bar indicator
├── resources/
│   └── otel-collector.yaml  — Collector config (uses env vars for credentials)
├── scripts/
│   └── package.sh        — builds the single VSIX
├── README.md
├── GUIDE.md              — detailed deployment guide (Portuguese)
└── package.json
```

---

## Privacy and security

- **Prompts are opt-in**: Claude Code captures prompts by default (can be disabled by removing hooks). Copilot captures prompts only when `captureContent: true` is set.
- **No response content from Claude Code**: The Claude Code hook system does not expose the AI's response text — only the user prompt and tool call data are available.
- **Token stored in OS keychain**: VS Code SecretStorage is backed by the OS keychain (Keychain on macOS, Credential Manager on Windows, libsecret on Linux) — never stored in plain text or `settings.json`.
- **Collector makes outbound HTTPS only**: The local collector only connects outbound to your Dynatrace tenant. No public port is exposed.
- **Verifiable binary**: Downloaded directly from [open-telemetry/opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases).

---

## License

MIT — see [LICENSE](LICENSE)
