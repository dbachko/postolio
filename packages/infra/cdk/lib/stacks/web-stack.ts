/**
 * Web Stack - Frontend Infrastructure (S3 + CloudFront)
 * Contains the React frontend deployed to S3 with CloudFront distribution
 */

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export interface WebStackProps extends cdk.StackProps {
  environment: string;
  domainName?: string;
  hostedZoneId?: string;
}

export class WebStack extends cdk.Stack {
  public readonly frontendBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const { environment, domainName, hostedZoneId } = props;
    const prefix = `postolio-${environment}-web`;

    // ==================== S3 Bucket for Frontend ====================
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${prefix}-frontend`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [
        {
          id: 'delete-old-versions',
          noncurrentVersionExpiration: cdk.Duration.days(7),
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== CloudFront Origin Access Identity ====================
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: `${prefix} - CloudFront access to S3`,
    });

    // Grant CloudFront read access to the S3 bucket
    this.frontendBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [originAccessIdentity.grantPrincipal],
        actions: ['s3:GetObject'],
        resources: [`${this.frontendBucket.bucketArn}/*`],
      })
    );

    // ==================== CloudFront Distribution ====================
    const distributionProps: cloudfront.DistributionProps = {
      comment: `${prefix} - Frontend Distribution`,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass:
        environment === 'prod'
          ? cloudfront.PriceClass.PRICE_CLASS_ALL
          : cloudfront.PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
      defaultBehavior: {
        origin: new origins.S3Origin(this.frontendBucket, {
          originAccessIdentity: originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: new cloudfront.CachePolicy(this, 'StaticAssetsCachePolicy', {
          cachePolicyName: `${prefix}-static-cache-policy`,
          comment: 'Cache policy for static assets with long TTL',
          defaultTtl: cdk.Duration.days(30),
          maxTtl: cdk.Duration.days(365),
          minTtl: cdk.Duration.seconds(0),
          headerBehavior: cloudfront.CacheHeaderBehavior.none(),
          queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
          cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        }),
      },
      additionalBehaviors: {
        // Special handling for index.html - no caching
        '/index.html': {
          origin: new origins.S3Origin(this.frontendBucket, {
            originAccessIdentity: originAccessIdentity,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, 'IndexCachePolicy', {
            cachePolicyName: `${prefix}-index-cache-policy`,
            comment: 'Cache policy for index.html - no caching',
            defaultTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.seconds(0),
            minTtl: cdk.Duration.seconds(0),
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
              'CloudFront-Is-Mobile-Viewer',
              'CloudFront-Is-Tablet-Viewer'
            ),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
          }),
        },
        // API proxy behavior (optional - for same-domain API calls)
        '/api/*': {
          origin: new origins.HttpOrigin(
            ssm.StringParameter.valueForStringParameter(this, `/postolio/${environment}/api/url`)
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      geoRestriction:
        environment === 'prod' ? undefined : cloudfront.GeoRestriction.denylist('CN', 'RU'), // Block certain countries in non-prod
    };

    // Add domain configuration if provided
    if (domainName && hostedZoneId) {
      const hostedZone = route53.HostedZone.fromHostedZoneId(this, 'HostedZone', hostedZoneId);

      // Create SSL certificate
      const certificate = new acm.Certificate(this, 'Certificate', {
        domainName: domainName,
        subjectAlternativeNames: [`www.${domainName}`],
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });

      this.distribution = new cloudfront.Distribution(this, 'Distribution', {
        ...distributionProps,
        domainNames: [domainName, `www.${domainName}`],
        certificate: certificate,
      });

      // Create Route53 records
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
    } else {
      this.distribution = new cloudfront.Distribution(this, 'Distribution', distributionProps);
    }

    // ==================== S3 Bucket for Application Logs ====================
    const logsBucket = new s3.Bucket(this, 'LogsBucket', {
      bucketName: `${prefix}-logs`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'delete-old-logs',
          expiration: cdk.Duration.days(90),
        },
        {
          id: 'transition-to-ia',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

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

    const webUrl = domainName
      ? `https://${domainName}`
      : `https://${this.distribution.distributionDomainName}`;
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
    NagSuppressions.addResourceSuppressions(
      this.frontendBucket,
      [
        {
          id: 'AwsSolutions-S1',
          reason: 'Access logs not required for frontend bucket, CloudFront provides access logs',
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this.distribution,
      [
        {
          id: 'AwsSolutions-CFR1',
          reason: 'CloudFront geo-restriction not required for this application',
        },
        {
          id: 'AwsSolutions-CFR2',
          reason: 'WAF integration handled at ALB level for API, frontend is static content',
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'S3 bucket policy requires wildcard for CloudFront access to all objects',
        },
      ],
      true
    );
  }
}
