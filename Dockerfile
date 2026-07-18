FROM node:26.5.0-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Hermetic, non-secret values used only while compiling route modules. Runtime
# configuration is injected by Compose and is not copied from this stage.
ENV NODE_ENV=production \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_URL=http://localhost:3000 \
    AUTH_SECRET=build-auth-secret-0123456789-abcdef \
    REDIS_URL=redis://localhost:6379 \
    APP_BOOTSTRAP_TOKEN=build-bootstrap-token-123456789 \
    MODEL_CREDENTIAL_ENCRYPTION_KEY=build-model-key-abcdef-0123456789 \
    EMAIL_PROVIDER=sendgrid \
    SENDGRID_API_KEY=build-sendgrid-key \
    UPLOAD_STORAGE=s3 \
    S3_BUCKET=build \
    S3_REGION=us-east-1 \
    S3_ENDPOINT=http://localhost:9000 \
    S3_ACCESS_KEY_ID=build \
    S3_SECRET_ACCESS_KEY=build-secret

RUN pnpm db:generate && pnpm build && pnpm prune --prod

FROM node:26.5.0-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && addgroup -S memoria && adduser -S memoria -G memoria

COPY --from=build --chown=memoria:memoria /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=memoria:memoria /app/node_modules ./node_modules
COPY --from=build --chown=memoria:memoria /app/.next ./.next
COPY --from=build --chown=memoria:memoria /app/dist ./dist
COPY --from=build --chown=memoria:memoria /app/public ./public
COPY --from=build --chown=memoria:memoria /app/prisma ./prisma
COPY --from=build --chown=memoria:memoria /app/scripts ./scripts

USER memoria
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && exec node scripts/start-server.mjs"]
