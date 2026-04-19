FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production

RUN pnpm db:generate && pnpm build

EXPOSE 3000

CMD ["node", "scripts/start-server.mjs"]
