import { Context, Data, Effect, Layer, Redacted } from "effect";
import { AgentVault } from "./client.js";
import {
  buildProxyEnv,
  type CreateSessionOptions,
  type Session,
} from "./resources/sessions.js";
import type { AgentVaultConfig } from "./types.js";

export interface AgentVaultSessionClient {
  readonly vault: (name: string) => {
    readonly sessions:
      | {
          readonly create: (
            options?: CreateSessionOptions,
          ) => Promise<Session>;
        }
      | undefined;
  };
}

export interface AgentVaultSandboxTargetConfig {
  readonly id: string;
  readonly label?: string;
  readonly launchTarget?: string;
  readonly certPath?: string;
}

export interface AgentVaultSandboxPtyOptions {
  readonly command: string;
  readonly env: Record<string, string>;
  readonly cwd?: string;
  readonly cols?: number;
  readonly rows?: number;
}

export interface AgentVaultSandboxPty {
  readonly id: string;
  readonly target: string;
  readonly command: string;
  readonly stdin: "interactive";
  readonly stdout: "stream";
  readonly stderr: "stream";
  readonly envKeys: ReadonlyArray<string>;
  readonly sessionId?: string;
  readonly terminalUrl?: string;
}

export class AgentVaultSandboxTargetError extends Data.TaggedError(
  "AgentVaultSandboxTargetError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface AgentVaultSandboxTargetLayerOptions
  extends AgentVaultSandboxTargetConfig {
  readonly startInteractivePty?: (
    options: AgentVaultSandboxPtyOptions,
  ) => Effect.Effect<AgentVaultSandboxPty, AgentVaultSandboxTargetError>;
}

export interface AgentVaultSandboxTargetService
  extends AgentVaultSandboxTargetConfig {
  readonly startInteractivePty: (
    options: AgentVaultSandboxPtyOptions,
  ) => Effect.Effect<AgentVaultSandboxPty, AgentVaultSandboxTargetError>;
}

export interface AgentVaultAiHarnessConfig {
  readonly id: string;
  readonly label?: string;
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly installScript?: string;
  readonly runScript?: string;
  readonly displayCommand?: string;
  readonly prompt?: string;
  readonly env?: Record<string, string>;
  readonly requestUrl?: string;
}

export interface AgentVaultSandboxProxyOptions extends AgentVaultConfig {
  readonly vault: string;
  readonly certPath: string;
  readonly sandbox?: AgentVaultSandboxTargetConfig;
  readonly aiHarness?: AgentVaultAiHarnessConfig;
  readonly ttlSeconds?: number;
  readonly label?: string;
  readonly credentialKeys?: ReadonlyArray<string>;
  readonly serviceNames?: ReadonlyArray<string>;
  readonly serviceHosts?: ReadonlyArray<string>;
  readonly client?: AgentVaultSessionClient;
}

export interface AgentVaultSandboxProxyLayerOptions extends AgentVaultConfig {
  readonly vault: string;
  readonly certPath?: string;
  readonly ttlSeconds?: number;
  readonly label?: string;
  readonly credentialKeys?: ReadonlyArray<string>;
  readonly serviceNames?: ReadonlyArray<string>;
  readonly serviceHosts?: ReadonlyArray<string>;
  readonly client?: AgentVaultSessionClient;
}

export interface PreparedSandboxProxy {
  readonly vault: string;
  readonly expiresAt: string;
  readonly certPath: string;
  readonly sandbox?: AgentVaultSandboxTargetConfig;
  readonly aiHarness?: AgentVaultAiHarnessConfig;
  readonly credentialKeys: ReadonlyArray<string>;
  readonly serviceNames: ReadonlyArray<string>;
  readonly serviceHosts: ReadonlyArray<string>;
  readonly env: Record<string, Redacted.Redacted<string>>;
  readonly sentinelEnv: Record<string, string>;
  readonly caCertificate: Redacted.Redacted<string>;
}

export class AgentVaultSandboxProxyError extends Data.TaggedError(
  "AgentVaultSandboxProxyError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AgentVaultSandboxTarget extends Context.Tag(
  "@infisical/agent-vault-sdk/AgentVaultSandboxTarget",
)<AgentVaultSandboxTarget, AgentVaultSandboxTargetService>() {
  static layer(target: AgentVaultSandboxTargetLayerOptions) {
    return Layer.succeed(AgentVaultSandboxTarget, {
      ...target,
      startInteractivePty:
        target.startInteractivePty ??
        (() =>
          Effect.fail(
            new AgentVaultSandboxTargetError({
              message: "Sandbox layer does not provide an interactive PTY adapter",
            }),
          )),
    });
  }
}

export class AgentVaultAiHarness extends Context.Tag(
  "@infisical/agent-vault-sdk/AgentVaultAiHarness",
)<AgentVaultAiHarness, AgentVaultAiHarnessConfig>() {
  static layer(harness: AgentVaultAiHarnessConfig) {
    return Layer.succeed(AgentVaultAiHarness, harness);
  }
}

export class AgentVaultSandboxProxy extends Context.Tag(
  "@infisical/agent-vault-sdk/AgentVaultSandboxProxy",
)<AgentVaultSandboxProxy, AgentVaultSandboxProxy.Service>() {
  static layer(options: AgentVaultSandboxProxyOptions) {
    return Layer.succeed(AgentVaultSandboxProxy, {
      prepareForSandbox: prepareForSandbox(options),
    });
  }

  static layerFromTargets(options: AgentVaultSandboxProxyLayerOptions) {
    return Layer.effect(
      AgentVaultSandboxProxy,
      Effect.gen(function* () {
        const sandbox = yield* AgentVaultSandboxTarget;
        const aiHarness = yield* AgentVaultAiHarness;
        return {
          prepareForSandbox: prepareForSandbox({
            ...options,
            certPath: options.certPath ?? sandbox.certPath ?? "",
            sandbox,
            aiHarness,
            credentialKeys: options.credentialKeys,
            serviceNames: options.serviceNames,
            serviceHosts: options.serviceHosts,
          }),
        };
      }),
    );
  }

  static unsafeMaterializeEnv = unsafeMaterializeEnv;
  static unsafeMaterializeCaCertificate = unsafeMaterializeCaCertificate;
}

export namespace AgentVaultSandboxProxy {
  export interface Service {
    readonly prepareForSandbox: Effect.Effect<
      PreparedSandboxProxy,
      AgentVaultSandboxProxyError
    >;
  }
}

export function prepareForSandbox(
  options: AgentVaultSandboxProxyOptions,
): Effect.Effect<PreparedSandboxProxy, AgentVaultSandboxProxyError> {
  return Effect.tryPromise({
    try: async () => {
      if (!options.vault.trim()) {
        throw new AgentVaultSandboxProxyError({ message: "vault is required" });
      }
      if (!options.certPath.trim()) {
        throw new AgentVaultSandboxProxyError({
          message: "certPath is required",
        });
      }

      const client =
        options.client ??
        new AgentVault({
          address: options.address,
          token: options.token,
        });
      const vault = client.vault(options.vault);
      if (!vault.sessions) {
        throw new AgentVaultSandboxProxyError({
          message: "A named vault client is required to mint sandbox sessions",
        });
      }

      const session = await vault.sessions.create({
        ttlSeconds: options.ttlSeconds,
        label: options.label,
      });
      if (!session.containerConfig) {
        throw new AgentVaultSandboxProxyError({
          message: "Agent Vault MITM proxy is disabled for this session",
        });
      }

      const env = buildProxyEnv(session.containerConfig, options.certPath);
      const credentialKeys = unique(options.credentialKeys ?? []);
      return {
        vault: options.vault,
        expiresAt: session.expiresAt,
        certPath: options.certPath,
        sandbox: options.sandbox,
        aiHarness: options.aiHarness,
        credentialKeys,
        serviceNames: unique(options.serviceNames ?? []),
        serviceHosts: unique(options.serviceHosts ?? []),
        env: redactRecord(env),
        sentinelEnv: Object.fromEntries(
          credentialKeys.map((key) => [key, `__AGENT_VAULT__:${key}`]),
        ),
        caCertificate: Redacted.make(session.containerConfig.caCertificate),
      };
    },
    catch: (cause) =>
      cause instanceof AgentVaultSandboxProxyError
        ? cause
        : new AgentVaultSandboxProxyError({
            message: "Failed to prepare Agent Vault sandbox proxy",
            cause,
          }),
  });
}

export function unsafeMaterializeEnv(
  prepared: PreparedSandboxProxy,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(prepared.env).map(([key, value]) => [
      key,
      Redacted.value(value),
    ]),
  );
}

export function unsafeMaterializeCaCertificate(
  prepared: PreparedSandboxProxy,
): string {
  return Redacted.value(prepared.caCertificate);
}

function redactRecord(record: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, Redacted.make(value)]),
  );
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
