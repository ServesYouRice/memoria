import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as OtelApi from "@opentelemetry/api";

const sdk = vi.hoisted(() => {
  const tracerShutdown = vi.fn(async () => {});
  const meterShutdown = vi.fn(async () => {});
  return {
    tracerShutdown,
    meterShutdown,
    TracerProvider: vi.fn(function (this: Record<string, unknown>, options) {
      this.options = options;
      this.shutdown = tracerShutdown;
    }),
    MeterProvider: vi.fn(function (this: Record<string, unknown>, options) {
      this.options = options;
      this.shutdown = meterShutdown;
    }),
    OTLPTraceExporter: vi.fn(),
    OTLPMetricExporter: vi.fn(),
    setGlobalTracerProvider: vi.fn(),
    setGlobalMeterProvider: vi.fn(),
    setGlobalContextManager: vi.fn(),
    setGlobalPropagator: vi.fn(),
  };
});

vi.mock("@opentelemetry/api", async (importOriginal) => {
  const actual = await importOriginal<typeof OtelApi>();
  return {
    ...actual,
    trace: {
      ...actual.trace,
      setGlobalTracerProvider: sdk.setGlobalTracerProvider,
    },
    metrics: {
      ...actual.metrics,
      setGlobalMeterProvider: sdk.setGlobalMeterProvider,
    },
    context: {
      ...actual.context,
      setGlobalContextManager: sdk.setGlobalContextManager,
    },
    propagation: {
      ...actual.propagation,
      setGlobalPropagator: sdk.setGlobalPropagator,
    },
  };
});
vi.mock("@opentelemetry/sdk-trace", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TracerProvider: sdk.TracerProvider,
}));
vi.mock("@opentelemetry/sdk-metrics", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MeterProvider: sdk.MeterProvider,
}));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: sdk.OTLPTraceExporter,
}));
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
  OTLPMetricExporter: sdk.OTLPMetricExporter,
}));

const telemetryGlobal = globalThis as { __memoriaTelemetry?: unknown };

describe("OpenTelemetry export (IMP-151)", () => {
  beforeEach(() => {
    delete telemetryGlobal.__memoriaTelemetry;
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete telemetryGlobal.__memoriaTelemetry;
    vi.unstubAllEnvs();
  });

  it("is off by default: no endpoint, no SDK, no exporter", async () => {
    const { startTelemetry, otlpEndpoint } =
      await import("@/lib/telemetry/otel");
    expect(otlpEndpoint({})).toBeNull();
    expect(otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "  " })).toBeNull();
    await expect(startTelemetry("memoria-web", {})).resolves.toBeNull();
    expect(sdk.TracerProvider).not.toHaveBeenCalled();
    expect(sdk.MeterProvider).not.toHaveBeenCalled();
    expect(sdk.OTLPTraceExporter).not.toHaveBeenCalled();
    expect(sdk.setGlobalTracerProvider).not.toHaveBeenCalled();
  });

  it("exports traces and metrics over OTLP when an endpoint is set", async () => {
    const { startTelemetry, shutdownTelemetry } =
      await import("@/lib/telemetry/otel");
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      SENTRY_ENVIRONMENT: "staging",
    };
    const handle = await startTelemetry("memoria-sync", env);

    expect(handle?.serviceName).toBe("memoria-sync");
    expect(sdk.OTLPTraceExporter).toHaveBeenCalledTimes(1);
    expect(sdk.OTLPMetricExporter).toHaveBeenCalledTimes(1);
    expect(sdk.setGlobalTracerProvider).toHaveBeenCalledTimes(1);
    expect(sdk.setGlobalMeterProvider).toHaveBeenCalledTimes(1);
    expect(sdk.setGlobalContextManager).toHaveBeenCalledTimes(1);

    const options = sdk.TracerProvider.mock.calls[0]?.[0] as {
      resource: { attributes: Record<string, unknown> };
    };
    expect(options.resource.attributes["service.name"]).toBe("memoria-sync");
    expect(options.resource.attributes["deployment.environment.name"]).toBe(
      "staging",
    );

    // A second start in the same process reuses the first.
    await expect(startTelemetry("memoria-web", env)).resolves.toBe(handle);
    expect(sdk.TracerProvider).toHaveBeenCalledTimes(1);

    await shutdownTelemetry();
    expect(sdk.tracerShutdown).toHaveBeenCalledTimes(1);
    expect(sdk.meterShutdown).toHaveBeenCalledTimes(1);
  });

  it("lets OTEL_SERVICE_NAME override the process default", async () => {
    vi.stubEnv("OTEL_SERVICE_NAME", "memoria-web-staging");
    const { startTelemetry } = await import("@/lib/telemetry/otel");
    await startTelemetry("memoria-web", {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
    });
    const options = sdk.TracerProvider.mock.calls[0]?.[0] as {
      resource: { attributes: Record<string, unknown> };
    };
    expect(options.resource.attributes["service.name"]).toBe(
      "memoria-web-staging",
    );
  });

  it("is started with its own service name by every process", () => {
    const instrumentation = readFileSync("src/instrumentation.ts", "utf8");
    expect(instrumentation).toContain('startTelemetry("memoria-web")');
    expect(instrumentation).toContain(
      "if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT)",
    );
    expect(readFileSync("scripts/sync-server.ts", "utf8")).toContain(
      'await startTelemetry("memoria-sync")',
    );
    expect(readFileSync("scripts/outbox-worker.ts", "utf8")).toContain(
      'await startTelemetry("memoria-worker")',
    );
    // With OTLP on, Memoria's provider owns tracing instead of Sentry's.
    expect(readFileSync("sentry.server.config.ts", "utf8")).toContain(
      "enableOpenTelemetrySetup: !process.env.OTEL_EXPORTER_OTLP_ENDPOINT",
    );
  });
});
