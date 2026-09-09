# Dynatrace AI Observability — Guia de Implantação

**Extensão VS Code · GitHub Copilot → OpenTelemetry → Dynatrace**  
Versão 1.0 · Dynatrace Solutions Engineering LATAM

---

## Visão geral

Esta extensão coleta automaticamente traces de uso de AI (GitHub Copilot Chat, agentes, tool calls) e os envia para o Dynatrace via OpenTelemetry. Não requer infraestrutura adicional: o OTel Collector roda localmente no próprio computador do dev como um processo leve em background.

```
VS Code / Cursor
  └─ GitHub Copilot Chat
       └─ OTel spans (localhost:4318)
            └─ otelcol-contrib (processo local, ~50 MB RAM)
                 └─ HTTPS → Dynatrace SaaS (Grail)
```

---

## Pré-requisitos

### Dynatrace

| Item | Requisito |
|---|---|
| Tenant | SaaS Latest ou Managed com Grail habilitado |
| App instalado | AI & LLM Observability (Preview) |
| Token | `openTelemetryTrace.ingest` + `metrics.ingest` |

Gerar token: `Ctrl+K → Access Tokens → Generate new token`

### Máquina do desenvolvedor

#### Hardware mínimo

| Recurso | Mínimo | Observação |
|---|---|---|
| RAM | 4 GB | O coletor usa ~50–80 MB adicionais |
| CPU | Qualquer | < 2% de uso adicional em uso normal |
| Disco | 200 MB livres | ~100 MB para o binário do coletor (cache permanente) |
| Rede | Conexão com internet | Necessária apenas na primeira ativação (download do binário) |

#### Sistema Operacional

| OS | Versão mínima | Arquiteturas |
|---|---|---|
| **macOS** | 10.15 Catalina | x64 (Intel), arm64 (Apple Silicon) |
| **Windows** | 10 versão 1803 (Build 17134) | x64 |
| **Linux** | Ubuntu 20.04 / Debian 11 / RHEL 8 / Fedora 36 / Amazon Linux 2023 | x64 |

> **Windows**: a versão 1803 é o mínimo porque introduziu o comando `tar` nativo, necessário para extrair o binário do coletor.

#### IDE

| IDE | Versão mínima | Observação |
|---|---|---|
| **VS Code** | 1.99.0 | Recomendado: sempre a versão mais recente |
| **Cursor** | 0.40+ | Fork do VS Code; suporta extensões `.vsix` |

> Para que os traces do **GitHub Copilot Chat** sejam capturados, a extensão **GitHub Copilot** deve estar instalada e ativa na IDE.  
> No **Cursor** usando o AI nativo (não Copilot), os spans são enviados via variáveis de ambiente `OTEL_*` — ver seção [Cursor sem GitHub Copilot](#cursor-sem-github-copilot).

#### Software — usuário final

| Software | Versão mínima | Finalidade | Obrigatório? |
|---|---|---|---|
| **Python 3** | 3.6+ | Executa os hooks do Claude Code (envia spans a cada tool call) | Só se usar Claude Code |
| **tar** | Qualquer | Extrai o binário do OTel Collector na 1ª ativação | Sim (já incluso no OS) |

> **Python 3 no macOS**: se instalado via Homebrew (`/opt/homebrew/bin/python3`), verifique se está acessível rodando `python3 --version` no terminal. No macOS 12.3+, o Python 3 do sistema foi removido — instale via Homebrew: `brew install python3`.  
> **Python 3 no Windows**: baixe em [python.org](https://www.python.org/downloads/) e marque a opção **"Add Python to PATH"** durante a instalação. O comando usado é `python` (não `python3`).  
> **Python 3 no Linux**: geralmente já incluso. Se não: `sudo apt install python3` (Debian/Ubuntu) ou `sudo dnf install python3` (RHEL/Fedora).

#### Software — somente para quem vai BUILDAR a extensão

| Software | Versão mínima | Finalidade |
|---|---|---|
| Node.js | 18.0 LTS | Compilar o TypeScript |
| npm | 9.0 | Gerenciar dependências |
| curl | Qualquer | Script de build |

---

## Instalação — usuário final

### Passo 1 — Obter o arquivo VSIX

Solicite o arquivo `dt-ai-observability.vsix` ao responsável pela distribuição interna.

### Passo 2 — Instalar a extensão

**Via UI (recomendado):**

1. Abra o VS Code ou Cursor
2. Clique no ícone **Extensions** na barra lateral (ou `Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Clique nos `···` (três pontos) no topo do painel
4. Selecione **Install from VSIX...**
5. Escolha o arquivo `dt-ai-observability.vsix`
6. Aguarde a instalação e clique em **Reload**

**Via terminal (se o comando `code` estiver disponível):**

```bash
code --install-extension dt-ai-observability.vsix
```

**Via terminal sem o comando `code` no PATH (macOS):**

```bash
/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code \
  --install-extension dt-ai-observability.vsix
```

### Passo 3 — Configurar credenciais

Na primeira abertura após a instalação, aparecerá um prompt:

> *"Dynatrace AI Observability: configure suas credenciais para começar."*

Clique em **Configurar Agora** e preencha os 3 campos:

| Campo | Exemplo | Observação |
|---|---|---|
| OTLP Endpoint | `https://abc12345.live.dynatrace.com/api/v2/otlp` | Use `.live.`, não `.apps.` |
| API Token | `dt0c01.XXXXXXXXXX...` | Começa com `dt0c01.` |
| E-mail | `dev@empresa.com` | Opcional; identifica o dev nos spans |

> O token é armazenado no **keychain do sistema operacional** via VS Code SecretStorage — nunca em arquivo de texto.

Para reconfigurar a qualquer momento: `Ctrl+Shift+P` → **Dynatrace AI Obs: Configurar Credenciais**

### Passo 4 — Download automático do coletor (primeira vez)

Na primeira ativação com credenciais configuradas, a extensão:

1. Detecta o OS e arquitetura da máquina
2. Baixa o binário correto do OTel Collector (~100 MB) do GitHub Releases
3. Armazena em cache permanente (não baixa novamente em atualizações da extensão)
4. Inicia o coletor automaticamente

Uma barra de progresso mostra o andamento do download.

### Passo 5 — Confirmar que está funcionando

**Status bar** (canto inferior direito):

| Ícone | Significado |
|---|---|
| `⊙ DT OTel` (fundo laranja) | Parado ou não configurado |
| `↺ DT OTel` (girando) | Iniciando / baixando binário |
| `● DT OTel` (fundo normal) | Rodando e coletando |

---

## Validação

### 1. Verificar o processo local

```bash
# macOS / Linux
curl http://localhost:13133
# Esperado: {"status":"Server available","upSince":"...","checks":{...}}

# Windows (PowerShell)
Invoke-WebRequest http://localhost:13133
```

### 2. Verificar o log da extensão

`View → Output → selecionar "Dynatrace AI Observability"` no dropdown.

Deve conter:
```
[...] Iniciando OTel Collector...
[...] Coletor pronto na porta 4318.
```

### 3. Validar spans chegando no Dynatrace

Abra **Notebooks** no tenant e execute (aguarde 1–2 min após a primeira mensagem no Copilot):

```dql
fetch spans, from:now()-15m
| filter service.name == "copilot-chat"
| summarize spans = count(),
            models = collectDistinct(gen_ai.request.model),
            emails  = collectDistinct(user.email)
```

Se `spans > 0` e `models` tem pelo menos um valor, a pipeline está completa.

### 4. Queries úteis

**Custo estimado por modelo (últimas 24h):**
```dql
fetch spans, from:now()-24h
| filter service.name == "copilot-chat"
| filter isNotNull(gen_ai.usage.input_tokens)
| fieldsAdd inp = toDouble(gen_ai.usage.input_tokens)
| fieldsAdd out = toDouble(gen_ai.usage.output_tokens)
| fieldsAdd cost_usd =
    if(contains(gen_ai.request.model, "opus"),
       (inp * 0.000015) + (out * 0.000075),
    else: if(contains(gen_ai.request.model, "mini"),
       (inp * 0.00000015) + (out * 0.0000006),
    else: (inp * 0.0000025) + (out * 0.00001)))
| summarize total_cost = sum(cost_usd), requests = count(), by:{gen_ai.request.model}
| sort total_cost desc
```

**Latência P50/P95/P99 por modelo:**
```dql
fetch spans, from:now()-24h
| filter service.name == "copilot-chat"
| filter startsWith(span.name, "chat ")
| fieldsAdd dur_ms = duration / 1000000
| summarize p50 = percentile(dur_ms,50),
            p95 = percentile(dur_ms,95),
            p99 = percentile(dur_ms,99),
            by:{gen_ai.request.model}
```

---

## Cursor sem GitHub Copilot

O Cursor usa seu próprio AI e não tem as configurações `github.copilot.chat.otel.*`. Para capturar spans do Cursor, adicione as variáveis de ambiente abaixo no perfil do shell **antes** de abrir o Cursor:

**macOS / Linux** — adicionar em `~/.zshrc` ou `~/.bashrc`:
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=cursor-ide
```

**Windows** — PowerShell (adicionar ao `$PROFILE`):
```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318"
$env:OTEL_SERVICE_NAME            = "cursor-ide"
```

Reinicie o terminal e abra o Cursor a partir dele para herdar as variáveis.

---

## Comandos disponíveis

Acesse via `Ctrl+Shift+P` (ou `Cmd+Shift+P` no Mac):

| Comando | Descrição |
|---|---|
| `Dynatrace AI Obs: Configurar Credenciais` | Abre o fluxo de 3 etapas para definir/atualizar endpoint e token |
| `Dynatrace AI Obs: Iniciar Coletor` | Inicia o coletor manualmente |
| `Dynatrace AI Obs: Parar Coletor` | Para o coletor |
| `Dynatrace AI Obs: Ver Status` | Mostra se o coletor está rodando |

---

## Configurações (settings.json)

| Chave | Padrão | Descrição |
|---|---|---|
| `dynatraceAiObs.endpoint` | `""` | OTLP endpoint do Dynatrace |
| `dynatraceAiObs.userEmail` | `""` | E-mail do dev (aparece nos spans) |
| `dynatraceAiObs.autoStart` | `true` | Iniciar automaticamente com o VS Code |
| `dynatraceAiObs.collectorPort` | `4318` | Porta OTLP HTTP local |

---

## Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| Status bar laranja após configurar | Binário ainda baixando | Aguardar o download (~100 MB na 1ª vez) |
| `curl localhost:13133` não responde | Porta 4318 ou 13133 ocupada | Alterar `dynatraceAiObs.collectorPort` nas settings |
| Spans não aparecem no Dynatrace | Token inválido ou endpoint errado com `.apps.` | Reconfigurar com `Configurar Credenciais` |
| `user.email` vem nulo nos spans | Campo e-mail não preenchido na configuração | Reconfigurar e preencher o e-mail |
| Erro no download do binário | Sem acesso ao GitHub Releases (`github.com`) | Verificar proxy/firewall; liberar `github.com` e `objects.githubusercontent.com` |
| VS Code liga OTel mas Copilot não envia | Faltou recarregar a janela | `Ctrl+Shift+P` → `Developer: Reload Window` |
| Hooks do Claude Code não geram spans | Python 3 não encontrado pelo hook | Rodar `python3 --version` no terminal; se falhar, instalar Python 3 e garantir que está no PATH |
| Hooks configurados mas Claude Code não os executa | Claude Code não foi reiniciado após a configuração | Fechar e reabrir o Claude Code (terminal ou VS Code) |
| Notificação de hooks não apareceu na instalação | `~/.claude` não existia ainda ou erro de permissão | Rodar `Cmd+Shift+P` → `Dynatrace AI Obs: Configurar Hooks do Claude Code` manualmente |

---

## Guia para quem vai BUILDAR a extensão

### Pré-requisitos de build

```bash
node --version   # >= 18.0
npm --version    # >= 9.0
```

### Passos

```bash
# 1. Clonar o repositório
git clone <repo-url>
cd vscode-dt-ai-observability

# 2. Instalar dependências
npm install

# 3. Gerar o VSIX (~2 MB, sem binário embutido)
./scripts/package.sh

# Resultado: dt-ai-observability.vsix
```

### Estrutura do projeto

```
vscode-dt-ai-observability/
├── src/
│   ├── extension.ts     — entry point, fluxo de configuração
│   ├── collector.ts     — spawn e ciclo de vida do processo
│   ├── downloader.ts    — detecção de plataforma, download e cache do binário
│   ├── settings.ts      — configuração automática do github.copilot.chat.otel.*
│   └── statusBar.ts     — indicador visual na barra inferior
├── resources/
│   └── otel-collector.yaml  — configuração do coletor (usa env vars)
├── scripts/
│   └── package.sh       — gera o VSIX final
├── GUIDE.md             — este documento
└── package.json
```

---

## Privacidade e segurança

- **`captureContent: false`** — prompts, respostas e código não são transmitidos. Somente metadados: modelo, tokens, duração, IDs de sessão, nomes de ferramentas.
- **Token armazenado no keychain do OS** via VS Code SecretStorage — nunca em arquivo de texto ou settings.json.
- **Coletor apenas faz HTTPS de saída** para o tenant Dynatrace — não expõe porta pública.
- **Binário verificável** — baixado diretamente do repositório oficial [open-telemetry/opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases).
