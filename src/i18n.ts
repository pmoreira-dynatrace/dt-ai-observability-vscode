/**
 * Minimal i18n dictionary for the configuration panel webview.
 * Only covers user-facing text inside ConfigPanel — commands in the
 * Command Palette and VS Code notifications are not covered (see README).
 */

export type Language = 'pt-BR' | 'en' | 'es';

export const SUPPORTED_LANGUAGES: Language[] = ['pt-BR', 'en', 'es'];
export const DEFAULT_LANGUAGE: Language = 'pt-BR';

export type Dict = Record<string, string>;

export const translations: Record<Language, Dict> = {
    'pt-BR': {
        // Header
        appTitle: 'Dynatrace AI Observability',
        appSubtitle: 'Configure credenciais, gerencie o coletor e acesse os Evals.',
        langSelectLabel: 'Idioma',

        // Tabs
        tabConfig: 'Configurações',
        tabCollector: 'Coletor',
        tabEvals: 'Evals',
        tabBarAria: 'Seções do painel',

        // Dynatrace section
        secDynatrace: 'Dynatrace',
        endpointLabel: 'Endpoint',
        modeTenant: 'Tenant ID',
        modeUrl: 'OTLP Endpoint completo',
        tenantIdHint: 'Somente o ID do tenant — o endereço completo é preenchido automaticamente.',
        endpointHintHtml: 'Use <code>.live.dynatrace.com</code> — não <code>.apps.</code>',
        tokenLabel: 'API Token',
        tokenHintHtml: 'Scopes: <code>openTelemetryTrace.ingest</code> + <code>metrics.ingest</code> · Armazenado no keychain do SO',
        tokenPlaceholder: 'dt0c01.XXXXXXXXXX… (deixe em branco para manter o atual)',
        tokenSavedPlaceholder: '●●●●●●●● (token salvo — deixe em branco para manter)',
        emailLabel: 'Email do desenvolvedor',
        emailPlaceholder: 'dev@empresa.com (opcional)',
        emailHint: 'Aparece nos spans para identificar o dev nos relatórios',

        // Coleta section
        secColeta: 'Coleta',
        captureLabel: 'Capturar conteúdo de prompts e respostas',
        captureHint: 'Envia Input/Output nos spans (visível no Prompts stream). Desabilitado por padrão para privacidade.',
        evalsCheckboxLabel: 'Habilitar Dynatrace Evals (dt-evals)',
        evalsCheckboxHintHtml: 'Requer "Capturar prompts" habilitado. Instala <code>@dynatrace-oss/dt-evals</code> e avalia spans gen_ai.*',

        // Ports section
        secPorts: 'Portas do coletor local',
        collectorPortLabel: 'Porta OTLP HTTP',
        collectorPortHint: 'Recebe spans da extensão e do hook. Porta alternativa é encontrada automaticamente se ocupada.',
        healthPortLabel: 'Porta Health Check',
        healthPortHint: 'Porta alternativa é encontrada automaticamente se ocupada.',

        // Attributes section
        secAttrs: 'Atributos customizados',
        attrKeyHeader: 'Chave',
        attrValHeader: 'Valor',
        attrKeyPlaceholder: 'chave',
        attrValPlaceholder: 'valor',
        attrRemoveTitle: 'Remover',
        btnAddAttr: '+ Adicionar atributo',
        btnSaveAttrs: 'Salvar / Atualizar atributos',
        attrsHintHtml: 'Adicionados a todos os spans. Ex: <code>squad</code>, <code>cost_center</code>, <code>project</code>. O coletor reinicia automaticamente ao salvar.',

        // Footer
        btnSaveConfig: 'Salvar configurações',
        btnValidateCreds: 'Validar credenciais',

        // Banners (client-side dynamic)
        bannerFillRequired: '✗ Preencha o Endpoint (ou Tenant ID) e o Token para validar.',
        bannerEndpointRequired: '✗ Endpoint ou Tenant ID é obrigatório.',
        bannerValidatingSave: '⏳ Validando credenciais e salvando...',
        bannerValidatingOnly: '⏳ Validando credenciais…',
        bannerCredsValid: '✓ Credenciais válidas.',
        bannerSaveSuccess: '✓ Credenciais validadas e configurações salvas. Coletor reiniciando…',
        bannerAttrsSuccess: '✓ Atributos salvos. Coletor reiniciando automaticamente…',
        bannerAttrsErrorPrefix: '✗ Erro ao salvar atributos: ',
        bannerCrossPrefix: '✗ ',

        // Collector tab
        secStatus: 'Status',
        statusChecking: 'Verificando...',
        statusRunning: 'Rodando',
        statusStopped: 'Parado',
        statusStarting: 'Iniciando...',
        statusStopping: 'Parando...',
        statusRestarting: 'Reiniciando...',
        btnStart: 'Iniciar',
        btnStop: 'Parar',
        btnRestart: 'Reiniciar',
        secCollectorLog: 'Log do coletor',
        btnRefreshLog: 'Atualizar',
        btnScrollBottom: 'Ir ao fim',
        btnClearLog: 'Limpar',
        logHint: 'Até 300 linhas, atualizadas em tempo real.',

        // Evals tab
        secEvals: 'Dynatrace Evals',
        evalsEnableLabel: 'Habilitar Dynatrace Evals',
        evalsEnableHint: 'Avalia spans gen_ai.* com os evaluators configurados.',
        evalsCaptureWarn: 'Habilite "Capturar prompts" na aba Configurações para usar os Evals.',
        secActions: 'Ações',
        btnInstallEvals: 'Instalar dt-evals',
        btnConfigureEvals: 'Abrir wizard de configuração',
        btnRunEvals: 'Rodar Evals',
        btnValidateEvals: 'Validar setup',
        evalsActionsHint: 'As ações são abertas no terminal integrado.',

        // Server-side messages
        errInvalidToken: 'Token inválido — verifique se está correto.',
        errMissingScopes: 'Token sem os scopes: openTelemetryTrace.ingest + metrics.ingest.',
        errHttpStatus: 'Endpoint respondeu HTTP {0} — verifique a URL.',
        errConnect: 'Não foi possível conectar: {0}',
        errTimeout: 'Timeout — verifique a URL e sua conexão.',
        errInvalidUrl: 'URL inválida: {0}',
        errInvalidCredentialsPrefix: 'Credenciais inválidas: ',
    },

    en: {
        // Header
        appTitle: 'Dynatrace AI Observability',
        appSubtitle: 'Configure credentials, manage the collector, and access Evals.',
        langSelectLabel: 'Language',

        // Tabs
        tabConfig: 'Settings',
        tabCollector: 'Collector',
        tabEvals: 'Evals',
        tabBarAria: 'Panel sections',

        // Dynatrace section
        secDynatrace: 'Dynatrace',
        endpointLabel: 'Endpoint',
        modeTenant: 'Tenant ID',
        modeUrl: 'Full OTLP Endpoint',
        tenantIdHint: 'Tenant ID only — the full address is filled in automatically.',
        endpointHintHtml: 'Use <code>.live.dynatrace.com</code> — not <code>.apps.</code>',
        tokenLabel: 'API Token',
        tokenHintHtml: 'Scopes: <code>openTelemetryTrace.ingest</code> + <code>metrics.ingest</code> · Stored in the OS keychain',
        tokenPlaceholder: 'dt0c01.XXXXXXXXXX… (leave blank to keep the current one)',
        tokenSavedPlaceholder: '●●●●●●●● (token saved — leave blank to keep)',
        emailLabel: 'Developer email',
        emailPlaceholder: 'dev@company.com (optional)',
        emailHint: 'Shows up in spans to identify the developer',

        // Coleta section
        secColeta: 'Collection',
        captureLabel: 'Capture prompt and response content',
        captureHint: 'Sends Input/Output in spans (visible in the Prompts stream). Disabled by default for privacy.',
        evalsCheckboxLabel: 'Enable Dynatrace Evals (dt-evals)',
        evalsCheckboxHintHtml: 'Requires "Capture prompts" enabled. Installs <code>@dynatrace-oss/dt-evals</code> and evaluates gen_ai.* spans',

        // Ports section
        secPorts: 'Local collector ports',
        collectorPortLabel: 'OTLP HTTP port',
        collectorPortHint: 'Receives spans from the extension and the hook. An alternative port is found automatically if busy.',
        healthPortLabel: 'Health check port',
        healthPortHint: 'An alternative port is found automatically if busy.',

        // Attributes section
        secAttrs: 'Custom attributes',
        attrKeyHeader: 'Key',
        attrValHeader: 'Value',
        attrKeyPlaceholder: 'key',
        attrValPlaceholder: 'value',
        attrRemoveTitle: 'Remove',
        btnAddAttr: '+ Add attribute',
        btnSaveAttrs: 'Save / Update attributes',
        attrsHintHtml: 'Added to every span. E.g.: <code>squad</code>, <code>cost_center</code>, <code>project</code>. The collector restarts automatically on save.',

        // Footer
        btnSaveConfig: 'Save settings',
        btnValidateCreds: 'Validate credentials',

        // Banners (client-side dynamic)
        bannerFillRequired: '✗ Fill in the Endpoint (or Tenant ID) and Token to validate.',
        bannerEndpointRequired: '✗ Endpoint or Tenant ID is required.',
        bannerValidatingSave: '⏳ Validating credentials and saving...',
        bannerValidatingOnly: '⏳ Validating credentials…',
        bannerCredsValid: '✓ Credentials are valid.',
        bannerSaveSuccess: '✓ Credentials validated and settings saved. Collector restarting…',
        bannerAttrsSuccess: '✓ Attributes saved. Collector restarting automatically…',
        bannerAttrsErrorPrefix: '✗ Error saving attributes: ',
        bannerCrossPrefix: '✗ ',

        // Collector tab
        secStatus: 'Status',
        statusChecking: 'Checking...',
        statusRunning: 'Running',
        statusStopped: 'Stopped',
        statusStarting: 'Starting...',
        statusStopping: 'Stopping...',
        statusRestarting: 'Restarting...',
        btnStart: 'Start',
        btnStop: 'Stop',
        btnRestart: 'Restart',
        secCollectorLog: 'Collector log',
        btnRefreshLog: 'Refresh',
        btnScrollBottom: 'Jump to end',
        btnClearLog: 'Clear',
        logHint: 'Up to 300 lines, updated in real time.',

        // Evals tab
        secEvals: 'Dynatrace Evals',
        evalsEnableLabel: 'Enable Dynatrace Evals',
        evalsEnableHint: 'Evaluates gen_ai.* spans with the configured evaluators.',
        evalsCaptureWarn: 'Enable "Capture prompts" in the Settings tab to use Evals.',
        secActions: 'Actions',
        btnInstallEvals: 'Install dt-evals',
        btnConfigureEvals: 'Open configuration wizard',
        btnRunEvals: 'Run Evals',
        btnValidateEvals: 'Validate setup',
        evalsActionsHint: 'Actions open in the integrated terminal.',

        // Server-side messages
        errInvalidToken: 'Invalid token — check that it is correct.',
        errMissingScopes: 'Token missing scopes: openTelemetryTrace.ingest + metrics.ingest.',
        errHttpStatus: 'Endpoint responded with HTTP {0} — check the URL.',
        errConnect: 'Could not connect: {0}',
        errTimeout: 'Timeout — check the URL and your connection.',
        errInvalidUrl: 'Invalid URL: {0}',
        errInvalidCredentialsPrefix: 'Invalid credentials: ',
    },

    es: {
        // Header
        appTitle: 'Dynatrace AI Observability',
        appSubtitle: 'Configure credenciales, gestione el colector y acceda a Evals.',
        langSelectLabel: 'Idioma',

        // Tabs
        tabConfig: 'Configuración',
        tabCollector: 'Colector',
        tabEvals: 'Evals',
        tabBarAria: 'Secciones del panel',

        // Dynatrace section
        secDynatrace: 'Dynatrace',
        endpointLabel: 'Endpoint',
        modeTenant: 'Tenant ID',
        modeUrl: 'Endpoint OTLP completo',
        tenantIdHint: 'Solo el ID del tenant — la dirección completa se completa automáticamente.',
        endpointHintHtml: 'Use <code>.live.dynatrace.com</code> — no <code>.apps.</code>',
        tokenLabel: 'API Token',
        tokenHintHtml: 'Scopes: <code>openTelemetryTrace.ingest</code> + <code>metrics.ingest</code> · Almacenado en el keychain del SO',
        tokenPlaceholder: 'dt0c01.XXXXXXXXXX… (deje en blanco para mantener el actual)',
        tokenSavedPlaceholder: '●●●●●●●● (token guardado — deje en blanco para mantener)',
        emailLabel: 'Correo del desarrollador',
        emailPlaceholder: 'dev@empresa.com (opcional)',
        emailHint: 'Aparece en los spans para identificar al desarrollador en los informes',

        // Coleta section
        secColeta: 'Recolección',
        captureLabel: 'Capturar contenido de prompts y respuestas',
        captureHint: 'Envía Input/Output en los spans (visible en el Prompts stream). Deshabilitado por defecto por privacidad.',
        evalsCheckboxLabel: 'Habilitar Dynatrace Evals (dt-evals)',
        evalsCheckboxHintHtml: 'Requiere "Capturar prompts" habilitado. Instala <code>@dynatrace-oss/dt-evals</code> y evalúa spans gen_ai.*',

        // Ports section
        secPorts: 'Puertos del colector local',
        collectorPortLabel: 'Puerto OTLP HTTP',
        collectorPortHint: 'Recibe spans de la extensión y del hook. Se busca un puerto alternativo automáticamente si está ocupado.',
        healthPortLabel: 'Puerto de health check',
        healthPortHint: 'Se busca un puerto alternativo automáticamente si está ocupado.',

        // Attributes section
        secAttrs: 'Atributos personalizados',
        attrKeyHeader: 'Clave',
        attrValHeader: 'Valor',
        attrKeyPlaceholder: 'clave',
        attrValPlaceholder: 'valor',
        attrRemoveTitle: 'Eliminar',
        btnAddAttr: '+ Agregar atributo',
        btnSaveAttrs: 'Guardar / Actualizar atributos',
        attrsHintHtml: 'Se agregan a todos los spans. Ej.: <code>squad</code>, <code>cost_center</code>, <code>project</code>. El colector se reinicia automáticamente al guardar.',

        // Footer
        btnSaveConfig: 'Guardar configuración',
        btnValidateCreds: 'Validar credenciales',

        // Banners (client-side dynamic)
        bannerFillRequired: '✗ Complete el Endpoint (o Tenant ID) y el Token para validar.',
        bannerEndpointRequired: '✗ El Endpoint o Tenant ID es obligatorio.',
        bannerValidatingSave: '⏳ Validando credenciales y guardando...',
        bannerValidatingOnly: '⏳ Validando credenciales…',
        bannerCredsValid: '✓ Credenciales válidas.',
        bannerSaveSuccess: '✓ Credenciales validadas y configuración guardada. El colector se está reiniciando…',
        bannerAttrsSuccess: '✓ Atributos guardados. El colector se reinicia automáticamente…',
        bannerAttrsErrorPrefix: '✗ Error al guardar atributos: ',
        bannerCrossPrefix: '✗ ',

        // Collector tab
        secStatus: 'Estado',
        statusChecking: 'Verificando...',
        statusRunning: 'Activo',
        statusStopped: 'Detenido',
        statusStarting: 'Iniciando...',
        statusStopping: 'Deteniendo...',
        statusRestarting: 'Reiniciando...',
        btnStart: 'Iniciar',
        btnStop: 'Detener',
        btnRestart: 'Reiniciar',
        secCollectorLog: 'Registro del colector',
        btnRefreshLog: 'Actualizar',
        btnScrollBottom: 'Ir al final',
        btnClearLog: 'Limpiar',
        logHint: 'Hasta 300 líneas, actualizadas en tiempo real.',

        // Evals tab
        secEvals: 'Dynatrace Evals',
        evalsEnableLabel: 'Habilitar Dynatrace Evals',
        evalsEnableHint: 'Evalúa spans gen_ai.* con los evaluadores configurados.',
        evalsCaptureWarn: 'Habilite "Capturar prompts" en la pestaña Configuración para usar Evals.',
        secActions: 'Acciones',
        btnInstallEvals: 'Instalar dt-evals',
        btnConfigureEvals: 'Abrir asistente de configuración',
        btnRunEvals: 'Ejecutar Evals',
        btnValidateEvals: 'Validar configuración',
        evalsActionsHint: 'Las acciones se abren en la terminal integrada.',

        // Server-side messages
        errInvalidToken: 'Token inválido — verifique que sea correcto.',
        errMissingScopes: 'Token sin los scopes: openTelemetryTrace.ingest + metrics.ingest.',
        errHttpStatus: 'El endpoint respondió HTTP {0} — verifique la URL.',
        errConnect: 'No se pudo conectar: {0}',
        errTimeout: 'Tiempo de espera agotado — verifique la URL y su conexión.',
        errInvalidUrl: 'URL inválida: {0}',
        errInvalidCredentialsPrefix: 'Credenciales inválidas: ',
    },
};

/** Get a translated string for a language, falling back to pt-BR, then the raw key. */
export function t(lang: Language, key: string): string {
    return translations[lang]?.[key] ?? translations[DEFAULT_LANGUAGE][key] ?? key;
}

/** Format a translated string with {0}, {1}, ... placeholders. */
export function tf(lang: Language, key: string, ...args: (string | number)[]): string {
    let str = t(lang, key);
    args.forEach((arg, i) => { str = str.replace(`{${i}}`, String(arg)); });
    return str;
}

/** Normalize an arbitrary stored value into a supported Language, defaulting to pt-BR. */
export function normalizeLanguage(value: string | undefined): Language {
    return (SUPPORTED_LANGUAGES as string[]).includes(value ?? '') ? (value as Language) : DEFAULT_LANGUAGE;
}
