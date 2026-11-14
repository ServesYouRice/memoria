/**
 * IMP-151 — OpenTelemetry traces and metrics over OTLP/HTTP.
 *
 * Off by default: nothing loads unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
 * Each process starts it once with its own service name (`memoria-web` from
 * Next's `instrumentation.ts`, `memoria-sync` and `memoria-worker` from their
 * entrypoints). The OTLP exporters read the standard `OTEL_EXPORTER_OTLP_*`
 * variables themselves (endpoint, per-signal endpoints, headers), and
 * `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES` override the resource.
 *
 * Only the API is imported statically; the SDK and exporters load lazily, so
 * a process without an endpoint never loads them. The handle lives on
 * `globalThis`, because `server.ts` and Next's instrumentation bundle are
 * separate module graphs in one process.
 *
 * @module lib/telemetry/otel
 */

export type TelemetryService =
  "memoria-web" | "memoria-sync" | "memoria-worker" | "memoria-capture";

export interface TelemetryHandle {
  serviceName: string;
  shutdown: () => Promise<void>;
}

type TelemetryEnv = Record<string, string | undefined>;

const telemetryGlobal = globalThis as typeof globalThis & {
  __memoriaTelemetry?: Promise<TelemetryHandle | null>;
};

/** Longest a graceful shutdown waits for the last export. */
const SHUTDOWN_FLUSH_MS = 5_000;

/** The OTLP base endpoint, or null when export is switched off. */
export function otlpEndpoint(env: TelemetryEnv = process.env): string | null {
  const value = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return value ? value : null;
}

/** Parent-based ratio sampling; `OTEL_TRACES_SAMPLER_ARG` sets the ratio. */
function samplerRatio(env: TelemetryEnv): number {
  const ratio = Number(env.OTEL_TRACES_SAMPLER_ARG);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 1;
}

async function start(
  serviceName: TelemetryService,
  env: TelemetryEnv,
): Promise<TelemetryHandle> {
  const [
    api,
    { AsyncLocalStorageContextManager },
    { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator },
    resources,
    sdkTrace,
    { OTLPTraceExporter },
    { MeterProvider, PeriodicExportingMetricReader },
    { OTLPMetricExporter },
  ] = await Promise.all([
    import("@opentelemetry/api"),
    import("@opentelemetry/context-async-hooks"),
    import("@opentelemetry/core"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/sdk-trace"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
  ]);

  const resource = resources
    .defaultResource()
    .merge(
      resources.resourceFromAttributes({
        "service.name": serviceName,
        ...(env.SENTRY_RELEASE
          ? { "service.version": env.SENTRY_RELEASE }
          : {}),
        ...(env.SENTRY_ENVIRONMENT
          ? { "deployment.environment.name": env.SENTRY_ENVIRONMENT }
          : {}),
      }),
    )
    // OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES win over the defaults.
    .merge(resources.detectResources({ detectors: [resources.envDetector] }));

  const tracerProvider = new sdkTrace.TracerProvider({
    resource,
    sampler: new sdkTrace.ParentBasedSampler({
      root: new sdkTrace.TraceIdRatioBasedSampler(samplerRatio(env)),
    }),
    spanProcessors: [
      new sdkTrace.BatchSpanProcessor({ exporter: new OTLPTraceExporter() }),
    ],
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 60_000,
      }),
    ],
  });

  api.context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  api.propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  );
  api.trace.setGlobalTracerProvider(tracerProvider);
  api.metrics.setGlobalMeterProvider(meterProvider);

  return {
    serviceName,
    shutdown: async () => {
      // Flush what is buffered; an unreachable collector must not hold
      // shutdown, so failures are swallowed and the wait is capped.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([
          tracerProvider.shutdown(),
          meterProvider.shutdown(),
        ]),
        new Promise((resolve) => {
          timer = setTimeout(resolve, SHUTDOWN_FLUSH_MS);
          timer.unref?.();
        }),
      ]);
      clearTimeout(timer);
    },
  };
}

/**
 * Start OTLP export for this process when an endpoint is configured.
 * Resolves to null (and loads no SDK code) when it is not. Safe to call more
 * than once: later calls return the first handle.
 */
export function startTelemetry(
  serviceName: TelemetryService,
  env: TelemetryEnv = process.env,
): Promise<TelemetryHandle | null> {
  if (!otlpEndpoint(env)) return Promise.resolve(null);
  telemetryGlobal.__memoriaTelemetry ??= start(serviceName, env).catch(
    (error: unknown) => {
      // Telemetry must never stop the process from serving.
      console.error("OpenTelemetry could not start", error);
      return null;
    },
  );
  return telemetryGlobal.__memoriaTelemetry;
}

/** Flush and stop the process's exporters, if any were started. */
export async function shutdownTelemetry(): Promise<void> {
  const handle = await telemetryGlobal.__memoriaTelemetry;
  await handle?.shutdown();
}
