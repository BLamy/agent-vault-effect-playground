import { Effect, Redacted } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  AgentVaultSandboxProxy,
  prepareForSandbox,
  unsafeMaterializeCaCertificate,
  unsafeMaterializeEnv,
  type AgentVaultSessionClient,
} from "../src/effect.js";

const fakeContainerConfig = {
  env: {
    HTTPS_PROXY: "https://session-token:default@127.0.0.1:14322",
    HTTP_PROXY: "https://session-token:default@127.0.0.1:14322",
    NO_PROXY: "localhost,127.0.0.1",
  },
  caCertificate: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n",
};

describe("AgentVaultSandboxProxy", () => {
  it("prepares redacted proxy env, CA PEM, and sentinel env", async () => {
    const create = vi.fn().mockResolvedValue({
      token: "session-token",
      expiresAt: "2026-05-20T00:00:00Z",
      address: "http://localhost:14321",
      containerConfig: fakeContainerConfig,
    });
    const client: AgentVaultSessionClient = {
      vault: vi.fn(() => ({ sessions: { create } })),
    };

    const prepared = await Effect.runPromise(
      prepareForSandbox({
        client,
        vault: "default",
        certPath: "/etc/agent-vault/ca.pem",
        ttlSeconds: 600,
        label: "sprite",
        sandbox: {
          id: "sprite",
          label: "Sprite",
          launchTarget: "Sprite agent command",
          certPath: "/etc/agent-vault/ca.pem",
        },
        ai: {
          provider: "openai",
          label: "OpenAI",
          model: "gpt-4.1-mini",
          requestUrl: "https://api.openai.com/v1/responses",
        },
        credentialKeys: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
        serviceNames: ["openai"],
      }),
    );

    expect(client.vault).toHaveBeenCalledWith("default");
    expect(create).toHaveBeenCalledWith({
      ttlSeconds: 600,
      label: "sprite",
    });
    expect(String(prepared.env.HTTPS_PROXY)).not.toContain("session-token");
    expect(Redacted.value(prepared.env.HTTPS_PROXY)).toContain("session-token");
    expect(unsafeMaterializeEnv(prepared).NODE_EXTRA_CA_CERTS).toBe(
      "/etc/agent-vault/ca.pem",
    );
    expect(unsafeMaterializeCaCertificate(prepared)).toContain("FAKE");
    expect(prepared.sandbox?.id).toBe("sprite");
    expect(prepared.ai?.provider).toBe("openai");
    expect(Object.keys(prepared.sentinelEnv)).toEqual([
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
    ]);
  });

  it("fails when MITM container config is unavailable", async () => {
    const client: AgentVaultSessionClient = {
      vault: () => ({
        sessions: {
          create: vi.fn().mockResolvedValue({
            token: "session-token",
            expiresAt: "2026-05-20T00:00:00Z",
            address: "http://localhost:14321",
            containerConfig: null,
          }),
        },
      }),
    };

    const result = await Effect.runPromise(
      Effect.either(
        prepareForSandbox({
          client,
          vault: "default",
          certPath: "/etc/agent-vault/ca.pem",
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("MITM proxy is disabled");
    }
  });

  it("provides the service as an Effect layer", async () => {
    const client: AgentVaultSessionClient = {
      vault: () => ({
        sessions: {
          create: vi.fn().mockResolvedValue({
            token: "session-token",
            expiresAt: "2026-05-20T00:00:00Z",
            address: "http://localhost:14321",
            containerConfig: fakeContainerConfig,
          }),
        },
      }),
    };

    const program = Effect.gen(function* () {
      const proxy = yield* AgentVaultSandboxProxy;
      return yield* proxy.prepareForSandbox;
    }).pipe(
      Effect.provide(
        AgentVaultSandboxProxy.layer({
          client,
          vault: "default",
          certPath: "/etc/agent-vault/ca.pem",
          credentialKeys: ["OPENAI_API_KEY"],
        }),
      ),
    );

    const prepared = await Effect.runPromise(program);
    expect(prepared.credentialKeys).toEqual(["OPENAI_API_KEY"]);
  });
});
