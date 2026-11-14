/**
 * IMP-151 — spans and metrics through the OpenTelemetry API.
 *
 * The API is a no-op until `startTelemetry` registers a provider, so these
 * helpers cost almost nothing when OTLP export is off. Attributes carry
 * kinds and counts, never canvas, user or job ids.
 *
 * @module lib/telemetry/tracing
 */

import {
  SpanStatusCode,
  metrics,
  trace,
  type Attributes,
  type Counter,
  type Meter,
} from "@opentelemetry/api";

const INSTRUMENTATION_NAME = "memoria";

/** Run `fn` inside an active span that records its error, if any. */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  return trace
    .getTracer(INSTRUMENTATION_NAME)
    .startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await fn();
      } catch (error) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
}

let counterMeter: Meter | undefined;
const counters = new Map<string, Counter>();

/**
 * Add to a monotonic OpenTelemetry counter. The meter is looked up on each
 * call because one taken before the provider is registered stays a no-op.
 */
export function addCounter(name: string, amount: number): void {
  const meter = metrics.getMeter(INSTRUMENTATION_NAME);
  if (meter !== counterMeter) {
    counterMeter = meter;
    counters.clear();
  }
  let counter = counters.get(name);
  if (!counter) {
    counter = meter.createCounter(name);
    counters.set(name, counter);
  }
  counter.add(amount);
}
