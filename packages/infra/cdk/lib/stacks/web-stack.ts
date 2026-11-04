/**
 * Web Stack - Frontend Infrastructure (S3 + CloudFront)
 * Contains the React frontend deployed to S3 with CloudFront distribution
 */

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { acknowledgeNagRules } from '../utils/cdk-nag-suppressions';
import { Construct } from 'constructs';

export interface WebStackProps extends cdk.StackProps {
  environment: string;
  domainName?: string;
  hostedZoneId?: string;
  useExternalDns?: boolean;
  certificateArn?: string;
  hostedZoneName?: string;
}

export class WebStack extends cdk.Stack {
  public readonly frontendBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const {
      environment,
      domainName,
      hostedZoneId,
      hostedZoneName,
      useExternalDns,
      certificateArn,
    } = props;
    const prefix = `postolio-${environment}-web`;
    const isProduction = environment === 'prod';
    const enableCloudFrontAccessLogs = isProduction;

    // ==================== Shared Access Logs Archive ====================
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `${prefix}-access-logs`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      lifecycleRules: [
        {
          id: 'expire-access-logs',
          expiration: cdk.Duration.days(isProduction ? 365 : 14),
        },
      ],
      removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProduction,
    });

    // ==================== S3 Bucket for Frontend ====================
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${prefix}-frontend`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'frontend/',
      lifecycleRules: [
        {
          id: 'delete-old-versions',
          noncurrentVersionExpiration: cdk.Duration.days(7),
        },
      ],
      removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProduction,
    });

    // ==================== CloudFront Logs Bucket ====================
    const cloudFrontLogsLifecycleRules: s3.LifecycleRule[] = [
      {
        id: 'delete-old-logs',
        expiration: cdk.Duration.days(isProduction ? 90 : 14),
      },
    ];

    if (isProduction) {
      cloudFrontLogsLifecycleRules.push({
        id: 'transition-to-ia',
        transitions: [
          {
            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
            transitionAfter: cdk.Duration.days(30),
          },
        ],
      });
    }

    const logsBucket = new s3.Bucket(this, 'LogsBucket', {
      bucketName: `${prefix}-logs`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: cloudFrontLogsLifecycleRules,
      removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProduction,
    });

    const originAccessControl = new cloudfront.S3OriginAccessControl(
      this,
      'FrontendOriginAccessControl',
      {
        originAccessControlName: `${prefix}-oac`,
      }
    );

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket, {
      originAccessControl,
      originAccessLevels: [cloudfront.AccessLevel.READ],
    });

    const apiUrlValue = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/api/url`
    );

    let apiOrigin: origins.HttpOrigin;
    if (!cdk.Token.isUnresolved(apiUrlValue)) {
      const apiUrl = new URL(apiUrlValue);
      const normalizedPath =
        apiUrl.pathname.endsWith('/') && apiUrl.pathname !== '/'
          ? apiUrl.pathname.slice(0, -1)
          : apiUrl.pathname;

      let originProps: origins.HttpOriginProps = {
        originPath: normalizedPath !== '/' ? normalizedPath : undefined,
        protocolPolicy:
          apiUrl.protocol === 'http:'
            ? cloudfront.OriginProtocolPolicy.HTTP_ONLY
            : cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      };

      if (apiUrl.port) {
        const portNumber = Number(apiUrl.port);
        if (Number.isNaN(portNumber)) {
          throw new Error(`Invalid port in API URL: ${apiUrl.port}`);
        }

        if (apiUrl.protocol === 'http:') {
          originProps = {
            ...originProps,
            httpPort: portNumber,
          };
        } else {
          originProps = {
            ...originProps,
            httpsPort: portNumber,
          };
        }
      }

      if (apiUrl.protocol === 'https:') {
        originProps = {
          ...originProps,
          originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
        };
      } else if (apiUrl.protocol !== 'http:') {
        throw new Error(`Unsupported protocol for API URL: ${apiUrl.protocol}`);
      }

      apiOrigin = new origins.HttpOrigin(apiUrl.hostname, originProps);
    } else {
      const rest = cdk.Fn.select(1, cdk.Fn.split('://', apiUrlValue));
      const hostWithPath = rest;
      const hostWithPort = cdk.Fn.select(0, cdk.Fn.split('/', hostWithPath));
      const hostname = cdk.Fn.select(0, cdk.Fn.split(':', hostWithPort));

      apiOrigin = new origins.HttpOrigin(hostname, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        httpPort: 80,
      });

      cdk.Annotations.of(this).addWarning(
        'Using simplified API origin configuration because the API URL is unresolved at synthesis. Ensure /postolio/${environment}/api/url is a full URL if stage-specific routing is required.'
      );
    }

    // ==================== WebSocket Policies ====================
    // For WebSocket support, we use managed policies that handle the upgrade headers properly
    // CloudFront doesn't allow custom forwarding of Upgrade/Connection headers - these are
    // automatically handled by the ALL_VIEWER policy which forwards all viewer headers

    // ==================== CloudFront Function: SPA rewrite (viewer-request) ====================
    // Rewrites non-file, non-/api/* paths to /index.html to enable SPA deep links
    const spaRewriteFunction = new cloudfront.Function(this, 'SpaRewriteFunction', {
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri || '/';
  // Pass API calls straight through
  if (uri.indexOf('/api/') === 0) { return request; }
  // Treat URIs with a dot as direct asset requests
  if (uri.indexOf('.') !== -1) { return request; }
  // Rewrite to SPA entry
  request.uri = '/index.html';
  return request;
}`),
      runtime: cloudfront.FunctionRuntime.JS_1_0,
      comment: 'SPA rewrite to /index.html for non-/api routes',
    });

    // ==================== Resolve Assets API Origin (ALB) ====================
    // The Asset Library microservice exposes an ALB endpoint stored in SSM at
    // /postolio/{env}/assets/api-endpoint (e.g., http://<alb-dns>)
    const assetsApiUrlValue = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/assets/api-endpoint`
    );
    let assetsApiOrigin: origins.HttpOrigin;
    // Try to fully resolve URL at synth; if unresolved token, fall back to Fn.split parsing
    if (
      assetsApiUrlValue &&
      (assetsApiUrlValue.startsWith('http://') || assetsApiUrlValue.startsWith('https://'))
    ) {
      try {
        const assetsApiUrl = new URL(assetsApiUrlValue);
        const normalizedPath = assetsApiUrl.pathname.endsWith('/')
          ? assetsApiUrl.pathname.slice(0, -1)
          : assetsApiUrl.pathname;

        let originProps: origins.HttpOriginProps = {
          originPath: normalizedPath !== '/' ? normalizedPath : undefined,
          protocolPolicy:
            assetsApiUrl.protocol === 'http:'
              ? cloudfront.OriginProtocolPolicy.HTTP_ONLY
              : cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        };

        if (assetsApiUrl.port) {
          const portNumber = Number(assetsApiUrl.port);
          if (Number.isNaN(portNumber)) {
            throw new Error(`Invalid port in Assets API URL: ${assetsApiUrl.port}`);
          }

          if (assetsApiUrl.protocol === 'http:') {
            originProps = {
              ...originProps,
              httpPort: portNumber,
            };
          } else {
            originProps = {
              ...originProps,
              httpsPort: portNumber,
            };
          }
        }

        if (assetsApiUrl.protocol === 'https:') {
          originProps = {
            ...originProps,
            originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
          };
        } else if (assetsApiUrl.protocol !== 'http:') {
          throw new Error(`Unsupported protocol for Assets API URL: ${assetsApiUrl.protocol}`);
        }

        assetsApiOrigin = new origins.HttpOrigin(assetsApiUrl.hostname, originProps);
      } catch {
        // Fall through to token-based parsing
        const rest = cdk.Fn.select(1, cdk.Fn.split('://', assetsApiUrlValue));
        const hostWithPath = rest;
        const hostWithPort = cdk.Fn.select(0, cdk.Fn.split('/', hostWithPath));
        const hostname = cdk.Fn.select(0, cdk.Fn.split(':', hostWithPort));
        assetsApiOrigin = new origins.HttpOrigin(hostname, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 80,
        });
      }
    } else {
      const rest = cdk.Fn.select(1, cdk.Fn.split('://', assetsApiUrlValue));
      const hostWithPath = rest;
      const hostWithPort = cdk.Fn.select(0, cdk.Fn.split('/', hostWithPath));
      const hostname = cdk.Fn.select(0, cdk.Fn.split(':', hostWithPort));

      assetsApiOrigin = new origins.HttpOrigin(hostname, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        httpPort: 80,
      });
    }

    // ==================== CloudFront Distribution ====================
    const staticAssetsCachePolicy = new cloudfront.CachePolicy(this, 'StaticAssetsCachePolicy', {
      cachePolicyName: `${prefix}-static-cache-policy`,
      comment: 'Cache policy for static assets with long TTL',
      defaultTtl: cdk.Duration.days(30),
      maxTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.seconds(0),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    const distributionProps: cloudfront.DistributionProps = {
      comment: `${prefix} - Frontend Distribution`,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: isProduction
        ? cloudfront.PriceClass.PRICE_CLASS_ALL
        : cloudfront.PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
      enableLogging: enableCloudFrontAccessLogs,
      ...(enableCloudFrontAccessLogs
        ? {
            logBucket: logsBucket,
            logFilePrefix: 'cloudfront/',
          }
        : {}),
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        // Disable caching on the default behavior because the SPA rewrite function can turn
        // arbitrary paths (e.g. /drafts) into /index.html. If this behavior is cached, CloudFront
        // can serve stale HTML for a long time, causing chunk hash mismatches after deploys.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        functionAssociations: [
          {
            function: spaRewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        // Cache built static assets (Vite emits hashed files under /assets/*)
        '/assets/*': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          compress: true,
          cachePolicy: staticAssetsCachePolicy,
        },
        // Special handling for index.html - no caching
        '/index.html': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, 'IndexCachePolicy', {
            cachePolicyName: `${prefix}-index-cache-policy`,
            comment: 'Cache policy for index.html - no caching',
            defaultTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.seconds(0),
            minTtl: cdk.Duration.seconds(0),
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
          }),
        },
        // API proxy behavior (optional - for same-domain API calls)
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        // Assets API proxy behavior - serves Asset Library service under the app domain
        '/assets-api/*': {
          origin: assetsApiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        // WebSocket behavior - uses ALL_VIEWER to forward all headers including upgrade headers
        '/ws': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
      },
      // Do not remap 404s globally; the SPA rewrite function handles app routes.
      // Keeping 404s intact avoids API paths (e.g., /api/*, /assets-api/*) returning HTML.
      geoRestriction:
        environment === 'prod' ? undefined : cloudfront.GeoRestriction.denylist('CN', 'RU'), // Block certain countries in non-prod
    };

    let hostedZone: route53.IHostedZone | undefined;
    if (domainName && !useExternalDns) {
      if (hostedZoneId && hostedZoneName) {
        hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
          hostedZoneId,
          zoneName: hostedZoneName,
        });
      } else if (hostedZoneId) {
        hostedZone = route53.HostedZone.fromHostedZoneId(this, 'HostedZone', hostedZoneId);
      } else {
        const lookupDomain = hostedZoneName ?? deriveHostedZoneName(domainName);
        hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
          domainName: lookupDomain,
        });
      }
    }

    let distributionCertificate: acm.ICertificate | undefined;
    const distributionDomainNames: string[] = [];

    if (domainName && hostedZone) {
      distributionCertificate = new acm.Certificate(this, 'Certificate', {
        domainName: domainName,
        subjectAlternativeNames: [`www.${domainName}`],
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });

      distributionDomainNames.push(domainName, `www.${domainName}`);
    } else if (domainName && certificateArn) {
      distributionCertificate = acm.Certificate.fromCertificateArn(
        this,
        'ImportedWebCertificate',
        certificateArn
      );

      distributionDomainNames.push(domainName);
    }

    if (distributionCertificate) {
      this.distribution = new cloudfront.Distribution(this, 'Distribution', {
        ...distributionProps,
        domainNames: distributionDomainNames,
        certificate: distributionCertificate,
      });
    } else {
      this.distribution = new cloudfront.Distribution(this, 'Distribution', distributionProps);
    }

    const domainConfigured = Boolean(distributionCertificate);

    if (domainName && hostedZone && domainConfigured) {
      new route53.ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.distribution)
        ),
      });

      new route53.ARecord(this, 'WwwAliasRecord', {
        zone: hostedZone,
        recordName: `www.${domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    // ==================== SSM Parameters ====================
    new ssm.StringParameter(this, 'FrontendBucketNameParameter', {
      parameterName: `/postolio/${environment}/web/bucket-name`,
      stringValue: this.frontendBucket.bucketName,
      description: 'Frontend S3 Bucket Name',
    });

    new ssm.StringParameter(this, 'CloudFrontDistributionIdParameter', {
      parameterName: `/postolio/${environment}/web/distribution-id`,
      stringValue: this.distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    new ssm.StringParameter(this, 'CloudFrontDomainNameParameter', {
      parameterName: `/postolio/${environment}/web/domain-name`,
      stringValue: this.distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
    });

    const preferredDomain = domainName ? `https://${domainName}` : undefined;
    const webUrl = preferredDomain || `https://${this.distribution.distributionDomainName}`;
    new ssm.StringParameter(this, 'WebUrlParameter', {
      parameterName: `/postolio/${environment}/web/url`,
      stringValue: webUrl,
      description: 'Frontend Application URL',
    });

    // ==================== Stack Outputs ====================
    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      description: 'Frontend S3 Bucket Name',
      exportName: `${prefix}-bucket-name`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID',
      exportName: `${prefix}-distribution-id`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
      exportName: `${prefix}-distribution-domain`,
    });

    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: webUrl,
      description: 'Frontend Application URL',
      exportName: `${prefix}-url`,
    });

    new cdk.CfnOutput(this, 'LogsBucketName', {
      value: logsBucket.bucketName,
      description: 'Application Logs S3 Bucket Name',
      exportName: `${prefix}-logs-bucket-name`,
    });

    // ==================== CDK NAG Suppressions ====================
    const distributionSuppressions = [
      {
        id: 'AwsSolutions-CFR1',
        reason: 'CloudFront geo-restriction not required for this application',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'WAF integration handled at ALB level for API, frontend is static content',
      },
      {
        id: 'AwsSolutions-CFR5',
        reason:
          'Origin communicates over HTTP because the API load balancer only exposes HTTP endpoints; CloudFront still enforces HTTPS for viewers.',
      },
    ];

    if (!distributionCertificate) {
      if (isProduction) {
        throw new Error(
          'An ACM certificate is required for the web distribution in production. Provide a hostedZoneId or webCertificateArn context value.'
        );
      }

      distributionSuppressions.push({
        id: 'AwsSolutions-CFR4',
        reason:
          'Non-production environment uses default CloudFront certificate; custom certificate will be supplied when promoting to production.',
      });
    }

    if (!enableCloudFrontAccessLogs) {
      distributionSuppressions.push({
        id: 'AwsSolutions-CFR3',
        reason:
          'CloudFront access logging is intentionally disabled in non-production to reduce log volume and storage costs.',
      });
    }

    acknowledgeNagRules(this.distribution, distributionSuppressions);

    acknowledgeNagRules(accessLogsBucket, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'Access logs bucket is the final destination for server logs and cannot log to itself',
      },
    ]);

    acknowledgeNagRules(logsBucket, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'CloudFront logs bucket is a terminal log destination and should not write recursive server access logs.',
      },
    ]);

    acknowledgeNagRules(this, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'S3 bucket policy requires wildcard for CloudFront access to all objects',
      },
    ]);
  }
}

function deriveHostedZoneName(domainName: string): string {
  const trimmed = domainName.replace(/\.$/, '');
  const parts = trimmed.split('.');
  if (parts.length <= 2) {
    return trimmed;
  }

  return parts.slice(-2).join('.');
}
