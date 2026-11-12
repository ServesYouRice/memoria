import WebSocket from "ws";

const SYNC_PATH = "/api/collaboration/sync";

/**
 * Open the document-sync socket through the public address, with the same
 * Origin a browser sends (IMP-100). Opening is enough: authentication comes
 * after, so a refusal before `open` means a proxy, address or origin problem.
 *
 * @param {string} url where to connect
 * @param {{ timeoutMs?: number; origin?: string }} [options] `origin`: the
 *   public address (AUTH_URL) when connecting to a local port directly
 * @returns {Promise<{ ok: boolean; url: string; reason?: string }>}
 */
export function probeLiveConnection(target, { timeoutMs = 5000, origin } = {}) {
  const targetOrigin = new URL(target).origin;
  const sendOrigin = origin ? new URL(origin).origin : targetOrigin;
  const url = `${targetOrigin.replace(/^http/, "ws")}${SYNC_PATH}`;
  return new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(url, { headers: { Origin: sendOrigin } });
    const finish = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.terminate();
      resolve(ok ? { ok, url } : { ok, url, reason });
    };
    const timer = setTimeout(
      () => finish(false, "No answer in time"),
      timeoutMs,
    );
    socket.on("open", () => finish(true));
    socket.on("unexpected-response", (_request, response) =>
      finish(
        false,
        `The server answered HTTP ${response.statusCode} instead of opening a live connection`,
      ),
    );
    socket.on("error", (error) =>
      finish(false, error.message || "Connection failed"),
    );
  });
}
