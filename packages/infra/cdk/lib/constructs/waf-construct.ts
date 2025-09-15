import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface WAFConstructProps {
  environment: 'dev' | 'staging' | 'prod';
  allowedCountries?: string[];
  rateLimitPerMinute?: number;
}

export class WAFConstruct extends Construct {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: WAFConstructProps) {
    super(scope, id);

    const { environment, allowedCountries = ['US', 'CA'], rateLimitPerMinute = 1000 } = props;

    // Create WAF rules
    const rules: wafv2.CfnWebACL.RuleProperty[] = [
      // AWS Managed Rule - Common Rule Set (OWASP Top 10)
      {
        name: 'AWS-AWSManagedRulesCommonRuleSet',
        priority: 10,
        overrideAction: { none: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: 'AWS',
            name: 'AWSManagedRulesCommonRuleSet',
            excludedRules: environment === 'dev' ? [
              // Allow more lenient rules in development
              { name: 'GenericRFI_BODY' },
              { name: 'GenericRFI_QUERYARGUMENTS' },
              { name: 'GenericRFI_URIPATH' },
            ] : [],
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'CommonRuleSetMetric',
        },
      },

      // AWS Managed Rule - Known Bad Inputs
      {
        name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
        priority: 20,
        overrideAction: { none: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: 'AWS',
            name: 'AWSManagedRulesKnownBadInputsRuleSet',
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'KnownBadInputsMetric',
        },
      },

      // AWS Managed Rule - SQL Injection
      {
        name: 'AWS-AWSManagedRulesSQLiRuleSet',
        priority: 30,
        overrideAction: { none: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: 'AWS',
            name: 'AWSManagedRulesSQLiRuleSet',
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'SQLInjectionMetric',
        },
      },

      // AWS Managed Rule - Anonymous IP List
      {
        name: 'AWS-AWSManagedRulesAnonymousIpList',
        priority: 40,
        overrideAction: { none: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: 'AWS',
            name: 'AWSManagedRulesAnonymousIpList',
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'AnonymousIPMetric',
        },
      },

      // Geographic restriction (production only)
      ...(environment === 'prod' ? [{
        name: 'GeoRestrictionRule',
        priority: 50,
        action: { block: {} },
        statement: {
          notStatement: {
            statement: {
              geoMatchStatement: {
                countryCodes: allowedCountries,
              },
            },
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'GeoRestrictionMetric',
        },
      }] : []),

      // Rate limiting rule
      {
        name: 'RateLimitRule',
        priority: 60,
        action: { block: {} },
        statement: {
          rateBasedStatement: {
            limit: rateLimitPerMinute,
            aggregateKeyType: 'IP',
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'RateLimitMetric',
        },
      },

      // Custom rule to block requests with suspicious patterns
      {
        name: 'SuspiciousRequestsRule',
        priority: 70,
        action: { block: {} },
        statement: {
          orStatement: {
            statements: [
              {
                byteMatchStatement: {
                  searchString: '../',
                  fieldToMatch: { uriPath: {} },
                  textTransformations: [
                    {
                      priority: 0,
                      type: 'URL_DECODE',
                    },
                  ],
                  positionalConstraint: 'CONTAINS',
                },
              },
              {
                byteMatchStatement: {
                  searchString: 'UNION SELECT',
                  fieldToMatch: { allQueryArguments: {} },
                  textTransformations: [
                    {
                      priority: 0,
                      type: 'UPPERCASE',
                    },
                  ],
                  positionalConstraint: 'CONTAINS',
                },
              },
              {
                byteMatchStatement: {
                  searchString: '<script',
                  fieldToMatch: { body: {} },
                  textTransformations: [
                    {
                      priority: 0,
                      type: 'LOWERCASE',
                    },
                  ],
                  positionalConstraint: 'CONTAINS',
                },
              },
            ],
          },
        },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'SuspiciousRequestsMetric',
        },
      },
    ];

    // Create the Web ACL
    this.webAcl = new wafv2.CfnWebACL(this, 'PostolioWebACL', {
      name: `postolio-waf-${environment}`,
      scope: 'REGIONAL', // Use REGIONAL for API Gateway
      defaultAction: { allow: {} },
      description: `Postolio WAF for ${environment} environment`,
      rules,
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `PostolioWAF${environment}`,
      },
      tags: [
        {
          key: 'Environment',
          value: environment,
        },
        {
          key: 'Service',
          value: 'WAF',
        },
        {
          key: 'ManagedBy',
          value: 'CDK',
        },
      ],
    });

    // Output the Web ACL ARN
    new cdk.CfnOutput(this, 'WAFWebACLArn', {
      value: this.webAcl.attrArn,
      description: 'WAF Web ACL ARN',
      exportName: `${cdk.Stack.of(this).stackName}-WAF-ARN`,
    });

    new cdk.CfnOutput(this, 'WAFWebACLId', {
      value: this.webAcl.attrId,
      description: 'WAF Web ACL ID',
      exportName: `${cdk.Stack.of(this).stackName}-WAF-ID`,
    });
  }
}

// Helper function to associate WAF with API Gateway
export function associateWAFWithApiGateway(
  scope: Construct,
  apiGatewayArn: string,
  webAclArn: string,
  environment: string
): void {
  new wafv2.CfnWebACLAssociation(scope, `WAFAssociation-${environment}`, {
    resourceArn: apiGatewayArn,
    webAclArn,
  });
}