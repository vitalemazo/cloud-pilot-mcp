# cloud-pilot-mcp

An MCP server that gives AI agents the ability to control AWS and Azure cloud infrastructure through natural language. Instead of building hundreds of individual tools, it exposes just two — **search** and **execute** — that together cover the entire API surface of both cloud providers: **421 AWS services** and **240+ Azure resource providers**, discovered and fetched dynamically at runtime.

## The Problem

Cloud providers expose thousands of API operations across hundreds of services. Traditional approaches to AI-driven cloud management either:

- **Hard-code a handful of tools** (e.g., "list EC2 instances", "create S3 bucket") — limiting what the agent can do to what the developer anticipated
- **Generate hundreds of MCP tools** from API specs — overwhelming the agent's context window and making tool selection unreliable
- **Require manual updates** every time a cloud provider launches a new service

cloud-pilot-mcp solves this with a **search-and-execute pattern**: the agent discovers what it needs at runtime, then calls it through a sandboxed execution environment. No pre-built tools, no fixed service list, no manual updates.

## How It Works

```
You: "Set up a Transit Gateway connecting three VPCs across us-east-1 and eu-west-1"

Agent → search("create transit gateway", provider: "aws")
      ← Returns: CreateTransitGateway, CreateTransitGatewayVpcAttachment,
                 CreateTransitGatewayRouteTable... with full parameter schemas

Agent → execute(provider: "aws", code: `
          const tgw = await sdk.request({
            service: "ec2",
            action: "CreateTransitGateway",
            params: { Description: "Multi-region hub", Options: { AmazonSideAsn: 64512 } }
          });
          console.log(tgw);
        `)
      ← Returns: Transit Gateway ID, state, creation details
```

The agent reasons about what APIs exist, plans the sequence, and executes — all within the conversation.

## Architecture

```
                    MCP Protocol (stdio or Streamable HTTP)
                              │
                    ┌─────────▼──────────┐
                    │  cloud-pilot-mcp   │
                    │                    │
                    │  ┌──────────────┐  │
                    │  │   search     │  │  "What APIs exist for X?"
                    │  │              │  │  Searches 18,000+ AWS operations
                    │  │  Tier 1: Service catalog (421 AWS, 240 Azure)
                    │  │  Tier 2: Operation index (keyword match)
                    │  │  Tier 3: Full spec hydration (params, output)
                    │  └──────────────┘  │
                    │                    │
                    │  ┌──────────────┐  │
                    │  │   execute    │  │  "Call this API with these params"
                    │  │              │  │
                    │  │  QuickJS sandbox (no fs/net access)
                    │  │    └─ sdk.request() bridge
                    │  │         ├─ AWS: SigV4 signed request
                    │  │         └─ Azure: Bearer token + ARM REST
                    │  └──────────────┘  │
                    │                    │
                    │  ┌──────────────┐  │
                    │  │  Safety      │  │  Allowlists, blocklists,
                    │  │  + Audit     │  │  read-only mode, dry-run,
                    │  │              │  │  every call logged to audit trail
                    │  └──────────────┘  │
                    └────────────────────┘
                        │           │
              ┌─────────▼┐    ┌────▼──────────┐
              │   AWS    │    │    Azure      │
              │ SigV4    │    │ OAuth2/Bearer │
              │ 421 svcs │    │ 240+ providers│
              └──────────┘    └───────────────┘
```

## Real-World Use Cases

### Deploy an Azure Landing Zone
An agent can discover and orchestrate calls across 15+ Azure resource providers in a single conversation:
- `Microsoft.Management` — create management group hierarchy
- `Microsoft.Authorization` — assign RBAC roles and Azure Policies
- `Microsoft.Network` — deploy hub VNet, Azure Firewall, VPN Gateway
- `Microsoft.Security` — enable Defender for Cloud
- `Microsoft.Insights` — configure diagnostic settings and alerts
- `Microsoft.KeyVault` — provision Key Vault with access policies

The agent searches for each operation it needs, builds the dependency graph, and executes in order.

### Build a Global WAN on AWS
Create a multi-region Transit Gateway mesh with Direct Connect:
- `ec2:CreateTransitGateway` — hub in each region
- `ec2:CreateTransitGatewayPeeringAttachment` — cross-region peering
- `directconnect:CreateConnection` — on-premises connectivity
- `networkmanager:CreateGlobalNetwork` — unified management
- `route53:CreateHostedZone` — DNS for the mesh

All 84 Transit Gateway operations and all Direct Connect operations are discoverable without pre-configuration.

### Incident Response Automation
An agent investigating a security incident can dynamically discover and call:
- `guardduty:ListFindings` — pull active threats
- `cloudtrail:LookupEvents` — trace the activity
- `ec2:DescribeSecurityGroups` — check exposed ports
- `iam:ListAccessKeys` — find compromised credentials
- `ec2:RevokeSecurityGroupIngress` — close the hole (when `mode: read-write`)

### Cost Analysis and Optimization
- `ce:GetCostAndUsage` — pull spend data
- `ec2:DescribeInstances` — find idle resources
- `rds:DescribeDBInstances` — check oversized databases
- `compute:VirtualMachines_ListAll` — Azure VM inventory
- `advisor:Recommendations_List` — Azure Advisor suggestions

## Dynamic API Discovery

The server doesn't ship with a static list of supported operations. It discovers them at runtime using a three-tier system:

### Tier 1: Service Catalog
On startup (or when the 7-day cache expires), the server fetches the complete service list from the source repos via the GitHub Git Trees API:
- **AWS**: [boto/botocore](https://github.com/boto/botocore) — 421 services
- **Azure**: [Azure/azure-rest-api-specs](https://github.com/Azure/azure-rest-api-specs) — 240+ resource providers

This is 1-2 API calls total. The catalog is cached to disk and also ships as a bundled fallback for offline use.

### Tier 2: Operation Index
A keyword-searchable index of every operation across all services:
- **AWS**: 18,000+ operations (e.g., `CreateTransitGateway`, `DescribeInstances`, `PutBucketPolicy`)
- **Azure**: 3,000+ operations (e.g., `VirtualMachines_CreateOrUpdate`, `PolicyAssignments_Create`)

Built progressively — pre-downloaded specs are indexed immediately, remaining services are fetched from CDN in the background. Once built (~2-5 minutes on first run), the index is cached to disk and loads instantly on subsequent startups.

### Tier 3: Full Specs
Complete API specifications with parameter schemas, response types, and documentation. Fetched on demand when a search match needs hydration:
- **AWS**: from [jsDelivr CDN](https://cdn.jsdelivr.net) (no rate limits)
- **Azure**: from raw.githubusercontent.com (CDN-backed)

Cached to disk (30-day TTL) and held in an LRU memory cache (max 10 specs).

### Self-Updating
When cloud providers launch new services, the specs appear in their respective GitHub repos within days. The server picks them up automatically on the next catalog refresh — no code changes, no redeployment, no manual intervention. A monthly GitHub Action also refreshes the bundled fallback catalogs.

## Safety Model

The agent never gets raw credentials. The sandboxed execution environment (QuickJS WASM) has no access to the filesystem, network, or host process. It can only interact with cloud APIs through a constrained `sdk.request()` bridge that enforces:

| Control | How It Works |
|---------|-------------|
| **Read-only mode** | Blocks mutating operations (Create, Delete, Put, Update, Terminate, etc. for AWS; PUT/POST/DELETE/PATCH for Azure). Default mode. |
| **Service allowlist** | Only configured services can be called. Requests to unlisted services are rejected before reaching the cloud API. |
| **Action blocklist** | Specific dangerous operations (e.g., `iam:DeleteUser`, `ec2:TerminateInstances`) can be permanently blocked regardless of mode. |
| **Dry-run mode** | The `execute` tool accepts a `dryRun: true` flag that logs what would happen without making any API call. |
| **Audit trail** | Every search and execution is logged with timestamp, service, action, parameters, success/failure, and duration. |
| **Credential isolation** | Cloud credentials live in the host process (from env vars, Vault, or Azure AD). The sandbox never sees them — the bridge attaches auth headers automatically. |

### Safety Modes

```yaml
providers:
  - type: aws
    mode: read-only      # Default. Only Describe/Get/List operations allowed.
    # mode: read-write   # Allows Create/Update/Put. Still respects blocklist.
    # mode: full         # No restrictions. Use with caution.
```

## Quick Start

### Prerequisites
- Node.js 20+
- AWS credentials and/or Azure service principal (for actual API calls)

### Install and Run

```bash
git clone https://github.com/vitalemazo/cloud-pilot-mcp.git
cd cloud-pilot-mcp
npm install
npm run build
```

Optionally pre-download common specs for faster first searches:
```bash
npm run download-specs
```

### Configure Credentials

Copy `.env.example` to `.env` and fill in your cloud credentials:

```bash
cp .env.example .env
```

For AWS:
```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

For Azure:
```
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
AZURE_SUBSCRIPTION_ID=...
```

### Connect to Your MCP Client

The server speaks standard MCP protocol and works with any compatible client. Below are integration examples for major platforms.

#### Claude Code (stdio)

Add to `~/.claude/mcp.json` or `.mcp.json` in your project root:

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

Once connected, the `search` and `execute` tools appear automatically. You interact naturally:

```
You:   "What EC2 operations exist for Transit Gateways?"
Agent: → calls search("transit gateway", provider: "aws")
       ← Returns 15 operations with full parameter schemas

You:   "Create a Transit Gateway with ASN 64512"
Agent: → calls execute(provider: "aws", code: "const tgw = await sdk.request({...})")
       ← Returns the created Transit Gateway details
```

#### Claude Code (Streamable HTTP — remote server)

When cloud-pilot-mcp runs as a persistent service (e.g., Docker on a server):

```json
{
  "mcpServers": {
    "cloud-pilot": {
      "type": "http",
      "url": "http://your-server:8400/mcp"
    }
  }
}
```

Or behind Cloudflare Access / auth proxy:

```json
{
  "mcpServers": {
    "cloud-pilot": {
      "type": "url",
      "url": "https://cloudpilot.example.com/mcp",
      "headers": {
        "CF-Access-Client-Id": "...",
        "CF-Access-Client-Secret": "..."
      }
    }
  }
}
```

#### OpenAI Agents SDK (Python)

The OpenAI Agents SDK has native MCP support. Connect via stdio or Streamable HTTP:

```python
from agents import Agent
from agents.mcp import MCPServerStdio, MCPServerStreamableHttp

# Option 1: stdio (agent spawns the server)
cloud_pilot = MCPServerStdio(
    command="node",
    args=["dist/index.js"],
    cwd="/path/to/cloud-pilot-mcp"
)

# Option 2: Streamable HTTP (connect to running server)
cloud_pilot = MCPServerStreamableHttp(
    url="http://your-server:8400/mcp"
)

agent = Agent(
    name="cloud-ops",
    instructions="You manage AWS and Azure infrastructure using cloud-pilot tools.",
    mcp_servers=[cloud_pilot]
)

# The agent now has access to search() and execute() tools.
# When it receives a message like "List all stopped EC2 instances",
# it will call search to discover DescribeInstances, then execute
# to call the AWS API and filter the results.
```

The SDK converts MCP tool schemas to OpenAI function-calling format automatically. The agent sees `search` and `execute` as callable functions just like any native OpenAI tool.

#### Cursor / Windsurf / Cline

All three IDE-based AI coding tools use the same MCP configuration format:

**Cursor** — `~/.cursor/mcp.json`:
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

**Windsurf** — `~/.codeium/windsurf/mcp_config.json` — same format.

**Cline** — configured through VS Code settings UI or `cline_mcp_settings.json` — same format with optional `"disabled"` and `"alwaysAllow"` fields.

Once configured, you can ask these coding assistants to manage cloud infrastructure directly while you code:

```
You: "The API gateway is throwing 503s. Check the Lambda function's configuration
      and recent CloudWatch errors, then fix the timeout setting."

Agent: → search("describe function configuration", provider: "aws")
       → execute(code to call Lambda:GetFunctionConfiguration)
       → search("cloudwatch get log events", provider: "aws")  
       → execute(code to query CloudWatch Logs)
       → search("update function configuration", provider: "aws")
       → execute(code to update the Lambda timeout)  [if mode: read-write]
```

#### LangChain / LangGraph

Use the `langchain-mcp-adapters` package to bring cloud-pilot tools into any LangChain agent:

```python
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

async with MultiServerMCPClient({
    "cloud-pilot": {
        "transport": "streamable_http",
        "url": "http://your-server:8400/mcp"
    }
}) as client:
    tools = client.get_tools()  # search + execute as LangChain BaseTool objects
    llm = ChatOpenAI(model="gpt-4o")
    agent = create_react_agent(llm, tools)

    result = await agent.ainvoke({
        "messages": [{"role": "user", "content": "List all Azure VMs that are deallocated"}]
    })
```

This works with any LangChain-compatible LLM — OpenAI, Anthropic, local models, etc.

#### Custom Agent (TypeScript)

Use the official MCP TypeScript SDK to build your own agent:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://your-server:8400/mcp")
);
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

// Discover available tools
const { tools } = await client.listTools();
// → [{ name: "search", description: "...", inputSchema: {...} },
//    { name: "execute", description: "...", inputSchema: {...} }]

// Search for operations
const searchResult = await client.callTool({
  name: "search",
  arguments: { provider: "aws", query: "create vpc" }
});

// Execute an API call
const execResult = await client.callTool({
  name: "execute",
  arguments: {
    provider: "aws",
    code: `
      const vpc = await sdk.request({
        service: "ec2",
        action: "CreateVpc",
        params: { CidrBlock: "10.0.0.0/16" }
      });
      console.log(vpc);
    `
  }
});
```

#### Custom Agent (Python)

```python
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

async with streamablehttp_client(url="http://your-server:8400/mcp") as (r, w, _):
    async with ClientSession(r, w) as session:
        await session.initialize()

        # Discover tools
        tools = await session.list_tools()

        # Search for Azure Kubernetes operations
        result = await session.call_tool(
            "search",
            {"provider": "azure", "query": "managed cluster create"}
        )

        # Execute: list all AKS clusters
        result = await session.call_tool(
            "execute",
            {
                "provider": "azure",
                "code": """
                    const clusters = await sdk.request({
                        service: "containerservice",
                        action: "GET /subscriptions/{subscriptionId}/providers/Microsoft.ContainerService/managedClusters",
                        params: {}
                    });
                    console.log(clusters);
                """
            }
        )
```

### Why One Server Serves All Platforms

cloud-pilot-mcp speaks the Model Context Protocol — an open standard. Every platform listed above connects using the same wire protocol (JSON-RPC 2.0 over stdio or HTTP). The server doesn't need platform-specific adapters. Deploy it once, connect from everywhere:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Claude Code │  │  OpenAI SDK  │  │   Cursor     │
│  (stdio)     │  │  (HTTP)      │  │   (stdio)    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
               ┌─────────▼──────────┐
               │  cloud-pilot-mcp   │
               │  (one instance)    │
               └─────────┬──────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         ┌────▼───┐ ┌───▼────┐ ┌──▼───┐
         │  AWS   │ │ Azure  │ │ GCP? │
         │421 svcs│ │240 svcs│ │      │
         └────────┘ └────────┘ └──────┘
```

The server starts, loads the service catalog (~50KB), and is ready to serve searches and executions.

## Configuration Reference

### `config.yaml`

```yaml
transport: stdio             # stdio (dev/local) | http (production, Streamable HTTP)

http:
  port: 8400
  host: "127.0.0.1"

auth:
  type: env                  # env | vault | azure-ad
  vault:                     # For type: vault
    address: "http://vault:8200"
    roleId: "..."
    secretId: "..."
    secretPath: "secret/cloud-pilot"
  azureAd:                   # For type: azure-ad
    tenantId: "..."
    clientId: "..."
    clientSecret: "..."

providers:
  - type: aws
    region: us-east-1
    mode: read-only          # read-only | read-write | full
    allowedServices: []      # Empty = all services allowed
    blockedActions:          # Always blocked, regardless of mode
      - "iam:DeleteUser"
      - "ec2:TerminateInstances"

  - type: azure
    region: eastus
    mode: read-only
    subscriptionId: "..."    # Or set AZURE_SUBSCRIPTION_ID env var
    allowedServices: []

specs:
  dynamic: true              # Enable runtime API discovery
  cacheDir: "~/.cloud-pilot/cache"
  catalogTtlDays: 7          # How often to refresh the service catalog
  specTtlDays: 30            # How long to cache downloaded specs
  maxMemorySpecs: 10         # Max full specs held in memory (LRU eviction)
  offline: false             # Never fetch from network (use cache/local only)

sandbox:
  memoryLimitMB: 128         # QuickJS sandbox memory limit
  timeoutMs: 30000           # Execution timeout (30 seconds)

audit:
  type: file                 # file | console
  path: ./audit.json
```

### Environment Variable Overrides

| Variable | Overrides |
|----------|-----------|
| `TRANSPORT` | `transport` |
| `HTTP_PORT` | `http.port` |
| `HTTP_HOST` | `http.host` |
| `AUTH_TYPE` | `auth.type` |
| `AWS_ACCESS_KEY_ID` | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials |
| `AWS_REGION` | AWS region |
| `AZURE_TENANT_ID` | Azure AD tenant |
| `AZURE_CLIENT_ID` | Azure AD client |
| `AZURE_CLIENT_SECRET` | Azure AD secret |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription |
| `VAULT_ADDR` | Vault address |
| `VAULT_ROLE_ID` | Vault AppRole |
| `VAULT_SECRET_ID` | Vault AppRole |
| `CLOUD_PILOT_SPECS_DYNAMIC` | `specs.dynamic` |
| `CLOUD_PILOT_SPECS_OFFLINE` | `specs.offline` |
| `GITHUB_TOKEN` | Optional: increases GitHub API rate limit from 60/hr to 5,000/hr |

## Transports

### stdio (Development)
The MCP client spawns cloud-pilot-mcp as a subprocess. Communication over stdin/stdout. Dies with the client session.

```bash
# Direct run
npm run dev

# Or via built output
node dist/index.js
```

### Streamable HTTP (Production)
Runs as a persistent service accessible over HTTP. Supports multiple concurrent clients, session management, and stream resumability. Survives client disconnections.

```yaml
transport: http
http:
  port: 8400
  host: "0.0.0.0"    # Listen on all interfaces for Docker
```

Deployable as a Docker container:
```bash
docker build -t cloud-pilot-mcp .
docker run -p 8400:8400 --env-file .env cloud-pilot-mcp
```

## Authentication

### Environment Variables (Development)
Set AWS/Azure credentials directly. Simplest for local development.

### HashiCorp Vault (Production)
Authenticates via AppRole, reads cloud credentials from Vault KV:
```
vault kv put secret/cloud-pilot/aws access_key_id=AKIA... secret_access_key=...
vault kv put secret/cloud-pilot/azure tenant_id=... client_id=... client_secret=...
```

### Azure AD Client Credentials (Azure-native)
OAuth2 client credentials flow against `login.microsoftonline.com`. Tokens are cached and refreshed automatically with a 5-minute pre-expiry buffer.

## Project Structure

```
src/
├── index.ts                     # Entrypoint — config loading, dependency wiring
├── server.ts                    # MCP server — registers search + execute tools
├── config.ts                    # YAML + env config loader with Zod validation
│
├── interfaces/                  # Pluggable contracts (extend to add providers/auth)
│   ├── auth.ts                  # AuthProvider — getCredentials(), isExpired()
│   ├── cloud-provider.ts        # CloudProvider — searchSpec(), call(), listServices()
│   └── audit.ts                 # AuditLogger — log(), query()
│
├── tools/
│   ├── search.ts                # search tool — spec discovery, formatted results
│   └── execute.ts               # execute tool — sandbox orchestration, dry-run
│
├── specs/                       # Dynamic API discovery system
│   ├── types.ts                 # CatalogEntry, OperationIndexEntry, SpecsConfig
│   ├── dynamic-spec-index.ts    # Three-tier lazy-loading spec index
│   ├── spec-fetcher.ts          # GitHub Git Trees API + CDN fetcher
│   ├── spec-cache.ts            # Disk cache with TTL-based expiration
│   ├── operation-index.ts       # Cross-service keyword search index
│   └── lru-cache.ts             # In-memory LRU eviction for full specs
│
├── providers/
│   ├── aws/
│   │   ├── provider.ts          # AWS CloudProvider — SigV4 calls, safety enforcement
│   │   ├── specs.ts             # Botocore JSON parser (used by DynamicSpecIndex)
│   │   └── signer.ts            # AWS Signature Version 4 implementation
│   └── azure/
│       ├── provider.ts          # Azure CloudProvider — ARM REST calls, safety enforcement
│       └── specs.ts             # Swagger/OpenAPI parser (used by DynamicSpecIndex)
│
├── auth/
│   ├── env.ts                   # Environment variable auth
│   ├── vault.ts                 # HashiCorp Vault AppRole auth
│   └── azure-ad.ts              # Azure AD OAuth2 client credentials
│
├── audit/
│   └── file.ts                  # Append-only JSON audit log
│
└── sandbox/
    ├── runtime.ts               # QuickJS WASM sandbox with timeout + memory limits
    └── api-bridge.ts            # sdk.request() bridge — connects sandbox to providers

scripts/
├── download-specs.sh            # Pre-download common specs for faster cold start
└── build-catalogs.ts            # Generate bundled fallback catalogs from GitHub

data/
├── aws-catalog.json             # Bundled AWS service catalog (421 services)
└── azure-catalog.json           # Bundled Azure service catalog (240+ providers)

.github/workflows/
└── update-catalogs.yml          # Monthly auto-refresh of bundled catalogs
```

## Extending

### Adding a New Cloud Provider

1. Create `src/providers/{name}/provider.ts` implementing the `CloudProvider` interface
2. Create `src/providers/{name}/specs.ts` to parse the provider's API specification format
3. Add the provider type to the config schema in `src/config.ts`
4. Wire it up in `src/index.ts`
5. Add catalog fetching logic in `src/specs/spec-fetcher.ts`

The `CloudProvider` interface requires three methods:
```typescript
interface CloudProvider {
  searchSpec(query: string, service?: string): Promise<OperationSpec[]>;
  call(service: string, action: string, params: Record<string, unknown>): Promise<CloudProviderCallResult>;
  listServices(): string[];
}
```

### Adding a New Auth Backend

1. Create `src/auth/{name}.ts` implementing the `AuthProvider` interface
2. Add the type to the config schema
3. Wire it up in `buildAuth()` in `src/index.ts`

### Deployment Targets

The server is designed to run anywhere:

| Environment | Transport | Auth | Notes |
|-------------|-----------|------|-------|
| Local dev machine | stdio | env | MCP client spawns as subprocess |
| Docker on a server | Streamable HTTP | Vault | Persistent service, multi-client |
| Azure Foundry | Streamable HTTP | Azure AD / Managed Identity | Native Azure auth |
| AWS ECS/Lambda | Streamable HTTP | IAM Role | Native AWS auth |
| Kubernetes | Streamable HTTP | Vault / Workload Identity | Sidecar or standalone pod |

## License

MIT
