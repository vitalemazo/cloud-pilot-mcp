// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface ProviderProfile {
  provider: string;
  title: string;
  content: string;
}

const AWS_PROFILE: ProviderProfile = {
  provider: "aws",
  title: "AWS Cloud Platform Engineering Guide",
  content: `# AWS Cloud Platform Engineering Guide

## Network Architecture
- Design VPCs with non-overlapping CIDR blocks for future peering. Use /16 for production, /20 for dev/test.
- Use a hub-and-spoke topology with Transit Gateway for multi-VPC environments. Avoid VPC peering meshes beyond 3 VPCs.
- Segment subnets into tiers: public (ALB/NAT), private (compute), isolated (data). Minimum 2 AZs for HA, 3 for production.
- Use PrivateLink for service-to-service communication. Avoid exposing services to the public internet unless required.
- Deploy VPC Flow Logs to S3 with Athena integration for network forensics.
- Use AWS Cloud WAN with network segments (prod, dev, shared-services) for global deployments.

## Identity and Access Management
- Never use IAM users for workloads. Use IAM Roles everywhere: EC2 instance profiles, ECS task roles, Lambda execution roles.
- Apply least privilege with permission boundaries. Start with AWS managed policies, then scope down.
- Use Service Control Policies (SCPs) in AWS Organizations to enforce guardrails across all accounts.
- Enable cross-account access via sts:AssumeRole, never by sharing credentials.
- Enforce MFA on all human IAM principals. Use IAM Identity Center (SSO) for console access.
- Use IAM Access Analyzer to identify unused permissions and public/cross-account resource exposure.

## Security Posture
- Enable GuardDuty, Security Hub, and Config Rules in all accounts and regions from day one.
- Use CloudTrail with organization trail, multi-region enabled, log file validation, and S3 + CloudWatch delivery.
- Encrypt everything: EBS (aws/ebs or CMK), S3 (SSE-S3 or SSE-KMS), RDS (KMS), Secrets Manager for credentials.
- Use KMS key policies with grants, not IAM policies alone. Rotate CMKs annually.
- Deploy AWS WAF on CloudFront and ALB. Use managed rule groups (AWSManagedRulesCommonRuleSet) as baseline.
- Use VPC Security Groups as primary network controls. NACLs only for broad deny rules.

## Compute and Containers
- ECS on Fargate for most workloads. Use EC2 launch type only when you need GPU, custom AMI, or extreme density.
- EKS for Kubernetes-native workloads. Use managed node groups with Bottlerocket AMI for security.
- Lambda for event-driven, sub-15-minute tasks. Watch for cold start latency in VPC-attached functions.
- Use Graviton (arm64) instances for 20-40% cost savings on compatible workloads.
- Auto Scaling: target tracking on CPU/request count. Step scaling only for bursty workloads.

## Storage and Data
- S3: enable versioning, lifecycle policies (IA at 30d, Glacier at 90d), block public access at account level.
- RDS: Multi-AZ for production, read replicas for read-heavy workloads. Use Aurora for >1TB databases.
- DynamoDB: on-demand capacity for unpredictable workloads, provisioned with auto-scaling for steady-state.
- Use EFS for shared filesystem needs, FSx for Lustre for HPC/ML.

## Cost Optimization
- Use Cost Explorer and Budgets with alerts. Tag every resource with Environment, Team, CostCenter.
- Reserved Instances or Savings Plans for steady-state compute (1-year no-upfront to start).
- Spot Instances for fault-tolerant workloads (batch, CI/CD, dev). Use Spot Fleet with diversified allocation.
- Right-size instances using Compute Optimizer recommendations. Review monthly.
- Delete unattached EBS volumes, unused Elastic IPs, and idle NAT Gateways.

## Operational Excellence
- Use CloudWatch Alarms on key metrics: CPU, memory (via CloudWatch Agent), 5xx rates, queue depth.
- Centralize logs: CloudWatch Logs with Logs Insights, or ship to S3 via Firehose for long-term retention.
- Use Systems Manager for patching, inventory, and remote access (Session Manager, not SSH).
- Deploy infrastructure via CloudFormation or CDK. No manual console changes in production accounts.
- Use AWS Backup for centralized backup policies across RDS, EBS, EFS, DynamoDB.

## Common Anti-Patterns
- Using the default VPC for production workloads.
- Creating IAM users with long-lived access keys instead of roles.
- Storing secrets in environment variables, SSM Parameter Store (plaintext), or code. Use Secrets Manager.
- Running a single-AZ RDS instance in production.
- Not enabling S3 bucket versioning and block public access.
- Using overly broad security group rules (0.0.0.0/0 ingress on non-HTTP ports).
- Ignoring Trusted Advisor and Security Hub findings.`,
};

const AZURE_PROFILE: ProviderProfile = {
  provider: "azure",
  title: "Azure Cloud Platform Engineering Guide",
  content: `# Azure Cloud Platform Engineering Guide

## Landing Zone Architecture
- Structure: Root Management Group > Platform (Identity, Management, Connectivity) + Landing Zones (Corp, Online) + Sandbox.
- Use separate subscriptions as blast radius boundaries: one per workload or environment.
- Apply Azure Policy at management group level for inheritance. Use Deny policies for guardrails, Audit for visibility.
- Deploy using Azure Landing Zone accelerator (Bicep/Terraform modules) for consistent baseline.

## Identity and Access
- Use Entra ID (Azure AD) as the sole identity provider. Federate on-prem AD if needed, never sync passwords.
- Managed Identities everywhere: system-assigned for single-resource, user-assigned for shared access patterns.
- Never use service principal secrets for automated workloads. Use Managed Identity or Workload Identity Federation.
- RBAC: prefer built-in roles. Create custom roles only when built-ins are too broad. Scope to resource group, not subscription.
- Enable Privileged Identity Management (PIM) for just-in-time elevation on Owner/Contributor roles.
- Use Conditional Access policies: require MFA, block legacy auth, enforce compliant devices.

## Network Design
- Hub-spoke with Azure Firewall in the hub for centralized egress and east-west inspection.
- Use Virtual WAN for global deployments spanning multiple regions (simplifies routing and VPN/ExpressRoute).
- Private Endpoints for all PaaS services (Storage, SQL, Key Vault, ACR). Disable public access.
- NSGs on every subnet. Use Application Security Groups (ASGs) for logical grouping.
- Use Azure DDoS Protection Standard on VNets with public-facing resources.
- DNS: Azure Private DNS Zones linked to VNets for Private Endpoint resolution.

## Compute and Containers
- AKS for containerized workloads. Use system node pools for critical add-ons, user pools for workloads.
- Enable AKS workload identity (not pod identity) for Azure resource access from pods.
- Container Apps for simpler HTTP APIs and event-driven microservices (serverless Kubernetes).
- App Service for traditional web apps. Use deployment slots for zero-downtime releases.
- VMSS for legacy workloads needing VMs. Use Ephemeral OS disks for stateless tiers.

## Security
- Enable Microsoft Defender for Cloud on all subscriptions. Target Secure Score > 80%.
- Key Vault for all secrets, certificates, and keys. Use RBAC (not access policies) for Key Vault access.
- Enable diagnostic settings on every resource: send to Log Analytics Workspace.
- Use Azure Policy to enforce encryption, network rules, and tagging compliance.
- Enable Microsoft Sentinel for SIEM/SOAR if you need centralized threat detection.
- Storage: require HTTPS, disable shared key access (use Entra auth), enable soft delete and versioning.

## Governance and Cost
- Tag policy: enforce Environment, Owner, CostCenter at resource group level.
- Use Cost Management + Billing with budget alerts. Review Cost Analysis weekly.
- Azure Reservations for steady-state VMs, SQL, Cosmos DB (1-year start).
- Use Azure Advisor for rightsizing, idle resource detection, and security recommendations.
- Resource locks (CanNotDelete) on production resource groups and critical resources.

## Operational Excellence
- Azure Monitor: metrics, logs, alerts, Application Insights for APM.
- Log Analytics Workspace as central log sink. Use KQL for analysis.
- Use Update Manager for OS patching. Azure Automation for scheduled tasks.
- Deploy via Bicep or Terraform. Azure DevOps or GitHub Actions for CI/CD.
- Use Azure Resource Graph for cross-subscription inventory queries.

## Common Anti-Patterns
- Using classic (ASM) resources instead of ARM.
- Granting Contributor at subscription scope to service principals.
- Not using Private Endpoints for PaaS services (exposing SQL/Storage to public internet).
- Missing NSGs on subnets (relying only on Azure Firewall).
- Storing secrets in App Settings instead of Key Vault references.
- Single subscription for all workloads (no blast radius isolation).
- Ignoring Azure Advisor and Secure Score recommendations.`,
};

const GCP_PROFILE: ProviderProfile = {
  provider: "gcp",
  title: "GCP Cloud Platform Engineering Guide",
  content: `# GCP Cloud Platform Engineering Guide

## Organization and Project Hierarchy
- Structure: Organization > Folders (by environment or business unit) > Projects (per workload).
- Projects are the primary resource boundary. Use separate projects for prod, staging, dev.
- Apply Organization Policies at the org or folder level: restrict VM external IPs, enforce uniform bucket access, disable service account key creation.
- Use Resource Manager tags for conditional IAM bindings and firewall policies.

## Identity and Access Management
- Use Workload Identity Federation for external workloads (GitHub Actions, AWS, Azure). Never create service account keys.
- Service accounts: one per workload/application. Never use the default compute service account.
- Follow least privilege: use predefined roles. Avoid primitive roles (Owner/Editor/Viewer) in production.
- Use IAM Conditions for time-bound or attribute-based access (e.g., resource.type, request.time).
- Enable IAM Recommender to identify and remove excess permissions.
- Use groups (Cloud Identity/Google Workspace) for IAM bindings, not individual user emails.

## Network Architecture
- Use Shared VPC for centralized network management across projects. The host project owns the VPC, service projects use it.
- Design with custom-mode VPCs. Never use auto-mode (creates subnets in all regions with overlapping ranges).
- Private Google Access on all subnets so VMs without external IPs can reach Google APIs.
- Cloud NAT for outbound internet from private instances. No need for NAT instance VMs.
- Use Cloud Interconnect or Partner Interconnect for on-prem connectivity. Cloud VPN for dev/test.
- Hierarchical Firewall Policies at org/folder level for global rules. VPC firewall rules for project-specific.
- Use VPC Service Controls to create security perimeters around sensitive APIs (BigQuery, GCS, etc.).

## Compute and Containers
- GKE Autopilot for most Kubernetes workloads (Google manages nodes, you manage pods). Standard mode only when you need GPU, DaemonSets, or custom node configs.
- Enable Workload Identity on GKE to bind K8s service accounts to Google service accounts. Never mount SA keys.
- Binary Authorization for deploy-time container image attestation.
- Cloud Run for stateless HTTP services and event-driven workloads (auto-scaling to zero).
- Compute Engine: use custom machine types to avoid over-provisioning. Preemptible/Spot VMs for fault-tolerant workloads.

## Security
- Security Command Center (Premium) for vulnerability scanning, threat detection, and compliance.
- Use VPC Service Controls perimeters around all projects handling sensitive data.
- Enable Cloud Audit Logs (Admin Activity auto-enabled, Data Access must be enabled per service).
- Cloud KMS for encryption key management. Use customer-managed keys for sensitive data.
- Secret Manager for all secrets and API keys. Reference from workloads, never embed in code/config.
- Enable OS Login on all Compute instances. Disable SSH keys in project/instance metadata.

## Data and Storage
- Cloud Storage: use uniform bucket-level access (not ACLs). Enable object versioning and lifecycle policies.
- BigQuery: use authorized views and column-level security for data access control. Slot reservations for predictable costs.
- Cloud SQL: use Private IP only. Enable automated backups, point-in-time recovery, and HA (regional).
- Spanner for globally distributed relational data. Firestore for serverless document store.

## Cost Optimization
- Committed Use Discounts (CUDs) for steady-state Compute, Cloud SQL, GKE.
- Sustained Use Discounts apply automatically for Compute Engine (no action needed).
- Use Recommender API for idle VM, idle disk, and rightsizing recommendations.
- Set billing budgets with alerting at 50%, 80%, 100% thresholds.
- Label everything: env, team, cost-center. Use billing export to BigQuery for custom analysis.

## Common Anti-Patterns
- Using auto-mode VPCs (uncontrollable CIDR ranges, subnets in all regions).
- Granting roles/editor or roles/owner to service accounts.
- Creating and downloading service account keys instead of using Workload Identity Federation.
- Not enabling VPC Service Controls for projects with sensitive data.
- Using the default network (has overly permissive firewall rules).
- Running GKE Standard when Autopilot meets requirements (unnecessary node management overhead).
- Ignoring Security Command Center findings and IAM Recommender suggestions.`,
};

const ALIBABA_PROFILE: ProviderProfile = {
  provider: "alibaba",
  title: "Alibaba Cloud Platform Engineering Guide",
  content: `# Alibaba Cloud Platform Engineering Guide

## Account and Resource Organization
- Use Resource Directory for multi-account management with folders by environment or business unit.
- Resource Groups within accounts for logical separation and access control scoping.
- Apply Control Policies at the directory/folder level for organization-wide guardrails.
- Tag everything: environment, team, cost-center, project. Tags drive cost allocation and automation.

## Identity and Access Management (RAM)
- Use RAM roles for all workloads. ECS instances should use instance RAM roles, not embedded credentials.
- STS (Security Token Service) for temporary credentials. AssumeRole for cross-account access.
- Follow least privilege: use system policies as starting templates, create custom policies scoped to specific resources.
- Enable MFA for all RAM user console access. Disable console access for API-only users.
- Use RAM groups for policy assignment, not individual user bindings.
- Use ActionTrail for auditing all API calls across accounts.

## Network Architecture
- VPC design: plan CIDR blocks to avoid overlaps. Use /16 for large deployments, /20 for small workloads.
- VSwitches span a single AZ. Deploy at least 2 VSwitches across different AZs for HA.
- Use Cloud Enterprise Network (CEN) for multi-VPC and multi-region connectivity. CEN replaces manual peering.
- Security Groups: stateful, instance-level. Use them as the primary network access control.
- NAT Gateway for outbound internet from private instances. Use DNAT for inbound port mapping.
- Use Express Connect or VPN Gateway for hybrid connectivity to on-prem data centers.
- PrivateLink for secure access to Alibaba Cloud services without traversing the public internet.

## Compute and Containers
- ECS: use VPC-type instances. Choose instance families based on workload (compute-optimized, memory-optimized, GPU).
- Use Auto Scaling Groups with custom scaling rules (target tracking on CPU or custom metrics).
- ACK (Container Service for Kubernetes): use managed edition for most workloads. Pro edition for production with advanced features.
- Serverless Kubernetes (ASK) for burst workloads or jobs without node management.
- Function Compute for event-driven, short-duration tasks.

## Security
- Enable Security Center (Enterprise/Advanced) for vulnerability scanning, baseline checks, and threat detection.
- Use KMS for encryption key management. Server-side encryption on OSS, RDS, and ECS disks.
- Enable ActionTrail in all regions for API audit logging. Ship to OSS for long-term retention.
- Use WAF for web application protection. Anti-DDoS for network layer protection.
- Certificate Management Service for SSL/TLS certificate provisioning and rotation.
- Bastionhost for privileged access management to ECS instances. Avoid direct SSH from internet.

## Storage and Data
- OSS (Object Storage): enable versioning, lifecycle rules (IA at 30d, Archive at 90d), server-side encryption.
- RDS: use Multi-AZ deployment for production. Read replicas for read-heavy workloads. Enable TDE for encryption.
- PolarDB for high-performance relational database with auto-scaling storage.
- ApsaraDB for Redis: use cluster edition for high throughput. Enable persistence and backup.

## Cost Optimization
- Use Subscription (reserved) pricing for steady-state ECS, RDS, SLB instances. 1-year start.
- Preemptible ECS instances for fault-tolerant batch processing (up to 90% discount).
- Use Cost Management for billing analysis. Set budget alerts at multiple thresholds.
- Right-size instances based on CloudMonitor metrics. Review monthly.
- Delete unused ECS instances, unattached disks, and idle SLB instances.

## China-Specific Considerations
- ICP (Internet Content Provider) filing is required for any domain serving content within mainland China.
- Data residency: understand which regions are in mainland China vs international. Data sovereignty laws apply.
- Mainland China regions have separate endpoints and may require different account setup.
- Great Firewall: plan for latency to international services. Use CEN or Global Accelerator for cross-border traffic.
- Real-name verification is required for mainland China accounts.

## Common Anti-Patterns
- Using classic network instead of VPC.
- Embedding RAM AccessKey credentials in application code or config files.
- Running single-AZ deployments in production without cross-AZ redundancy.
- Not enabling ActionTrail for API audit logging.
- Using overly broad RAM policies (AliyunFullAccess) on service roles.
- Ignoring Security Center alerts and baseline check failures.
- Not planning CIDR ranges, leading to overlaps that prevent VPC peering/CEN attachment.`,
};

const PROFILES: Record<string, ProviderProfile> = {
  aws: AWS_PROFILE,
  azure: AZURE_PROFILE,
  gcp: GCP_PROFILE,
  alibaba: ALIBABA_PROFILE,
};

export function getProviderProfile(provider: string): ProviderProfile | undefined {
  return PROFILES[provider];
}

export function getAllProviderProfiles(): ProviderProfile[] {
  return Object.values(PROFILES);
}
