import * as vscode from 'vscode';

export function configureCopilotOtel(): void {
    const port = vscode.workspace.getConfiguration('dynatraceAiObs').get<number>('collectorPort', 4318);
    const config = vscode.workspace.getConfiguration();

    config.update('github.copilot.chat.otel.enabled', true, vscode.ConfigurationTarget.Global);
    config.update('github.copilot.chat.otel.exporterType', 'otlp-http', vscode.ConfigurationTarget.Global);
    config.update('github.copilot.chat.otel.otlpEndpoint', `http://localhost:${port}`, vscode.ConfigurationTarget.Global);
    config.update('github.copilot.chat.otel.captureContent', true, vscode.ConfigurationTarget.Global);
    config.update('github.copilot.chat.otel.maxAttributeSizeChars', 0, vscode.ConfigurationTarget.Global);
}
