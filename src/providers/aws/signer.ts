// Copyright (c) 2026 Vitale Mazo. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";

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

export async function signRequest(
  params: SigningParams,
): Promise<Record<string, string>> {
  const parsed = new URL(params.url);

  const request = new HttpRequest({
    method: params.method,
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams),
    headers: {
      ...params.headers,
      host: parsed.host,
    },
    body: params.body || undefined,
  });

  const signer = new SignatureV4({
    service: params.service,
    region: params.region,
    credentials: {
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      sessionToken: params.sessionToken,
    },
    sha256: Sha256,
  });

  const signed = await signer.sign(request);
  return signed.headers as Record<string, string>;
}
