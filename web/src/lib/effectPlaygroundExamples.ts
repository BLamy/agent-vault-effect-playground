import { Effect } from "effect";
import {
  AgentVaultAiHarness,
  AgentVaultSandboxProxy,
  AgentVaultSandboxTarget,
  SandboxProxyConfigError,
  composeSandboxProxyLayers,
  redactedDisplay,
  type SandboxProxyConfig,
} from "./effectSandboxProxy";

export type PlaygroundExampleId =
  | "inventory"
  | "proxy-layer"
  | "harness-run"
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
    description: "Reads the three composed layer services from the program environment.",
    code: `const AppLayer = composeSandboxProxyLayers(config);

const program = Effect.gen(function* () {
  const sandbox = yield* AgentVaultSandboxTarget;
  const harness = yield* AgentVaultAiHarness;
  const proxy = yield* AgentVaultSandboxProxy;

  return {
    vault: proxy.vaultName,
    layers: ["sandbox", "aiHarness", "agentVaultProxy"],
    sandbox: sandbox.label,
    harness: harness.label,
    services: proxy.selectedServices.map((service) => service.name),
    credentialKeys: proxy.selectedCredentialKeys
  };
}).pipe(Effect.provide(AppLayer));`,
  },
  {
    id: "proxy-layer",
    title: "Build sandbox env",
    description: "Expands the proxy layer into env key names and CA mount metadata.",
    code: `const AppLayer = composeSandboxProxyLayers(config);

const program = Effect.gen(function* () {
  const sandbox = yield* AgentVaultSandboxTarget;
  const proxy = yield* AgentVaultSandboxProxy;

  return {
    sandbox: sandbox.launchTarget,
    certPath: proxy.certPath,
    proxyEnv: Object.fromEntries(
      Object.entries(proxy.proxyEnv).map(([key, value]) => [key, "<redacted>"])
    ),
    sentinelEnvKeys: Object.keys(proxy.sentinelEnv)
  };
}).pipe(Effect.provide(AppLayer));`,
  },
  {
    id: "harness-run",
    title: "Run harness through proxy",
    description: "Models the sandbox launcher installing an AI harness, then running it with proxy env.",
    code: `const AppLayer = composeSandboxProxyLayers(config);

const program = Effect.gen(function* () {
  const harness = yield* AgentVaultAiHarness;
  const proxy = yield* AgentVaultSandboxProxy;
  const apiKey = proxy.selectedCredentialKeys[0];

  if (!apiKey) {
    return yield* Effect.fail(
      new SandboxProxyConfigError({ message: "Select at least one credential." })
    );
  }

  return {
    harness: harness.label,
    installPhase: {
      command: harness.installScript,
      proxyEnvKeys: Object.keys(proxy.proxyEnv),
      sentinelEnvKeys: []
    },
    runPhase: {
      command: harness.runScript,
      proxyEnvKeys: Object.keys(proxy.proxyEnv),
      sentinelEnvKeys: Object.keys(proxy.sentinelEnv)
    },
    interceptedHosts: harness.serviceHosts
  };
}).pipe(Effect.provide(AppLayer));`,
  },
  {
    id: "fail-closed",
    title: "Fail closed",
    description: "Shows the shape of an Effect failure when no secrets are selected.",
    code: `const AppLayer = composeSandboxProxyLayers(config);

const program = Effect.gen(function* () {
  const proxy = yield* AgentVaultSandboxProxy;

  if (proxy.selectedCredentialKeys.length === 0) {
    return yield* Effect.fail(
      new SandboxProxyConfigError({
        message: "No credential keys selected for this sandbox."
      })
    );
  }

  return "ready";
}).pipe(Effect.provide(AppLayer));`,
  },
];

export function runPlaygroundExample(
  exampleId: PlaygroundExampleId,
  config: SandboxProxyConfig,
): Effect.Effect<unknown, SandboxProxyConfigError> {
  const layer = composeSandboxProxyLayers(config);

  switch (exampleId) {
    case "inventory":
      return Effect.gen(function* () {
        const sandbox = yield* AgentVaultSandboxTarget;
        const harness = yield* AgentVaultAiHarness;
        const proxy = yield* AgentVaultSandboxProxy;
        return {
          vault: proxy.vaultName,
          layers: ["AgentVaultSandboxTarget", "AgentVaultAiHarness", "AgentVaultSandboxProxy"],
          services: proxy.selectedServices.map((service) => ({
            name: service.name,
            host: service.host,
            credentialKeys: service.credentialKeys,
          })),
          sandbox: {
            id: sandbox.id,
            label: sandbox.label,
            launchTarget: sandbox.launchTarget,
          },
          aiHarness: {
            id: harness.id,
            label: harness.label,
            packageName: harness.packageName,
            packageVersion: harness.packageVersion,
            displayCommand: harness.displayCommand,
            requestUrl: harness.requestUrl,
          },
          credentialKeys: proxy.selectedCredentialKeys,
        };
      }).pipe(Effect.provide(layer));
    case "proxy-layer":
      return Effect.gen(function* () {
        const sandbox = yield* AgentVaultSandboxTarget;
        const proxy = yield* AgentVaultSandboxProxy;
        return {
          sandbox: sandbox.label,
          launchTarget: sandbox.launchTarget,
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
    case "harness-run":
      return Effect.gen(function* () {
        const harness = yield* AgentVaultAiHarness;
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
          harness: {
            id: harness.id,
            label: harness.label,
            packageName: `${harness.packageName}@${harness.packageVersion}`,
            displayCommand: harness.displayCommand,
          },
          installPhase: {
            command: harness.installScript,
            proxyEnvKeys: Object.keys(proxy.proxyEnv),
            sentinelEnvKeys: [],
          },
          runPhase: {
            command: harness.runScript,
            harnessEnvKeys: Object.keys(harness.env),
            proxyEnvKeys: Object.keys(proxy.proxyEnv),
            sentinelEnvKeys: Object.keys(proxy.sentinelEnv),
          },
          interceptedHosts: harness.serviceHosts,
          result: "The sandbox runs the harness normally; HTTP(S)_PROXY and CA env route outbound API calls through Agent Vault.",
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
