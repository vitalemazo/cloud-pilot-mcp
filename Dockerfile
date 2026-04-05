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
COPY specs/ specs/

ENV NODE_ENV=production
ENV TRANSPORT=http
ENV HTTP_HOST=0.0.0.0
ENV HTTP_PORT=8400

EXPOSE 8400

CMD ["node", "dist/index.js"]
