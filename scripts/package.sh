#!/bin/bash
# Gera um único VSIX leve (~2MB) sem binário embutido.
# O binário é baixado automaticamente na primeira ativação em cada máquina.
# Uso: ./scripts/package.sh
# Pré-requisito: npm install

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Dynatrace AI Observability — Build VSIX ==="
echo ""

echo "→ Compilando TypeScript..."
npm run compile
echo "  OK"
echo ""

echo "→ Empacotando VSIX (sem binários — download na ativação)..."
npx vsce package --no-git-tag-version --out dt-ai-observability.vsix
echo ""

SIZE=$(du -sh dt-ai-observability.vsix | cut -f1)
echo "=== Pronto ==="
echo "  Arquivo : dt-ai-observability.vsix (${SIZE})"
echo ""
echo "Instalar no VS Code:"
echo "  code --install-extension dt-ai-observability.vsix"
echo ""
echo "Na 1ª ativação, a extensão baixa (~100MB) o binário"
echo "correto para o OS da máquina e cacheia em globalStorage."
echo "Nas próximas vezes, inicia imediatamente sem download."
