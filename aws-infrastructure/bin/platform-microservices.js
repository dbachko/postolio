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
const platform_microservices_stack_1 = require("../lib/stacks/platform-microservices-stack");
const oauth_config_1 = require("../lib/utils/oauth-config");
const app = new cdk.App();
// Get environment from context or default to dev
const environment = app.node.tryGetContext('environment') || 'dev';
const alertEmail = app.node.tryGetContext('alertEmail');
// Validate environment
if (!['dev', 'staging', 'prod'].includes(environment)) {
    throw new Error(`Invalid environment: ${environment}. Must be dev, staging, or prod.`);
}
// Stack configuration based on environment
const stackProps = {
    dev: {
        env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
        },
        description: 'Postolio Platform Microservices - Development',
        tags: {
            Environment: 'dev',
            Project: 'Postolio',
            ManagedBy: 'CDK',
            Service: 'PlatformMicroservices',
        },
    },
    staging: {
        env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
        },
        description: 'Postolio Platform Microservices - Staging',
        tags: {
            Environment: 'staging',
            Project: 'Postolio',
            ManagedBy: 'CDK',
            Service: 'PlatformMicroservices',
        },
    },
    prod: {
        env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
        },
        description: 'Postolio Platform Microservices - Production',
        tags: {
            Environment: 'prod',
            Project: 'Postolio',
            ManagedBy: 'CDK',
            Service: 'PlatformMicroservices',
            CostCenter: 'Engineering',
        },
    },
};
// Get OAuth configuration from shared utility
const oauthConfig = (0, oauth_config_1.getOAuthConfig)(app);
// Create the stack
new platform_microservices_stack_1.PlatformMicroservicesStack(app, `Postolio-Platform-${environment}`, {
    ...stackProps[environment],
    environment: environment,
    alertEmail,
    ...oauthConfig, // Spread OAuth configuration
});
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxhdGZvcm0tbWljcm9zZXJ2aWNlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBsYXRmb3JtLW1pY3Jvc2VydmljZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsdUNBQW9DO0FBQ3BDLGlEQUFrQztBQUNsQyw2RkFBdUY7QUFDdkYsNERBQTBEO0FBRTFELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFBO0FBRXpCLGlEQUFpRDtBQUNqRCxNQUFNLFdBQVcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsSUFBSSxLQUFLLENBQUE7QUFDbEUsTUFBTSxVQUFVLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUE7QUFFdkQsdUJBQXVCO0FBQ3ZCLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7SUFDdEQsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsV0FBVyxrQ0FBa0MsQ0FBQyxDQUFBO0FBQ3hGLENBQUM7QUFFRCwyQ0FBMkM7QUFDM0MsTUFBTSxVQUFVLEdBQUc7SUFDakIsR0FBRyxFQUFFO1FBQ0gsR0FBRyxFQUFFO1lBQ0gsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CO1lBQ3hDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLFdBQVc7U0FDdEQ7UUFDRCxXQUFXLEVBQUUsK0NBQStDO1FBQzVELElBQUksRUFBRTtZQUNKLFdBQVcsRUFBRSxLQUFLO1lBQ2xCLE9BQU8sRUFBRSxVQUFVO1lBQ25CLFNBQVMsRUFBRSxLQUFLO1lBQ2hCLE9BQU8sRUFBRSx1QkFBdUI7U0FDakM7S0FDRjtJQUNELE9BQU8sRUFBRTtRQUNQLEdBQUcsRUFBRTtZQUNILE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtZQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXO1NBQ3REO1FBQ0QsV0FBVyxFQUFFLDJDQUEyQztRQUN4RCxJQUFJLEVBQUU7WUFDSixXQUFXLEVBQUUsU0FBUztZQUN0QixPQUFPLEVBQUUsVUFBVTtZQUNuQixTQUFTLEVBQUUsS0FBSztZQUNoQixPQUFPLEVBQUUsdUJBQXVCO1NBQ2pDO0tBQ0Y7SUFDRCxJQUFJLEVBQUU7UUFDSixHQUFHLEVBQUU7WUFDSCxPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7WUFDeEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztTQUN0RDtRQUNELFdBQVcsRUFBRSw4Q0FBOEM7UUFDM0QsSUFBSSxFQUFFO1lBQ0osV0FBVyxFQUFFLE1BQU07WUFDbkIsT0FBTyxFQUFFLFVBQVU7WUFDbkIsU0FBUyxFQUFFLEtBQUs7WUFDaEIsT0FBTyxFQUFFLHVCQUF1QjtZQUNoQyxVQUFVLEVBQUUsYUFBYTtTQUMxQjtLQUNGO0NBQ0YsQ0FBQTtBQUVELDhDQUE4QztBQUM5QyxNQUFNLFdBQVcsR0FBRyxJQUFBLDZCQUFjLEVBQUMsR0FBRyxDQUFDLENBQUE7QUFFdkMsbUJBQW1CO0FBQ25CLElBQUkseURBQTBCLENBQUMsR0FBRyxFQUFFLHFCQUFxQixXQUFXLEVBQUUsRUFBRTtJQUN0RSxHQUFHLFVBQVUsQ0FBQyxXQUFzQyxDQUFDO0lBQ3JELFdBQVcsRUFBRSxXQUF5QztJQUN0RCxVQUFVO0lBQ1YsR0FBRyxXQUFXLEVBQUUsNkJBQTZCO0NBQzlDLENBQUMsQ0FBQTtBQUVGLEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJ1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0IHsgUGxhdGZvcm1NaWNyb3NlcnZpY2VzU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL3BsYXRmb3JtLW1pY3Jvc2VydmljZXMtc3RhY2snXG5pbXBvcnQgeyBnZXRPQXV0aENvbmZpZyB9IGZyb20gJy4uL2xpYi91dGlscy9vYXV0aC1jb25maWcnXG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKClcblxuLy8gR2V0IGVudmlyb25tZW50IGZyb20gY29udGV4dCBvciBkZWZhdWx0IHRvIGRldlxuY29uc3QgZW52aXJvbm1lbnQgPSBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpIHx8ICdkZXYnXG5jb25zdCBhbGVydEVtYWlsID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnYWxlcnRFbWFpbCcpXG5cbi8vIFZhbGlkYXRlIGVudmlyb25tZW50XG5pZiAoIVsnZGV2JywgJ3N0YWdpbmcnLCAncHJvZCddLmluY2x1ZGVzKGVudmlyb25tZW50KSkge1xuICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZW52aXJvbm1lbnQ6ICR7ZW52aXJvbm1lbnR9LiBNdXN0IGJlIGRldiwgc3RhZ2luZywgb3IgcHJvZC5gKVxufVxuXG4vLyBTdGFjayBjb25maWd1cmF0aW9uIGJhc2VkIG9uIGVudmlyb25tZW50XG5jb25zdCBzdGFja1Byb3BzID0ge1xuICBkZXY6IHtcbiAgICBlbnY6IHtcbiAgICAgIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gICAgICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcbiAgICB9LFxuICAgIGRlc2NyaXB0aW9uOiAnUG9zdG9saW8gUGxhdGZvcm0gTWljcm9zZXJ2aWNlcyAtIERldmVsb3BtZW50JyxcbiAgICB0YWdzOiB7XG4gICAgICBFbnZpcm9ubWVudDogJ2RldicsXG4gICAgICBQcm9qZWN0OiAnUG9zdG9saW8nLFxuICAgICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgICAgIFNlcnZpY2U6ICdQbGF0Zm9ybU1pY3Jvc2VydmljZXMnLFxuICAgIH0sXG4gIH0sXG4gIHN0YWdpbmc6IHtcbiAgICBlbnY6IHtcbiAgICAgIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gICAgICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcbiAgICB9LFxuICAgIGRlc2NyaXB0aW9uOiAnUG9zdG9saW8gUGxhdGZvcm0gTWljcm9zZXJ2aWNlcyAtIFN0YWdpbmcnLFxuICAgIHRhZ3M6IHtcbiAgICAgIEVudmlyb25tZW50OiAnc3RhZ2luZycsXG4gICAgICBQcm9qZWN0OiAnUG9zdG9saW8nLFxuICAgICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgICAgIFNlcnZpY2U6ICdQbGF0Zm9ybU1pY3Jvc2VydmljZXMnLFxuICAgIH0sXG4gIH0sXG4gIHByb2Q6IHtcbiAgICBlbnY6IHtcbiAgICAgIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gICAgICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcbiAgICB9LFxuICAgIGRlc2NyaXB0aW9uOiAnUG9zdG9saW8gUGxhdGZvcm0gTWljcm9zZXJ2aWNlcyAtIFByb2R1Y3Rpb24nLFxuICAgIHRhZ3M6IHtcbiAgICAgIEVudmlyb25tZW50OiAncHJvZCcsXG4gICAgICBQcm9qZWN0OiAnUG9zdG9saW8nLFxuICAgICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgICAgIFNlcnZpY2U6ICdQbGF0Zm9ybU1pY3Jvc2VydmljZXMnLFxuICAgICAgQ29zdENlbnRlcjogJ0VuZ2luZWVyaW5nJyxcbiAgICB9LFxuICB9LFxufVxuXG4vLyBHZXQgT0F1dGggY29uZmlndXJhdGlvbiBmcm9tIHNoYXJlZCB1dGlsaXR5XG5jb25zdCBvYXV0aENvbmZpZyA9IGdldE9BdXRoQ29uZmlnKGFwcClcblxuLy8gQ3JlYXRlIHRoZSBzdGFja1xubmV3IFBsYXRmb3JtTWljcm9zZXJ2aWNlc1N0YWNrKGFwcCwgYFBvc3RvbGlvLVBsYXRmb3JtLSR7ZW52aXJvbm1lbnR9YCwge1xuICAuLi5zdGFja1Byb3BzW2Vudmlyb25tZW50IGFzIGtleW9mIHR5cGVvZiBzdGFja1Byb3BzXSxcbiAgZW52aXJvbm1lbnQ6IGVudmlyb25tZW50IGFzICdkZXYnIHwgJ3N0YWdpbmcnIHwgJ3Byb2QnLFxuICBhbGVydEVtYWlsLFxuICAuLi5vYXV0aENvbmZpZywgLy8gU3ByZWFkIE9BdXRoIGNvbmZpZ3VyYXRpb25cbn0pXG5cbmFwcC5zeW50aCgpIl19