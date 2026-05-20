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

export interface AgentVaultSandboxProxyOptions extends AgentVaultConfig {
  readonly vault: string;
  readonly certPath: string;
  readonly ttlSeconds?: number;
  readonly label?: string;
  readonly credentialKeys?: ReadonlyArray<string>;
  readonly serviceNames?: ReadonlyArray<string>;
  readonly client?: AgentVaultSessionClient;
}

export interface PreparedSandboxProxy {
  readonly vault: string;
  readonly expiresAt: string;
  readonly certPath: string;
  readonly credentialKeys: ReadonlyArray<string>;
  readonly serviceNames: ReadonlyArray<string>;
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

export class AgentVaultSandboxProxy extends Context.Tag(
  "@infisical/agent-vault-sdk/AgentVaultSandboxProxy",
)<AgentVaultSandboxProxy, AgentVaultSandboxProxy.Service>() {
  static layer(options: AgentVaultSandboxProxyOptions) {
    return Layer.succeed(AgentVaultSandboxProxy, {
      prepareForSandbox: prepareForSandbox(options),
    });
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
        credentialKeys,
        serviceNames: unique(options.serviceNames ?? []),
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
