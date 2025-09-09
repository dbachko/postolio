import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { HttpRequest } from "@aws-sdk/protocol-http";

export async function signRequest(request: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
}): Promise<Record<string, string>> {
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: process.env.AWS_REGION || "us-east-1",
    service: "execute-api",
    sha256: Sha256,
  });

  const httpRequest = new HttpRequest({
    method: request.method,
    hostname: request.url.hostname,
    path: request.url.pathname,
    query: Object.fromEntries(request.url.searchParams.entries()),
    headers: request.headers,
    body: request.body,
  });

  const signedRequest = await signer.sign(httpRequest);
  return signedRequest.headers;
}
