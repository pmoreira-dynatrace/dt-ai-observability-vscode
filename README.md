# Dynatrace AI Observability — VS Code Extension

[![Latest Release](https://img.shields.io/github/v/release/pmoreira-dynatrace/dt-ai-observability-vscode?label=Download%20latest%20release&sort=semver&style=for-the-badge&logo=github)](https://github.com/pmoreira-dynatrace/dt-ai-observability-vscode/releases/latest)

Observe AI assistant usage (GitHub Copilot Chat, Claude Code) via OpenTelemetry and send traces directly to Dynatrace — with no Docker, no manual collector setup, and no extra infrastructure.

```
VS Code / Cursor
  ├─ GitHub Copilot Chat  ──┐
  └─ Claude Code (hooks)  ──┤─→ OTel Collector (local process, ~50 MB RAM)
                             └─→ HTTPS → Dynatrace SaaS (Grail)
```

**What gets captured:**

| Source | Prompt | Response | Model | Duration | Tokens | Tool calls |
|---|---|---|---|---|---|---|
| GitHub Copilot Chat | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Claude Code | ✓ | ✓ | ✓ | ✓ | ✓ (incl. cache) | ✓ with input/output |

> **AI Obs "Prompts stream" note:** The Prompts stream tab in the AI & LLM Observability app currently only shows data from GitHub Copilot Chat (native Dynatrace integration). Claude Code data arrives via OTel and is fully visible in **Distributed Traces**, **DQL queries**, and **Notebooks**. See the [DQL Dashboard](#dql-dashboard-for-claude-code) section for equivalent queries.

---

## ✅ Prerequisites

Before you start, make sure you have a Dynatrace tenant ready and a machine that meets the minimum requirements below.

### ☁️ Dynatrace tenant

| Requirement | Detail |
|---|---|
| 🏢 **Tenant type** | SaaS Latest or Managed with Grail enabled |
| 📦 **App** | AI & LLM Observability (install from Hub) |
| 🔑 **API token** | Scopes: `openTelemetryTrace.ingest` + `metrics.ingest` |

> 💡 **Generate a token:** `Ctrl+K` → **Access Tokens** → **Generate new token**

### 💻 Developer machine

<details open>
<summary><b>🖥️ Hardware</b></summary>

| Resource | Minimum | Notes |
|---|---|---|
| 🧠 **RAM** | 4 GB | Collector uses ~50–80 MB extra |
| ⚙️ **CPU** | Any | < 2% additional usage |
| 💾 **Disk** | 200 MB free | ~100 MB for cached collector binary |
| 🌐 **Network** | Internet access | Required once on first activation (binary download) |

</details>

<details open>
<summary><b>🧩 Operating System</b></summary>

| OS | Minimum version | Architectures |
|---|---|---|
| 🍎 **macOS** | 10.15 Catalina | x64 (Intel), arm64 (Apple Silicon) |
| 🪟 **Windows** | 10 build 17134 (1803) | x64 |
| 🐧 **Linux** | Ubuntu 20.04 / Debian 11 / RHEL 8 / Fedora 36 | x64 |

> ⚠️ Windows 1803+ is required for the built-in `tar` command used to extract the collector binary.

</details>

<details open>
<summary><b>🧑‍💻 IDE</b></summary>

| IDE | Minimum version |
|---|---|
| 🔵 **VS Code** | 1.99.0 |
| ⚫ **Cursor** | 0.40+ |

</details>

<details open>
<summary><b>📚 Software (end-user)</b></summary>

| Software | Version | Required for | Notes |
|---|---|---|---|
| 🐍 **Python 3** | 3.6+ | Claude Code hooks | Pre-installed on macOS/Linux. Windows: install from [python.org](https://www.python.org/downloads/) and check **Add Python to PATH** |
| 📦 **tar** | Any | Extracting collector binary | Pre-installed on all supported OSes |

</details>

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

### Step 3 — Configure credentials

On first launch a prompt appears. Click **Configurar Agora** and fill in three fields:

| Field | Example | Notes |
|---|---|---|
| OTLP Endpoint | `https://abc12345.live.dynatrace.com/api/v2/otlp` | Use `.live.`, not `.apps.` |
| API Token | `dt0c01.XXXXXXXXXX...` | Must start with `dt0c01.` |
| Email (optional) | `dev@company.com` | Appears in spans to identify the developer |

The token is stored in the **OS keychain** via VS Code SecretStorage — never in plain text.

To reconfigure: `Cmd+Shift+P` → **Dynatrace AI Obs: Configurar Credenciais**

### Step 4 — First-time binary download

On first activation the extension automatically downloads the OTel Collector binary (~100 MB), caches it permanently, and starts it. A progress bar shows the download status.

### Step 5 — Verify it's working

**Status bar** (bottom-right corner):

| Icon | Meaning |
|---|---|
| `⊙ DT OTel` (orange) | Stopped or not configured |
| `↺ DT OTel` (spinning) | Starting / downloading binary |
| `● DT OTel` (normal) | Running and collecting |

**Check the collector process:**
```bash
curl http://localhost:13133
# Expected: {"status":"Server available","upSince":"..."}
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

## Custom attributes

Add custom span attributes (squad, cost center, project, etc.) to every Claude Code and Copilot span without editing JSON files.

**Via Quick Pick UI (recommended):**

`Cmd+Shift+P` → **Dynatrace AI Obs: Gerenciar Atributos Customizados**

The command opens an interactive menu:
- **Add attribute** — type the key, then the value
- **Remove attribute** — select from a list of existing keys
- **Done** — saves and restarts the collector immediately

Attributes are saved in `~/.claude/otel-attrs.json` (for Claude Code) and to VS Code settings (for the collector resource attributes). No restart required.

**Example use cases:**

| Key | Value | Purpose |
|---|---|---|
| `squad` | `platform` | Filter by team in Dynatrace |
| `cost_center` | `cc-1234` | Chargeback reporting |
| `project` | `migration-v2` | Project-level attribution |
| `environment` | `staging` | Environment tagging |

---

## Understanding token counts

### Why Dynatrace shows far more tokens than expected

You may notice that a short question like *"What is the strongest Pokémon in the first region?"* (~10 tokens) appears in Dynatrace as **20,000+ tokens**. This is correct — and it reveals what AI tools actually cost.

When you send a message in GitHub Copilot Chat or Claude Code, the AI assistant does not receive just your question. It sends a complete API payload to the LLM that includes:

| Component | Tokens (approx.) |
|---|---|
| System prompt (assistant instructions, behavior rules) | 5,000 – 10,000 |
| Tool definitions (list of available tools + parameters) | 5,000 – 15,000 |
| Workspace context (open files, folder structure) | 0 – 5,000 |
| Conversation history (previous turns) | variable |
| Your actual question | 10 – 200 |
| **Total per request** | **15,000 – 30,000+** |

The Copilot Chat UI shows only your message's token count. The OpenAI tokenizer counts only what you paste into it. **Dynatrace shows the real number** — the full payload sent to the LLM API, which is what actually gets billed.

This is the core value of this observability extension: each question that looks like "10 tokens" in the Copilot UI is actually 20,000+ tokens at the API level. At scale, across hundreds of developers, this gap between perceived and real consumption is what drives unexpected AI costs.

---

## Validating data in Dynatrace

### AI & LLM Observability app

Open the **AI Observability** app in your tenant:

- **Overview tab**: shows total LLM requests, token usage, and model breakdown — Claude Code data appears here automatically.
- **Explorer tab**: click on `claude-code` service to see request-level details, latency, and token usage per conversation turn.
- **Distributed Traces**: full trace with span events containing prompt and completion text. Filter by `service.name = claude-code`.

> **Prompts stream tab**: currently shows GitHub Copilot Chat only (native integration). Use the DQL queries below for equivalent Claude Code visibility.

### DQL queries

Open **Notebooks** in your tenant and run these queries.

#### Claude Code — prompt stream

```dql
fetch spans, from:now()-24h
| filter service.name == "claude-code"
| filter startsWith(span.name, "chat")
| filter isNotNull(`gen_ai.prompt`)
| fields
    timestamp,
    Developer     = `user.email`,
    Model         = `gen_ai.request.model`,
    Duration      = duration,
    Input_Tokens  = `gen_ai.usage.input_tokens`,
    Output_Tokens = `gen_ai.usage.output_tokens`,
    Prompt        = `gen_ai.prompt`,
    Response      = `gen_ai.completion`
| sort timestamp desc
```

#### Claude Code — usage by developer

```dql
fetch spans, from:now()-24h
| filter service.name == "claude-code"
| filter startsWith(span.name, "chat")
| summarize
    Requests      = count(),
    Input_Tokens  = sum(toLong(`gen_ai.usage.input_tokens`)),
    Output_Tokens = sum(toLong(`gen_ai.usage.output_tokens`)),
    Total_Tokens  = sum(toLong(`gen_ai.usage.input_tokens`) + toLong(`gen_ai.usage.output_tokens`)),
    Avg_Duration  = avg(duration)
  by: Developer = `user.email`
| sort Total_Tokens desc
```

#### Claude Code — usage by model

```dql
fetch spans, from:now()-24h
| filter service.name == "claude-code"
| filter startsWith(span.name, "chat")
| summarize
    Requests     = count(),
    Total_Tokens = sum(toLong(`gen_ai.usage.input_tokens`) + toLong(`gen_ai.usage.output_tokens`)),
    Avg_Duration = avg(duration)
  by: Model = `gen_ai.request.model`
| sort Total_Tokens desc
```

#### Claude Code — volume over time (7 days)

```dql
fetch spans, from:now()-7d
| filter service.name == "claude-code"
| filter startsWith(span.name, "chat")
| summarize
    Requests = count(),
    Tokens   = sum(toLong(`gen_ai.usage.input_tokens`) + toLong(`gen_ai.usage.output_tokens`))
  by: bin(timestamp, 1h)
| sort timestamp asc
```

#### Claude Code — cost estimate per developer

```dql
fetch spans, from:now()-30d
| filter service.name == "claude-code"
| filter startsWith(span.name, "chat")
| summarize
    Total_Cost_USD = sum(toDouble(`gen_ai.usage.cost_usd`)),
    Requests       = count()
  by: Developer = `user.email`
| sort Total_Cost_USD desc
```

#### Claude Code — tool calls

```dql
fetch spans, from:now()-1h
| filter service.name == "claude-code"
| filter startsWith(span.name, "claude.tool.")
| fields timestamp, span.name, claude.tool_input, claude.tool_response, claude.duration_ms
| sort timestamp desc
```

#### GitHub Copilot Chat spans

```dql
fetch spans, from:now()-1h
| filter service.name == "copilot-chat"
| fields timestamp, span.name, gen_ai.request.model,
         gen_ai.usage.input_tokens, gen_ai.usage.output_tokens
| sort timestamp desc
```

---

## DQL Dashboard for Claude Code

Save as a **Notebook** in Dynatrace (Menu → Notebooks → New) to get a persistent dashboard equivalent to the AI Obs Prompts stream.

Paste the five queries above into separate tiles, set the time range to **Last 24 hours**, and pin to a Dashboard for team-wide visibility.

---

## Available commands

`Cmd+Shift+P` (or `Ctrl+Shift+P` on Windows/Linux):

| Command | Description |
|---|---|
| `Dynatrace AI Obs: Configurar Credenciais` | Set or update endpoint and API token |
| `Dynatrace AI Obs: Iniciar Coletor` | Start the collector manually |
| `Dynatrace AI Obs: Parar Coletor` | Stop the collector |
| `Dynatrace AI Obs: Ver Status` | Show whether the collector is running |
| `Dynatrace AI Obs: Gerenciar Atributos Customizados` | Add or remove custom span attributes via Quick Pick UI |
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
| `dynatraceAiObs.customAttributes` | `{}` | Custom attributes added to all spans (managed via Quick Pick command) |

---

## Cursor (without GitHub Copilot)

Cursor uses its own AI and doesn't support the `github.copilot.chat.otel.*` settings. To capture Cursor spans add these environment variables to your shell profile **before** opening Cursor:

**macOS / Linux** — add to `~/.zshrc` or `~/.bashrc`:
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=cursor-ide
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
| Copilot sends data but Claude Code doesn't | Python 3 not found | Run `python3 --version` in terminal; install if missing |
| Claude Code model shows as "claude" (not full name) | Old spans before fix | Only affects historical spans; new spans show `claude-sonnet-4-6` etc. |
| Custom attributes command not found | Extension not updated | Reinstall from latest VSIX |
| Claude Code hooks not executing | Claude Code not restarted after hook setup | Close and reopen Claude Code |

---

## Building from source

```bash
# 1. Clone
git clone https://github.com/pmoreira-dynatrace/dt-ai-observability-vscode
cd dt-ai-observability-vscode

# 2. Install dependencies
npm install

# 3. Compile
npm run compile

# 4. Build VSIX
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
│   └── package.sh        — builds the VSIX
├── README.md
└── package.json
```

---

## Privacy and security

- **Prompt and response capture**: Claude Code captures both the user prompt and AI response text by default. This can be disabled by running **Dynatrace AI Obs: Remover Hooks do Claude Code**.
- **Token stored in OS keychain**: VS Code SecretStorage is backed by the OS keychain (Keychain on macOS, Credential Manager on Windows, libsecret on Linux) — never stored in plain text or `settings.json`.
- **Collector makes outbound HTTPS only**: The local collector only connects outbound to your Dynatrace tenant. No public port is exposed.
- **Verifiable binary**: Downloaded directly from [open-telemetry/opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases).

---

## License

MIT — see [LICENSE](LICENSE)
