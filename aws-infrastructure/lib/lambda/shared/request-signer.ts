/**
 * Shared AWS Request Signing Utility
 * Extracted from TokenServiceClient for reuse across Lambda functions
 */

import { SignatureV4 } from '@aws-sdk/signature-v4';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Sha256 } from '@aws-crypto/sha256-js';

export interface RequestSigningConfig {
  service?: string;
  region?: string;
}

export interface SignableRequest {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  body?: string;
}

export class RequestSigner {
  private signer: SignatureV4;

  constructor(config: RequestSigningConfig = {}) {
    this.signer = new SignatureV4({
      service: config.service || 'execute-api',
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      credentials: defaultProvider(),
      sha256: Sha256,
    });
  }

  async signRequest(request: SignableRequest): Promise<Record<string, string>> {
    const signableRequest = {
      method: request.method,
      headers: {
        ...request.headers,
        host: request.url.hostname,
      },
      hostname: request.url.hostname,
      path: request.url.pathname + request.url.search,
      protocol: request.url.protocol,
      body: request.body,
    };

    const signedRequest = await this.signer.sign(signableRequest);
    return signedRequest.headers as Record<string, string>;
  }
}

/**
 * Convenience function to create and use a signer in one call
 */
export async function signRequest(
  request: SignableRequest, 
  config?: RequestSigningConfig
): Promise<Record<string, string>> {
  const signer = new RequestSigner(config);
  return signer.signRequest(request);
}