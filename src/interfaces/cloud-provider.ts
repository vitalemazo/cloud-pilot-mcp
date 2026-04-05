export interface ParamSpec {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface OperationSpec {
  service: string;
  operation: string;
  httpMethod: string;
  description: string;
  inputParams: ParamSpec[];
  outputFields: ParamSpec[];
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
  name: "aws" | "azure";
  searchSpec(query: string, service?: string): Promise<OperationSpec[]>;
  call(
    service: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<CloudProviderCallResult>;
  listServices(): string[];
}
