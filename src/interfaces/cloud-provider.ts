// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface ParamSpec {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface ServiceMetadata {
  protocol?: string;       // "ec2" | "query" | "json" | "rest-json" | "rest-xml"
  targetPrefix?: string;   // For JSON protocol (e.g., "AmazonEC2ContainerServiceV20141113")
  apiVersion?: string;     // e.g., "2016-11-15"
  endpointPrefix?: string; // e.g., "ec2", may differ from service name
  jsonVersion?: string;    // e.g., "1.1"
  serviceId?: string;      // e.g., "Elastic Load Balancing v2" — maps to @aws-sdk/client-* package
}

export interface OperationSpec {
  service: string;
  operation: string;
  httpMethod: string;
  description: string;
  inputParams: ParamSpec[];
  outputFields: ParamSpec[];
  serviceMetadata?: ServiceMetadata;
}

export interface CloudProviderCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: {
    requestId?: string;
    httpStatus?: number;
    duration?: number;
  };
}

export interface CloudProvider {
  name: "aws" | "azure" | "gcp" | "alibaba";
  searchSpec(query: string, service?: string): Promise<OperationSpec[]>;
  call(
    service: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<CloudProviderCallResult>;
  /** Validate a call against the cloud provider without executing it.
   *  Returns success=true if the provider confirms the call would succeed.
   *  Not all providers/operations support native dry-run — falls back to
   *  client-side validation. */
  dryRun?(
    service: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<CloudProviderCallResult & { validationSource: string }>;
  listServices(): string[];
}
