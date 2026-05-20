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

export type AiProviderId = "openai" | "anthropic" | "openrouter" | "custom";

export interface AiProviderOption {
  readonly id: AiProviderId;
  readonly label: string;
  readonly description: string;
  readonly defaultModel: string;
  readonly credentialKeys: ReadonlyArray<string>;
  readonly serviceHosts: ReadonlyArray<string>;
  readonly requestUrl: string;
}

export interface SandboxProxyConfig {
  readonly vaultName: string;
  readonly sessionEndpoint: string;
  readonly sandboxRuntime: SandboxRuntimeOption;
  readonly aiProvider: AiProviderOption;
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

export const aiProviderOptions = [
  {
    id: "openai",
    label: "OpenAI",
    description: "Responses API routed through the Agent Vault proxy.",
    defaultModel: "gpt-4.1-mini",
    credentialKeys: ["OPENAI_API_KEY"],
    serviceHosts: ["api.openai.com"],
    requestUrl: "https://api.openai.com/v1/responses",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Messages API routed through the Agent Vault proxy.",
    defaultModel: "claude-3-5-sonnet-latest",
    credentialKeys: ["ANTHROPIC_API_KEY"],
    serviceHosts: ["api.anthropic.com"],
    requestUrl: "https://api.anthropic.com/v1/messages",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "OpenAI-compatible chat completions through OpenRouter.",
    defaultModel: "openai/gpt-4.1-mini",
    credentialKeys: ["OPENROUTER_API_KEY"],
    serviceHosts: ["openrouter.ai", "api.openrouter.ai"],
    requestUrl: "https://openrouter.ai/api/v1/chat/completions",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Use the manually selected services and credential keys.",
    defaultModel: "configured-by-agent",
    credentialKeys: [],
    serviceHosts: [],
    requestUrl: "configured-by-agent",
  },
] as const satisfies ReadonlyArray<AiProviderOption>;

const credentialPattern = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

export function layerSandboxProxy(config: SandboxProxyConfig) {
  return Layer.succeed(AgentVaultSandboxProxy, config);
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

export function aiProviderById(id: AiProviderId): AiProviderOption {
  return aiProviderOptions.find((option) => option.id === id) ?? aiProviderOptions[0];
}

export function defaultAiProviderForVault(input: {
  readonly credentialKeys: ReadonlyArray<string>;
  readonly services: ReadonlyArray<VaultService>;
}): AiProviderId {
  const keys = new Set(input.credentialKeys);

  return (
    aiProviderOptions.find(
      (provider) =>
        provider.id !== "custom" &&
        (provider.credentialKeys.some((key) => keys.has(key)) ||
          input.services.some((service) =>
            serviceHostMatches(service.host, provider.serviceHosts),
          )),
    )?.id ?? "custom"
  );
}

export function selectionForAiProvider(input: {
  readonly aiProviderId: AiProviderId;
  readonly availableCredentialKeys: ReadonlyArray<string>;
  readonly services: ReadonlyArray<VaultService>;
}): {
  readonly credentialKeys: ReadonlyArray<string>;
  readonly serviceNames: ReadonlyArray<string>;
} {
  const provider = aiProviderById(input.aiProviderId);
  if (provider.id === "custom") {
    return { credentialKeys: [], serviceNames: [] };
  }

  const availableCredentialKeys = new Set(input.availableCredentialKeys);
  const credentialKeys = provider.credentialKeys.filter((key) =>
    availableCredentialKeys.has(key),
  );
  const serviceNames = input.services
    .filter((service) => serviceHostMatches(service.host, provider.serviceHosts))
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
  readonly aiProviderId: AiProviderId;
  readonly certPath: string;
}): Effect.Effect<SandboxProxyConfig, SandboxProxyConfigError> {
  return Effect.gen(function* () {
    const sandboxRuntime = sandboxRuntimeById(input.sandboxRuntimeId);
    const aiProvider = aiProviderById(input.aiProviderId);
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
      aiProvider,
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
  const ai = JSON.stringify(
    {
      provider: config.aiProvider.id,
      label: config.aiProvider.label,
      model: config.aiProvider.defaultModel,
      requestUrl: config.aiProvider.requestUrl,
      credentialKeys: config.selectedCredentialKeys,
      serviceNames: config.selectedServices.map((service) => service.name),
    },
    null,
    2,
  );

  return `import { AgentVaultSandboxProxy } from "@infisical/agent-vault-sdk/effect";
import { Effect } from "effect";

const SandboxTarget = ${sandbox} as const;
const AiTarget = ${ai} as const;

const ProxyLayer = AgentVaultSandboxProxy.layer({
  address: process.env.AGENT_VAULT_ADDR!,
  token: process.env.AGENT_VAULT_TOKEN!,
  vault: "${config.vaultName}",
  certPath: "${config.certPath}",
  sandbox: SandboxTarget,
  ai: AiTarget,
  credentialKeys: ${credentialKeys},
  serviceNames: ${serviceNames}
});

const program = Effect.gen(function* () {
  const proxy = yield* AgentVaultSandboxProxy;
  const prepared = yield* proxy.prepareForSandbox;
  const env = AgentVaultSandboxProxy.unsafeMaterializeEnv(prepared);
  const caCertificate = AgentVaultSandboxProxy.unsafeMaterializeCaCertificate(prepared);

  // write caCertificate to prepared.certPath in the selected sandbox
  // start the sandbox command with env plus prepared.sentinelEnv
  return {
    sandbox: prepared.sandbox,
    ai: prepared.ai,
    envKeys: Object.keys(env),
    caCertificateBytes: caCertificate.length,
    credentialKeys: prepared.credentialKeys
  };
}).pipe(Effect.provide(ProxyLayer));

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
