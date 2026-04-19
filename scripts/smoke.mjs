import { parseArgs } from './lib/runtime.mjs';
import { runSmokeChecks } from './lib/smoke.mjs';

const { flags, values } = parseArgs(process.argv.slice(2));
const asJson = flags.has('--json');
const requireRunningApp = flags.has('--strict');
const baseUrl = values[0] || process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';

const report = await runSmokeChecks({
  baseUrl,
  requireRunningApp,
});

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Smoke base URL: ${report.baseUrl}`);
  for (const result of report.results) {
    console.log(`${result.status.toUpperCase()} ${result.name}: ${result.detail}`);
  }
}

if (report.hasFailure) {
  process.exit(1);
}
