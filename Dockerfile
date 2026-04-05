FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-slim

WORKDIR /app
COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY package.json ./
COPY config.yaml ./
COPY data/ data/
COPY specs/ specs/

ENV NODE_ENV=production
ENV TRANSPORT=http
ENV HTTP_HOST=0.0.0.0
ENV HTTP_PORT=8400
ENV CLOUD_PILOT_SPECS_DYNAMIC=true

EXPOSE 8400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8400/mcp').then(r => process.exit(r.ok || r.status === 405 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
