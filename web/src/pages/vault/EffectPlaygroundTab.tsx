import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Effect, Either } from "effect";
import Button from "../../components/Button";
import CopyButton from "../../components/CopyButton";
import EffectCodeViewer from "../../components/EffectCodeViewer";
import Input from "../../components/Input";
import { apiFetch } from "../../lib/api";
import {
  createEffectApiSnippet,
  credentialKeysForService,
  makeSandboxProxyConfig,
  proxyEnvKeys,
  redactedDisplay,
  serviceDisplayName,
  type SandboxProxyConfig,
  type VaultService,
} from "../../lib/effectSandboxProxy";
import {
  playgroundExamples,
  runPlaygroundExample,
  type PlaygroundExampleId,
} from "../../lib/effectPlaygroundExamples";
import { ErrorBanner, LoadingSpinner, useVaultParams } from "./shared";

const defaultCertPath = "/etc/agent-vault/ca.pem";

export default function EffectPlaygroundTab() {
  const { vaultName } = useVaultParams();
  const [credentialKeys, setCredentialKeys] = useState<string[]>([]);
  const [services, setServices] = useState<VaultService[]>([]);
  const [selectedCredentialKeys, setSelectedCredentialKeys] = useState<string[]>([]);
  const [selectedServiceNames, setSelectedServiceNames] = useState<string[]>([]);
  const [certPath, setCertPath] = useState(defaultCertPath);
  const [exampleId, setExampleId] = useState<PlaygroundExampleId>("inventory");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [runOutput, setRunOutput] = useState("");
  const [runError, setRunError] = useState("");
  const [runningLayer, setRunningLayer] = useState(false);
  const [layerOutput, setLayerOutput] = useState("");
  const [layerError, setLayerError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [credentialsResp, servicesResp] = await Promise.all([
          apiFetch(`/v1/credentials?vault=${encodeURIComponent(vaultName)}`),
          apiFetch(`/v1/vaults/${encodeURIComponent(vaultName)}/services`),
        ]);

        if (!credentialsResp.ok) {
          const data = await credentialsResp.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load credential keys.");
        }
        if (!servicesResp.ok) {
          const data = await servicesResp.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load services.");
        }

        const credentialsData = await credentialsResp.json();
        const servicesData = await servicesResp.json();
        const nextCredentialKeys = (credentialsData.keys ?? []) as string[];
        const nextServices = (servicesData.services ?? []) as VaultService[];
        const enabledServiceNames = nextServices
          .filter((service) => service.enabled !== false)
          .map(serviceDisplayName);
        const referencedKeys = referencedCredentialKeys(
          nextServices.filter((service) => enabledServiceNames.includes(serviceDisplayName(service))),
          nextCredentialKeys,
        );

        if (!cancelled) {
          setCredentialKeys(nextCredentialKeys);
          setServices(nextServices);
          setSelectedServiceNames(enabledServiceNames);
          setSelectedCredentialKeys(referencedKeys);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Network error.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [vaultName]);

  const configResult = useMemo(
    () =>
      Effect.runSync(
        Effect.either(
          makeSandboxProxyConfig({
            vaultName,
            availableCredentialKeys: credentialKeys,
            services,
            selectedCredentialKeys,
            selectedServiceNames,
            certPath,
          }),
        ),
      ),
    [
      vaultName,
      credentialKeys,
      services,
      selectedCredentialKeys,
      selectedServiceNames,
      certPath,
    ],
  );

  const proxyConfig = Either.isRight(configResult) ? configResult.right : null;
  const configError = Either.isLeft(configResult) ? configResult.left.message : "";
  const currentExample = playgroundExamples.find((example) => example.id === exampleId) ?? playgroundExamples[0];
  const referencedKeysByService = useMemo(
    () =>
      Object.fromEntries(
        services.map((service) => [
          serviceDisplayName(service),
          credentialKeysForService(service),
        ]),
      ),
    [services],
  );
  const codeSnippet = proxyConfig ? createEffectApiSnippet(proxyConfig) : "";
  const preview = proxyConfig ? sanitizeProxyConfig(proxyConfig) : null;

  async function runExample() {
    if (!proxyConfig) return;
    setRunning(true);
    setRunError("");
    setRunOutput("");
    try {
      const result = await Effect.runPromise(
        Effect.either(runPlaygroundExample(exampleId, proxyConfig)),
      );
      if (Either.isLeft(result)) {
        setRunError(result.left.message);
      } else {
        setRunOutput(JSON.stringify(result.right, null, 2));
      }
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : "Example failed.");
    } finally {
      setRunning(false);
    }
  }

  async function runGeneratedLayer() {
    if (!proxyConfig) return;
    setRunningLayer(true);
    setLayerError("");
    setLayerOutput("");
    try {
      const result = await Effect.runPromise(
        Effect.either(runGeneratedLayerPreview(proxyConfig)),
      );
      if (Either.isLeft(result)) {
        setLayerError(result.left.message);
      } else {
        setLayerOutput(JSON.stringify(result.right, null, 2));
      }
    } catch (err: unknown) {
      setLayerError(err instanceof Error ? err.message : "Generated layer failed.");
    } finally {
      setRunningLayer(false);
    }
  }

  function selectReferenced() {
    const selectedServices = services.filter((service) =>
      selectedServiceNames.includes(serviceDisplayName(service)),
    );
    setSelectedCredentialKeys(referencedCredentialKeys(selectedServices, credentialKeys));
  }

  function clearSelection() {
    setSelectedCredentialKeys([]);
    setSelectedServiceNames([]);
  }

  return (
    <div className="p-8 w-full max-w-[1180px]">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-[22px] font-semibold text-text tracking-tight mb-1">
            Effect Playground
          </h2>
          <p className="text-sm text-text-muted">
            Compose vault credentials into a Sprite outbound proxy layer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={selectReferenced}>
            Select referenced
          </Button>
          <Button variant="secondary" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)] gap-5">
          <div className="space-y-5">
            <Panel title="Services">
              <div className="space-y-2">
                {services.length === 0 ? (
                  <EmptyPanelText>No services configured.</EmptyPanelText>
                ) : (
                  services.map((service) => {
                    const name = serviceDisplayName(service);
                    const selected = selectedServiceNames.includes(name);
                    const keys = referencedKeysByService[name] ?? [];
                    return (
                      <button
                        key={name}
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        onClick={() =>
                          setSelectedServiceNames((prev) =>
                            prev.includes(name)
                              ? prev.filter((value) => value !== name)
                              : [...prev, name].sort(),
                          )
                        }
                        className={`w-full text-left rounded-lg border p-3 transition-colors ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border bg-bg hover:border-text-dim"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-text truncate">
                              {name}
                            </div>
                            <div className="text-xs text-text-muted mt-0.5 truncate">
                              {service.host}
                            </div>
                          </div>
                          <span
                            className={`text-[11px] font-semibold rounded-full border px-2 py-0.5 ${
                              service.enabled === false
                                ? "border-danger/20 bg-danger-bg text-danger"
                                : "border-success/20 bg-success-bg text-success"
                            }`}
                          >
                            {service.enabled === false ? "Disabled" : "Enabled"}
                          </span>
                        </div>
                        {keys.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {keys.map((key) => (
                              <span
                                key={key}
                                className="px-2 py-1 rounded-md border border-border bg-surface text-[11px] font-mono text-text-muted"
                              >
                                {key}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </Panel>

            <Panel title="Credentials">
              <div className="space-y-2">
                {credentialKeys.length === 0 ? (
                  <EmptyPanelText>No credential keys stored.</EmptyPanelText>
                ) : (
                  credentialKeys.map((key) => {
                    const selected = selectedCredentialKeys.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        onClick={() =>
                          setSelectedCredentialKeys((prev) =>
                            prev.includes(key)
                              ? prev.filter((value) => value !== key)
                              : [...prev, key].sort(),
                          )
                        }
                        className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border bg-bg hover:border-text-dim"
                        }`}
                      >
                        <span className="min-w-0 text-sm font-mono text-text truncate">
                          {key}
                        </span>
                        <span className="text-xs text-text-dim">
                          {selected ? "Selected" : "Available"}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </Panel>

            <Panel title="Sandbox Mount">
              <label className="block text-xs font-medium text-text-muted mb-2">
                CA certificate path
              </label>
              <Input value={certPath} onChange={(event) => setCertPath(event.target.value)} />
              {configError && <ErrorBanner message={configError} className="mt-3" />}
            </Panel>
          </div>

          <div className="space-y-5 min-w-0">
            <Panel
              title="Generated Layer"
              action={
                codeSnippet ? (
                  <div className="flex items-center gap-2">
                    <CopyButton
                      value={codeSnippet}
                      label="Copy"
                      copiedLabel="Copied"
                      className="px-3 py-1.5 rounded-md border border-border bg-surface text-xs font-semibold text-text hover:bg-bg transition-colors"
                    />
                    <Button
                      onClick={runGeneratedLayer}
                      loading={runningLayer}
                      disabled={!proxyConfig}
                      className="!px-3 !py-1.5 !text-xs"
                    >
                      Run layer
                    </Button>
                  </div>
                ) : undefined
              }
            >
              {codeSnippet ? (
                <EffectCodeViewer
                  value={codeSnippet}
                  maxHeight={420}
                  ariaLabel="Generated Agent Vault Effect layer"
                />
              ) : (
                <pre className="max-h-[420px] overflow-auto rounded-lg bg-[#0b0d10] border border-border p-4 text-xs text-text-muted leading-relaxed">
                  <code>Select a valid sandbox mount path.</code>
                </pre>
              )}
              {layerError && (
                <ErrorBanner message={layerError} className="mt-3" />
              )}
              {layerOutput && (
                <pre className="mt-4 max-h-[260px] overflow-auto rounded-lg bg-bg border border-border p-4 text-xs text-text-muted leading-relaxed">
                  <code>{layerOutput}</code>
                </pre>
              )}
            </Panel>

            <Panel title="Preview">
              <pre className="max-h-[260px] overflow-auto rounded-lg bg-bg border border-border p-4 text-xs text-text-muted leading-relaxed">
                <code>{preview ? JSON.stringify(preview, null, 2) : "{}"}</code>
              </pre>
            </Panel>

            <Panel title="Examples">
              <div className="flex flex-wrap gap-2 mb-4">
                {playgroundExamples.map((example) => {
                  const active = example.id === exampleId;
                  return (
                    <button
                      key={example.id}
                      type="button"
                      onClick={() => setExampleId(example.id)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        active
                          ? "border-primary bg-primary/5 text-text"
                          : "border-border text-text-muted hover:text-text"
                      }`}
                    >
                      {example.title}
                    </button>
                  );
                })}
              </div>
              <div className="text-sm font-semibold text-text mb-1">
                {currentExample.title}
              </div>
              <div className="text-xs text-text-muted mb-3">
                {currentExample.description}
              </div>
              <EffectCodeViewer
                value={currentExample.code}
                maxHeight={260}
                ariaLabel={`${currentExample.title} code`}
                fileName={`${currentExample.id}.ts`}
              />
              <div className="mt-4 flex items-center gap-3">
                <Button onClick={runExample} loading={running} disabled={!proxyConfig}>
                  Run example
                </Button>
                {runError && (
                  <span className="text-sm text-danger">
                    {runError}
                  </span>
                )}
              </div>
              {runOutput && (
                <pre className="mt-4 max-h-[260px] overflow-auto rounded-lg bg-bg border border-border p-4 text-xs text-text-muted leading-relaxed">
                  <code>{runOutput}</code>
                </pre>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function runGeneratedLayerPreview(
  config: SandboxProxyConfig,
): Effect.Effect<GeneratedLayerRunOutput, Error> {
  return Effect.tryPromise({
    try: async () => {
      const sessionResp = await apiFetch("/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
          vault: config.vaultName,
          ttl_seconds: 900,
          label: "effect-playground-generated-layer",
        }),
      });
      if (!sessionResp.ok) {
        throw new Error(await responseError(sessionResp, "Failed to mint sandbox session."));
      }

      const session = (await sessionResp.json()) as {
        readonly token?: string;
        readonly expires_at?: string;
        readonly av_addr?: string;
      };

      const caResp = await apiFetch("/v1/mitm/ca.pem", {
        headers: { Accept: "text/plain" },
      });
      if (!caResp.ok) {
        throw new Error(
          caResp.status === 404
            ? "Agent Vault MITM proxy is disabled for this server."
            : await responseError(caResp, "Failed to read MITM CA certificate."),
        );
      }

      const caCertificate = await caResp.text();
      const mitmPort = caResp.headers.get("X-MITM-Port") || "14322";
      const mitmTls = caResp.headers.get("X-MITM-TLS") === "1";
      const caEnvKeys = [
        "SSL_CERT_FILE",
        "NODE_EXTRA_CA_CERTS",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "GIT_SSL_CAINFO",
        "DENO_CERT",
      ];

      return {
        status: "prepared",
        vaultName: config.vaultName,
        expiresAt: session.expires_at ?? "<server default>",
        certPath: config.certPath,
        session: {
          token: "<redacted>",
          address: session.av_addr || window.location.origin,
        },
        mitm: {
          port: mitmPort,
          tls: mitmTls,
          caCertificate: "<redacted>",
          caCertificateBytes: caCertificate.length,
        },
        proxyEnv: Object.fromEntries(
          proxyEnvKeys.map((key) => [
            key,
            caEnvKeys.includes(key) ? config.certPath : "<redacted>",
          ]),
        ),
        selectedServices: config.selectedServices.map((service) => ({
          name: service.name,
          host: service.host,
          credentialKeys: service.credentialKeys,
        })),
        sentinelEnvKeys: Object.keys(config.sentinelEnv),
        notes: [
          "Minted a real short-lived proxy session.",
          "The session token, proxy URL, and CA PEM were redacted from this output.",
          "serviceNames and credentialKeys are launcher metadata until Agent Vault adds server-enforced session allowlists.",
        ],
      };
    },
    catch: (cause) =>
      cause instanceof Error
        ? cause
        : Object.assign(new Error("Generated layer failed."), { cause }),
  });
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyPanelText({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-4 text-sm text-text-muted">
      {children}
    </div>
  );
}

interface GeneratedLayerRunOutput {
  readonly status: "prepared";
  readonly vaultName: string;
  readonly expiresAt: string;
  readonly certPath: string;
  readonly session: {
    readonly token: "<redacted>";
    readonly address: string;
  };
  readonly mitm: {
    readonly port: string;
    readonly tls: boolean;
    readonly caCertificate: "<redacted>";
    readonly caCertificateBytes: number;
  };
  readonly proxyEnv: Record<string, string>;
  readonly selectedServices: ReadonlyArray<{
    readonly name: string;
    readonly host: string;
    readonly credentialKeys: ReadonlyArray<string>;
  }>;
  readonly sentinelEnvKeys: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

function referencedCredentialKeys(
  services: ReadonlyArray<VaultService>,
  availableKeys: ReadonlyArray<string>,
): string[] {
  const available = new Set(availableKeys);
  return [
    ...new Set(
      services.flatMap((service) =>
        credentialKeysForService(service).filter((key) => available.has(key)),
      ),
    ),
  ].sort();
}

async function responseError(resp: Response, fallback: string) {
  const body = await resp.json().catch(() => ({}));
  if (typeof body.error === "string") {
    return body.error;
  }
  if (typeof body.message === "string") {
    return body.message;
  }
  return fallback;
}

function sanitizeProxyConfig(config: SandboxProxyConfig) {
  return {
    vaultName: config.vaultName,
    sessionEndpoint: config.sessionEndpoint,
    certPath: config.certPath,
    selectedCredentialKeys: config.selectedCredentialKeys,
    selectedServices: config.selectedServices,
    proxyEnv: Object.fromEntries(
      Object.entries(config.proxyEnv).map(([key, value]) => [
        key,
        redactedDisplay(value),
      ]),
    ),
    sentinelEnvKeys: Object.keys(config.sentinelEnv),
    notes: config.notes,
  };
}
