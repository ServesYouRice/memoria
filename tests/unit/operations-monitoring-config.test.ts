import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const alerts = readFileSync("monitoring/alerts.yml", "utf8");
const alertTests = readFileSync("monitoring/alert-tests.yml", "utf8");
const prometheus = readFileSync("monitoring/prometheus.yml", "utf8");
const dashboard = readFileSync(
  "monitoring/grafana/dashboards/operations.json",
  "utf8",
);

const requiredAlerts = [
  "MemoriaMetricsTargetDown",
  "MemoriaUnavailable",
  "MemoriaDatabaseUnavailable",
  "MemoriaStorageUnavailable",
  "MemoriaServerErrors",
  "MemoriaRedisSafetyFailure",
  "MemoriaWebSocketRejections",
  "MemoriaOutboxBacklog",
  "MemoriaOutboxDeadLetters",
  "MemoriaOutboxHandlerTimeout",
  "MemoriaOutboxLeaseLoss",
  "MemoriaBackupMissing",
  "MemoriaBackupStale",
  "MemoriaBackupFreshnessCheckFailure",
  "MemoriaAiBudgetWarning",
  "MemoriaAiBudgetExceeded",
];

describe("operations monitoring profile", () => {
  it("scrapes the protected metrics endpoint with a mounted secret", () => {
    expect(prometheus).toContain(
      "credentials_file: /run/secrets/internal_operations_token",
    );
    expect(prometheus).toContain("targets: ['app:3000']");
  });

  it("assigns every critical signal an owner and runbook", () => {
    for (const name of requiredAlerts) {
      const start = alerts.indexOf(`alert: ${name}`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const next = alerts.indexOf("- alert:", start + 1);
      const rule = alerts.slice(start, next === -1 ? undefined : next);
      expect(rule, `${name} owner`).toContain("owner:");
      expect(rule, `${name} runbook`).toContain("runbook_url:");
    }
  });

  it("ships executable alert scenarios and dashboard queries", () => {
    expect(alertTests).toContain("alert_rule_test:");
    expect(alertTests).toContain("MemoriaUnavailable");
    expect(alertTests).toContain("MemoriaBackupMissing");
    expect(alertTests).toContain("MemoriaOutboxDeadLetters");
    const parsed = JSON.parse(dashboard) as {
      panels: Array<{ targets: unknown[] }>;
    };
    expect(parsed.panels.length).toBeGreaterThanOrEqual(8);
    expect(parsed.panels.every((panel) => panel.targets.length > 0)).toBe(true);
  });
});
