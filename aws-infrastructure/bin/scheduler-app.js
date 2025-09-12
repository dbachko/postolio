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
const content_scheduler_stack_1 = require("../lib/scheduler/content-scheduler-stack");
// import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
const app = new cdk.App();
// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';
const alertEmail = app.node.tryGetContext('alertEmail');
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
const stackName = `ContentScheduler-${environment}`;
const stack = new content_scheduler_stack_1.ContentSchedulerStack(app, stackName, {
    env: envConfig[environment],
    environment: environment,
    alertEmail: alertEmail,
    mainAppApiUrl: app.node.tryGetContext('mainAppApiUrl') || 'https://postolio.example',
    description: `Content Scheduler Microservice - ${environment} environment`,
    tags: {
        Environment: environment,
        Service: 'ContentScheduler',
        ManagedBy: 'CDK',
        Version: '2.0',
    },
});
// CDK Nag checks temporarily disabled for development deployment
// TODO: Re-enable with proper suppressions for production deployment
// cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZWR1bGVyLWFwcC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjaGVkdWxlci1hcHAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsdUNBQXFDO0FBQ3JDLGlEQUFtQztBQUNuQyxzRkFBaUY7QUFDakYsaUVBQWlFO0FBRWpFLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLG1EQUFtRDtBQUNuRCxNQUFNLFdBQVcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsSUFBSSxLQUFLLENBQUM7QUFDbkUsTUFBTSxVQUFVLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7QUFFeEQscUNBQXFDO0FBQ3JDLE1BQU0sU0FBUyxHQUFHO0lBQ2hCLEdBQUcsRUFBRTtRQUNILE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtRQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXO0tBQ3REO0lBQ0QsT0FBTyxFQUFFO1FBQ1AsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CO1FBQ3hDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLFdBQVc7S0FDdEQ7SUFDRCxJQUFJLEVBQUU7UUFDSixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7UUFDeEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztLQUN0RDtDQUNGLENBQUM7QUFFRixNQUFNLFNBQVMsR0FBRyxvQkFBb0IsV0FBVyxFQUFFLENBQUM7QUFFcEQsTUFBTSxLQUFLLEdBQUcsSUFBSSwrQ0FBcUIsQ0FBQyxHQUFHLEVBQUUsU0FBUyxFQUFFO0lBQ3RELEdBQUcsRUFBRSxTQUFTLENBQUMsV0FBcUMsQ0FBQztJQUNyRCxXQUFXLEVBQUUsV0FBeUM7SUFDdEQsVUFBVSxFQUFFLFVBQVU7SUFDdEIsYUFBYSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxJQUFJLHVCQUF1QjtJQUNqRixXQUFXLEVBQUUsb0NBQW9DLFdBQVcsY0FBYztJQUMxRSxJQUFJLEVBQUU7UUFDSixXQUFXLEVBQUUsV0FBVztRQUN4QixPQUFPLEVBQUUsa0JBQWtCO1FBQzNCLFNBQVMsRUFBRSxLQUFLO1FBQ2hCLE9BQU8sRUFBRSxLQUFLO0tBQ2Y7Q0FDRixDQUFDLENBQUM7QUFFSCxpRUFBaUU7QUFDakUscUVBQXFFO0FBQ3JFLHNFQUFzRTtBQUV0RSxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3Rlcic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29udGVudFNjaGVkdWxlclN0YWNrIH0gZnJvbSAnLi4vbGliL3NjaGVkdWxlci9jb250ZW50LXNjaGVkdWxlci1zdGFjayc7XG4vLyBpbXBvcnQgeyBBd3NTb2x1dGlvbnNDaGVja3MsIE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuXG4vLyBHZXQgZW52aXJvbm1lbnQgZnJvbSBjb250ZXh0IG9yIGRlZmF1bHQgdG8gJ2RldidcbmNvbnN0IGVudmlyb25tZW50ID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnZW52aXJvbm1lbnQnKSB8fCAnZGV2JztcbmNvbnN0IGFsZXJ0RW1haWwgPSBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdhbGVydEVtYWlsJyk7XG5cbi8vIEVudmlyb25tZW50LXNwZWNpZmljIGNvbmZpZ3VyYXRpb25cbmNvbnN0IGVudkNvbmZpZyA9IHtcbiAgZGV2OiB7XG4gICAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcbiAgfSxcbiAgc3RhZ2luZzoge1xuICAgIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gICAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gfHwgJ3VzLWVhc3QtMScsXG4gIH0sXG4gIHByb2Q6IHtcbiAgICBhY2NvdW50OiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5ULFxuICAgIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OIHx8ICd1cy1lYXN0LTEnLFxuICB9LFxufTtcblxuY29uc3Qgc3RhY2tOYW1lID0gYENvbnRlbnRTY2hlZHVsZXItJHtlbnZpcm9ubWVudH1gO1xuXG5jb25zdCBzdGFjayA9IG5ldyBDb250ZW50U2NoZWR1bGVyU3RhY2soYXBwLCBzdGFja05hbWUsIHtcbiAgZW52OiBlbnZDb25maWdbZW52aXJvbm1lbnQgYXMga2V5b2YgdHlwZW9mIGVudkNvbmZpZ10sXG4gIGVudmlyb25tZW50OiBlbnZpcm9ubWVudCBhcyAnZGV2JyB8ICdzdGFnaW5nJyB8ICdwcm9kJyxcbiAgYWxlcnRFbWFpbDogYWxlcnRFbWFpbCxcbiAgbWFpbkFwcEFwaVVybDogYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnbWFpbkFwcEFwaVVybCcpIHx8ICdodHRwczovL2FwcC5wb3N0b2wuaW8nLFxuICBkZXNjcmlwdGlvbjogYENvbnRlbnQgU2NoZWR1bGVyIE1pY3Jvc2VydmljZSAtICR7ZW52aXJvbm1lbnR9IGVudmlyb25tZW50YCxcbiAgdGFnczoge1xuICAgIEVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcbiAgICBTZXJ2aWNlOiAnQ29udGVudFNjaGVkdWxlcicsXG4gICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgICBWZXJzaW9uOiAnMi4wJyxcbiAgfSxcbn0pO1xuXG4vLyBDREsgTmFnIGNoZWNrcyB0ZW1wb3JhcmlseSBkaXNhYmxlZCBmb3IgZGV2ZWxvcG1lbnQgZGVwbG95bWVudFxuLy8gVE9ETzogUmUtZW5hYmxlIHdpdGggcHJvcGVyIHN1cHByZXNzaW9ucyBmb3IgcHJvZHVjdGlvbiBkZXBsb3ltZW50XG4vLyBjZGsuQXNwZWN0cy5vZihhcHApLmFkZChuZXcgQXdzU29sdXRpb25zQ2hlY2tzKHsgdmVyYm9zZTogdHJ1ZSB9KSk7XG5cbmFwcC5zeW50aCgpOyJdfQ==