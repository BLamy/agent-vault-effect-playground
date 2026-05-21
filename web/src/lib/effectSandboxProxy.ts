import { Context, Data, Effect, Layer, Redacted } from "effect";

export type ServiceAuth =
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password?: string }
  | { type: "api-key"; key: string; header?: string; prefix?: string }
  | { type: "custom"; headers: Record<string, string> }
  | { type: "passthrough" };

export interface VaultService {
  readonly name?: string;
  readonly host: string;
  readonly enabled?: boolean;
  readonly auth: ServiceAuth;
  readonly substitutions?: ReadonlyArray<{
    readonly key: string;
    readonly placeholder: string;
    readonly in?: ReadonlyArray<string>;
  }>;
}

export interface SandboxProxyService {
  readonly name: string;
  readonly host: string;
  readonly enabled: boolean;
  readonly credentialKeys: ReadonlyArray<string>;
}

export type SandboxRuntimeId = "sprite" | "almostnode" | "local-node";

export interface SandboxRuntimeOption {
  readonly id: SandboxRuntimeId;
  readonly label: string;
  readonly description: string;
  readonly defaultCertPath: string;
  readonly launchTarget: string;
}

export interface SandboxPtyOptions {
  readonly command: string;
  readonly env: Record<string, string>;
  readonly cwd?: string;
  readonly cols?: number;
  readonly rows?: number;
}

export interface SandboxPtyHandle {
  readonly id: string;
  readonly target: string;
  readonly command: string;
  readonly stdin: "interactive";
  readonly stdout: "stream";
  readonly stderr: "stream";
  readonly envKeys: ReadonlyArray<string>;
  readonly cols?: number;
  readonly rows?: number;
  readonly sessionId?: string;
  readonly terminalUrl?: string;
}

export interface SandboxRuntimeService extends SandboxRuntimeOption {
  readonly startInteractivePty: (
    options: SandboxPtyOptions,
  ) => Effect.Effect<SandboxPtyHandle, SandboxProxyConfigError>;
}

export type AiHarnessId = "codex" | "claude" | "opencode" | "gemini" | "custom";

export interface AiHarnessOption {
  readonly id: AiHarnessId;
  readonly label: string;
  readonly description: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly installScript: string;
  readonly runScript: string;
  readonly displayCommand: string;
  readonly prompt: string;
  readonly env: Record<string, string>;
  readonly requestUrl: string;
}

export interface AiHarnessProxyDefaults {
  readonly credentialKeys: ReadonlyArray<string>;
  readonly optionalCredentialKeys: ReadonlyArray<string>;
  readonly serviceHosts: ReadonlyArray<string>;
}

export interface SandboxProxyConfig {
  readonly vaultName: string;
  readonly sessionEndpoint: string;
  readonly sandboxRuntime: SandboxRuntimeOption;
  readonly aiHarness: AiHarnessOption;
  readonly certPath: string;
  readonly selectedCredentialKeys: ReadonlyArray<string>;
  readonly selectedServices: ReadonlyArray<SandboxProxyService>;
  readonly proxyEnv: Record<string, Redacted.Redacted<string>>;
  readonly sentinelEnv: Record<string, string>;
  readonly notes: ReadonlyArray<string>;
}

export class SandboxProxyConfigError extends Data.TaggedError(
  "SandboxProxyConfigError",
)<{
  readonly message: string;
}> {}

export class AgentVaultSandboxProxy extends Context.Tag(
  "AgentVaultSandboxProxy",
)<AgentVaultSandboxProxy, SandboxProxyConfig>() {}

export class AgentVaultSandboxTarget extends Context.Tag(
  "AgentVaultSandboxTarget",
)<AgentVaultSandboxTarget, SandboxRuntimeService>() {
  static layer(target: SandboxRuntimeOption) {
    return Layer.succeed(AgentVaultSandboxTarget, {
      ...target,
      startInteractivePty: (options) =>
        Effect.succeed({
          id: `agent-pty:${target.id}`,
          target: target.launchTarget,
          command: options.command,
          stdin: "interactive",
          stdout: "stream",
          stderr: "stream",
          envKeys: Object.keys(options.env),
          cols: options.cols,
          rows: options.rows,
        }),
    });
  }
}

export class AgentVaultAiHarness extends Context.Tag(
  "AgentVaultAiHarness",
)<AgentVaultAiHarness, AiHarnessOption>() {
  static layer(harness: AiHarnessOption) {
    return Layer.succeed(AgentVaultAiHarness, harness);
  }
}

export const proxyEnvKeys = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_USE_ENV_PROXY",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "DENO_CERT",
] as const;

export const sandboxRuntimeOptions = [
  {
    id: "sprite",
    label: "Sprite",
    description: "Replay Sprite process with CA written into the sandbox filesystem.",
    defaultCertPath: "/etc/agent-vault/ca.pem",
    launchTarget: "Sprite agent command",
  },
  {
    id: "almostnode",
    label: "AlmostNode",
    description: "Browser-backed sandbox that receives proxy env from the host launcher.",
    defaultCertPath: "/home/sandbox/.agent-vault/ca.pem",
    launchTarget: "AlmostNode worker command",
  },
  {
    id: "local-node",
    label: "Local Node",
    description: "Local Node process for smoke tests before moving into a sandbox.",
    defaultCertPath: "/tmp/agent-vault-ca.pem",
    launchTarget: "Local node process",
  },
] as const satisfies ReadonlyArray<SandboxRuntimeOption>;

export const aiHarnessOptions = [
  {
    id: "codex",
    label: "Codex",
    description: "Installs and runs Codex in the sandbox with OpenAI traffic routed through Agent Vault.",
    packageName: "@openai/codex",
    packageVersion: "latest",
    installScript: "npm install -g @openai/codex@latest",
    runScript:
      "AGENT_PROMPT=\"${AGENT_PROMPT:-Describe this sandbox}\" codex exec --skip-git-repo-check --ask-for-approval never --sandbox workspace-write --color never \"$AGENT_PROMPT\"",
    displayCommand: "codex exec",
    prompt: "Use the configured OpenAI credential through Agent Vault and report the model/account reachability.",
    env: {
      CI: "1",
      NO_COLOR: "1",
    },
    requestUrl: "https://api.openai.com/v1/responses",
  },
  {
    id: "claude",
    label: "Claude Code",
    description: "Installs and runs Claude Code in the sandbox with Anthropic traffic routed through Agent Vault.",
    packageName: "@anthropic-ai/claude-code",
    packageVersion: "latest",
    installScript: "npm install -g @anthropic-ai/claude-code@latest",
    runScript:
      "AGENT_PROMPT=\"${AGENT_PROMPT:-Describe this sandbox}\" claude -p \"$AGENT_PROMPT\"",
    displayCommand: "claude -p",
    prompt: "Use the configured Anthropic credential through Agent Vault and report the model/account reachability.",
    env: {
      CI: "1",
      NO_COLOR: "1",
    },
    requestUrl: "https://api.anthropic.com/v1/messages",
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Installs and runs OpenCode in the sandbox; whichever configured provider it calls is intercepted.",
    packageName: "opencode-ai",
    packageVersion: "latest",
    installScript: "npm install -g opencode-ai@latest",
    runScript:
      "AGENT_PROMPT=\"${AGENT_PROMPT:-Describe this sandbox}\" opencode run \"$AGENT_PROMPT\"",
    displayCommand: "opencode run",
    prompt: "Use one configured AI provider through Agent Vault and report which outbound host was reached.",
    env: {
      CI: "1",
      NO_COLOR: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    requestUrl: "provider-selected-by-harness",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    description: "Installs and runs Gemini CLI in the sandbox with Google API traffic routed through Agent Vault.",
    packageName: "@google/gemini-cli",
    packageVersion: "latest",
    installScript: "npm install -g @google/gemini-cli@latest",
    runScript:
      "AGENT_PROMPT=\"${AGENT_PROMPT:-Describe this sandbox}\" gemini -p \"$AGENT_PROMPT\"",
    displayCommand: "gemini -p",
    prompt: "Use the configured Google/Gemini credential through Agent Vault and report the model/account reachability.",
    env: {
      CI: "1",
      NO_COLOR: "1",
    },
    requestUrl: "https://generativelanguage.googleapis.com",
  },
  {
    id: "custom",
    label: "Custom harness",
    description: "Use the manually selected services and credential keys with your own harness command.",
    packageName: "custom",
    packageVersion: "manual",
    installScript: "echo 'install your harness here'",
    runScript: "echo 'run your harness here'",
    displayCommand: "custom harness",
    prompt: "configured-by-agent",
    env: {},
    requestUrl: "configured-by-agent",
  },
] as const satisfies ReadonlyArray<AiHarnessOption>;

export const aiHarnessProxyDefaults = {
  codex: {
    credentialKeys: ["OPENAI_API_KEY"],
    optionalCredentialKeys: [],
    serviceHosts: ["api.openai.com"],
  },
  claude: {
    credentialKeys: ["ANTHROPIC_API_KEY"],
    optionalCredentialKeys: [],
    serviceHosts: ["api.anthropic.com"],
  },
  opencode: {
    credentialKeys: [],
    optionalCredentialKeys: [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENROUTER_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
    ],
    serviceHosts: [
      "api.anthropic.com",
      "api.openai.com",
      "openrouter.ai",
      "api.openrouter.ai",
      "generativelanguage.googleapis.com",
    ],
  },
  gemini: {
    credentialKeys: [],
    optionalCredentialKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    serviceHosts: ["generativelanguage.googleapis.com", "aiplatform.googleapis.com"],
  },
  custom: {
    credentialKeys: [],
    optionalCredentialKeys: [],
    serviceHosts: [],
  },
} as const satisfies Record<AiHarnessId, AiHarnessProxyDefaults>;

const credentialPattern = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

export function layerSandboxTarget(config: SandboxProxyConfig) {
  return AgentVaultSandboxTarget.layer(config.sandboxRuntime);
}

export function layerAiHarness(config: SandboxProxyConfig) {
  return AgentVaultAiHarness.layer(config.aiHarness);
}

export function layerSandboxProxy(config: SandboxProxyConfig) {
  return Layer.effect(
    AgentVaultSandboxProxy,
    Effect.gen(function* () {
      const sandboxRuntime = yield* AgentVaultSandboxTarget;
      const aiHarness = yield* AgentVaultAiHarness;

      return {
        ...config,
        sandboxRuntime,
        aiHarness,
      };
    }),
  );
}

export function composeSandboxProxyLayers(config: SandboxProxyConfig) {
  const ProxyLayer = layerSandboxProxy(config);
  const SandboxLayer = layerSandboxTarget(config);
  const HarnessLayer = layerAiHarness(config);

  return ProxyLayer.pipe(Layer.provideMerge(Layer.mergeAll(SandboxLayer, HarnessLayer)));
}

export function redactedDisplay(_value: Redacted.Redacted<string>): string {
  return "<redacted>";
}

export function serviceDisplayName(service: VaultService): string {
  return service.name?.trim() || service.host;
}

export function credentialKeysForService(service: VaultService): string[] {
  const keys = new Set<string>();

  switch (service.auth.type) {
    case "bearer":
      addKey(keys, service.auth.token);
      break;
    case "basic":
      addKey(keys, service.auth.username);
      addKey(keys, service.auth.password);
      break;
    case "api-key":
      addKey(keys, service.auth.key);
      break;
    case "custom":
      for (const value of Object.values(service.auth.headers)) {
        for (const match of value.matchAll(credentialPattern)) {
          addKey(keys, match[1]);
        }
      }
      break;
    case "passthrough":
      break;
    default:
      break;
  }

  for (const substitution of service.substitutions ?? []) {
    addKey(keys, substitution.key);
  }

  return [...keys].sort();
}

export function sandboxRuntimeById(id: SandboxRuntimeId): SandboxRuntimeOption {
  return (
    sandboxRuntimeOptions.find((option) => option.id === id) ??
    sandboxRuntimeOptions[0]
  );
}

export function aiHarnessById(id: AiHarnessId): AiHarnessOption {
  return aiHarnessOptions.find((option) => option.id === id) ?? aiHarnessOptions[0];
}

export function proxyDefaultsForAiHarness(id: AiHarnessId): AiHarnessProxyDefaults {
  return aiHarnessProxyDefaults[id] ?? aiHarnessProxyDefaults.custom;
}

export function defaultAiHarnessForVault(input: {
  readonly credentialKeys: ReadonlyArray<string>;
  readonly services: ReadonlyArray<VaultService>;
}): AiHarnessId {
  const keys = new Set(input.credentialKeys);

  return (
    aiHarnessOptions.find(
      (harness) => {
        const proxyDefaults = proxyDefaultsForAiHarness(harness.id);
        return (
          harness.id !== "custom" &&
          ([...proxyDefaults.credentialKeys, ...proxyDefaults.optionalCredentialKeys].some(
            (key) => keys.has(key),
          ) ||
            input.services.some((service) =>
              serviceHostMatches(service.host, proxyDefaults.serviceHosts),
            ))
        );
      },
    )?.id ?? "custom"
  );
}

export function selectionForAiHarness(input: {
  readonly aiHarnessId: AiHarnessId;
  readonly availableCredentialKeys: ReadonlyArray<string>;
  readonly services: ReadonlyArray<VaultService>;
}): {
  readonly credentialKeys: ReadonlyArray<string>;
  readonly serviceNames: ReadonlyArray<string>;
} {
  const harness = aiHarnessById(input.aiHarnessId);
  if (harness.id === "custom") {
    return { credentialKeys: [], serviceNames: [] };
  }

  const proxyDefaults = proxyDefaultsForAiHarness(harness.id);
  const availableCredentialKeys = new Set(input.availableCredentialKeys);
  const credentialKeys = unique([
    ...proxyDefaults.credentialKeys,
    ...proxyDefaults.optionalCredentialKeys,
  ]).filter((key) => availableCredentialKeys.has(key));
  const serviceNames = input.services
    .filter((service) => serviceHostMatches(service.host, proxyDefaults.serviceHosts))
    .map(serviceDisplayName)
    .sort();

  return { credentialKeys, serviceNames };
}

export function makeSandboxProxyConfig(input: {
  readonly vaultName: string;
  readonly availableCredentialKeys: ReadonlyArray<string>;
  readonly services: ReadonlyArray<VaultService>;
  readonly selectedCredentialKeys: ReadonlyArray<string>;
  readonly selectedServiceNames: ReadonlyArray<string>;
  readonly sandboxRuntimeId: SandboxRuntimeId;
  readonly aiHarnessId: AiHarnessId;
  readonly certPath: string;
}): Effect.Effect<SandboxProxyConfig, SandboxProxyConfigError> {
  return Effect.gen(function* () {
    const sandboxRuntime = sandboxRuntimeById(input.sandboxRuntimeId);
    const aiHarness = aiHarnessById(input.aiHarnessId);
    const certPath = input.certPath.trim();
    if (certPath === "") {
      return yield* Effect.fail(
        new SandboxProxyConfigError({ message: "Certificate path is required." }),
      );
    }

    const available = new Set(input.availableCredentialKeys);
    const selectedCredentialKeys = unique(input.selectedCredentialKeys).filter(
      (key) => available.has(key),
    );
    const selectedServiceNames = new Set(input.selectedServiceNames);
    const selectedServices = input.services
      .filter((service) => selectedServiceNames.has(serviceDisplayName(service)))
      .map((service) => ({
        name: serviceDisplayName(service),
        host: service.host,
        enabled: service.enabled !== false,
        credentialKeys: credentialKeysForService(service).filter((key) =>
          selectedCredentialKeys.includes(key),
        ),
      }));

    const proxyEnv: Record<string, Redacted.Redacted<string>> = {
      HTTP_PROXY: Redacted.make("<minted-agent-vault-proxy-url>"),
      HTTPS_PROXY: Redacted.make("<minted-agent-vault-proxy-url>"),
      NO_PROXY: Redacted.make("localhost,127.0.0.1"),
      NODE_USE_ENV_PROXY: Redacted.make("1"),
      SSL_CERT_FILE: Redacted.make(certPath),
      NODE_EXTRA_CA_CERTS: Redacted.make(certPath),
      REQUESTS_CA_BUNDLE: Redacted.make(certPath),
      CURL_CA_BUNDLE: Redacted.make(certPath),
      GIT_SSL_CAINFO: Redacted.make(certPath),
      DENO_CERT: Redacted.make(certPath),
    };

    const sentinelEnv = Object.fromEntries(
      selectedCredentialKeys.map((key) => [key, `__AGENT_VAULT__:${key}`]),
    );

    const notes = [
      "The browser preview never mints or displays the proxy URL, token, CA PEM, or raw credential values.",
      "Today Agent Vault tokens are vault-scoped; true service/key allowlists require a session-scope API extension.",
      "The Sprite should receive the raw proxy env only from a backend session endpoint, after the CA PEM is written into the sandbox filesystem.",
    ];

    return {
      vaultName: input.vaultName,
      sessionEndpoint: "/v1/sessions",
      sandboxRuntime,
      aiHarness,
      certPath,
      selectedCredentialKeys,
      selectedServices,
      proxyEnv,
      sentinelEnv,
      notes,
    };
  });
}

export function createEffectApiSnippet(config: SandboxProxyConfig): string {
  const credentialKeys = JSON.stringify(config.selectedCredentialKeys, null, 2);
  const serviceNames = JSON.stringify(
    config.selectedServices.map((service) => service.name),
    null,
    2,
  );
  const serviceHosts = JSON.stringify(
    config.selectedServices.map((service) => service.host),
    null,
    2,
  );
  const sandbox = JSON.stringify(
    {
      id: config.sandboxRuntime.id,
      label: config.sandboxRuntime.label,
      launchTarget: config.sandboxRuntime.launchTarget,
      certPath: config.certPath,
    },
    null,
    2,
  );
  const aiHarness = JSON.stringify(
    {
      id: config.aiHarness.id,
      label: config.aiHarness.label,
      packageName: config.aiHarness.packageName,
      packageVersion: config.aiHarness.packageVersion,
      installScript: config.aiHarness.installScript,
      runScript: config.aiHarness.runScript,
      displayCommand: config.aiHarness.displayCommand,
      prompt: config.aiHarness.prompt,
      env: config.aiHarness.env,
      requestUrl: config.aiHarness.requestUrl,
    },
    null,
    2,
  );

  return `import {
  AgentVaultAiHarness,
  AgentVaultSandboxProxy,
  AgentVaultSandboxTarget
} from "@infisical/agent-vault-sdk/effect";
import { SpriteContext, SpriteTerminal } from "@replayio/effect-platform-sprites";
import { Effect, Layer } from "effect";

const spriteContext = new SpriteContext(process.env.SPRITE_NAME ?? "agent-vault-effect-playground", undefined, {
  createIfMissing: true,
  namePrefix: "agent-vault-effect-playground",
  token: process.env.SPRITES_TOKEN!
});
const SpriteLayer = Layer.unwrapEffect(
  Effect.map(spriteContext.resolveSprite(), (sprite) =>
    SpriteTerminal.layer(sprite, { terminal: { cols: 100, rows: 30 } })
  )
);

const ProxyLayer = AgentVaultSandboxProxy.layerFromTargets({
  address: process.env.AGENT_VAULT_ADDR!,
  token: process.env.AGENT_VAULT_TOKEN!,
  vault: "${config.vaultName}",
  ttlSeconds: 900,
  label: "effect-playground-generated-layer",
  credentialKeys: ${credentialKeys},
  serviceNames: ${serviceNames},
  serviceHosts: ${serviceHosts}
});
const SandboxLayer = Layer.effect(
  AgentVaultSandboxTarget,
  Effect.gen(function* () {
    const terminal = yield* SpriteTerminal.Tag;
    const sandboxTarget = ${sandbox};

    return {
      ...sandboxTarget,
      startInteractivePty: (options: {
        readonly command: string;
        readonly env: Record<string, string>;
        readonly cwd?: string;
        readonly cols?: number;
        readonly rows?: number;
      }) =>
        terminal.create({
          command: "/bin/sh",
          args: ["-lc", options.command],
          cols: options.cols ?? 100,
          rows: options.rows ?? 30
        }).pipe(
          Effect.map((tty) => ({
            id: tty.sessionId ?? "agent-pty:" + sandboxTarget.id,
            target: sandboxTarget.launchTarget ?? sandboxTarget.id,
            command: options.command,
            stdin: "interactive" as const,
            stdout: "stream" as const,
            stderr: "stream" as const,
            envKeys: Object.keys(options.env),
            sessionId: tty.sessionId
          }))
        )
    };
  })
);
const HarnessLayer = AgentVaultAiHarness.layer(${aiHarness});
const AppLayer = ProxyLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(SandboxLayer, HarnessLayer)),
  Layer.provide(SpriteLayer)
);

const program = Effect.gen(function* () {
  const sandbox = yield* AgentVaultSandboxTarget;
  const harness = yield* AgentVaultAiHarness;
  const proxy = yield* AgentVaultSandboxProxy;
  const prepared = yield* proxy.prepareForSandbox;
  const proxyEnv = AgentVaultSandboxProxy.unsafeMaterializeEnv(prepared);
  const caCertificate = AgentVaultSandboxProxy.unsafeMaterializeCaCertificate(prepared);
  const runEnv = {
    ...harness.env,
    ...proxyEnv,
    ...prepared.sentinelEnv
  };

  // In the sandbox adapter:
  // 1. write caCertificate to prepared.certPath
  // 2. install the harness package inside the sandbox without proxy or sentinel keys
  // 3. start the agent harness through the sandbox layer's interactive PTY
  // Every HTTP client used by the harness now sees HTTP(S)_PROXY and the CA bundle.
  const agentPty = yield* sandbox.startInteractivePty({
    command: harness.runScript ?? "",
    env: runEnv,
    cols: 100,
    rows: 30
  });

  return {
    sandbox,
    harness: {
      id: harness.id,
      packageName: harness.packageName,
      displayCommand: harness.displayCommand
    },
    installPhase: {
      command: harness.installScript,
      envKeys: Object.keys(harness.env),
      proxyEnvKeys: []
    },
    runPhase: {
      command: harness.runScript,
      envKeys: Object.keys(runEnv),
      proxyEnvKeys: Object.keys(proxyEnv),
      sentinelEnvKeys: Object.keys(prepared.sentinelEnv)
    },
    agentPty,
    caCertificateBytes: caCertificate.length,
    credentialKeys: prepared.credentialKeys
  };
}).pipe(Effect.provide(AppLayer));

await Effect.runPromise(program);`;
}

function addKey(keys: Set<string>, key: string | undefined) {
  const trimmed = key?.trim();
  if (trimmed) {
    keys.add(trimmed);
  }
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function serviceHostMatches(
  serviceHost: string,
  providerHosts: ReadonlyArray<string>,
): boolean {
  const normalizedServiceHost = normalizeHost(serviceHost);
  return providerHosts.some((providerHost) => {
    const normalizedProviderHost = normalizeHost(providerHost);
    return (
      normalizedServiceHost === normalizedProviderHost ||
      normalizedServiceHost.endsWith(`.${normalizedProviderHost}`)
    );
  });
}

function normalizeHost(host: string): string {
  const withoutProtocol = host.toLowerCase().replace(/^https?:\/\//, "");
  return withoutProtocol.split("/")[0]?.replace(/^\*\./, "") ?? withoutProtocol;
}
