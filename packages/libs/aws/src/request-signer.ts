import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { resolveAwsServiceTarget } from './signer-utils.js';

export async function signRequest(request: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
}): Promise<Record<string, string>> {
  const { service, region } = resolveAwsServiceTarget(request.url);

  const headers: Record<string, string> = {
    ...request.headers,
  };

  if (!headers.host && !headers.Host) {
    headers.host = request.url.host;
  }

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service,
    sha256: Sha256,
  });

  const httpRequest = new HttpRequest({
    method: request.method,
    hostname: request.url.hostname,
    path: request.url.pathname,
    query: Object.fromEntries(request.url.searchParams.entries()),
    headers,
    body: request.body,
  });

  const signedRequest = await signer.sign(httpRequest);
  return signedRequest.headers;
}
