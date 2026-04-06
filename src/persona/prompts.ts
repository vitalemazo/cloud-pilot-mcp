// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProviderProfile } from "./provider-profiles.js";

export function registerPersonaPrompts(
  server: McpServer,
  providerNames: string[],
): void {
  const providerEnum = providerNames.length > 0 ? providerNames : ["aws"];
  const enumType = z.enum(providerEnum as [string, ...string[]]);

  server.prompt(
    "landing-zone",
    "Deploy a cloud landing zone with production-grade architecture, identity, networking, security, and governance",
    {
      provider: enumType.describe("Target cloud provider"),
      environment: z
        .enum(["production", "staging", "dev", "sandbox"])
        .default("production")
        .describe("Target environment tier"),
    },
    async ({ provider, environment }) => {
      const profile = getProviderProfile(provider);
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are a Senior Cloud Platform Engineer designing a **${environment} landing zone** on **${provider.toUpperCase()}**.

Design and deploy a complete landing zone following these phases:

## Phase 1: Organization & Governance
- Account/subscription/project hierarchy with isolation boundaries
- Naming conventions and tagging strategy (Environment, Team, CostCenter minimum)
- Policy guardrails (SCPs, Azure Policy, Org Policies) to prevent misconfigurations

## Phase 2: Identity Foundation
- Centralized identity provider configuration
- Role-based access model with least-privilege assignments
- Privileged access management (PIM/just-in-time elevation)
- Service/workload identity strategy (no long-lived credentials)

## Phase 3: Network Topology
- Hub-and-spoke or mesh network design with CIDR planning
- Centralized egress and ingress control (firewall, WAF)
- Private connectivity for all managed services
- DNS architecture (private zones, forwarding)
- Hybrid connectivity (VPN/dedicated connection) if applicable

## Phase 4: Security Baseline
- Threat detection and security monitoring services enabled
- Encryption at rest and in transit for all services
- Centralized logging and audit trail
- Vulnerability scanning and compliance monitoring

## Phase 5: Operational Readiness
- Centralized monitoring, alerting, and dashboards
- Backup and disaster recovery policies
- Cost management with budgets and alerts
- CI/CD pipeline for infrastructure deployment

${profile ? `\nReference the provider guide:\n${profile.content.slice(0, 2000)}` : ""}

Use the \`search\` tool to discover the specific APIs needed for each phase on ${provider.toUpperCase()}, then use \`execute\` to deploy. Verify each phase before proceeding to the next.`,
            },
          },
        ],
      };
    },
  );

  server.prompt(
    "incident-response",
    "Investigate and respond to a cloud security incident using provider-native security services",
    {
      provider: enumType.describe("Cloud provider where the incident occurred"),
      severity: z
        .enum(["critical", "high", "medium", "low"])
        .default("high")
        .describe("Incident severity level"),
    },
    async ({ provider, severity }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a Senior Cloud Security Engineer responding to a **${severity}-severity security incident** on **${provider.toUpperCase()}**.

Follow the incident response lifecycle:

## 1. Contain
- Identify the blast radius (affected accounts, regions, resources)
- Isolate compromised resources (revoke credentials, restrict network access, quarantine instances)
- Preserve evidence (snapshot disks, enable detailed logging, save flow logs)

## 2. Investigate
- Query threat detection services for findings and alerts
- Trace activity through audit logs (who, what, when, from where)
- Identify the attack vector (compromised credentials, misconfiguration, vulnerability exploit)
- Map the full scope of unauthorized access or changes

## 3. Eradicate
- Remove unauthorized access (delete rogue IAM entities, revoke sessions, rotate credentials)
- Patch or remediate the vulnerability that enabled the incident
- Remove any persistence mechanisms (backdoor accounts, modified policies, deployed resources)

## 4. Recover
- Restore affected resources from known-good state
- Re-enable services with hardened configuration
- Verify security posture through security service re-scan
- Monitor closely for 48-72 hours for re-compromise

## 5. Post-Incident
- Document timeline, root cause, impact, and remediation actions
- Identify detection gaps and create new monitoring rules
- Update security policies and guardrails to prevent recurrence

Use \`search\` to discover the security, audit, and IAM APIs on ${provider.toUpperCase()}, then \`execute\` to investigate and remediate. Log every action you take.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "cost-optimization",
    "Run a comprehensive cost optimization audit across cloud resources",
    {
      provider: enumType.describe("Cloud provider to audit"),
    },
    async ({ provider }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a Senior Cloud FinOps Engineer running a **cost optimization audit** on **${provider.toUpperCase()}**.

Systematically analyze and optimize across these categories:

## 1. Idle and Unused Resources
- Identify stopped/idle compute instances, unattached storage volumes, unused elastic IPs/public IPs
- Find load balancers with no targets, unused NAT gateways, empty resource groups
- Detect unused or low-utilization databases

## 2. Rightsizing
- Analyze compute instance CPU and memory utilization (target: 40-70% average)
- Check database instance metrics for over-provisioning
- Review container resource requests vs actual usage
- Generate specific resize recommendations with projected savings

## 3. Reserved Capacity and Commitments
- Identify workloads running 24/7 that qualify for reservations/savings plans/CUDs
- Calculate break-even and projected savings for 1-year and 3-year terms
- Check existing reservations for utilization and coverage gaps

## 4. Storage Optimization
- Review storage tiers — identify data that should be moved to infrequent access or archive
- Check for missing lifecycle policies on object storage
- Find old snapshots and backups beyond retention requirements

## 5. Network Costs
- Identify cross-AZ, cross-region, and internet egress traffic patterns
- Recommend VPC endpoints/Private Links to reduce data transfer costs
- Review CDN usage for cacheable content

## 6. Tagging and Accountability
- Audit resource tagging compliance (Environment, Team, CostCenter)
- Identify untagged resources and their estimated cost
- Recommend tag enforcement policies

Use \`search\` to discover cost management, monitoring, and resource listing APIs on ${provider.toUpperCase()}. Use \`execute\` to pull real data, analyze it, and present actionable recommendations with estimated savings.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "security-audit",
    "Run a comprehensive security posture review following provider best practices and CIS benchmarks",
    {
      provider: enumType.describe("Cloud provider to audit"),
    },
    async ({ provider }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a Senior Cloud Security Architect running a **comprehensive security audit** on **${provider.toUpperCase()}**.

Assess the security posture across these domains:

## 1. Identity and Access Management
- Audit root/global admin usage and MFA enforcement
- Review service accounts/principals — find those with excessive permissions or long-lived credentials
- Check for overly permissive policies (wildcard actions, unrestricted resource scope)
- Verify cross-account access patterns and trust relationships

## 2. Network Security
- Audit security groups/NSGs/firewall rules for overly broad ingress (0.0.0.0/0 on non-HTTP ports)
- Verify all managed services use private endpoints/private connectivity
- Check for public-facing resources that should be private
- Review VPN/interconnect configurations for secure hybrid connectivity

## 3. Encryption
- Verify encryption at rest is enabled on all storage, databases, and message queues
- Check encryption in transit (TLS enforcement, certificate validity)
- Audit key management — rotation policies, key access controls

## 4. Logging and Monitoring
- Verify audit logs are enabled in all regions and accounts
- Check that logs are shipped to a centralized, tamper-proof location
- Review alerting rules for critical security events (root login, policy changes, unauthorized API calls)
- Verify threat detection services are enabled and findings are actioned

## 5. Data Protection
- Check for publicly accessible storage (buckets, blobs, containers)
- Review backup policies and disaster recovery readiness
- Audit data retention and lifecycle policies

## 6. Compliance
- Run findings through the provider's security scoring service
- Identify critical and high findings that need immediate remediation
- Generate a prioritized remediation plan with effort estimates

Use \`search\` to discover security, IAM, and configuration APIs on ${provider.toUpperCase()}. Use \`execute\` to pull real security findings and present a prioritized remediation report.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "migration-assessment",
    "Assess workload migration readiness and plan a migration strategy",
    {
      provider: enumType.describe("Target cloud provider for migration"),
      source: z
        .string()
        .optional()
        .describe("Source environment (e.g., on-prem, aws, azure, gcp)"),
    },
    async ({ provider, source }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a Senior Cloud Migration Architect planning a **workload migration** to **${provider.toUpperCase()}**${source ? ` from **${source}**` : ""}.

Execute the migration assessment:

## 1. Discovery and Inventory
- Catalog all workloads, their dependencies, and current resource usage
- Identify data stores, their sizes, and data sensitivity classification
- Map network dependencies (internal, external, latency-sensitive)
- Document compliance and regulatory requirements that constrain placement

## 2. Migration Strategy (6 Rs)
For each workload, recommend one of:
- **Rehost** (lift-and-shift): Move as-is. Fastest, lowest risk.
- **Replatform** (lift-tinker-shift): Minor optimizations (e.g., managed database, container runtime).
- **Refactor**: Re-architect for cloud-native (microservices, serverless). Highest effort, highest long-term value.
- **Repurchase**: Replace with SaaS equivalent.
- **Retain**: Keep in current environment (not cost-effective or too risky to migrate now).
- **Retire**: Decommission — no longer needed.

## 3. Target Architecture
- Design the landing zone on ${provider.toUpperCase()} (network, identity, security baseline)
- Map source resources to target equivalents with sizing recommendations
- Plan data migration approach (online replication vs offline transfer vs hybrid)
- Design for HA and DR in the target environment

## 4. Migration Waves
- Group workloads into migration waves based on dependencies and risk
- Define success criteria and rollback procedures for each wave
- Estimate timeline and resource requirements per wave
- Identify pilot workloads for the first wave (low-risk, high-learning)

## 5. Risk and Cutover
- Identify migration risks (downtime tolerance, data consistency, DNS cutover)
- Plan for parallel running period and traffic shifting strategy
- Define go/no-go criteria for each cutover
- Post-migration validation checklist

Use \`search\` to discover compute, storage, network, and migration APIs on ${provider.toUpperCase()}. Analyze current resource usage and generate a concrete migration plan.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "well-architected-review",
    "Conduct a Well-Architected Framework review across all pillars",
    {
      provider: enumType.describe("Cloud provider to review"),
      pillar: z
        .enum([
          "all",
          "security",
          "reliability",
          "performance",
          "cost",
          "operations",
          "sustainability",
        ])
        .default("all")
        .describe("Specific pillar to focus on, or 'all' for comprehensive review"),
    },
    async ({ provider, pillar }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a Senior Cloud Architect conducting a **Well-Architected Review** on **${provider.toUpperCase()}**${pillar !== "all" ? `, focused on the **${pillar}** pillar` : " across all pillars"}.

${pillar === "all" || pillar === "security" ? `## Security Pillar
- Identity: Are all workloads using managed/federated identities? Is MFA enforced? Are permissions scoped to least privilege?
- Network: Are security groups/firewall rules tight? Are all PaaS services on private endpoints? Is ingress/egress controlled?
- Data: Is encryption at rest/in transit enabled everywhere? Are keys managed properly? Are backups encrypted?
- Detection: Are threat detection and security monitoring services active? Are findings reviewed and actioned?
- Incident: Is there an incident response plan? Are forensic capabilities in place (log retention, snapshots)?
` : ""}
${pillar === "all" || pillar === "reliability" ? `## Reliability Pillar
- Availability: Are workloads deployed across multiple AZs? Is there a multi-region DR strategy for critical systems?
- Fault tolerance: How does the system handle component failures? Are there circuit breakers, retries, and fallbacks?
- Recovery: Are backup and restore procedures tested? What is the RPO and RTO? Is there automated failover?
- Scaling: Can the system handle load spikes? Is auto-scaling configured with appropriate thresholds?
- Change management: Are deployments automated with rollback capability? Is there canary/blue-green deployment?
` : ""}
${pillar === "all" || pillar === "performance" ? `## Performance Pillar
- Compute: Are instance types/sizes appropriate for workload characteristics? Is there right-sizing data?
- Storage: Are the correct storage tiers and types being used? Is caching implemented where beneficial?
- Network: Is latency optimized (CDN, edge locations, regional placement)? Are there bottlenecks?
- Database: Are database engines matched to access patterns? Is read/write splitting implemented where needed?
- Monitoring: Are performance baselines established? Are there alerts for degradation?
` : ""}
${pillar === "all" || pillar === "cost" ? `## Cost Optimization Pillar
- Rightsizing: Are resources appropriately sized based on utilization data?
- Pricing models: Are reservations/savings plans/CUDs being used for steady-state workloads?
- Waste: Are there idle resources, orphaned storage, or unused allocations?
- Architecture: Are serverless/managed services used where they reduce total cost of ownership?
- Visibility: Is tagging enforced? Are budgets set with alerts? Is there regular cost review?
` : ""}
${pillar === "all" || pillar === "operations" ? `## Operational Excellence Pillar
- Observability: Are metrics, logs, and traces collected for all components? Is there a centralized dashboard?
- Automation: Is infrastructure deployed via IaC? Are operational procedures automated (patching, backup, scaling)?
- Runbooks: Do critical operations have documented runbooks? Are they tested regularly?
- On-call: Is there an alerting and escalation process? Are alerts actionable (not noisy)?
- Continuous improvement: Are post-incident reviews conducted? Are findings tracked to resolution?
` : ""}
${pillar === "all" || pillar === "sustainability" ? `## Sustainability Pillar
- Efficiency: Are workloads running on the most efficient instance types (e.g., ARM/Graviton)?
- Utilization: Are resources scaled to demand (auto-scaling to zero when idle)?
- Data: Are data retention policies in place to avoid storing unnecessary data?
- Region: Is workload placement optimized for low-carbon energy regions where feasible?
` : ""}
Use \`search\` to discover configuration, monitoring, and security APIs on ${provider.toUpperCase()}. Use \`execute\` to pull actual resource configurations and assess them against each pillar's criteria. Present findings as a scored report with prioritized recommendations.`,
          },
        },
      ],
    }),
  );
}
