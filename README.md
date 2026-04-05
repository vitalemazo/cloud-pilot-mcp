# cloud-pilot-mcp

MCP server for AI-driven cloud infrastructure management. Exposes two tools — **search** and **execute** — that let AI agents discover and call AWS and Azure APIs through a sandboxed runtime.

## Architecture

```
MCP Client (any MCP-compatible AI agent)
  └── cloud-pilot-mcp server
        ├── search(query)    → discovers API operations from provider specs
        └── execute(code)    → runs JS in sandboxed QuickJS VM
              └── sdk.request({ service, action, params })
                    └── AWS (SigV4) / Azure (Bearer token) — authenticated
```

### Key design principles

- **Two-tool pattern**: Instead of hundreds of tools, the agent discovers what it needs via `search` and calls it via `execute`
- **Pluggable providers**: AWS and Azure today, GCP or others via the same interface
- **Pluggable auth**: Environment variables, HashiCorp Vault, Azure AD — same interface
- **Sandboxed execution**: Agent-generated code runs in a QuickJS WASM sandbox with no filesystem/network access — only a constrained `sdk.request()` bridge
- **Audit everything**: Every search and execution is logged
- **Safety modes**: Read-only, read-write, and full modes with action allowlists and blocklists

## Quick start

```bash
npm install
npm run download-specs   # fetches AWS botocore + Azure OpenAPI specs
npm run dev
```

### Configuration

Copy `.env.example` to `.env` and fill in credentials, or edit `config.yaml`:

```yaml
transport: stdio       # stdio | http
auth:
  type: env            # env | vault | azure-ad
providers:
  - type: aws
    region: us-east-1
    mode: read-only
    allowedServices: [ec2, s3, iam, rds, lambda, ecs, cloudwatch]
  - type: azure
    region: eastus
    mode: read-only
    allowedServices: [compute, storage, network, sql, web, keyvault, monitor, containerservice]
```

### Transports

- **stdio**: MCP client spawns the server as a subprocess (development)
- **Streamable HTTP**: Runs as a persistent service (production)

### MCP client config

```json
{
  "mcpServers": {
    "cloud-pilot": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/path/to/cloud-pilot-mcp"
    }
  }
}
```

## Supported services

### AWS (8 services, via botocore specs)
ec2, s3, iam, rds, lambda, ecs, cloudwatch, sts

### Azure (12 spec files, via OpenAPI)
compute, compute-disks, storage, network, network-lb, network-nsg, sql, web, keyvault, containerservice, monitor, resources

## Project structure

```
src/
├── index.ts                 # Entrypoint — config, wiring, transport
├── server.ts                # MCP server + tool registration
├── config.ts                # Config loader (yaml + env overrides)
├── interfaces/              # Pluggable contracts
│   ├── auth.ts              # AuthProvider interface
│   ├── cloud-provider.ts    # CloudProvider interface
│   └── audit.ts             # AuditLogger interface
├── tools/
│   ├── search.ts            # API spec discovery tool
│   └── execute.ts           # Sandboxed execution tool
├── providers/
│   ├── aws/
│   │   ├── provider.ts      # AWS CloudProvider implementation
│   │   ├── specs.ts         # Botocore spec loader + search index
│   │   └── signer.ts        # AWS SigV4 request signing
│   └── azure/
│       ├── provider.ts      # Azure CloudProvider implementation
│       └── specs.ts         # Azure OpenAPI spec loader + search index
├── auth/
│   ├── env.ts               # Environment variable auth (dev/demo)
│   ├── vault.ts             # HashiCorp Vault auth (AppRole)
│   └── azure-ad.ts          # Azure AD client credentials auth
├── audit/
│   └── file.ts              # File-based audit logger
└── sandbox/
    ├── runtime.ts           # QuickJS WASM sandbox
    └── api-bridge.ts        # sdk.request() bridge injected into sandbox
scripts/
└── download-specs.sh        # Downloads AWS + Azure API spec files
```

## License

MIT
