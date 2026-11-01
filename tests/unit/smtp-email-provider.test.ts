/**
 * SMTP email provider (IMP-054).
 *
 * The provider talks to a real local SMTP server built with smtp-server. The
 * server records envelopes, messages and AUTH attempts, and its TLS listener
 * uses a self-signed certificate generated for the run. Nothing leaves
 * loopback.
 */

import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { createServer, type Server, type Socket } from "net";
import { tmpdir } from "os";
import path from "path";
import { SMTPServer, type SMTPServerSession } from "smtp-server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SMTPEmailProvider } from "@/lib/email/providers/smtp";
import { EmailDeliveryError } from "@/lib/email/types";

vi.mock("@/lib/logger", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: log, createLogger: () => log };
});

const USER = "mailer";
const PASS = "correct-horse-battery";

const message = {
  to: { email: "owner@example.com" },
  subject: "Capture test",
  text: "Plain body line",
  html: "<p>HTML body line</p>",
};

interface CapturedMessage {
  mailFrom: string | undefined;
  rcptTo: string[];
  raw: string;
  secure: boolean;
  user: string | undefined;
}

interface CaptureServer {
  port: number;
  messages: CapturedMessage[];
  authAttempts: string[];
  replyCode: { value: number | undefined };
  close(): Promise<void>;
}

let tlsDir: string;
let certPem: string;
let keyPem: string;

beforeAll(() => {
  tlsDir = mkdtempSync(path.join(tmpdir(), "memoria-smtp-test-"));
  const keyPath = path.join(tlsDir, "key.pem");
  const certPath = path.join(tlsDir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "2",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  keyPem = readFileSync(keyPath, "utf8");
  certPem = readFileSync(certPath, "utf8");
});

afterAll(() => {
  rmSync(tlsDir, { recursive: true, force: true });
});

const openServers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()!();
  }
});

/**
 * Plain servers hide and disable STARTTLS. Otherwise smtp-server falls back to
 * a bundled localhost certificate that has expired: an opportunistic upgrade
 * fails on the certificate before the behavior under test runs, and a
 * requireTLS client still sends STARTTLS even when it is not advertised.
 */
async function startCaptureServer(
  options: { tls?: boolean; implicitTls?: boolean } = {},
): Promise<CaptureServer> {
  const messages: CapturedMessage[] = [];
  const authAttempts: string[] = [];
  const replyCode: { value: number | undefined } = { value: undefined };
  const encrypted = Boolean(options.tls || options.implicitTls);

  const server = new SMTPServer({
    logger: false,
    authOptional: false,
    allowInsecureAuth: !encrypted,
    secure: Boolean(options.implicitTls),
    ...(encrypted
      ? { key: keyPem, cert: certPem }
      : { hideSTARTTLS: true, disabledCommands: ["STARTTLS"] }),
    onAuth(auth, _session, callback) {
      authAttempts.push(auth.username);
      if (auth.username === USER && auth.password === PASS) {
        callback(null, { user: auth.username });
      } else {
        callback(new Error("Invalid username or password"));
      }
    },
    onMailFrom(_address, _session, callback) {
      if (replyCode.value !== undefined) {
        const error = new Error(`Rejected with ${replyCode.value}`) as Error & {
          responseCode?: number;
        };
        error.responseCode = replyCode.value;
        callback(error);
        return;
      }
      callback();
    },
    onData(stream, session: SMTPServerSession, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        messages.push({
          mailFrom: session.envelope.mailFrom
            ? session.envelope.mailFrom.address
            : undefined,
          rcptTo: session.envelope.rcptTo.map((recipient) => recipient.address),
          raw: Buffer.concat(chunks).toString("utf8"),
          secure: session.secure,
          user: session.user,
        });
        callback(null, "queued");
      });
    },
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const capture: CaptureServer = {
    port,
    messages,
    authAttempts,
    replyCode,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
  openServers.push(capture.close);
  return capture;
}

/** A TCP listener that accepts connections and never speaks SMTP. */
async function startSilentServer(): Promise<{
  port: number;
  close(): Promise<void>;
}> {
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const close = () =>
    new Promise<void>((resolve) => {
      sockets.forEach((socket) => socket.destroy());
      server.close(() => resolve());
    });
  openServers.push(close);
  return { port, close };
}

function providerFor(
  port: number,
  overrides: {
    secure?: boolean;
    requireTLS?: boolean;
    transport?: ConstructorParameters<typeof SMTPEmailProvider>[1];
  } = {},
): SMTPEmailProvider {
  return new SMTPEmailProvider(
    {
      host: "127.0.0.1",
      port,
      secure: overrides.secure ?? false,
      requireTLS: overrides.requireTLS ?? false,
      auth: { user: USER, pass: PASS },
    },
    overrides.transport,
  );
}

describe("SMTPEmailProvider", () => {
  it("delivers a multipart message with AUTH in a non-production runtime", async () => {
    const server = await startCaptureServer();
    const provider = providerFor(server.port);

    await provider.send({
      ...message,
      from: { email: "noreply@memoria.test", name: "Memoria" },
      replyTo: { email: "support@memoria.test" },
      attachments: [{ filename: "note.txt", content: "attached text" }],
    });

    expect(server.authAttempts).toEqual([USER]);
    expect(server.messages).toHaveLength(1);
    const [delivered] = server.messages;
    expect(delivered.mailFrom).toBe("noreply@memoria.test");
    expect(delivered.rcptTo).toEqual(["owner@example.com"]);
    expect(delivered.user).toBe(USER);
    expect(delivered.raw).toContain("Subject: Capture test");
    expect(delivered.raw).toContain("From: Memoria <noreply@memoria.test>");
    expect(delivered.raw).toContain("Reply-To: support@memoria.test");
    expect(delivered.raw).toContain("Plain body line");
    expect(delivered.raw).toContain("filename=note.txt");
    expect(delivered.raw).toContain(
      Buffer.from("attached text").toString("base64"),
    );
  });

  it("refuses to send in production when the server offers no STARTTLS", async () => {
    const server = await startCaptureServer();
    const provider = providerFor(server.port, { requireTLS: true });

    const error = await provider
      .send({ ...message, from: { email: "noreply@memoria.test" } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).message).toMatch(/STARTTLS|TLS/);
    expect((error as EmailDeliveryError).retryable).toBe(false);
    expect(server.authAttempts).toEqual([]);
    expect(server.messages).toEqual([]);
  });

  it("upgrades with STARTTLS and authenticates over TLS when TLS is required", async () => {
    const server = await startCaptureServer({ tls: true });
    const provider = providerFor(server.port, {
      requireTLS: true,
      transport: { tls: { minVersion: "TLSv1.2", ca: [certPem] } },
    });

    await provider.send({
      ...message,
      from: { email: "noreply@memoria.test" },
    });

    expect(server.authAttempts).toEqual([USER]);
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0].secure).toBe(true);
  });

  it("delivers over implicit TLS when secure is set", async () => {
    const server = await startCaptureServer({ implicitTls: true });
    const provider = providerFor(server.port, {
      secure: true,
      requireTLS: true,
      transport: { tls: { minVersion: "TLSv1.2", ca: [certPem] } },
    });

    await provider.send({
      ...message,
      from: { email: "noreply@memoria.test" },
    });

    expect(server.messages).toHaveLength(1);
    expect(server.messages[0].secure).toBe(true);
  });

  it("rejects a server certificate that is not trusted", async () => {
    const server = await startCaptureServer({ tls: true });
    const provider = providerFor(server.port, { requireTLS: true });

    const error = await provider
      .send({ ...message, from: { email: "noreply@memoria.test" } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).message).toMatch(/CERT|self-signed/);
    expect((error as EmailDeliveryError).retryable).toBe(false);
    expect(server.messages).toEqual([]);
    expect(server.authAttempts).toEqual([]);
  });

  it("reports rejected credentials as a non-retryable delivery error", async () => {
    const server = await startCaptureServer();
    const provider = new SMTPEmailProvider({
      host: "127.0.0.1",
      port: server.port,
      secure: false,
      requireTLS: false,
      auth: { user: USER, pass: "wrong-password" },
    });

    const error = await provider
      .send({ ...message, from: { email: "noreply@memoria.test" } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).message).toContain("EAUTH");
    expect((error as EmailDeliveryError).retryable).toBe(false);
    expect(server.messages).toEqual([]);
    expect(await provider.verify()).toBe(false);
  });

  it("verifies the connection and credentials", async () => {
    const server = await startCaptureServer();

    await expect(providerFor(server.port).verify()).resolves.toBe(true);
  });

  it("classifies a 4xx reply as retryable and a 5xx reply as permanent", async () => {
    const server = await startCaptureServer();
    const provider = providerFor(server.port);
    const sendMessage = { ...message, from: { email: "noreply@memoria.test" } };

    server.replyCode.value = 451;
    const transient = await provider
      .send(sendMessage)
      .catch((caught: unknown) => caught);
    expect(transient).toBeInstanceOf(EmailDeliveryError);
    expect((transient as EmailDeliveryError).status).toBe(451);
    expect((transient as EmailDeliveryError).retryable).toBe(true);

    server.replyCode.value = 550;
    const permanent = await provider
      .send(sendMessage)
      .catch((caught: unknown) => caught);
    expect(permanent).toBeInstanceOf(EmailDeliveryError);
    expect((permanent as EmailDeliveryError).status).toBe(550);
    expect((permanent as EmailDeliveryError).retryable).toBe(false);
    expect(server.messages).toEqual([]);
  });

  it("bounds a server that never greets with the greeting timeout", async () => {
    const silent = await startSilentServer();
    const provider = providerFor(silent.port, {
      transport: { connectionTimeout: 2000, greetingTimeout: 200 },
    });

    const started = Date.now();
    const error = await provider
      .send({ ...message, from: { email: "noreply@memoria.test" } })
      .catch((caught: unknown) => caught);

    expect(Date.now() - started).toBeLessThan(2000);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).message).toContain("ETIMEDOUT");
    expect((error as EmailDeliveryError).retryable).toBe(true);
  });

  it("aborts an in-flight send when the caller's signal fires", async () => {
    const silent = await startSilentServer();
    const provider = providerFor(silent.port, {
      transport: { greetingTimeout: 30_000, connectionTimeout: 30_000 },
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("lease expired")), 50);

    const started = Date.now();
    const error = await provider
      .send({
        ...message,
        from: { email: "noreply@memoria.test" },
        signal: controller.signal,
      })
      .catch((caught: unknown) => caught);

    expect(Date.now() - started).toBeLessThan(5000);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EmailDeliveryError);
    expect((error as Error).message).toBe("lease expired");
  });
});

describe("sendEmail wiring for EMAIL_PROVIDER=smtp", () => {
  const envKeys = [
    "NODE_ENV",
    "EMAIL_PROVIDER",
    "EMAIL_FROM",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    vi.resetModules();
  });

  function configureSmtp(port: number, nodeEnv: string) {
    process.env.NODE_ENV = nodeEnv;
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.EMAIL_FROM = "noreply@memoria.test";
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_USER = USER;
    process.env.SMTP_PASS = PASS;
  }

  it("delivers through the configured SMTP server outside production", async () => {
    const server = await startCaptureServer();
    configureSmtp(server.port, "test");
    const { sendEmail } = await import("@/lib/email");

    await sendEmail({
      to: { email: "owner@example.com" },
      subject: "Wired",
      text: "wired body",
    });

    expect(server.messages).toHaveLength(1);
    expect(server.messages[0].mailFrom).toBe("noreply@memoria.test");
    expect(server.messages[0].raw).toContain("Subject: Wired");
  });

  it("refuses plaintext SMTP in production before any credentials are sent", async () => {
    const server = await startCaptureServer();
    configureSmtp(server.port, "production");
    const { sendEmail } = await import("@/lib/email");
    const { EmailDeliveryError: DeliveryError } =
      await import("@/lib/email/types");

    const error = await sendEmail({
      to: { email: "owner@example.com" },
      subject: "Wired",
      text: "wired body",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DeliveryError);
    expect((error as EmailDeliveryError).retryable).toBe(false);
    expect(server.authAttempts).toEqual([]);
    expect(server.messages).toEqual([]);
  });
});
