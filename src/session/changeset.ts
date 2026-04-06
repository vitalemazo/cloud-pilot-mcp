// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { createHash } from "node:crypto";

/** A resource created or modified during a session. */
export interface TrackedResource {
  provider: string;
  service: string;
  action: string;       // The action that created/modified this resource
  resourceId?: string;   // Extracted from the response (e.g., VpcId, GroupId)
  resourceType?: string; // e.g., "VPC", "SecurityGroup", "LoadBalancer"
  timestamp: string;
  params: Record<string, unknown>;
}

/** Result of a dry-run validation. */
export interface DryRunResult {
  provider: string;
  service: string;
  action: string;
  params: Record<string, unknown>;
  validated: boolean;       // true if cloud provider confirmed it would succeed
  validationSource: string; // "aws-native" | "client-side" | "azure-pipeline" | "gcp-rest"
  error?: string;           // If validation found a problem
  impact: ImpactSummary;
}

/** Human-readable impact summary for a dry-run. */
export interface ImpactSummary {
  description: string;      // e.g., "Create 1 VPC (10.0.0.0/16) in us-east-1"
  actionType: "create" | "modify" | "delete" | "read" | "other";
  reversible: boolean;
  reverseAction?: string;   // e.g., "DeleteVpc"
  warnings: string[];       // e.g., ["This will incur NAT Gateway charges (~$32/mo)"]
}

// Map of mutating action prefixes to their reverse actions and types
const ACTION_TYPE_MAP: Record<string, { type: ImpactSummary["actionType"]; reversible: boolean; reversePrefix?: string }> = {
  Create: { type: "create", reversible: true, reversePrefix: "Delete" },
  Run: { type: "create", reversible: true, reversePrefix: "Terminate" },
  Allocate: { type: "create", reversible: true, reversePrefix: "Release" },
  Delete: { type: "delete", reversible: false },
  Terminate: { type: "delete", reversible: false },
  Remove: { type: "delete", reversible: false },
  Release: { type: "delete", reversible: false },
  Revoke: { type: "delete", reversible: false },
  Update: { type: "modify", reversible: true },
  Modify: { type: "modify", reversible: true },
  Put: { type: "modify", reversible: true },
  Set: { type: "modify", reversible: true },
  Attach: { type: "modify", reversible: true, reversePrefix: "Detach" },
  Detach: { type: "modify", reversible: true, reversePrefix: "Attach" },
  Associate: { type: "modify", reversible: true, reversePrefix: "Disassociate" },
  Disassociate: { type: "modify", reversible: true, reversePrefix: "Associate" },
  Enable: { type: "modify", reversible: true, reversePrefix: "Disable" },
  Disable: { type: "modify", reversible: true, reversePrefix: "Enable" },
  Register: { type: "modify", reversible: true, reversePrefix: "Deregister" },
  Deregister: { type: "modify", reversible: true, reversePrefix: "Register" },
  Tag: { type: "modify", reversible: true, reversePrefix: "Untag" },
  Untag: { type: "modify", reversible: true, reversePrefix: "Tag" },
  Start: { type: "modify", reversible: true, reversePrefix: "Stop" },
  Stop: { type: "modify", reversible: true, reversePrefix: "Start" },
  Reboot: { type: "modify", reversible: true },
  Authorize: { type: "modify", reversible: true, reversePrefix: "Revoke" },
  Grant: { type: "modify", reversible: true },
};

/**
 * Tracks dry-run approvals, created resources, and generates rollback plans
 * for a single MCP session.
 */
export class SessionChangeset {
  // Set of hashes for calls that have been dry-run'd (Level 2)
  private dryRunApprovals = new Set<string>();

  // Ordered list of resources created/modified in this session (Level 4)
  private resources: TrackedResource[] = [];

  /** Generate a hash key for a (service, action, params) tuple. */
  private hashCall(service: string, action: string, params: Record<string, unknown>): string {
    const normalized = JSON.stringify({ service, action, params }, Object.keys({ service, action, params }).sort());
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  // ── Level 2: Dry-run gate ─────────────────────────────────────────

  /** Record that a dry-run was performed for this call. */
  recordDryRun(service: string, action: string, params: Record<string, unknown>): void {
    this.dryRunApprovals.add(this.hashCall(service, action, params));
  }

  /** Check if a matching dry-run was performed. */
  wasDryRunPerformed(service: string, action: string, params: Record<string, unknown>): boolean {
    return this.dryRunApprovals.has(this.hashCall(service, action, params));
  }

  /** Check if an action is mutating (and thus requires dry-run). */
  isMutating(action: string): boolean {
    return Object.keys(ACTION_TYPE_MAP).some((prefix) => action.startsWith(prefix));
  }

  // ── Level 3: Impact summary ───────────────────────────────────────

  /** Build an impact summary for a planned action. */
  buildImpactSummary(
    service: string,
    action: string,
    params: Record<string, unknown>,
  ): ImpactSummary {
    // Determine action type
    const matchedPrefix = Object.keys(ACTION_TYPE_MAP).find((p) => action.startsWith(p));
    const typeInfo = matchedPrefix ? ACTION_TYPE_MAP[matchedPrefix] : { type: "other" as const, reversible: false };

    // Build reverse action name if applicable
    let reverseAction: string | undefined;
    if (typeInfo.reversePrefix && matchedPrefix) {
      reverseAction = action.replace(matchedPrefix, typeInfo.reversePrefix);
    }

    // Build human-readable description
    const resourceName = action.replace(matchedPrefix ?? "", "");
    const region = (params as Record<string, unknown>).region as string | undefined;
    const description = `${matchedPrefix ?? "Call"} ${resourceName} on ${service}` +
      (region ? ` in ${region}` : "");

    // Generate warnings
    const warnings: string[] = [];
    if (action.includes("NatGateway") && typeInfo.type === "create") {
      warnings.push("NAT Gateway incurs charges (~$32/mo + data processing)");
    }
    if (action.includes("LoadBalancer") && typeInfo.type === "create") {
      warnings.push("Application Load Balancer incurs charges (~$16/mo + LCU)");
    }
    if (action.includes("DBInstance") && typeInfo.type === "create") {
      warnings.push("RDS instance incurs charges (varies by instance class)");
    }
    if (action.includes("Instance") && action.startsWith("Run")) {
      warnings.push("EC2 instance incurs charges (varies by instance type)");
    }
    if (typeInfo.type === "delete") {
      warnings.push("This action may not be reversible");
    }
    if (action.includes("SecurityGroup") && action.startsWith("Delete")) {
      warnings.push("Ensure no resources reference this security group");
    }

    return {
      description,
      actionType: typeInfo.type,
      reversible: typeInfo.reversible,
      reverseAction,
      warnings,
    };
  }

  // ── Level 4: Resource tracking and rollback ───────────────────────

  /** Track a resource that was created or modified. */
  trackResource(
    provider: string,
    service: string,
    action: string,
    params: Record<string, unknown>,
    responseData: unknown,
  ): void {
    const { resourceId, resourceType } = extractResourceInfo(action, responseData);

    this.resources.push({
      provider,
      service,
      action,
      resourceId,
      resourceType,
      timestamp: new Date().toISOString(),
      params,
    });
  }

  /** Get all tracked resources. */
  getResources(): readonly TrackedResource[] {
    return this.resources;
  }

  /** Generate a rollback plan (delete in reverse order). */
  generateRollbackPlan(): string[] {
    const steps: string[] = [];

    // Walk resources in reverse order
    for (let i = this.resources.length - 1; i >= 0; i--) {
      const r = this.resources[i];
      const matchedPrefix = Object.keys(ACTION_TYPE_MAP).find((p) => r.action.startsWith(p));
      const typeInfo = matchedPrefix ? ACTION_TYPE_MAP[matchedPrefix] : null;

      if (!typeInfo || typeInfo.type === "delete") continue; // Can't roll back a delete

      if (typeInfo.reversePrefix && matchedPrefix) {
        const reverseAction = r.action.replace(matchedPrefix, typeInfo.reversePrefix);
        const idStr = r.resourceId ? ` (${r.resourceId})` : "";
        steps.push(`${r.service}:${reverseAction}${idStr}`);
      }
    }

    return steps;
  }

  /** Format the current session state as a human-readable summary. */
  formatSessionSummary(): string {
    if (this.resources.length === 0) {
      return "No resources created or modified in this session.";
    }

    const lines = ["Session resources:"];
    for (const r of this.resources) {
      const id = r.resourceId ? ` ${r.resourceId}` : "";
      const type = r.resourceType ? ` (${r.resourceType})` : "";
      lines.push(`  + ${r.service}:${r.action}${id}${type}`);
    }

    const rollback = this.generateRollbackPlan();
    if (rollback.length > 0) {
      lines.push("", "Rollback plan:");
      for (let i = 0; i < rollback.length; i++) {
        lines.push(`  ${i + 1}. ${rollback[i]}`);
      }
    }

    return lines.join("\n");
  }
}

/** Extract resource ID and type from an API response. */
function extractResourceInfo(
  action: string,
  data: unknown,
): { resourceId?: string; resourceType?: string } {
  if (!data || typeof data !== "object") return {};

  const obj = data as Record<string, unknown>;

  // Common AWS response patterns for resource IDs
  const idFields = [
    "VpcId", "SubnetId", "InternetGatewayId", "NatGatewayId", "GroupId",
    "InstanceId", "AllocationId", "RouteTableId", "NetworkInterfaceId",
    "SecurityGroupId", "LoadBalancerArn", "TargetGroupArn", "ListenerArn",
    "DBInstanceIdentifier", "CacheClusterId", "ClusterArn", "FunctionArn",
    "BucketName", "KeyId", "SecretId", "TopicArn", "QueueUrl",
    "AutoScalingGroupName", "LaunchTemplateId", "StackId",
  ];

  // Check top-level fields
  for (const field of idFields) {
    if (obj[field]) {
      const resourceType = field.replace(/Id$|Arn$|Name$|Url$/, "");
      return { resourceId: String(obj[field]), resourceType };
    }
  }

  // Check nested structures (e.g., { Vpc: { VpcId: "..." } })
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      for (const field of idFields) {
        if (nested[field]) {
          const resourceType = field.replace(/Id$|Arn$|Name$|Url$/, "");
          return { resourceId: String(nested[field]), resourceType };
        }
      }
    }
  }

  return {};
}
