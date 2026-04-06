# cloud-pilot-mcp

An MCP server that gives AI agents the ability to control cloud infrastructure across **AWS, Azure, GCP, and Alibaba Cloud** through natural language. Instead of building hundreds of individual tools, it exposes just two — **search** and **execute** — that together cover **1,289+ services and 51,900+ API operations**, discovered and fetched dynamically at runtime.

When an agent connects, the server delivers a **Senior Cloud Platform Engineer persona** — complete with engineering principles, provider-specific expertise, safety awareness, and structured workflow prompts — so the agent automatically operates with production-grade cloud architecture and security standards.

## The Problem

Cloud providers expose thousands of API operations across hundreds of services. Traditional approaches to AI-driven cloud management either:

- **Hard-code a handful of tools** (e.g., "list EC2 instances", "create S3 bucket") — limiting what the agent can do to what the developer anticipated
- **Generate hundreds of MCP tools** from API specs — overwhelming the agent's context window and making tool selection unreliable
- **Require manual updates** every time a cloud provider launches a new service

cloud-pilot-mcp solves this with a **search-and-execute pattern**: the agent discovers what it needs at runtime, then calls it through a sandboxed execution environment. No pre-built tools, no fixed service list, no manual updates.

## How It Works

```
You: "Set up a Transit Gateway connecting three VPCs across us-east-1 and eu-west-1"

Agent -> search("create transit gateway", provider: "aws")
      <- Returns: CreateTransitGateway, CreateTransitGatewayVpcAttachment,
                 CreateTransitGatewayRouteTable... with full parameter schemas

Agent -> execute(provider: "aws", code: `
          const tgw = await sdk.request({
            service: "ec2",
            action: "CreateTransitGateway",
            params: { Description: "Multi-region hub", Options: { AmazonSideAsn: 64512 } }
          });
          console.log(tgw);
        `)
      <- Returns: Transit Gateway ID, state, creation details
```

The agent reasons about what APIs exist, plans the sequence, and executes — all within the conversation.

## Cloud Provider Coverage

| Provider | Services | Operations | Spec Source | Auth |
|----------|----------|------------|-------------|------|
| **AWS** | 421 | 18,109 | [boto/botocore](https://github.com/boto/botocore) via jsDelivr CDN | AWS CLI / SDK credential chain → SigV4 signing |
| **Azure** | 240+ | 3,157 | [azure-rest-api-specs](https://github.com/Azure/azure-rest-api-specs) via GitHub CDN | Azure CLI / DefaultAzureCredential → Bearer token |
| **GCP** | 305 | 12,599 | [Google Discovery API](https://www.googleapis.com/discovery/v1/apis) (live) | gcloud CLI / GoogleAuth → Bearer token |
| **Alibaba** | 323 | 18,058 | [Alibaba Cloud API](https://api.aliyun.com/meta/v1/products) + api-docs.json | aliyun CLI / credential chain → ACS3-HMAC-SHA256 |
| **Total** | **1,289+** | **51,923** | | |

All services are discovered dynamically — no pre-configuration needed. When a cloud provider launches a new service, it becomes available automatically on the next catalog refresh.

## Architecture

```
                    MCP Protocol (stdio or Streamable HTTP)
                              |
                    +---------v----------+
                    |  cloud-pilot-mcp   |
                    |                    |
                    |  +--------------+  |
                    |  |  Persona     |  |  Sr. Cloud Platform Engineer identity
                    |  |              |  |  instructions + resources + prompts
                    |  |  8 engineering principles, provider expertise,
                    |  |  6 workflow prompts, safety awareness
                    |  +--------------+  |
                    |                    |
                    |  +--------------+  |
                    |  |   search     |  |  "What APIs exist for X?"
                    |  |              |  |  Searches 51,900+ operations
                    |  |  Tier 1: Service catalog (1,289 services)
                    |  |  Tier 2: Operation index (keyword match)
                    |  |  Tier 3: Full spec hydration (params, output)
                    |  +--------------+  |
                    |                    |
                    |  +--------------+  |
                    |  |   execute    |  |  "Call this API with these params"
                    |  |              |  |
                    |  |  QuickJS sandbox (no fs/net access)
                    |  |    +-- sdk.request() bridge
                    |  |         |-- AWS: SigV4 signed request
                    |  |         |-- Azure: Bearer token + ARM REST
                    |  |         |-- GCP: Bearer token + REST
                    |  |         +-- Alibaba: ACS3-HMAC-SHA256 + RPC
                    |  +--------------+  |
                    |                    |
                    |  +--------------+  |
                    |  |  Safety      |  |  API key auth, CORS, rate limiting,
                    |  |  + Audit     |  |  read-only mode, allowlists, blocklists,
                    |  |              |  |  dry-run, audit trail
                    |  +--------------+  |
                    +--------------------+
                      |    |    |    |
               +------+  +--+  +-+  +--------+
               |          |      |            |
          +----v---+ +---v----+ +v-----+ +---v------+
          |  AWS   | | Azure  | |  GCP | | Alibaba  |
          |421 svcs| |240+pvdr| |305svc| | 323 svcs |
          +--------+ +--------+ +------+ +----------+
```

## Built-In Cloud Engineering Persona

When any AI agent connects to cloud-pilot-mcp, the server automatically shapes the agent's behavior through four layers:

### Server Instructions (always delivered)

On every connection, the server sends MCP `instructions` that establish the agent as a **Senior Cloud Platform Engineer, Security Architect, and DevOps Specialist** with:

- **8 core principles**: security-first, Infrastructure as Code, blast radius minimization, defense in depth, cost awareness, operational excellence, Well-Architected Framework, high availability by default
- **Behavioral standards**: search before executing, verify state before modifying, dry-run first for mutating operations, explain reasoning, warn about cost/risk, include monitoring alongside changes
- **Safety awareness**: understand and communicate the current mode (read-only/read-write/full), respect audit trail, use dry-run

The instructions are dynamically tailored to include only the configured providers, their modes, regions, and allowed services.

### Provider Expertise (on demand via MCP Resources)

Deep, provider-specific engineering guides (~1,500 words each) are available as MCP resources:

| Resource URI | Content |
|---|---|
| `cloud-pilot://persona/overview` | Full persona document with all principles and provider summary |
| `cloud-pilot://persona/aws` | VPC/TGW design, IAM roles, GuardDuty/SecurityHub, S3 lifecycle, Graviton, anti-patterns |
| `cloud-pilot://persona/azure` | Landing Zones, Entra ID/Managed Identity, Virtual WAN, Defender, Policy, PIM |
| `cloud-pilot://persona/gcp` | Shared VPC, Workload Identity Federation, GKE Autopilot, VPC Service Controls |
| `cloud-pilot://persona/alibaba` | CEN, RAM/STS, ACK, Security Center, China-specific (ICP, data residency) |
| `cloud-pilot://safety/{provider}` | Current safety mode, allowed services, blocked actions, audit config |

Agents pull these on demand — they add zero overhead to connections where they aren't needed.

### Workflow Prompts (structured multi-step procedures)

Six MCP prompts provide opinionated, multi-step workflows that agents can invoke:

| Prompt | What It Does |
|--------|-------------|
| `landing-zone` | Deploy a complete cloud landing zone: org structure, identity, networking, security baseline, monitoring |
| `incident-response` | Security incident lifecycle: contain, investigate, eradicate, recover, post-mortem |
| `cost-optimization` | Full cost audit: idle resources, rightsizing, reserved capacity, storage tiering, network costs |
| `security-audit` | Comprehensive security review: IAM, network, encryption, logging, compliance, vulnerability management |
| `migration-assessment` | Workload migration planning: discovery, 6R strategy, target architecture, migration waves, cutover |
| `well-architected-review` | Well-Architected Framework review across all 6 pillars with provider-native recommendations |

Each prompt accepts a `provider` argument (dynamically scoped to configured providers) and returns structured guidance that the agent follows step by step using `search` and `execute`.

### Persona Configuration

The persona is enabled by default. Customize or disable it in `config.yaml`:

```yaml
persona:
  enabled: true                 # Set false to disable all persona features
  # instructionsOverride: "..." # Replace default instructions with your own
  # additionalGuidance: "..."   # Append custom policies (e.g., "All resources must be tagged with CostCenter")
  enablePrompts: true           # Set false to disable workflow prompts
  enableResources: true         # Set false to disable persona resources
```

Or via environment variable: `CLOUD_PILOT_PERSONA_ENABLED=false`

## Real-World Use Cases

### Deploy an Azure Landing Zone
An agent can discover and orchestrate calls across 15+ Azure resource providers in a single conversation:
- `Microsoft.Management` — create management group hierarchy
- `Microsoft.Authorization` — assign RBAC roles and Azure Policies
- `Microsoft.Network` — deploy hub VNet, Azure Firewall, VPN Gateway
- `Microsoft.Security` — enable Defender for Cloud
- `Microsoft.Insights` — configure diagnostic settings and alerts
- `Microsoft.KeyVault` — provision Key Vault with access policies

### Build a Global WAN on AWS
Create a multi-region Transit Gateway mesh with Direct Connect:
- `ec2:CreateTransitGateway` — hub in each region
- `ec2:CreateTransitGatewayPeeringAttachment` — cross-region peering
- `directconnect:CreateConnection` — on-premises connectivity
- `networkmanager:CreateGlobalNetwork` — unified management

All 84 Transit Gateway operations and all Direct Connect operations are discoverable without pre-configuration.

### Multi-Cloud Kubernetes Management
Manage clusters across all four providers in one conversation:
- **AWS**: `eks:CreateCluster`, `eks:CreateNodegroup`
- **Azure**: `ContainerService:ManagedClusters_CreateOrUpdate`
- **GCP**: `container.projects.zones.clusters.create`
- **Alibaba**: `CS:CreateCluster`, `CS:DescribeClusterDetail`

### Incident Response Automation
- `guardduty:ListFindings` — pull active threats (AWS)
- `cloudtrail:LookupEvents` — trace the activity (AWS)
- `Microsoft.Security:Alerts_List` — Defender alerts (Azure)
- `securitycenter.organizations.sources.findings.list` — Security Command Center (GCP)

### Cost Analysis Across Clouds
- `ce:GetCostAndUsage` — AWS spend
- `Microsoft.CostManagement:Query_Usage` — Azure spend
- `cloudbilling.billingAccounts.projects.list` — GCP billing
- `BssOpenApi:QueryBill` — Alibaba billing

## Dynamic API Discovery

The server discovers APIs at runtime using a three-tier system:

### Tier 1: Service Catalog
On startup (or when the 7-day cache expires), the server fetches the complete service list:
- **AWS**: GitHub Git Trees API on [boto/botocore](https://github.com/boto/botocore) — 1 API call
- **Azure**: GitHub Git Trees API on [azure-rest-api-specs](https://github.com/Azure/azure-rest-api-specs) — 2 API calls
- **GCP**: Google Discovery API at `googleapis.com/discovery/v1/apis` — 1 API call
- **Alibaba**: Product metadata at `api.aliyun.com/meta/v1/products` — 1 API call

Catalogs are cached to disk and ship as bundled fallbacks for offline use.

### Tier 2: Operation Index
A keyword-searchable index of every operation across all services (51,900+ total). Built progressively on first search — pre-downloaded specs indexed immediately, remaining services fetched from CDN in the background (~2-5 minutes). Once built, the index is cached to disk and loads instantly on subsequent startups.

### Tier 3: Full Specs
Complete API specifications with parameter schemas, response types, and documentation. Fetched on demand from CDN when a search match needs hydration. Cached to disk (30-day TTL) and held in an LRU memory cache (max 10 specs).

### Self-Updating
When cloud providers launch new services, specs appear in their repositories within days. The server picks them up automatically on the next catalog refresh. A monthly GitHub Action also refreshes the bundled fallback catalogs.

## Safety Model

The agent never gets raw credentials. The sandboxed execution environment (QuickJS WASM) has no access to the filesystem, network, or host process. It can only interact with cloud APIs through a constrained `sdk.request()` bridge that enforces:

| Control | How It Works |
|---------|-------------|
| **Read-only mode** | Blocks mutating operations. Default for all providers. |
| **Service allowlist** | Only configured services can be called. Empty = all allowed. |
| **Action blocklist** | Specific dangerous operations permanently blocked. |
| **Dry-run mode** | `dryRun: true` logs what would happen without executing. |
| **Audit trail** | Every search and execution logged with timestamp, service, action, params, success/failure, duration. |
| **Credential isolation** | Credentials live in the host process. The sandbox never sees them. |

### Safety Modes

```yaml
providers:
  - type: aws
    mode: read-only      # Default. Only Describe/Get/List operations allowed.
    # mode: read-write   # Allows Create/Update/Put. Still respects blocklist.
    # mode: full         # No restrictions. Use with caution.
```

## HTTP Transport Security

When running as a Streamable HTTP service, the server includes:

| Feature | Details |
|---------|---------|
| **API key auth** | Bearer token or `x-api-key` header. Optional — set `HTTP_API_KEY` to enable. |
| **CORS** | Configurable allowed origins. Preflight handling. MCP session headers exposed. |
| **Rate limiting** | Sliding window per client IP. Default 60 req/min, configurable. |
| **Request logging** | Every request logged: status code, method, URL, duration, client IP. |
| **Health endpoint** | `GET /health` returns provider status and uptime. Bypasses auth for monitoring. |

## Quick Start

### Prerequisites
- Node.js 20+
- One or more cloud provider CLIs installed and authenticated:
  - **AWS**: [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) — `aws configure` or `aws sso login`
  - **Azure**: [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) — `az login`
  - **GCP**: [gcloud CLI](https://cloud.google.com/sdk/docs/install) — `gcloud auth application-default login`
  - **Alibaba**: [aliyun CLI](https://www.alibabacloud.com/help/en/cli/) — `aliyun configure`

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

Credentials are discovered automatically using each cloud provider's native SDK credential chain. If you have a CLI installed and authenticated, it just works — no `.env` file needed.

| Provider | Auto-Discovery Sources (checked in order) |
|----------|------------------------------------------|
| **AWS** | Environment vars → `~/.aws/credentials` → `~/.aws/config` (profiles/SSO) → IMDS/ECS container role |
| **Azure** | Environment vars → `az login` session → Managed Identity → VS Code / PowerShell |
| **GCP** | Environment vars → `gcloud auth` session (`~/.config/gcloud`) → `GOOGLE_APPLICATION_CREDENTIALS` → metadata server |
| **Alibaba** | Environment vars → `~/.alibabacloud/credentials` → `~/.aliyun/config.json` → ECS RAM role |

The fastest way to get started:

```bash
# Pick the providers you need:
aws configure          # or: aws sso login --profile my-profile
az login               # interactive browser login
gcloud auth application-default login
aliyun configure       # access key mode
```

<details>
<summary>Manual credential configuration (environment variables)</summary>

If you prefer not to use CLI-based auth, copy `.env.example` to `.env` and set credentials directly:

```bash
cp .env.example .env
```

```
# AWS
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1

# Azure
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
AZURE_SUBSCRIPTION_ID=...

# GCP
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GCP_PROJECT_ID=...

# Alibaba
ALIBABA_CLOUD_ACCESS_KEY_ID=...
ALIBABA_CLOUD_ACCESS_KEY_SECRET=...
ALIBABA_CLOUD_REGION=cn-hangzhou
```
</details>

#### Vault Integration

For production deployments, credentials can be sourced from **HashiCorp Vault** via AppRole auth. Set `auth.type: vault` in `config.yaml` and configure the Vault connection:

```yaml
auth:
  type: vault
  vault:
    address: https://vault.example.com
    roleId: "..."       # or VAULT_ROLE_ID env var
    secretId: "..."     # or VAULT_SECRET_ID env var
    secretPath: secret/cloud-pilot   # reads secret/cloud-pilot/{aws,azure,gcp,alibaba}
```

Vault secrets are read from `{secretPath}/{provider}` and mapped to credentials automatically. All four providers are supported.

#### Resilient Provider Initialization

Each provider initializes independently. If one provider's credentials are unavailable (e.g., no AWS CLI configured), the server starts with the remaining providers instead of failing entirely. Check the startup logs to see which providers loaded:

```
[cloud-pilot] Provider "aws" initialized (read-only, region: us-east-1)
[cloud-pilot] WARNING: Failed to initialize provider "azure": Azure credentials not found...
[cloud-pilot] Providers: aws
```

### Run with Docker

```bash
docker pull ghcr.io/vitalemazo/cloud-pilot-mcp:latest
docker run -p 8400:8400 --env-file .env ghcr.io/vitalemazo/cloud-pilot-mcp:latest
```

Or with docker-compose:
```bash
docker-compose up -d
```

### Connect to Your MCP Client

The server speaks standard MCP protocol and works with any compatible client.

#### stdio (local development)

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

#### Streamable HTTP (remote server)

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

#### With API key auth

```json
{
  "mcpServers": {
    "cloud-pilot": {
      "type": "http",
      "url": "http://your-server:8400/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

### Platform Integration Examples

<details>
<summary>OpenAI Agents SDK (Python)</summary>

```python
from agents import Agent
from agents.mcp import MCPServerStdio, MCPServerStreamableHttp

cloud_pilot = MCPServerStreamableHttp(url="http://your-server:8400/mcp")

agent = Agent(
    name="cloud-ops",
    instructions="You manage cloud infrastructure using cloud-pilot tools.",
    mcp_servers=[cloud_pilot]
)
```
</details>

<details>
<summary>Cursor / Windsurf / Cline</summary>

All use the same `mcpServers` JSON format. Config locations:
- **Cursor**: `~/.cursor/mcp.json`
- **Windsurf**: `~/.codeium/windsurf/mcp_config.json`
- **Cline**: VS Code settings or `cline_mcp_settings.json`
</details>

<details>
<summary>LangChain / LangGraph</summary>

```python
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent

async with MultiServerMCPClient({
    "cloud-pilot": {"transport": "streamable_http", "url": "http://your-server:8400/mcp"}
}) as client:
    tools = client.get_tools()
    agent = create_react_agent(llm, tools)
```
</details>

<details>
<summary>Custom TypeScript Agent</summary>

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://your-server:8400/mcp")));

const { tools } = await client.listTools();
const result = await client.callTool({ name: "search", arguments: { provider: "aws", query: "create vpc" } });
```
</details>

<details>
<summary>Custom Python Agent</summary>

```python
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

async with streamablehttp_client(url="http://your-server:8400/mcp") as (r, w, _):
    async with ClientSession(r, w) as session:
        await session.initialize()
        tools = await session.list_tools()
        result = await session.call_tool("search", {"provider": "gcp", "query": "compute instances list"})
```
</details>

## Configuration Reference

### `config.yaml`

```yaml
transport: stdio             # stdio | http

http:
  port: 8400
  host: "127.0.0.1"
  apiKey: ""                 # Optional: require Bearer/x-api-key auth
  corsOrigins: ["*"]         # Allowed CORS origins
  rateLimitPerMinute: 60     # Max requests per IP per minute

auth:
  type: env                  # env (auto-discovers from CLIs/SDK chains) | vault | azure-ad

providers:
  - type: aws
    region: us-east-1
    mode: read-only          # read-only | read-write | full
    allowedServices: []      # Empty = all services
    blockedActions: []

  - type: azure
    region: eastus
    mode: read-only
    subscriptionId: "..."

  - type: gcp
    region: us-central1
    mode: read-only

  - type: alibaba
    region: cn-hangzhou
    mode: read-only

specs:
  dynamic: true              # Enable runtime API discovery
  cacheDir: "~/.cloud-pilot/cache"
  catalogTtlDays: 7
  specTtlDays: 30
  maxMemorySpecs: 10
  offline: false

sandbox:
  memoryLimitMB: 128
  timeoutMs: 30000

audit:
  type: file                 # file | console
  path: ./audit.json

persona:
  enabled: true              # Enable Sr. Cloud Platform Engineer persona
  # instructionsOverride: "" # Replace default instructions entirely
  # additionalGuidance: ""   # Append custom policies to default instructions
  enablePrompts: true        # Expose workflow prompts (landing-zone, security-audit, etc.)
  enableResources: true      # Expose persona resources (cloud-pilot://persona/*)
```

### Environment Variable Overrides

| Variable | Overrides |
|----------|-----------|
| `TRANSPORT` | `transport` |
| `HTTP_PORT` / `HTTP_HOST` / `HTTP_API_KEY` | `http.*` |
| `AUTH_TYPE` | `auth.type` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | AWS credentials (also auto-discovered from `~/.aws/credentials`, SSO, IMDS) |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_SUBSCRIPTION_ID` | Azure credentials (also auto-discovered from `az login`, Managed Identity) |
| `GOOGLE_APPLICATION_CREDENTIALS` / `GCP_PROJECT_ID` | GCP credentials (also auto-discovered from `gcloud auth`, metadata server) |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_REGION` | Alibaba credentials (also auto-discovered from `~/.alibabacloud/credentials`, ECS RAM role) |
| `CLOUD_PILOT_SPECS_DYNAMIC` / `CLOUD_PILOT_SPECS_OFFLINE` | `specs.*` |
| `CLOUD_PILOT_PERSONA_ENABLED` | `persona.enabled` (set `false` to disable persona) |
| `GITHUB_TOKEN` | Increases GitHub API rate limit (60/hr -> 5,000/hr) |

## CI/CD Pipeline

Every push to `main` triggers an automated pipeline:

```
Push to main
  |
  +-- CI: typecheck -> build -> unit tests (vitest) -> HTTP smoke test
  |
  +-- Docker: tests pass -> build image -> push to GHCR -> verify container
  |
  +-- Monthly: refresh bundled API catalogs (GitHub Action)
```

- **CI gate**: Docker image is only built after all tests pass
- **Image**: `ghcr.io/vitalemazo/cloud-pilot-mcp:latest`
- **Tags**: `:latest`, `:main`, `:sha` (short commit hash)
- **Cache**: GitHub Actions layer cache for fast rebuilds
- **Verify**: Post-push pulls and runs the container to confirm it starts

## Project Structure

```
src/
+-- index.ts                     # Entrypoint: config, wiring, HTTP server with auth/CORS/rate limiting
+-- server.ts                    # MCP server: tools, persona, resources, prompts
+-- config.ts                    # YAML + env config loader with Zod validation
|
+-- interfaces/                  # Pluggable contracts
|   +-- auth.ts                  # AuthProvider: getCredentials(), isExpired()
|   +-- cloud-provider.ts        # CloudProvider: searchSpec(), call(), listServices()
|   +-- audit.ts                 # AuditLogger: log(), query()
|
+-- tools/
|   +-- search.ts                # search tool: spec discovery, formatted results
|   +-- execute.ts               # execute tool: sandbox orchestration, dry-run
|
+-- specs/                       # Dynamic API discovery system
|   +-- types.ts                 # CatalogEntry, OperationIndexEntry, SpecsConfig
|   +-- dynamic-spec-index.ts    # Three-tier lazy-loading spec index (all providers)
|   +-- spec-fetcher.ts          # GitHub Trees API + CDN + Google Discovery + Alibaba API
|   +-- spec-cache.ts            # Disk cache with TTL-based expiration
|   +-- operation-index.ts       # Cross-service keyword search (AWS/Azure/GCP/Alibaba extractors)
|   +-- lru-cache.ts             # In-memory LRU eviction for full specs
|
+-- providers/
|   +-- aws/
|   |   +-- provider.ts          # SigV4 calls, mutating-prefix safety
|   |   +-- specs.ts             # Botocore JSON parser
|   |   +-- signer.ts            # AWS Signature Version 4
|   +-- azure/
|   |   +-- provider.ts          # ARM REST calls, HTTP-method safety
|   |   +-- specs.ts             # Swagger/OpenAPI parser
|   +-- gcp/
|   |   +-- provider.ts          # Google REST calls, HTTP-method safety
|   |   +-- specs.ts             # Google Discovery Document parser
|   +-- alibaba/
|       +-- provider.ts          # Alibaba RPC calls, mutating-prefix safety
|       +-- signer.ts            # ACS3-HMAC-SHA256
|
+-- persona/                     # Cloud engineering persona system
|   +-- index.ts                 # Barrel export
|   +-- instructions.ts          # Dynamic MCP instructions builder (provider-aware)
|   +-- provider-profiles.ts     # Deep expertise docs: AWS, Azure, GCP, Alibaba
|   +-- resources.ts             # MCP resources: cloud-pilot://persona/*, cloud-pilot://safety/*
|   +-- prompts.ts               # 6 workflow prompts: landing-zone, incident-response, etc.
|
+-- auth/
|   +-- env.ts                   # Auto-discovery credential chain (AWS CLI/SDK, az CLI, gcloud, aliyun CLI)
|   +-- vault.ts                 # HashiCorp Vault AppRole (all 4 providers)
|   +-- azure-ad.ts              # Azure AD OAuth2 client credentials
|
+-- audit/
|   +-- file.ts                  # Append-only JSON audit log
|
+-- sandbox/
    +-- runtime.ts               # QuickJS WASM sandbox with timeout + memory limits
    +-- api-bridge.ts            # sdk.request() bridge: connects sandbox to providers

scripts/
+-- download-specs.sh            # Pre-download common specs for faster cold start
+-- build-catalogs.ts            # Generate bundled fallback catalogs

data/
+-- aws-catalog.json             # Bundled: 421 AWS services
+-- azure-catalog.json           # Bundled: 240+ Azure providers
+-- gcp-catalog.json             # Bundled: 305 GCP services

test/
+-- lru-cache.test.ts            # LRU cache unit tests
+-- operation-index.test.ts      # Operation index unit tests

.github/workflows/
+-- ci.yml                       # Typecheck, build, tests, smoke test
+-- docker.yml                   # Tests gate -> Docker build -> GHCR push -> verify
+-- update-catalogs.yml          # Monthly catalog refresh
```

## Extending

### Adding a New Cloud Provider

1. Create `src/providers/{name}/provider.ts` implementing `CloudProvider`
2. Create `src/providers/{name}/specs.ts` for the provider's spec format (optional)
3. If the provider has a custom signing algorithm, add `src/providers/{name}/signer.ts`
4. Add catalog fetching to `src/specs/spec-fetcher.ts`
5. Add operation extraction to `src/specs/operation-index.ts`
6. Add the provider type to `src/config.ts` and wire in `src/index.ts`

### Adding a New Auth Backend

1. Create `src/auth/{name}.ts` implementing `AuthProvider`
2. Add the type to the config schema
3. Wire it in `buildAuth()` in `src/index.ts`

### Deployment Targets

| Environment | Transport | Auth | Notes |
|-------------|-----------|------|-------|
| Local dev | stdio | env | MCP client spawns as subprocess |
| Docker on a server | Streamable HTTP | Vault / env | Persistent service, multi-client |
| Azure Foundry | Streamable HTTP | Azure AD / Managed Identity | Native Azure auth |
| AWS ECS/Lambda | Streamable HTTP | IAM Role | Native AWS auth |
| Kubernetes | Streamable HTTP | Vault / Workload Identity | Sidecar or standalone pod |

## Author

**Vitale Mazo** — [github.com/vitalemazo](https://github.com/vitalemazo)

Sole author and copyright holder. All intellectual property rights, including the search-and-execute pattern for dynamic cloud API discovery via sandboxed execution, are retained by the author.

## License

MIT License. Copyright (c) 2026 Vitale Mazo. All rights reserved.

See [LICENSE](LICENSE) for full terms. The MIT license grants permission to use, modify, and distribute this software, but does not transfer copyright or patent rights.
