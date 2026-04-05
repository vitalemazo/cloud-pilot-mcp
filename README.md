# cloud-pilot-mcp

MCP server for AI-driven cloud infrastructure management. Exposes two tools — **search** and **execute** — that let AI agents discover and call cloud provider APIs through a sandboxed runtime.

## Architecture

```
MCP Client (any MCP-compatible AI agent)
  └── cloud-pilot-mcp server
        ├── search(query)    → discovers API operations from provider specs
        └── execute(code)    → runs JS in isolated V8 sandbox
              └── sdk.request({ service, action, params })
                    └── cloud provider SDK (authenticated)
```

### Key design principles

- **Two-tool pattern**: Instead of hundreds of tools, the agent discovers what it needs via `search` and calls it via `execute`
- **Pluggable providers**: AWS today, Azure/GCP via the same interface
- **Pluggable auth**: Environment variables, HashiCorp Vault, Azure AD, AWS IAM — same interface
- **Sandboxed execution**: Agent-generated code runs in an `isolated-vm` V8 isolate with no filesystem/network access — only a constrained `sdk.request()` bridge
- **Audit everything**: Every search and execution is logged
- **Safety modes**: Read-only, read-write, and full modes with action allowlists and blocklists

## Quick start

```bash
npm install
npm run dev
```

### Configuration

Copy `.env.example` to `.env` and fill in credentials, or edit `config.yaml`:

```yaml
transport: stdio       # stdio | http
auth:
  type: env            # env | vault | azure-ad | aws-iam
providers:
  - type: aws
    region: us-east-1
    mode: read-only    # read-only | read-write | full
    allowedServices: [ec2, s3, iam, rds, lambda]
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
│   └── aws/
│       ├── provider.ts      # AWS CloudProvider implementation
│       ├── specs.ts         # Botocore spec loader + search index
│       └── signer.ts        # AWS SigV4 request signing
├── auth/
│   ├── env.ts               # EnvVar auth (dev/demo)
│   └── vault.ts             # HashiCorp Vault auth
├── audit/
│   └── file.ts              # File-based audit logger
└── sandbox/
    ├── runtime.ts           # isolated-vm V8 sandbox
    └── api-bridge.ts        # sdk.request() bridge injected into sandbox
```

## License

MIT
