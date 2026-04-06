// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { createHmac, createHash } from "node:crypto";

interface SigningParams {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
}

export function signRequest(params: SigningParams): Record<string, string> {
  const parsedUrl = new URL(params.url);
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");

  const headers: Record<string, string> = {
    ...params.headers,
    host: parsedUrl.host,
    "x-amz-date": amzDate,
  };

  if (params.sessionToken) {
    headers["x-amz-security-token"] = params.sessionToken;
  }

  // Required by S3, harmless for other services
  headers["x-amz-content-sha256"] = sha256(params.body);

  const signedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const signedHeaders = signedHeaderKeys.join(";");

  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${headers[Object.keys(headers).find((h) => h.toLowerCase() === k)!].trim()}`)
    .join("\n") + "\n";

  const payloadHash = sha256(params.body);

  const canonicalRequest = [
    params.method,
    parsedUrl.pathname,
    parsedUrl.search.replace("?", ""),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(
    params.secretAccessKey,
    dateStamp,
    params.region,
    params.service,
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");

  headers["Authorization"] =
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}
