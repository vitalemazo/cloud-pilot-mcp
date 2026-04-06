<p align="center">
  <img src="assets/banner.png" alt="cloud-pilot-mcp — Multi-cloud MCP infrastructure control" width="100%"/>
</p>

<h1 align="center">cloud-pilot-mcp</h1>

<p align="center">
  Give AI agents the ability to control cloud infrastructure across<br/>
  <b>AWS, Azure, GCP, and Alibaba Cloud</b> through natural language.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js&logoColor=white" alt="Node 20+"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://github.com/vitalemazo/cloud-pilot-mcp/pkgs/container/cloud-pilot-mcp"><img src="https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker&logoColor=white" alt="Docker"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/protocol-MCP-purple" alt="MCP"></a>
</p>

<br/>

> cloud-pilot exposes three tools — **search**, **execute**, and **tofu** — that together cover **1,289+ services** and **51,900+ API operations** with full infrastructure lifecycle management. Discover APIs at runtime, execute scripts against live cloud state, and manage stateful deployments with plan/apply/destroy through OpenTofu.

When an agent connects, the server delivers a **Senior Cloud Platform Engineer persona** — complete with engineering principles, provider-specific expertise, safety awareness, and structured workflow prompts — so the agent automatically operates with production-grade cloud architecture and security standards.

**Demo: Three-tier AWS deployment with OpenTofu** — VPC, ALB, ASG, RDS deployed and destroyed via the `tofu` tool.

[![Watch the full demo](assets/demo-preview.gif)](https://github.com/vitalemazo/cloud-pilot-mcp/releases/tag/v0.2.0)

**What changed in v0.2:**
- **Native SDK execution** — AWS calls use `@aws-sdk/client-*` packages (not custom HTTP). Azure uses `@azure/core-rest-pipeline` with automatic retry/throttling. Zero serialization bugs.
- **OpenTofu integration** — new `tofu` tool for stateful infrastructure lifecycle: write HCL, plan, apply, destroy, import existing resources, drift detection, and rollback.
- **4-level dry-run system** — native cloud provider validation (AWS DryRun), session-enforced gate, impact summaries with cost warnings, and session changeset with rollback plans.
- **Configurable safety** — `dryRunPolicy` per provider: `enforced` (interactive sessions), `optional` (approved automation), `disabled` (read-only bots).

---

## Table of Contents

| Section | Description |
|---------|-------------|
| [The Problem](#the-problem) | Why existing approaches fall short |
| [How It Works](#how-it-works) | The three-tool pattern: search, execute, tofu |
| [Cloud Provider Coverage](#cloud-provider-coverage) | 4 providers, 1,289 services, 51,900+ operations |
| [Architecture](#architecture) | System design and component overview |
| [Built-In Cloud Engineering Persona](#built-in-cloud-engineering-persona) | Instructions, resources, prompts, configuration |
| [Why cloud-pilot?](#why-cloud-pilot) | When you need a control plane between AI agents and your cloud |
| [Agents That Act, Not Advise](#agents-that-act-not-advise) | How cloud-pilot turns AI from advisor to actor — real deployment example |
| [Enterprise Integration](#enterprise-integration) | ServiceNow, Teams/Slack, and how MCP enables one integration for all clouds |
| [Infrastructure Lifecycle with OpenTofu](#infrastructure-lifecycle-with-opentofu) | Stateful deployments: plan, apply, destroy, import, drift detection, rollback |
| [Real-World Use Cases](#real-world-use-cases) | Landing zones, global WAN, K8s, incident response, cost analysis |
| **Getting Started** | |
| &nbsp;&nbsp;&nbsp;&nbsp;[Quick Start](#quick-start) | Prerequisites, install, and run |
| &nbsp;&nbsp;&nbsp;&nbsp;[Configure Credentials](#configure-credentials) | Auto-discovery, env vars, Vault, Azure AD |
| &nbsp;&nbsp;&nbsp;&nbsp;[Run with Docker](#run-with-docker) | Container deployment |
| &nbsp;&nbsp;&nbsp;&nbsp;[Connect to Your MCP Client](#connect-to-your-mcp-client) | stdio, HTTP, API key auth |
| &nbsp;&nbsp;&nbsp;&nbsp;[Platform Integration Examples](#platform-integration-examples) | OpenAI SDK, Cursor, LangChain, custom agents |
| **Reference** | |
| &nbsp;&nbsp;&nbsp;&nbsp;[Configuration Reference](#configuration-reference) | Full `config.yaml` schema and env var overrides |
| &nbsp;&nbsp;&nbsp;&nbsp;[Dynamic API Discovery](#dynamic-api-discovery) | Three-tier spec system: catalog, index, full specs |
| &nbsp;&nbsp;&nbsp;&nbsp;[Safety Model](#safety-model) | Sandbox isolation levels, modes, allowlists, audit trail |
| &nbsp;&nbsp;&nbsp;&nbsp;[HTTP Transport Security](#http-transport-security) | Auth, CORS, rate limiting |
| **Operations** | |
| &nbsp;&nbsp;&nbsp;&nbsp;[CI/CD Pipeline](#cicd-pipeline) | Build, test, Docker, catalog refresh |
| &nbsp;&nbsp;&nbsp;&nbsp;[Project Structure](#project-structure) | Source tree walkthrough |
| &nbsp;&nbsp;&nbsp;&nbsp;[Extending](#extending) | Add providers, auth backends, deployment targets |
| &nbsp;&nbsp;&nbsp;&nbsp;[Troubleshooting](#troubleshooting) | Common issues and diagnostic steps |

---

## The Problem

Cloud providers expose thousands of API operations across hundreds of services. Traditional approaches to AI-driven cloud management either:

- **Hard-code a handful of tools** (e.g., "list EC2 instances", "create S3 bucket") — limiting what the agent can do to what the developer anticipated
- **Generate hundreds of MCP tools** from API specs — overwhelming the agent's context window and making tool selection unreliable
- **Require manual updates** every time a cloud provider launches a new service

cloud-pilot-mcp solves this with a **search-and-execute pattern**: the agent discovers what it needs at runtime, then calls it through a sandboxed execution environment. No pre-built tools, no fixed service list, no manual updates.

---

## How It Works

```
                  User                        Agent                      cloud-pilot-mcp
                   |                            |                              |
                   |  "Set up a Transit Gateway |                              |
                   |   connecting three VPCs"    |                              |
                   |--------------------------->|                              |
                   |                            |                              |
                   |                            |  search("transit gateway")   |
                   |                            |----------------------------->|
                   |                            |                              |
                   |                            |  CreateTransitGateway,       |
                   |                            |  CreateTGWVpcAttachment,     |
                   |                            |  CreateTGWRouteTable + schemas|
                   |                            |<-----------------------------|
                   |                            |                              |
                   |                            |  execute(provider: "aws",    |
                   |                            |    code: sdk.request({       |
                   |                            |      service: "ec2",         |
                   |                            |      action: "CreateTGW",    |
                   |                            |      params: {...}           |
                   |                            |    })                        |
                   |                            |----------------------------->|
                   |                            |                              |  QuickJS
                   |                            |                              |  Sandbox
                   |                            |                              |----+
                   |                            |                              |    | SigV4
                   |                            |                              |    | signed
                   |                            |                              |<---+
                   |                            |  Transit Gateway ID, state   |
                   |                            |<-----------------------------|
                   |                            |                              |
                   |  "Done! TGW tgw-0abc123    |                              |
                   |   created in us-east-1"    |                              |
                   |<---------------------------|                              |
```

The agent reasons about what APIs exist, plans the sequence, and executes — all within the conversation.

---

## Cloud Provider Coverage

```
  +-------------------------------------------+
  |          51,900+ API Operations            |
  |                                            |
  |   +----------+  +---------+  +--------+   |
  |   |   AWS    |  |  Azure  |  |  GCP   |   |
  |   | 421 svcs |  | 240+    |  | 305    |   |
  |   | 18,109   |  | 3,157   |  | 12,599 |   |
  |   |   ops    |  |   ops   |  |  ops   |   |
  |   +----------+  +---------+  +--------+   |
  |                                            |
  |              +-----------+                 |
  |              |  Alibaba  |                 |
  |              |  323 svcs |                 |
  |              |  18,058   |                 |
  |              |    ops    |                 |
  |              +-----------+                 |
  +-------------------------------------------+
```

| Provider | Services | Operations | Spec Source | Auth |
|----------|----------|------------|-------------|------|
| **AWS** | 421 | 18,109 | [boto/botocore](https://github.com/boto/botocore) via jsDelivr CDN | AWS CLI / SDK credential chain -> Native `@aws-sdk/client-*` |
| **Azure** | 240+ | 3,157 | [azure-rest-api-specs](https://github.com/Azure/azure-rest-api-specs) via GitHub CDN | Azure CLI / DefaultAzureCredential -> `@azure/core-rest-pipeline` |
| **GCP** | 305 | 12,599 | [Google Discovery API](https://www.googleapis.com/discovery/v1/apis) (live) | gcloud CLI / GoogleAuth -> Bearer token |
| **Alibaba** | 323 | 18,058 | [Alibaba Cloud API](https://api.aliyun.com/meta/v1/products) + api-docs.json | aliyun CLI / credential chain -> ACS3-HMAC-SHA256 |
| **Total** | **1,289+** | **51,923** | | |

All services are discovered dynamically — no pre-configuration needed. When a cloud provider launches a new service, it becomes available automatically on the next catalog refresh.

---

## Architecture

```
                         MCP Protocol (stdio or Streamable HTTP)
                                       |
                         +-------------v--------------+
                         |      cloud-pilot-mcp       |
                         |                            |
    +--------------------+----------------------------+--------------------+
    |                    |                            |                    |
    |  +--------------+  |  +--------------+          |  +--------------+  |
    |  |   Persona    |  |  |    search    |          |  |   Safety     |  |
    |  +--------------+  |  +--------------+          |  |   + Audit    |  |
    |  | Sr. Cloud    |  |  | 51,900+ ops  |          |  +--------------+  |
    |  | Platform     |  |  |              |          |  | read-only    |  |
    |  | Engineer     |  |  | Tier 1:      |          |  | allowlists   |  |
    |  |              |  |  |  Catalog     |          |  | blocklists   |  |
    |  | 8 principles |  |  |  (1,289 svc) |          |  | 4-level      |  |
    |  | 6 prompts    |  |  | Tier 2:      |          |  |  dry-run     |  |
    |  | 4 provider   |  |  |  Op Index    |          |  | audit trail  |  |
    |  |   guides     |  |  | Tier 3:      |          |  | dryRunPolicy |  |
    |  |              |  |  |  Full Spec   |          |  | rate limit   |  |
    |  +--------------+  |  +--------------+          |  +--------------+  |
    |                    |                            |                    |
    |  +--------------+  |  +--------------+          |                    |
    |  |   execute    |  |  |    tofu      |          |                    |
    |  +--------------+  |  +--------------+          |                    |
    |  | VM sandbox   |  |  | OpenTofu     |          |                    |
    |  | Native SDK   |  |  | plan/apply   |          |                    |
    |  | calls        |  |  | destroy      |          |                    |
    |  |              |  |  | import       |          |                    |
    |  | Fast reads,  |  |  | State mgmt   |          |                    |
    |  | ad-hoc       |  |  | Drift detect |          |                    |
    |  | scripts      |  |  | Rollback     |          |                    |
    |  +--------------+  |  +--------------+          |                    |
    +--------------------+----------------------------+--------------------+
                         |    |         |         |
                +--------+    +---+     +---+     +--------+
                |                 |         |              |
           +----v-----+    +-----v---+  +--v-----+  +-----v------+
           |   AWS    |    |  Azure  |  |  GCP   |  |  Alibaba   |
           | Native   |    | ARM     |  | REST   |  | ACS3-HMAC  |
           | SDK v3   |    | Pipeline|  | + Auth |  | + fetch    |
           | 421 svcs |    | 240+    |  | 305    |  | 323 svcs   |
           +----------+    +---------+  +--------+  +------------+
```

---

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

---

## Why cloud-pilot?

If you're a developer with Claude Code or Cursor and your own AWS credentials, you don't need this — just run `aws` CLI commands directly. The AI already knows the CLI syntax, and you trust yourself with admin access.

**cloud-pilot exists for when the thing talking to your cloud isn't you in a terminal.** It's the control plane between untrusted or semi-trusted AI agents and your cloud accounts.

### SaaS product — Cloud Copilot for your customers

You build a platform where customers connect their AWS/Azure/GCP accounts and their teams manage infrastructure through a chat interface. You can't give the AI raw credentials — you need read-only mode for junior engineers, read-write for seniors, a full audit trail for compliance, and service allowlists so nobody accidentally touches production databases. Cloud-pilot is the middleware that makes this safe.

### Internal DevOps portal

Your company has 50 engineers. Instead of giving everyone AWS console access with broad IAM policies, you deploy cloud-pilot behind an internal chat interface. Engineers ask "what's running in staging?" or "scale up the ECS service." The MCP enforces who can read vs write, logs every action, and the infra team reviews the audit trail. One set of credentials, controlled access, full visibility.

### Incident response bot

A PagerDuty alert fires at 3am. An automated agent connects via cloud-pilot, pulls CloudWatch metrics, checks EC2 instance status, grabs CloudTrail events, and posts a summary to Slack — all in read-only mode with a full audit log. No human needed for initial triage. No risk of the bot making things worse because it can't mutate anything.

### Multi-cloud management for consulting firms

A consulting firm manages AWS, Azure, and GCP for different clients. One MCP server per client, each with Vault-sourced credentials, allowlists scoped to their environment, and separate audit logs. Consultants use whatever AI tool they prefer — Claude, ChatGPT, Cursor — all go through cloud-pilot. Client switches providers? Reconfigure the MCP, the agent workflow doesn't change.

### CI/CD pipeline intelligence

An agent in your deployment pipeline uses cloud-pilot to verify infrastructure state before and after deployments — checks security groups, validates IAM policies, confirms RDS snapshots exist. Read-only, fully audited, no credentials in the pipeline config. If something looks wrong, it blocks the deploy and explains why.

---

## Agents That Act, Not Advise

Most AI cloud tools generate plans for a human to run. cloud-pilot is the only path where the agent can actually **execute, observe results, and react** — detecting that a NAT Gateway is still pending, polling until available, then adding the route. Without it, that's a "run this, wait, then run this" conversation with you in the middle.

### What this looks like in practice

In a real deployment of a three-tier AWS architecture (VPC, ALB, ASG, RDS), cloud-pilot enabled the agent to:

1. **Live state awareness** — discovered the account only had a default VPC, adjusted the entire plan before writing a line of infrastructure
2. **Error recovery** — hit a `Buffer not defined` error in the sandbox, immediately rewrote with a manual base64 encoder, no interruption to the user
3. **Sequential dependencies** — NAT Gateway ready &rarr; route added &rarr; ASG healthy &rarr; RDS status check, all chained autonomously in a single execute call
4. **Guardrail enforcement** — cloud-pilot blocked bad API calls (wrong parameter casing, out-of-scope services) before they reached the cloud provider

**The core value: the AI becomes an actor, not an advisor.** cloud-pilot turns "here's a Terraform file, go run it" into an agent that deploys, observes, fixes, and confirms — all in one session.

---

## Enterprise Integration

cloud-pilot speaks MCP (Model Context Protocol), which means any AI platform that supports MCP can leverage it as a cloud control plane. Here's how this works in real enterprise environments:

### ServiceNow + cloud-pilot

A ServiceNow Virtual Agent receives an infrastructure request ("provision a staging environment for the payments team"). Instead of routing to a human, the workflow:

1. ServiceNow creates a change request with approval gates
2. Once approved, triggers an MCP-connected agent with cloud-pilot
3. The agent executes the full provisioning — VPC, subnets, security groups, compute, database — using cloud-pilot's `execute` tool in `read-write` mode scoped to the staging account
4. cloud-pilot's audit log feeds back into ServiceNow as the change implementation record
5. If anything fails, the agent rolls back and updates the ticket with diagnostics

The ServiceNow agent never needs cloud credentials in its config. cloud-pilot handles auth (via Vault, IAM roles, or managed identity), enforces allowlists so the agent can't touch production, and logs every API call for compliance.

### Microsoft Teams / Slack + cloud-pilot

An infrastructure bot in Teams receives: "what's the status of our EKS clusters?" The bot connects to cloud-pilot in `read-only` mode:

```
User (Teams):  "Why is the staging API slow?"
Bot:           → search("describe EKS cluster")
               → execute(eks:DescribeCluster, ec2:DescribeInstances, cloudwatch:GetMetricData)
               "The staging EKS cluster has 2/3 nodes in NotReady state.
                CPU across the healthy node is at 94%. Recommending a
                node group scale-up. Want me to submit a change request?"
User (Teams):  "Yes"
Bot:           → Creates ServiceNow CR → on approval → execute(eks:UpdateNodegroupConfig)
```

The same bot works across AWS, Azure, and GCP — one cloud-pilot server, one conversation model. Engineering teams don't need console access, CLI tools, or cloud-specific training. They ask questions in natural language and get answers grounded in live infrastructure state.

### Why MCP makes this possible

Traditional integrations require per-cloud, per-service API wrappers. A ServiceNow integration for AWS EC2 is different from one for Azure VMs is different from one for GCP Compute Engine. Each needs custom code, custom auth, custom error handling.

With cloud-pilot as the MCP layer:
- **One integration point** — connect your AI platform to cloud-pilot once, get all clouds
- **One security model** — read-only for chat bots, read-write for approved workflows, full audit trail
- **One conversation** — the agent discovers APIs at runtime, so new cloud services are available without integration updates
- **One audit log** — every action across every cloud, in one place, mapped to the user/ticket/workflow that triggered it

---

## Infrastructure Lifecycle with OpenTofu

cloud-pilot integrates [OpenTofu](https://opentofu.org) (open-source Terraform) as a third tool, giving AI agents full infrastructure lifecycle management with state tracking, dependency resolution, and rollback.

### Why not just use the execute tool?

The `execute` tool is fast and flexible — perfect for reads, ad-hoc queries, and scripted multi-step operations. But it's **stateless**. If an agent creates 14 resources across a VPC and something fails on resource #12, there's no record of what was created and no way to roll back.

OpenTofu solves this:

| Capability | execute (SDK) | tofu (OpenTofu) |
|---|---|---|
| Speed | Fast (direct API calls) | Slower (plan + apply cycle) |
| State tracking | None | Full state file with every resource attribute |
| Dependency graph | Manual | Automatic (knows subnets depend on VPC) |
| Drift detection | Manual describe calls | `tofu plan` shows any drift |
| Rollback | Manual (delete in reverse order) | `tofu destroy` handles dependency order |
| Import existing | N/A | `tofu import` adopts resources into state |
| Multi-resource changes | Script it yourself | Declarative — describe desired state |

### The three-tool workflow

```
1. search   → "What APIs exist for VPC, subnets, ALB?"
2. execute  → Read current state: "What VPCs exist? What's running?"
3. tofu     → Write HCL → plan → review → apply → state tracked
             → Later: plan (drift check) → destroy (clean rollback)
```

### Example: Deploy and rollback

```
Agent: "Deploy a three-tier architecture in us-east-1"

→ tofu write (workspace: "prod-web", hcl: VPC + subnets + ALB + ASG + RDS)
→ tofu init
→ tofu plan
    Plan: 14 to add, 0 to change, 0 to destroy.
    + aws_vpc.main
    + aws_subnet.public_1, public_2
    + aws_subnet.private_1, private_2
    + aws_internet_gateway.main
    + aws_nat_gateway.main
    + aws_lb.main
    + aws_autoscaling_group.app
    + aws_db_instance.main
    ...
→ tofu apply
    Apply complete! Resources: 14 added.

--- One week later ---

Agent: "Tear down the prod-web environment"

→ tofu destroy (workspace: "prod-web")
    Destroy complete! Resources: 14 destroyed.
    (NAT Gateway before route tables, subnets before VPC — dependency order)
```

### Example: Import existing resources

Already have infrastructure that wasn't created through cloud-pilot? Import it:

```
→ tofu write (hcl: resource "aws_vpc" "legacy" { cidr_block = "10.0.0.0/16" })
→ tofu import (resource: "aws_vpc.legacy", id: "vpc-0abc123")
    Import successful!
→ tofu state
    aws_vpc.legacy
→ tofu plan
    No changes. Your infrastructure matches the configuration.
```

Now that VPC is state-tracked. Future changes go through plan/apply, and destroy handles cleanup.

### Example: Drift detection

```
Agent: "Has anything changed in prod-web since last apply?"

→ tofu plan (workspace: "prod-web")
    Note: Objects have changed outside of OpenTofu
    ~ aws_security_group.web: ingress rules changed
        + ingress rule: 0.0.0.0/0 → port 22 (SSH)

    Someone opened SSH to the world. This was not in the HCL config.
```

The agent detects unauthorized changes and can either fix them (`tofu apply` to revert) or update the HCL to match.

### Configuration

All OpenTofu settings are configurable via `config.yaml` or environment variables, so developers can adjust state storage based on where and how their MCP server runs.

```yaml
tofu:
  enabled: true
  workspacesDir: ~/.cloud-pilot/tofu-workspaces  # Where workspaces and local state live
  binary: tofu                                    # Path to OpenTofu binary
  stateBackend: local                             # local | s3 | http | consul | pg
  timeoutMs: 300000                               # 5 min timeout for long operations
```

#### State backends

Choose a backend based on your deployment model:

**Local** (default) — state files on disk. Simple, no dependencies. Good for single-user or development.

```yaml
tofu:
  stateBackend: local
  workspacesDir: /persistent/volume/tofu-workspaces  # Must be persistent storage
```

**S3** — state in S3 with optional DynamoDB locking. Best for multi-agent AWS environments.

```yaml
tofu:
  stateBackend: s3
  stateConfig:
    bucket: my-company-tofu-state
    region: us-east-1
    dynamodbTable: tofu-locks     # Optional: enables state locking
    encrypt: true                 # Optional: encrypt state at rest
```

**HTTP** — state via HTTP API. Compatible with HashiCorp Vault, Consul, or any custom backend.

```yaml
tofu:
  stateBackend: http
  stateConfig:
    address: https://vault.internal/v1/secret/data/tofu-state
    username: tofu-agent          # Optional: basic auth
    password: ${VAULT_TOKEN}
```

**Consul** — state in Consul KV store with built-in locking.

```yaml
tofu:
  stateBackend: consul
  stateConfig:
    address: consul.internal:8500
    path: cloud-pilot/tofu-state  # KV path prefix
```

**PostgreSQL** — state in a PostgreSQL database. Good for teams with existing Postgres infrastructure.

```yaml
tofu:
  stateBackend: pg
  stateConfig:
    connStr: postgres://user:pass@db.internal/tofu_state
    schemaName: cloud_pilot       # Optional: schema isolation
```

#### Environment variable overrides

All tofu settings can be overridden via environment variables, useful for Docker deployments and CI/CD:

| Variable | Overrides | Example |
|----------|-----------|---------|
| `CLOUD_PILOT_TOFU_ENABLED` | `tofu.enabled` | `true` |
| `CLOUD_PILOT_TOFU_WORKSPACES_DIR` | `tofu.workspacesDir` | `/data/tofu-workspaces` |
| `CLOUD_PILOT_TOFU_BINARY` | `tofu.binary` | `/usr/local/bin/tofu` |
| `CLOUD_PILOT_TOFU_STATE_BACKEND` | `tofu.stateBackend` | `s3` |

Example Docker deployment with S3 state:

```bash
docker run -d \
  -e CLOUD_PILOT_TOFU_ENABLED=true \
  -e CLOUD_PILOT_TOFU_STATE_BACKEND=s3 \
  -e CLOUD_PILOT_TOFU_WORKSPACES_DIR=/data/workspaces \
  -v tofu-workspaces:/data/workspaces \
  ghcr.io/vitalemazo/cloud-pilot-mcp:latest
```

Credentials are automatically injected from cloud-pilot's auth provider (Vault, env, Azure AD) into the OpenTofu process. No separate credential configuration needed.

### When to use which tool

| Scenario | Tool | Why |
|---|---|---|
| "What instances are running?" | `execute` | Fast read, no state needed |
| "What APIs does EKS have?" | `search` | API discovery |
| "Create a VPC with 6 subnets" | `tofu` | Stateful, rollbackable |
| "Check CloudWatch metrics" | `execute` | Read-only, ad-hoc |
| "Deploy a full environment" | `tofu` | Complex, needs dependency ordering |
| "Emergency: scale up ASG" | `execute` | Fast, single API call |
| "Tear down staging" | `tofu` | Clean destroy in dependency order |
| "What changed since last deploy?" | `tofu plan` | Drift detection |

---

## Real-World Use Cases

The following examples show what agents can accomplish through cloud-pilot's three-tool pattern — discovering APIs, executing against live state, and managing stateful infrastructure lifecycle in a single conversation.

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

---

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

---

## Configure Credentials

Credentials are discovered automatically using each cloud provider's native SDK credential chain. If you have a CLI installed and authenticated, it just works — no `.env` file needed.

| Provider | Auto-Discovery Sources (checked in order) |
|----------|------------------------------------------|
| **AWS** | Environment vars -> `~/.aws/credentials` -> `~/.aws/config` (profiles/SSO) -> IMDS/ECS container role |
| **Azure** | Environment vars -> `az login` session -> Managed Identity -> VS Code / PowerShell |
| **GCP** | Environment vars -> `gcloud auth` session (`~/.config/gcloud`) -> `GOOGLE_APPLICATION_CREDENTIALS` -> metadata server |
| **Alibaba** | Environment vars -> `~/.alibabacloud/credentials` -> `~/.aliyun/config.json` -> ECS RAM role |

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

### Vault Integration

For production deployments, credentials can be sourced from **HashiCorp Vault** via AppRole auth. This keeps secrets out of config files and environment variables.

<details>
<summary><b>Step 1: Create Vault Secrets</b></summary>

Create a secret for each cloud provider at `secret/cloud-pilot/{provider}`. The server reads from `{secretPath}/{provider}` and maps fields automatically.

**AWS example:**
```bash
vault kv put secret/cloud-pilot/aws \
  access_key_id="AKIA..." \
  secret_access_key="..." \
  region="us-east-1"
```

**Expected key names per provider:**

| Provider | Required Keys | Optional Keys |
|----------|--------------|---------------|
| **AWS** | `access_key_id`, `secret_access_key` | `session_token`, `region` (default: us-east-1) |
| **Azure** | `tenant_id`, `client_id`, `client_secret` | `subscription_id` |
| **GCP** | `access_token`, `project_id` | |
| **Alibaba** | `access_key_id`, `access_key_secret` | `security_token`, `region` (default: cn-hangzhou) |

</details>

<details>
<summary><b>Step 2: Create an AppRole</b></summary>

Create a Vault AppRole with read access to the secret path:

```bash
# Enable AppRole auth (if not already)
vault auth enable approle

# Create a policy
vault policy write cloud-pilot - <<EOF
path "secret/data/cloud-pilot/*" {
  capabilities = ["read"]
}
EOF

# Create the AppRole
vault write auth/approle/role/cloud-pilot \
  token_policies="cloud-pilot" \
  token_ttl=1h \
  token_max_ttl=4h

# Get the role ID and secret ID
vault read auth/approle/role/cloud-pilot/role-id
vault write -f auth/approle/role/cloud-pilot/secret-id
```

</details>

<details>
<summary><b>Step 3: Configure cloud-pilot</b></summary>

Set `auth.type: vault` in `config.yaml`:

```yaml
auth:
  type: vault
  vault:
    address: https://vault.example.com
    roleId: "905670cc-..."       # or VAULT_ROLE_ID env var
    secretId: "6e84df5b-..."     # or VAULT_SECRET_ID env var
    secretPath: secret/data/cloud-pilot   # KV v2 API path (includes data/)
```

> **Important:** For KV v2 secret engines (the default), `secretPath` must include `data/` in the path. The server reads via the HTTP API directly, which requires the full KV v2 path: `secret/data/cloud-pilot`, not `secret/cloud-pilot`. The `vault kv` CLI handles this prefix automatically, but the HTTP API does not.

Or configure via environment variables:

```bash
export VAULT_ADDR="https://vault.example.com"
export VAULT_ROLE_ID="905670cc-..."
export VAULT_SECRET_ID="6e84df5b-..."
```

</details>

<details>
<summary><b>Step 4: Verify</b></summary>

Test the connection before starting the server:

```bash
# Verify AppRole login works
vault write auth/approle/login \
  role_id="$VAULT_ROLE_ID" \
  secret_id="$VAULT_SECRET_ID"

# Verify secret is readable
vault kv get secret/cloud-pilot/aws
```

</details>

### Resilient Provider Initialization

Each provider initializes independently. If one provider's credentials are unavailable (e.g., no AWS CLI configured), the server starts with the remaining providers instead of failing entirely. Check the startup logs to see which providers loaded:

```
[cloud-pilot] Provider "aws" initialized (read-only, region: us-east-1)
[cloud-pilot] WARNING: Failed to initialize provider "azure": Azure credentials not found...
[cloud-pilot] Providers: aws
```

---

## Run with Docker

```bash
docker pull ghcr.io/vitalemazo/cloud-pilot-mcp:latest
docker run -p 8400:8400 --env-file .env ghcr.io/vitalemazo/cloud-pilot-mcp:latest
```

Or with docker-compose:
```bash
docker-compose up -d
```

---

## Connect to Your MCP Client

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

---

## Platform Integration Examples

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

---

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
    dryRunPolicy: optional   # enforced | optional | disabled
    allowedServices: []      # Empty = all services
    blockedActions: []

  - type: azure
    region: eastus
    mode: read-only
    dryRunPolicy: optional
    subscriptionId: "..."

  - type: gcp
    region: us-central1
    mode: read-only
    dryRunPolicy: optional

  - type: alibaba
    region: cn-hangzhou
    mode: read-only
    dryRunPolicy: optional

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

tofu:
  enabled: false             # Enable OpenTofu infrastructure lifecycle tool
  workspacesDir: /data/tofu-workspaces  # Persistent workspace storage
  binary: tofu               # Path to OpenTofu binary
  stateBackend: local        # local | s3 | http
  # stateConfig:             # Backend-specific config
  #   bucket: my-state-bucket  # For s3 backend
  #   region: us-east-1
  timeoutMs: 300000          # 5 minute timeout for plan/apply
```

### Environment Variable Overrides

| Variable | Overrides |
|----------|-----------|
| `TRANSPORT` | `transport` |
| `HTTP_PORT` / `HTTP_HOST` / `HTTP_API_KEY` | `http.*` |
| `AUTH_TYPE` | `auth.type` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | AWS credentials |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_SUBSCRIPTION_ID` | Azure credentials |
| `GOOGLE_APPLICATION_CREDENTIALS` / `GCP_PROJECT_ID` | GCP credentials |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_REGION` | Alibaba credentials |
| `CLOUD_PILOT_SPECS_DYNAMIC` / `CLOUD_PILOT_SPECS_OFFLINE` | `specs.*` |
| `CLOUD_PILOT_TOFU_ENABLED` | `tofu.enabled` |
| `CLOUD_PILOT_TOFU_WORKSPACES_DIR` | `tofu.workspacesDir` |
| `CLOUD_PILOT_TOFU_BINARY` | `tofu.binary` |
| `CLOUD_PILOT_TOFU_STATE_BACKEND` | `tofu.stateBackend` |
| `CLOUD_PILOT_PERSONA_ENABLED` | `persona.enabled` (set `false` to disable persona) |
| `GITHUB_TOKEN` | Increases GitHub API rate limit (60/hr -> 5,000/hr) |

---

## Dynamic API Discovery

The server discovers APIs at runtime using a three-tier system:

```
  Request: "create transit gateway"
       |
       v
  +------------------+     +--------------------+     +------------------+
  |  Tier 1: Catalog |---->|  Tier 2: Op Index  |---->|  Tier 3: Spec   |
  +------------------+     +--------------------+     +------------------+
  | 1,289 services   |     | 51,900+ operations |     | Full params,    |
  | Names + metadata |     | Keyword-searchable |     | response types, |
  | Cached 7 days    |     | Built progressively|     | documentation   |
  | 1 API call/init  |     | Cached to disk     |     | Fetched on-demand|
  +------------------+     +--------------------+     | Cached 30 days  |
                                                      | LRU mem (10)    |
                                                      +------------------+
```

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

---

## Safety Model

The agent never gets raw credentials. Code executes in a sandboxed environment with only `console.log` and `sdk.request()` available — no filesystem, network, process, or Node.js API access. Credentials live in the host process and are never exposed to the sandbox.

```
  +--------------------------------------------------+
  |              Credential Isolation                  |
  |                                                    |
  |   Host Process            Sandbox                  |
  |  +---------------+    +--------------------+       |
  |  | AWS keys      |    |  sdk.request()     |       |
  |  | Azure tokens  |<-->|  bridge only       |       |
  |  | GCP tokens    |    |                    |       |
  |  | Alibaba keys  |    |  No fs / no net    |       |
  |  +---------------+    |  No process access |       |
  |                        +--------------------+       |
  +--------------------------------------------------+
```

| Control | How It Works |
|---------|-------------|
| **Read-only mode** | Blocks mutating operations. Default for all providers. |
| **Service allowlist** | Only configured services can be called. Empty = all allowed. |
| **Action blocklist** | Specific dangerous operations permanently blocked. |
| **Dry-run system** | 4-level validation: native cloud provider dry-run, session-enforced gate, impact summaries, rollback planning. Configurable per provider. |
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

### Dry-Run System

cloud-pilot includes a 4-level dry-run system that validates infrastructure changes before they happen. The behavior is configurable per provider via the `dryRunPolicy` setting.

#### Configuration

```yaml
providers:
  - type: aws
    mode: read-write
    dryRunPolicy: enforced    # enforced | optional | disabled
```

| Policy | Behavior | Use Case |
|--------|----------|----------|
| **`enforced`** | Mutating calls are **rejected** unless a matching `dryRun: true` call was made first in the same session. The server enforces this — the agent cannot skip it. | Interactive sessions (Claude Code, Cursor, Teams bots with human in the loop) |
| **`optional`** (default) | Dry-run is available and produces full validation/impact output, but the agent can execute without it. | Approved automation (ServiceNow post-approval workflows, CI/CD pipelines where the approval gate IS the safety check) |
| **`disabled`** | Dry-run returns basic call info with no cloud-side validation, no impact summary, and no session tracking. Zero overhead. | Read-only monitoring bots, fully trusted automation |

#### The 4 Levels

**Level 1 — Native cloud provider validation**

For AWS EC2 operations, cloud-pilot sends the actual API call with `DryRun=true` to AWS. AWS validates IAM permissions, resource quotas, CIDR conflicts, and other constraints — returning success or a specific failure reason — without creating any resources. Non-EC2 services get client-side validation (command exists, service is allowed).

```
DRY RUN: CreateVpc
  validation: { validated: true, validationSource: "aws-native" }
```

**Level 2 — Session-enforced gate** (requires `dryRunPolicy: enforced`)

Every mutating operation (Create, Delete, Update, Attach, etc.) must be dry-run'd before the real call. The server tracks a hash of each `(service, action, params)` tuple that has been dry-run'd in the session. If a real call doesn't have a matching dry-run, it's rejected:

```
ERROR: Mutating action "CreateVpc" requires a dry-run first (dryRunPolicy: enforced).
       Call execute with dryRun: true before executing this operation.
```

**Level 3 — Impact summary**

Every dry-run response includes a human-readable impact analysis:

```
impact: {
  description: "Create Vpc on ec2",
  actionType: "create",
  reversible: true,
  reverseAction: "DeleteVpc",
  warnings: []
}
```

For cost-incurring resources, warnings are included:
- `"NAT Gateway incurs charges (~$32/mo + data processing)"`
- `"Application Load Balancer incurs charges (~$16/mo + LCU)"`
- `"This action may not be reversible"` (for deletes)

**Level 4 — Session changeset and rollback plan**

cloud-pilot tracks every resource created or modified during the session, extracts resource IDs from responses, and maintains a reverse-order rollback plan:

```
Session resources:
  + ec2:CreateVpc vpc-0abc123 (Vpc)
  + ec2:CreateSubnet subnet-0def456 (Subnet)
  + ec2:CreateInternetGateway igw-0ghi789 (InternetGateway)

Rollback plan:
  1. ec2:DeleteInternetGateway (igw-0ghi789)
  2. ec2:DeleteSubnet (subnet-0def456)
  3. ec2:DeleteVpc (vpc-0abc123)
```

If a deployment fails mid-way, the rollback plan shows exactly what to clean up, in the correct dependency order.

#### Example: ServiceNow vs Claude Code

A **ServiceNow workflow** that's already been through change management approval:
```yaml
# ServiceNow integration config
providers:
  - type: aws
    mode: read-write
    dryRunPolicy: optional    # Approval gate is the safety check
```

An **interactive Claude Code session** where a human reviews each step:
```yaml
# Developer config
providers:
  - type: aws
    mode: read-write
    dryRunPolicy: enforced    # Force dry-run before every mutation
```

A **read-only monitoring bot** in Slack:
```yaml
# Monitoring bot config
providers:
  - type: aws
    mode: read-only
    dryRunPolicy: disabled    # Read-only, no mutations possible
```

### Sandbox Isolation Levels

cloud-pilot ships with a **Node.js `vm` sandbox** — a V8 context with no access to Node.js APIs. This provides credential isolation and is suitable for development, internal tools, and trusted AI agent workloads.

For **production deployments** where untrusted users or third-party agents submit code, the sandbox should be upgraded to a hardened isolation layer. The `executeInSandbox` interface is designed for this — swap the implementation, everything else stays the same.

| Isolation Level | Technology | Platform | Use Case |
|----------------|------------|----------|----------|
| **Soft sandbox** (default) | Node.js `vm.createContext()` | Any (macOS, Linux, Windows) | Development, internal tools, trusted AI agents |
| **Container isolation** | [Docker](https://www.docker.com/) / [Podman](https://podman.io/) | Any | Multi-tenant SaaS, customer-submitted code |
| **MicroVM isolation** | [Firecracker](https://github.com/firecracker-microvm/firecracker) | Linux (KVM) | High-security, per-execution throwaway VMs (what AWS Lambda uses) |
| **Permission-based** | [Deno](https://deno.com/) | Any (macOS, Linux, Windows) | Fine-grained permission control (--allow-net, --allow-read) |

To upgrade, replace `src/sandbox/runtime.ts` with an implementation that spins up a container or microVM, injects the code and bridge, and returns the result. The interface is a single function:

```typescript
executeInSandbox(code: string, bridge: RequestBridge, options: SandboxOptions): Promise<SandboxResult>
```

---

## HTTP Transport Security

When running as a Streamable HTTP service, the server includes:

| Feature | Details |
|---------|---------|
| **API key auth** | Bearer token or `x-api-key` header. Optional — set `HTTP_API_KEY` to enable. |
| **CORS** | Configurable allowed origins. Preflight handling. MCP session headers exposed. |
| **Rate limiting** | Sliding window per client IP. Default 60 req/min, configurable. |
| **Request logging** | Every request logged: status code, method, URL, duration, client IP. |
| **Health endpoint** | `GET /health` returns provider status and uptime. Bypasses auth for monitoring. |

---

## CI/CD Pipeline

Every push to `main` triggers an automated pipeline:

```
  Push to main
       |
       +---> CI --------> Docker ---------> Registry
       |     |             |                  |
       |     typecheck     tests pass?        ghcr.io/vitalemazo/
       |     build         |                  cloud-pilot-mcp
       |     unit tests    build image        :latest :main :sha
       |     smoke test    push to GHCR
       |                   verify container
       |
       +---> Monthly: refresh bundled API catalogs (GitHub Action)
```

- **CI gate**: Docker image is only built after all tests pass
- **Image**: `ghcr.io/vitalemazo/cloud-pilot-mcp:latest`
- **Tags**: `:latest`, `:main`, `:sha` (short commit hash)
- **Cache**: GitHub Actions layer cache for fast rebuilds
- **Verify**: Post-push pulls and runs the container to confirm it starts

---

## Project Structure

```
src/
+-- index.ts                     # Entrypoint: config, wiring, HTTP server with auth/CORS/rate limiting
+-- server.ts                    # MCP server: tools, persona, resources, prompts
+-- config.ts                    # YAML + env config loader with Zod validation
|
+-- interfaces/                  # Pluggable contracts
|   +-- auth.ts                  #   AuthProvider: getCredentials(), isExpired()
|   +-- cloud-provider.ts        #   CloudProvider: searchSpec(), call(), listServices()
|   +-- audit.ts                 #   AuditLogger: log(), query()
|
+-- tools/
|   +-- search.ts                # search tool: spec discovery, formatted results
|   +-- execute.ts               # execute tool: sandbox orchestration, dry-run
|
+-- specs/                       # Dynamic API discovery system
|   +-- types.ts                 #   CatalogEntry, OperationIndexEntry, SpecsConfig
|   +-- dynamic-spec-index.ts    #   Three-tier lazy-loading spec index (all providers)
|   +-- spec-fetcher.ts          #   GitHub Trees API + CDN + Google Discovery + Alibaba API
|   +-- spec-cache.ts            #   Disk cache with TTL-based expiration
|   +-- operation-index.ts       #   Cross-service keyword search (all provider extractors)
|   +-- lru-cache.ts             #   In-memory LRU eviction for full specs
|
+-- providers/
|   +-- aws/
|   |   +-- provider.ts          #   SigV4 calls, mutating-prefix safety
|   |   +-- specs.ts             #   Botocore JSON parser
|   |   +-- signer.ts            #   AWS Signature Version 4
|   +-- azure/
|   |   +-- provider.ts          #   ARM REST calls, HTTP-method safety
|   |   +-- specs.ts             #   Swagger/OpenAPI parser
|   +-- gcp/
|   |   +-- provider.ts          #   Google REST calls, HTTP-method safety
|   |   +-- specs.ts             #   Google Discovery Document parser
|   +-- alibaba/
|       +-- provider.ts          #   Alibaba RPC calls, mutating-prefix safety
|       +-- signer.ts            #   ACS3-HMAC-SHA256
|
+-- persona/                     # Cloud engineering persona system
|   +-- index.ts                 #   Barrel export
|   +-- instructions.ts          #   Dynamic MCP instructions builder (provider-aware)
|   +-- provider-profiles.ts     #   Deep expertise docs: AWS, Azure, GCP, Alibaba
|   +-- resources.ts             #   MCP resources: cloud-pilot://persona/*, cloud-pilot://safety/*
|   +-- prompts.ts               #   6 workflow prompts: landing-zone, incident-response, etc.
|
+-- auth/
|   +-- env.ts                   #   Auto-discovery credential chain (all CLIs/SDKs)
|   +-- vault.ts                 #   HashiCorp Vault AppRole (all 4 providers)
|   +-- azure-ad.ts              #   Azure AD OAuth2 client credentials
|
+-- audit/
|   +-- file.ts                  #   Append-only JSON audit log
|
+-- sandbox/
    +-- runtime.ts               #   QuickJS WASM sandbox with timeout + memory limits
    +-- api-bridge.ts            #   sdk.request() bridge: connects sandbox to providers

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

---

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

---

## Troubleshooting

### "No providers are currently configured"

This is the most common issue. The server started but no cloud providers initialized successfully. Provider failures are non-fatal — the server logs a warning to stderr and continues without the failed provider.

**Check the logs.** The server logs to stderr. Look for lines like:
```
[cloud-pilot] WARNING: Failed to initialize provider "aws": <reason>
```

Common causes:

#### 1. Credentials not found or invalid

- **env auth**: Verify your CLI is authenticated (`aws sts get-caller-identity`, `az account show`, etc.)
- **vault auth**: Verify AppRole login works and the secret path is correct (see [Vault Integration](#vault-integration))
- **Expired tokens**: Vault tokens and cloud provider sessions expire. Re-authenticate and restart the server.

#### 2. Config file not found

The server looks for config in this order: `$CLOUD_PILOT_CONFIG` env var, `config.local.yaml`, `config.yaml` — all relative to the **working directory**. When an MCP client spawns the server as a subprocess, the working directory may not be the project root.

**Fix:** The server automatically resolves its project root from the script location, but if you've moved `dist/index.js` or are running from a symlink, set the config path explicitly:

```bash
export CLOUD_PILOT_CONFIG=/absolute/path/to/config.yaml
```

Or in your MCP client config:
```json
{
  "mcpServers": {
    "cloud-pilot": {
      "command": "node",
      "args": ["/path/to/cloud-pilot-mcp/dist/index.js"],
      "env": {
        "CLOUD_PILOT_CONFIG": "/path/to/cloud-pilot-mcp/config.yaml"
      }
    }
  }
}
```

#### 3. Vault `secretPath` missing `data/` prefix

If using Vault KV v2 (the default since Vault 1.1), the HTTP API path must include `/data/`:

| Vault CLI command | HTTP API path (for `secretPath`) |
|---|---|
| `vault kv get secret/cloud-pilot/aws` | `secret/data/cloud-pilot` |
| `vault kv get kv/myapp/aws` | `kv/data/myapp` |

The `vault kv` CLI adds the `/data/` prefix automatically. The server's Vault client uses the HTTP API directly, so you must include it.

#### 4. Vault secret key naming mismatch

The server expects specific key names in each Vault secret. If your existing secrets use different names (e.g., `access_key` instead of `access_key_id`), the credentials will be `undefined` and the provider will fail.

See the [expected key names table](#vault-integration) and verify your secrets match:

```bash
vault kv get -format=json secret/cloud-pilot/aws | jq '.data.data | keys'
# Should output: ["access_key_id", "region", "secret_access_key"]
```

### Provider initialized but search returns no results

The operation index builds progressively in the background after first startup. If you search immediately after a cold start, results may be limited. Watch stderr for:

```
[cloud-pilot] Starting background operation index build for aws...
[cloud-pilot] Background index build complete for aws
```

Pre-download specs for faster cold starts:
```bash
npm run download-specs
```

### Testing provider connectivity

Verify credentials work end-to-end before debugging the MCP layer:

```bash
# Direct test (from the project directory)
node -e "
  const { loadConfig } = await import('./dist/config.js');
  const { VaultAuthProvider } = await import('./dist/auth/vault.js');
  const config = loadConfig();
  const auth = new VaultAuthProvider(config.auth.vault);
  const creds = await auth.getCredentials('aws');
  console.log('Keys:', Object.keys(creds.aws));
  console.log('Has accessKeyId:', !!creds.aws.accessKeyId);
  console.log('Region:', creds.aws.region);
"
```

For env auth, verify the CLI works:
```bash
aws sts get-caller-identity   # AWS
az account show               # Azure
gcloud auth print-access-token # GCP
```

---

## Author

**Vitale Mazo** — [github.com/vitalemazo](https://github.com/vitalemazo)

Sole author and copyright holder. All intellectual property rights, including the search-and-execute pattern for dynamic cloud API discovery via sandboxed execution, are retained by the author.

## License

MIT License. Copyright (c) 2026 Vitale Mazo. All rights reserved.

See [LICENSE](LICENSE) for full terms. The MIT license grants permission to use, modify, and distribute this software, but does not transfer copyright or patent rights.
