import { createHmac, createHash, randomUUID } from "node:crypto";

interface SigningParams {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  accessKeyId: string;
  accessKeySecret: string;
}

export function signAlibabaRequest(params: SigningParams): Record<string, string> {
  const parsedUrl = new URL(params.url);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const nonce = randomUUID();

  const headers: Record<string, string> = {
    ...params.headers,
    host: parsedUrl.host,
    "x-acs-date": now,
    "x-acs-signature-nonce": nonce,
  };

  // Canonical headers: lowercase, sorted, trimmed
  const signedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .filter((k) => k === "host" || k === "content-type" || k.startsWith("x-acs-"))
    .sort();
  const signedHeaders = signedHeaderKeys.join(";");

  const canonicalHeaders = signedHeaderKeys
    .map((k) => {
      const originalKey = Object.keys(headers).find((h) => h.toLowerCase() === k)!;
      return `${k}:${headers[originalKey].trim()}`;
    })
    .join("\n") + "\n";

  // Canonical request
  const hashedBody = sha256(params.body);
  const canonicalRequest = [
    params.method.toUpperCase(),
    parsedUrl.pathname,
    parsedUrl.search.replace("?", ""),
    canonicalHeaders,
    signedHeaders,
    hashedBody,
  ].join("\n");

  // String to sign
  const stringToSign = `ACS3-HMAC-SHA256\n${sha256(canonicalRequest)}`;

  // Signature
  const signature = hmacHex(params.accessKeySecret, stringToSign);

  headers["Authorization"] =
    `ACS3-HMAC-SHA256 Credential=${params.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;

  return headers;
}

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmacHex(key: string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}
