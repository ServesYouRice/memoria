import WebSocket from 'ws';

function addResult(results, name, status, detail) {
  results.push({ name, status, detail });
}

function toWebSocketUrl(baseUrl, pathname) {
  const url = new URL(pathname, baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

async function fetchRoute(url, { timeoutMs = 5000 } = {}) {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function checkHtmlRoute(results, baseUrl, pathname, name, timeoutMs) {
  const url = new URL(pathname, baseUrl);

  try {
    const response = await fetchRoute(url, { timeoutMs });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      addResult(results, name, 'fail', `${url.pathname} returned HTTP ${response.status}`);
      return;
    }

    if (!contentType.includes('text/html')) {
      addResult(
        results,
        name,
        'fail',
        `${url.pathname} returned unexpected content-type ${contentType || 'unknown'}`
      );
      return;
    }

    addResult(results, name, 'pass', `${url.pathname} returned HTML`);
  } catch (error) {
    addResult(
      results,
      name,
      'fail',
      error instanceof Error ? error.message : `Failed to fetch ${url.pathname}`
    );
  }
}

async function checkHealthRoute(results, baseUrl, timeoutMs) {
  const url = new URL('/api/health', baseUrl);

  try {
    const response = await fetchRoute(url, { timeoutMs });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      addResult(
        results,
        'health-route',
        'fail',
        typeof payload?.error === 'string'
          ? payload.error
          : `Health route returned HTTP ${response.status}`
      );
      return;
    }

    if (!payload || typeof payload !== 'object') {
      addResult(results, 'health-route', 'fail', 'Health route returned a non-JSON payload');
      return;
    }

    const overallStatus = typeof payload.status === 'string' ? payload.status : 'unknown';
    if (overallStatus === 'ok') {
      addResult(results, 'health-route', 'pass', 'Liveness route reports ok');
      return;
    }

    addResult(results, 'health-route', 'fail', `Health route reports ${overallStatus}`);
  } catch (error) {
    addResult(
      results,
      'health-route',
      'fail',
      error instanceof Error ? error.message : 'Failed to fetch health route'
    );
  }
}

async function checkCollaborationUpgrade(results, baseUrl, timeoutMs) {
  const url = toWebSocketUrl(baseUrl, '/api/collaboration/__smoke_missing_canvas__');

  await new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(url, {
      handshakeTimeout: timeoutMs,
    });

    const finish = (status, detail) => {
      if (settled) {
        return;
      }

      settled = true;
      addResult(results, 'collaboration-ws', status, detail);
      socket.removeAllListeners();
      // terminate() emits asynchronously when an HTTP rejection arrives before
      // the WebSocket reaches OPEN. Keep a no-op listener during cleanup so an
      // expected rejected upgrade cannot crash the smoke runner.
      socket.on('error', () => {});
      socket.terminate();
      resolve();
    };

    socket.once('open', () => {
      finish('fail', 'Collaboration endpoint upgraded a missing-canvas smoke request');
    });

    socket.once('unexpected-response', (_request, response) => {
      const statusCode = response.statusCode ?? 0;
      response.resume();

      if ([400, 401, 403, 404].includes(statusCode)) {
        finish('pass', `Collaboration endpoint handled upgrade with HTTP ${statusCode}`);
        return;
      }

      finish('fail', `Collaboration endpoint returned unexpected HTTP ${statusCode}`);
    });

    socket.once('error', (error) => {
      finish('fail', error instanceof Error ? error.message : 'Collaboration endpoint failed');
    });
  });
}

export async function runSmokeChecks({
  baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000',
  requireRunningApp = false,
  timeoutMs = 5000,
} = {}) {
  const results = [];

  let normalizedBaseUrl;
  try {
    normalizedBaseUrl = new URL(baseUrl).toString();
  } catch {
    addResult(results, 'app-url', 'fail', `Invalid base URL: ${baseUrl}`);
    return { baseUrl, results, hasFailure: true };
  }

  const rootUrl = new URL('/', normalizedBaseUrl);

  try {
    const response = await fetchRoute(rootUrl, { timeoutMs });
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok || !contentType.includes('text/html')) {
      addResult(
        results,
        'app-url',
        'fail',
        `App root returned HTTP ${response.status} with content-type ${contentType || 'unknown'}`
      );
      return { baseUrl: normalizedBaseUrl, results, hasFailure: true };
    }

    addResult(results, 'app-url', 'pass', `App root reachable at ${rootUrl.origin}`);
  } catch (error) {
    addResult(
      results,
      'app-url',
      requireRunningApp ? 'fail' : 'warn',
      error instanceof Error ? error.message : 'App root is unreachable'
    );
    return {
      baseUrl: normalizedBaseUrl,
      results,
      hasFailure: requireRunningApp,
    };
  }

  await checkHealthRoute(results, normalizedBaseUrl, timeoutMs);
  await checkHtmlRoute(results, normalizedBaseUrl, '/', 'home-route', timeoutMs);
  await checkHtmlRoute(results, normalizedBaseUrl, '/auth/login', 'login-route', timeoutMs);
  await checkCollaborationUpgrade(results, normalizedBaseUrl, timeoutMs);

  return {
    baseUrl: normalizedBaseUrl,
    results,
    hasFailure: results.some((entry) => entry.status === 'fail'),
  };
}
