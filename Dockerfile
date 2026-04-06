FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-slim

# Install OpenTofu for infrastructure-as-code lifecycle management.
# Only installed when INSTALL_TOFU=true build arg is set (opt-in).
ARG INSTALL_TOFU=true
RUN if [ "$INSTALL_TOFU" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends curl unzip && \
      ARCH=$(dpkg --print-architecture) && \
      TOFU_VERSION="1.9.0" && \
      curl -fsSL "https://github.com/opentofu/opentofu/releases/download/v${TOFU_VERSION}/tofu_${TOFU_VERSION}_linux_${ARCH}.zip" -o /tmp/tofu.zip && \
      unzip /tmp/tofu.zip -d /usr/local/bin tofu && \
      rm /tmp/tofu.zip && \
      chmod +x /usr/local/bin/tofu && \
      apt-get purge -y curl unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app
COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY package.json ./
COPY config.yaml.example config.yaml
COPY data/ data/

ENV NODE_ENV=production
ENV TRANSPORT=http
ENV HTTP_HOST=0.0.0.0
ENV HTTP_PORT=8400
ENV CLOUD_PILOT_SPECS_DYNAMIC=true

EXPOSE 8400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8400/mcp').then(r => process.exit(r.ok || r.status === 405 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
