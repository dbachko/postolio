import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface PostolioStackProps extends cdk.StackProps {
    environment: string;
    domainName?: string;
    hostedZoneId?: string;
    useExternalDns?: boolean;
    serviceDiscoveryNamespaceId?: string;
}
export declare class PostolioStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PostolioStackProps);
}
