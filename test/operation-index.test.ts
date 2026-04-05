import { describe, it, expect } from "vitest";
import { OperationIndex } from "../src/specs/operation-index.js";

describe("OperationIndex", () => {
  it("searches by keyword across operations", () => {
    const index = new OperationIndex();
    index.addService("ec2", [
      { service: "ec2", operation: "CreateVpc", method: "POST", description: "Creates a VPC" },
      { service: "ec2", operation: "DescribeInstances", method: "POST", description: "Describes instances" },
      { service: "ec2", operation: "CreateTransitGateway", method: "POST", description: "Creates a transit gateway" },
    ]);
    index.addService("s3", [
      { service: "s3", operation: "CreateBucket", method: "PUT", description: "Creates a bucket" },
    ]);

    const results = index.search("create vpc");
    expect(results.length).toBe(1);
    expect(results[0].operation).toBe("CreateVpc");
  });

  it("requires all terms to match", () => {
    const index = new OperationIndex();
    index.addService("ec2", [
      { service: "ec2", operation: "CreateVpc", method: "POST", description: "Creates a VPC" },
      { service: "ec2", operation: "CreateTransitGateway", method: "POST", description: "Creates a transit gateway" },
    ]);

    const results = index.search("create transit gateway");
    expect(results.length).toBe(1);
    expect(results[0].operation).toBe("CreateTransitGateway");
  });

  it("scopes search to a service", () => {
    const index = new OperationIndex();
    index.addService("ec2", [
      { service: "ec2", operation: "CreateVpc", method: "POST", description: "Creates a VPC" },
    ]);
    index.addService("s3", [
      { service: "s3", operation: "CreateBucket", method: "PUT", description: "Creates a bucket" },
    ]);

    const results = index.search("create", "s3");
    expect(results.length).toBe(1);
    expect(results[0].service).toBe("s3");
  });

  it("replaces service entries on re-add", () => {
    const index = new OperationIndex();
    index.addService("ec2", [
      { service: "ec2", operation: "Old", method: "POST", description: "old" },
    ]);
    index.addService("ec2", [
      { service: "ec2", operation: "New", method: "POST", description: "new" },
    ]);

    expect(index.search("old").length).toBe(0);
    expect(index.search("new").length).toBe(1);
  });

  it("extracts from AWS spec format", () => {
    const entries = OperationIndex.extractFromAwsSpec("ec2", {
      operations: {
        DescribeVpcs: {
          name: "DescribeVpcs",
          http: { method: "POST" },
          documentation: "<p>Describes your VPCs.</p>",
        },
      },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].operation).toBe("DescribeVpcs");
    expect(entries[0].description).toBe("Describes your VPCs.");
  });

  it("extracts from Azure spec format", () => {
    const entries = OperationIndex.extractFromAzureSpec("compute", {
      paths: {
        "/subscriptions/{sub}/providers/Microsoft.Compute/virtualMachines": {
          get: {
            operationId: "VirtualMachines_ListAll",
            summary: "Lists all VMs in a subscription",
          },
        },
      },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].operation).toBe("VirtualMachines_ListAll");
    expect(entries[0].method).toBe("GET");
  });
});
