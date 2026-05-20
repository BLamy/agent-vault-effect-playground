import { Effect } from "effect";
import {
  AgentVaultSandboxProxy,
  SandboxProxyConfigError,
  layerSandboxProxy,
  redactedDisplay,
  type SandboxProxyConfig,
} from "./effectSandboxProxy";

export type PlaygroundExampleId =
  | "inventory"
  | "proxy-layer"
  | "provider-fetch"
  | "fail-closed";

export interface PlaygroundExample {
  readonly id: PlaygroundExampleId;
  readonly title: string;
  readonly description: string;
  readonly code: string;
}

export const playgroundExamples: ReadonlyArray<PlaygroundExample> = [
  {
    id: "inventory",
    title: "Inspect vault selection",
    description: "Reads selected services and credential keys from the Effect service.",
    code: `const program = Effect.gen(function* () {
  const proxy = yield* AgentVaultSandboxProxy;

  return {
    vault: proxy.vaultName,
    services: proxy.selectedServices.map((service) => service.name),
    credentialKeys: proxy.selectedCredentialKeys
  };
}).pipe(Effect.provide(layerSandboxProxy(config)));`,
  },
  {
    id: "proxy-layer",
    title: "Build sandbox env",
    description: "Expands the proxy layer into env key names and CA mount metadata.",
    code: `const program = Effect.gen(function* () {
  const proxy = yield* AgentVaultSandboxProxy;

  return {
    certPath: proxy.certPath,
    proxyEnv: Object.fromEntries(
      Object.entries(proxy.proxyEnv).map(([key, value]) => [key, "<redacted>"])
    ),
    sentinelEnvKeys: Object.keys(proxy.sentinelEnv)
  };
}).pipe(Effect.provide(layerSandboxProxy(config)));`,
  },
  {
    id: "provider-fetch",
    title: "Provider call through proxy",
    description: "Models a Sprite calling a provider API with a sentinel key.",
    code: `const program = Effect.gen(function* () {
  const proxy = yield* AgentVaultSandboxProxy;
  const apiKey = proxy.selectedCredentialKeys[0];

  if (!apiKey) {
    return yield* Effect.fail(
      new SandboxProxyConfigError({ message: "Select at least one credential." })
    );
  }

  return {
    request: "fetch('https://api.openai.com/v1/responses', ...)",
    authHeader: "Bearer <sentinel>",
    routedBy: Object.keys(proxy.proxyEnv)
  };
}).pipe(Effect.provide(layerSandboxProxy(config)));`,
  },
  {
    id: "fail-closed",
    title: "Fail closed",
    description: "Shows the shape of an Effect failure when no secrets are selected.",
    code: `const program = Effect.gen(function* () {
  const proxy = yield* AgentVaultSandboxProxy;

  if (proxy.selectedCredentialKeys.length === 0) {
    return yield* Effect.fail(
      new SandboxProxyConfigError({
        message: "No credential keys selected for this sandbox."
      })
    );
  }

  return "ready";
}).pipe(Effect.provide(layerSandboxProxy(config)));`,
  },
];

export function runPlaygroundExample(
  exampleId: PlaygroundExampleId,
  config: SandboxProxyConfig,
): Effect.Effect<unknown, SandboxProxyConfigError> {
  const layer = layerSandboxProxy(config);

  switch (exampleId) {
    case "inventory":
      return Effect.gen(function* () {
        const proxy = yield* AgentVaultSandboxProxy;
        return {
          vault: proxy.vaultName,
          services: proxy.selectedServices.map((service) => ({
            name: service.name,
            host: service.host,
            credentialKeys: service.credentialKeys,
          })),
          credentialKeys: proxy.selectedCredentialKeys,
        };
      }).pipe(Effect.provide(layer));
    case "proxy-layer":
      return Effect.gen(function* () {
        const proxy = yield* AgentVaultSandboxProxy;
        return {
          certPath: proxy.certPath,
          proxyEnv: Object.fromEntries(
            Object.entries(proxy.proxyEnv).map(([key, value]) => [
              key,
              redactedDisplay(value),
            ]),
          ),
          sentinelEnvKeys: Object.keys(proxy.sentinelEnv),
          notes: proxy.notes,
        };
      }).pipe(Effect.provide(layer));
    case "provider-fetch":
      return Effect.gen(function* () {
        const proxy = yield* AgentVaultSandboxProxy;
        const apiKey = proxy.selectedCredentialKeys[0];
        if (!apiKey) {
          return yield* Effect.fail(
            new SandboxProxyConfigError({
              message: "Select at least one credential.",
            }),
          );
        }

        return {
          request: "fetch('https://api.openai.com/v1/responses', { headers })",
          authHeader: "Bearer <sentinel>",
          proxyEnvKeys: Object.keys(proxy.proxyEnv),
          result: "The MITM proxy replaces the sentinel with the stored credential before forwarding.",
        };
      }).pipe(Effect.provide(layer));
    case "fail-closed":
      return Effect.gen(function* () {
        const proxy = yield* AgentVaultSandboxProxy;
        if (proxy.selectedCredentialKeys.length === 0) {
          return yield* Effect.fail(
            new SandboxProxyConfigError({
              message: "No credential keys selected for this sandbox.",
            }),
          );
        }
        return {
          result: "ready",
          credentialKeys: proxy.selectedCredentialKeys,
        };
      }).pipe(Effect.provide(layer));
  }
}
