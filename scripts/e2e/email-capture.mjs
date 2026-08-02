import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8025);
const token = process.env.E2E_EMAIL_CAPTURE_TOKEN;
const sendgridKey = process.env.SENDGRID_API_KEY;

if (!token || token.length < 24) {
  throw new Error('E2E_EMAIL_CAPTURE_TOKEN of at least 24 characters is required.');
}
if (!sendgridKey) {
  throw new Error('SENDGRID_API_KEY is required by the capture service.');
}

const messages = [];

function equalSecret(left, right) {
  if (!left || !right) return false;
  const expected = Buffer.from(left);
  const actual = Buffer.from(right);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Email payload is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { status: 'ok' });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v3/mail/send') {
    const authorization = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!equalSecret(sendgridKey, authorization)) {
      json(response, 401, { error: 'unauthorized' });
      return;
    }
    try {
      const payload = await readJson(request);
      const personalization = payload.personalizations?.[0] || {};
      const content = Array.isArray(payload.content) ? payload.content : [];
      messages.push({
        id: randomUUID(),
        to: (personalization.to || []).map((recipient) => recipient.email),
        subject: payload.subject || '',
        text: content.find((part) => part.type === 'text/plain')?.value || '',
        html: content.find((part) => part.type === 'text/html')?.value || '',
        deliveryId: personalization.custom_args?.memoria_delivery_id || null,
        receivedAt: new Date().toISOString(),
      });
      response.writeHead(202);
      response.end();
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : 'invalid payload',
      });
    }
    return;
  }

  const suppliedToken = request.headers['x-e2e-token'];
  if (!equalSecret(token, Array.isArray(suppliedToken) ? suppliedToken[0] : suppliedToken)) {
    json(response, 404, { status: 'not_found' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/messages') {
    const recipient = url.searchParams.get('to')?.toLowerCase();
    const subject = url.searchParams.get('subject')?.toLowerCase();
    const filtered = messages.filter(
      (message) =>
        (!recipient || message.to.some((email) => email.toLowerCase() === recipient)) &&
        (!subject || message.subject.toLowerCase().includes(subject)),
    );
    json(response, 200, { messages: filtered });
    return;
  }

  if (request.method === 'DELETE' && url.pathname === '/messages') {
    messages.length = 0;
    json(response, 200, { cleared: true });
    return;
  }

  json(response, 404, { status: 'not_found' });
});

const shutdown = () => server.close(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

server.listen(port, '0.0.0.0', () => {
  console.log(`E2E email capture listening on ${port}`);
});
