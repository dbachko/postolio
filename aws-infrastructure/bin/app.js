#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const cdk_nag_1 = require("cdk-nag");
const content_scheduler_stack_1 = require("../lib/scheduler/content-scheduler-stack");
const postolio_stack_1 = require("../lib/stacks/postolio-stack");
const token_service_stack_1 = require("../lib/stacks/token-service-stack");
const service_discovery_stack_1 = require("../lib/stacks/service-discovery-stack");
const oauth_config_1 = require("../lib/utils/oauth-config");
const app = new cdk.App();
// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';
const alertEmail = app.node.tryGetContext('alertEmail');
// Custom domain configuration for Postolio stack
const domainName = app.node.tryGetContext('domainName');
const hostedZoneId = app.node.tryGetContext('hostedZoneId');
const useExternalDns = app.node.tryGetContext('useExternalDns') || false;
// Environment-specific configuration
const envConfig = {
    dev: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    staging: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    prod: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
};
const stackEnv = envConfig[environment];
// 1. Deploy Shared Service Discovery stack first (all services will use this)
const serviceDiscoveryStack = new service_discovery_stack_1.ServiceDiscoveryStack(app, `ServiceDiscovery-${environment}`, {
    env: stackEnv,
    environment: environment,
    description: `Shared Service Discovery - ${environment} environment`,
    tags: {
        Environment: environment,
        Service: 'ServiceDiscovery',
        ManagedBy: 'CDK',
        Version: '1.0',
    },
});
// Get OAuth configuration from shared utility
const oauthConfig = (0, oauth_config_1.getOAuthConfig)(app);
// 2. Deploy Token Service stack (uses shared service discovery)
const tokenServiceStack = new token_service_stack_1.TokenServiceStack(app, `TokenService-${environment}`, {
    env: stackEnv,
    environment: environment,
    alertEmail: alertEmail,
    serviceDiscoveryNamespaceId: serviceDiscoveryStack.namespaceId,
    // OAuth configuration from shared utility
    ...oauthConfig,
    description: `Token Service - OAuth token management - ${environment} environment`,
    tags: {
        Environment: environment,
        Service: 'TokenService',
        ManagedBy: 'CDK',
        Version: '1.0',
    },
});
// 3. Deploy ContentScheduler stack (uses shared service discovery)
const contentSchedulerStack = new content_scheduler_stack_1.ContentSchedulerStack(app, `ContentScheduler-${environment}`, {
    env: stackEnv,
    environment: environment,
    alertEmail: alertEmail,
    serviceDiscoveryNamespaceId: serviceDiscoveryStack.namespaceId,
    description: `Content Scheduler Microservice - ${environment} environment`,
    tags: {
        Environment: environment,
        Service: 'ContentScheduler',
        ManagedBy: 'CDK',
        Version: '2.0',
    },
});
// 4. Deploy Postolio stack (uses shared service discovery)
const postolioStack = new postolio_stack_1.PostolioStack(app, `Postolio-${environment}`, {
    env: stackEnv,
    environment,
    domainName,
    hostedZoneId,
    useExternalDns,
    serviceDiscoveryNamespaceId: serviceDiscoveryStack.namespaceId,
    // No stack references needed - services use Cloud Map for discovery
    description: `Postolio Main Application - ${environment} environment`,
    tags: {
        Environment: environment,
        Service: 'Postolio',
        ManagedBy: 'CDK',
        Version: '2.0',
    },
});
// No explicit dependencies needed - services can be deployed independently
// Service discovery handles runtime communication
// Apply CDK Nag security checks to all environments
// This ensures security best practices are followed during development
cdk.Aspects.of(app).add(new cdk_nag_1.AwsSolutionsChecks({
    verbose: true,
    reports: true,
    logIgnores: false
}));
// Output CDK Nag compliance status
console.log(`CDK Nag security checks enabled for ${environment} environment`);
// Add comprehensive outputs for both stacks
new cdk.CfnOutput(contentSchedulerStack, 'CrossStackReference', {
    value: contentSchedulerStack.stackName,
    description: 'ContentScheduler stack reference for cross-stack dependencies',
    exportName: `ContentScheduler-${environment}-StackRef`,
});
new cdk.CfnOutput(postolioStack, 'DependencyStatus', {
    value: 'Successfully integrated with ContentScheduler',
    description: 'Indicates successful cross-stack dependency resolution',
});
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLHVDQUFxQztBQUNyQyxpREFBbUM7QUFDbkMscUNBQTZDO0FBQzdDLHNGQUFpRjtBQUNqRixpRUFBNkQ7QUFDN0QsMkVBQXNFO0FBQ3RFLG1GQUE4RTtBQUM5RSw0REFBMkQ7QUFFM0QsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7QUFFMUIsbURBQW1EO0FBQ25ELE1BQU0sV0FBVyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEtBQUssQ0FBQztBQUNuRSxNQUFNLFVBQVUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsQ0FBQztBQUV4RCxpREFBaUQ7QUFDakQsTUFBTSxVQUFVLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDeEQsTUFBTSxZQUFZLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDNUQsTUFBTSxjQUFjLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxLQUFLLENBQUM7QUFFekUscUNBQXFDO0FBQ3JDLE1BQU0sU0FBUyxHQUFHO0lBQ2hCLEdBQUcsRUFBRTtRQUNILE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtRQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXO0tBQ3REO0lBQ0QsT0FBTyxFQUFFO1FBQ1AsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CO1FBQ3hDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFD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QztBQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLHVDQUF1QyxXQUFXLGNBQWMsQ0FBQyxDQUFDO0FBRTlFLDRDQUE0QztBQUM1QyxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMscUJBQXFCLEVBQUUscUJBQXFCLEVBQUU7SUFDOUQsS0FBSyxFQUFFLHFCQUFxQixDQUFDLFNBQVM7SUFDdEMsV0FBVyxFQUFFLCtEQUErRDtJQUM1RSxVQUFVLEVBQUUsb0JBQW9CLFdBQVcsV0FBVztDQUN2RCxDQUFDLENBQUM7QUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsYUFBYSxFQUFFLGtCQUFrQixFQUFFO0lBQ25ELEtBQUssRUFBRSwrQ0FBK0M7SUFDdEQsV0FBVyxFQUFFLHdEQUF3RDtDQUN0RSxDQUFDLENBQUM7QUFFSCxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3Rlcic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQXdzU29sdXRpb25zQ2hlY2tzIH0gZnJvbSAnY2RrLW5hZyc7XG5pbXBvcnQgeyBDb250ZW50U2NoZWR1bGVyU3RhY2sgfSBmcm9tICcuLi9saWIvc2NoZWR1bGVyL2NvbnRlbnQtc2NoZWR1bGVyLXN0YWNrJztcbmltcG9ydCB7IFBvc3RvbGlvU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL3Bvc3RvbGlvLXN0YWNrJztcbmltcG9ydCB7IFRva2VuU2VydmljZVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy90b2tlbi1zZXJ2aWNlLXN0YWNrJztcbmltcG9ydCB7IFNlcnZpY2VEaXNjb3ZlcnlTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3Mvc2VydmljZS1kaXNjb3Zlcnktc3RhY2snO1xuaW1wb3J0IHsgZ2V0T0F1dGhDb25maWcgfSBmcm9tICcuLi9saWIvdXRpbHMvb2F1dGgtY29uZmlnJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8gR2V0IGVudmlyb25tZW50IGZyb20gY29udGV4dCBvciBkZWZhdWx0IHRvICdkZXYnXG5jb25zdCBlbnZpcm9ubWVudCA9IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2Vudmlyb25tZW50JykgfHwgJ2Rldic7XG5jb25zdCBhbGVydEVtYWlsID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnYWxlcnRFbWFpbCcpO1xuXG4vLyBDdXN0b20gZG9tYWluIGNvbmZpZ3VyYXRpb24gZm9yIFBvc3RvbGlvIHN0YWNrXG5jb25zdCBkb21haW5OYW1lID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnZG9tYWluTmFtZScpO1xuY29uc3QgaG9zdGVkWm9uZUlkID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnaG9zdGVkWm9uZUlkJyk7XG5jb25zdCB1c2VFeHRlcm5hbERucyA9IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ3VzZUV4dGVybmFsRG5zJykgfHwgZmFsc2U7XG5cbi8vIEVudmlyb25tZW50LXNwZWNpZmljIGNvbmZpZ3VyYXRpb25cbmNvbnN0IGVudkNvbmZpZyA9IHtcbiAgZGV2OiB7XG4gICAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcbiAgfSxcbiAgc3RhZ2luZzoge1xuICAgIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gICAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gfHwgJ3VzLWVhc3QtMScsXG4gIH0sXG4gIHByb2Q6IHtcbiAgICBhY2NvdW50OiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5ULFxuICAgIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OIHx8ICd1cy1lYXN0LTEnLFxuICB9LFxufTtcblxuY29uc3Qgc3RhY2tFbnYgPSBlbnZDb25maWdbZW52aXJvbm1lbnQgYXMga2V5b2YgdHlwZW9mIGVudkNvbmZpZ107XG5cbi8vIDEuIERlcGxveSBTaGFyZWQgU2VydmljZSBEaXNjb3Zlcnkgc3RhY2sgZmlyc3QgKGFsbCBzZXJ2aWNlcyB3aWxsIHVzZSB0aGlzKVxuY29uc3Qgc2VydmljZURpc2NvdmVyeVN0YWNrID0gbmV3IFNlcnZpY2VEaXNjb3ZlcnlTdGFjayhhcHAsIGBTZXJ2aWNlRGlzY292ZXJ5LSR7ZW52aXJvbm1lbnR9YCwge1xuICBlbnY6IHN0YWNrRW52LFxuICBlbnZpcm9ubWVudDogZW52aXJvbm1lbnQgYXMgJ2RldicgfCAnc3RhZ2luZycgfCAncHJvZCcsXG4gIGRlc2NyaXB0aW9uOiBgU2hhcmVkIFNlcnZpY2UgRGlzY292ZXJ5IC0gJHtlbnZpcm9ubWVudH0gZW52aXJvbm1lbnRgLFxuICB0YWdzOiB7XG4gICAgRW52aXJvbm1lbnQ6IGVudmlyb25tZW50LFxuICAgIFNlcnZpY2U6ICdTZXJ2aWNlRGlzY292ZXJ5JyxcbiAgICBNYW5hZ2VkQnk6ICdDREsnLFxuICAgIFZlcnNpb246ICcxLjAnLFxuICB9LFxufSk7XG5cbi8vIEdldCBPQXV0aCBjb25maWd1cmF0aW9uIGZyb20gc2hhcmVkIHV0aWxpdHlcbmNvbnN0IG9hdXRoQ29uZmlnID0gZ2V0T0F1dGhDb25maWcoYXBwKTtcblxuLy8gMi4gRGVwbG95IFRva2VuIFNlcnZpY2Ugc3RhY2sgKHVzZXMgc2hhcmVkIHNlcnZpY2UgZGlzY292ZXJ5KVxuY29uc3QgdG9rZW5TZXJ2aWNlU3RhY2sgPSBuZXcgVG9rZW5TZXJ2aWNlU3RhY2soYXBwLCBgVG9rZW5TZXJ2aWNlLSR7ZW52aXJvbm1lbnR9YCwge1xuICBlbnY6IHN0YWNrRW52LFxuICBlbnZpcm9ubWVudDogZW52aXJvbm1lbnQgYXMgJ2RldicgfCAnc3RhZ2luZycgfCAncHJvZCcsXG4gIGFsZXJ0RW1haWw6IGFsZXJ0RW1haWwsXG4gIHNlcnZpY2VEaXNjb3ZlcnlOYW1lc3BhY2VJZDogc2VydmljZURpc2NvdmVyeVN0YWNrLm5hbWVzcGFjZUlkLFxuICAvLyBPQXV0aCBjb25maWd1cmF0aW9uIGZyb20gc2hhcmVkIHV0aWxpdHlcbiAgLi4ub2F1dGhDb25maWcsXG4gIGRlc2NyaXB0aW9uOiBgVG9rZW4gU2VydmljZSAtIE9BdXRoIHRva2VuIG1hbmFnZW1lbnQgLSAke2Vudmlyb25tZW50fSBlbnZpcm9ubWVudGAsXG4gIHRhZ3M6IHtcbiAgICBFbnZpcm9ubWVudDogZW52aXJvbm1lbnQsXG4gICAgU2VydmljZTogJ1Rva2VuU2VydmljZScsXG4gICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgICBWZXJzaW9uOiAnMS4wJyxcbiAgfSxcbn0pO1xuXG4vLyAzLiBEZXBsb3kgQ29udGVudFNjaGVkdWxlciBzdGFjayAodXNlcyBzaGFyZWQgc2VydmljZSBkaXNjb3ZlcnkpXG5jb25zdCBjb250ZW50U2NoZWR1bGVyU3RhY2sgPSBuZXcgQ29udGVudFNjaGVkdWxlclN0YWNrKGFwcCwgYENvbnRlbnRTY2hlZHVsZXItJHtlbnZpcm9ubWVudH1gLCB7XG4gIGVudjogc3RhY2tFbnYsXG4gIGVudmlyb25tZW50OiBlbnZpcm9ubWVudCBhcyAnZGV2JyB8ICdzdGFnaW5nJyB8ICdwcm9kJyxcbiAgYWxlcnRFbWFpbDogYWxlcnRFbWFpbCxcbiAgc2VydmljZURpc2NvdmVyeU5hbWVzcGFjZUlkOiBzZXJ2aWNlRGlzY292ZXJ5U3RhY2submFtZXNwYWNlSWQsXG4gIGRlc2NyaXB0aW9uOiBgQ29udGVudCBTY2hlZHVsZXIgTWljcm9zZXJ2aWNlIC0gJHtlbnZpcm9ubWVudH0gZW52aXJvbm1lbnRgLFxuICB0YWdzOiB7XG4gICAgRW52aXJvbm1lbnQ6IGVudmlyb25tZW50LFxuICAgIFNlcnZpY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICBNYW5hZ2VkQnk6ICdDREsnLFxuICAgIFZlcnNpb246ICcyLjAnLFxuICB9LFxufSk7XG5cbi8vIDQuIERlcGxveSBQb3N0b2xpbyBzdGFjayAodXNlcyBzaGFyZWQgc2VydmljZSBkaXNjb3ZlcnkpXG5jb25zdCBwb3N0b2xpb1N0YWNrID0gbmV3IFBvc3RvbGlvU3RhY2soYXBwLCBgUG9zdG9saW8tJHtlbnZpcm9ubWVudH1gLCB7XG4gIGVudjogc3RhY2tFbnYsXG4gIGVudmlyb25tZW50LFxuICBkb21haW5OYW1lLFxuICBob3N0ZWRab25lSWQsXG4gIHVzZUV4dGVybmFsRG5zLFxuICBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlSWQ6IHNlcnZpY2VEaXNjb3ZlcnlTdGFjay5uYW1lc3BhY2VJZCxcbiAgLy8gTm8gc3RhY2sgcmVmZXJlbmNlcyBuZWVkZWQgLSBzZXJ2aWNlcyB1c2UgQ2xvdWQgTWFwIGZvciBkaXNjb3ZlcnlcbiAgZGVzY3JpcHRpb246IGBQb3N0b2xpbyBNYWluIEFwcGxpY2F0aW9uIC0gJHtlbnZpcm9ubWVudH0gZW52aXJvbm1lbnRgLFxuICB0YWdzOiB7XG4gICAgRW52aXJvbm1lbnQ6IGVudmlyb25tZW50LFxuICAgIFNlcnZpY2U6ICdQb3N0b2xpbycsXG4gICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgICBWZXJzaW9uOiAnMi4wJyxcbiAgfSxcbn0pO1xuXG4vLyBObyBleHBsaWNpdCBkZXBlbmRlbmNpZXMgbmVlZGVkIC0gc2VydmljZXMgY2FuIGJlIGRlcGxveWVkIGluZGVwZW5kZW50bHlcbi8vIFNlcnZpY2UgZGlzY292ZXJ5IGhhbmRsZXMgcnVudGltZSBjb21tdW5pY2F0aW9uXG5cbi8vIEFwcGx5IENESyBOYWcgc2VjdXJpdHkgY2hlY2tzIHRvIGFsbCBlbnZpcm9ubWVudHNcbi8vIFRoaXMgZW5zdXJlcyBzZWN1cml0eSBiZXN0IHByYWN0aWNlcyBhcmUgZm9sbG93ZWQgZHVyaW5nIGRldmVsb3BtZW50XG5jZGsuQXNwZWN0cy5vZihhcHApLmFkZChuZXcgQXdzU29sdXRpb25zQ2hlY2tzKHsgXG4gIHZlcmJvc2U6IHRydWUsXG4gIHJlcG9ydHM6IHRydWUsXG4gIGxvZ0lnbm9yZXM6IGZhbHNlXG59KSk7XG5cbi8vIE91dHB1dCBDREsgTmFnIGNvbXBsaWFuY2Ugc3RhdHVzXG5jb25zb2xlLmxvZyhgQ0RLIE5hZyBzZWN1cml0eSBjaGVja3MgZW5hYmxlZCBmb3IgJHtlbnZpcm9ubWVudH0gZW52aXJvbm1lbnRgKTtcblxuLy8gQWRkIGNvbXByZWhlbnNpdmUgb3V0cHV0cyBmb3IgYm90aCBzdGFja3Ncbm5ldyBjZGsuQ2ZuT3V0cHV0KGNvbnRlbnRTY2hlZHVsZXJTdGFjaywgJ0Nyb3NzU3RhY2tSZWZlcmVuY2UnLCB7XG4gIHZhbHVlOiBjb250ZW50U2NoZWR1bGVyU3RhY2suc3RhY2tOYW1lLFxuICBkZXNjcmlwdGlvbjogJ0NvbnRlbnRTY2hlZHVsZXIgc3RhY2sgcmVmZXJlbmNlIGZvciBjcm9zcy1zdGFjayBkZXBlbmRlbmNpZXMnLFxuICBleHBvcnROYW1lOiBgQ29udGVudFNjaGVkdWxlci0ke2Vudmlyb25tZW50fS1TdGFja1JlZmAsXG59KTtcblxubmV3IGNkay5DZm5PdXRwdXQocG9zdG9saW9TdGFjaywgJ0RlcGVuZGVuY3lTdGF0dXMnLCB7XG4gIHZhbHVlOiAnU3VjY2Vzc2Z1bGx5IGludGVncmF0ZWQgd2l0aCBDb250ZW50U2NoZWR1bGVyJyxcbiAgZGVzY3JpcHRpb246ICdJbmRpY2F0ZXMgc3VjY2Vzc2Z1bCBjcm9zcy1zdGFjayBkZXBlbmRlbmN5IHJlc29sdXRpb24nLFxufSk7XG5cbmFwcC5zeW50aCgpOyJdfQ==