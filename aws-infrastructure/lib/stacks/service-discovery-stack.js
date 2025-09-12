"use strict";
/**
 * Shared Service Discovery Stack
 * Creates a single Cloud Map namespace that all services can register with
 */
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
exports.ServiceDiscoveryStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const servicediscovery = __importStar(require("aws-cdk-lib/aws-servicediscovery"));
class ServiceDiscoveryStack extends cdk.Stack {
    namespace;
    namespaceId;
    namespaceName;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment, vpc } = props;
        const namespaceName = `postolio-${environment}.local`;
        // Create namespace based on whether VPC is provided
        if (vpc) {
            // Private DNS namespace for VPC-based services (ECS)
            this.namespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
                name: namespaceName,
                vpc,
                description: `Shared service discovery namespace for Postolio ${environment}`,
            });
        }
        else {
            // HTTP namespace for serverless services (Lambda)
            this.namespace = new servicediscovery.HttpNamespace(this, 'Namespace', {
                name: namespaceName,
                description: `Shared service discovery namespace for Postolio ${environment}`,
            });
        }
        this.namespaceId = this.namespace.namespaceId;
        this.namespaceName = this.namespace.namespaceName;
        // Export namespace details for other stacks to import
        new cdk.CfnOutput(this, 'NamespaceId', {
            value: this.namespaceId,
            description: 'Cloud Map Namespace ID',
            exportName: `ServiceDiscovery-${environment}-NamespaceId`,
        });
        new cdk.CfnOutput(this, 'NamespaceName', {
            value: this.namespaceName,
            description: 'Cloud Map Namespace Name',
            exportName: `ServiceDiscovery-${environment}-NamespaceName`,
        });
        new cdk.CfnOutput(this, 'NamespaceArn', {
            value: this.namespace.namespaceArn,
            description: 'Cloud Map Namespace ARN',
            exportName: `ServiceDiscovery-${environment}-NamespaceArn`,
        });
        // Add tags
        cdk.Tags.of(this).add('Service', 'ServiceDiscovery');
        cdk.Tags.of(this).add('Environment', environment);
        cdk.Tags.of(this).add('ManagedBy', 'CDK');
    }
}
exports.ServiceDiscoveryStack = ServiceDiscoveryStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS1kaXNjb3Zlcnktc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzZXJ2aWNlLWRpc2NvdmVyeS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCxpREFBbUM7QUFDbkMsbUZBQXFFO0FBU3JFLE1BQWEscUJBQXNCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDbEMsU0FBUyxDQUE4QjtJQUN2QyxXQUFXLENBQVM7SUFDcEIsYUFBYSxDQUFTO0lBRXRDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBaUM7UUFDekUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxHQUFHLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFDbkMsTUFBTSxhQUFhLEdBQUcsWUFBWSxXQUFXLFFBQVEsQ0FBQztRQUV0RCxvREFBb0Q7UUFDcEQsSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUNSLHFEQUFxRDtZQUNyRCxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksZ0JBQWdCLENBQUMsbUJBQW1CLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRTtnQkFDM0UsSUFBSSxFQUFFLGFBQWE7Z0JBQ25CLEdBQUc7Z0JBQ0gsV0FBVyxFQUFFLG1EQUFtRCxXQUFXLEVBQUU7YUFDOUUsQ0FBQyxDQUFDO1FBQ0wsQ0FBQzthQUFNLENBQUM7WUFDTixrREFBa0Q7WUFDbEQsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLGdCQUFnQixDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO2dCQUNyRSxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsV0FBVyxFQUFFLG1EQUFtRCxXQUFXLEVBQUU7YUFDOUUsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUM7UUFDOUMsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQztRQUVsRCxzREFBc0Q7UUFDdEQsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDckMsS0FBSyxFQUFFLElBQUksQ0FBQyxXQUFXO1lBQ3ZCLFdBQVcsRUFBRSx3QkFBd0I7WUFDckMsVUFBVSxFQUFFLG9CQUFvQixXQUFXLGNBQWM7U0FDMUQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLElBQUksQ0FBQyxhQUFhO1lBQ3pCLFdBQVcsRUFBRSwwQkFBMEI7WUFDdkMsVUFBVSxFQUFFLG9CQUFvQixXQUFXLGdCQUFnQjtTQUM1RCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUN0QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZO1lBQ2xDLFdBQVcsRUFBRSx5QkFBeUI7WUFDdEMsVUFBVSxFQUFFLG9CQUFvQixXQUFXLGVBQWU7U0FDM0QsQ0FBQyxDQUFDO1FBRUgsV0FBVztRQUNYLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsa0JBQWtCLENBQUMsQ0FBQztRQUNyRCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQ2xELEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDNUMsQ0FBQztDQUNGO0FBdERELHNEQXNEQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU2hhcmVkIFNlcnZpY2UgRGlzY292ZXJ5IFN0YWNrXG4gKiBDcmVhdGVzIGEgc2luZ2xlIENsb3VkIE1hcCBuYW1lc3BhY2UgdGhhdCBhbGwgc2VydmljZXMgY2FuIHJlZ2lzdGVyIHdpdGhcbiAqL1xuXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgc2VydmljZWRpc2NvdmVyeSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VydmljZWRpc2NvdmVyeSc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBTZXJ2aWNlRGlzY292ZXJ5U3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52aXJvbm1lbnQ6ICdkZXYnIHwgJ3N0YWdpbmcnIHwgJ3Byb2QnO1xuICB2cGM/OiBlYzIuSVZwYzsgLy8gT3B0aW9uYWwgVlBDIGZvciBwcml2YXRlIEROUyBuYW1lc3BhY2Vcbn1cblxuZXhwb3J0IGNsYXNzIFNlcnZpY2VEaXNjb3ZlcnlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lc3BhY2U6IHNlcnZpY2VkaXNjb3ZlcnkuSU5hbWVzcGFjZTtcbiAgcHVibGljIHJlYWRvbmx5IG5hbWVzcGFjZUlkOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lc3BhY2VOYW1lOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFNlcnZpY2VEaXNjb3ZlcnlTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudmlyb25tZW50LCB2cGMgfSA9IHByb3BzO1xuICAgIGNvbnN0IG5hbWVzcGFjZU5hbWUgPSBgcG9zdG9saW8tJHtlbnZpcm9ubWVudH0ubG9jYWxgO1xuXG4gICAgLy8gQ3JlYXRlIG5hbWVzcGFjZSBiYXNlZCBvbiB3aGV0aGVyIFZQQyBpcyBwcm92aWRlZFxuICAgIGlmICh2cGMpIHtcbiAgICAgIC8vIFByaXZhdGUgRE5TIG5hbWVzcGFjZSBmb3IgVlBDLWJhc2VkIHNlcnZpY2VzIChFQ1MpXG4gICAgICB0aGlzLm5hbWVzcGFjZSA9IG5ldyBzZXJ2aWNlZGlzY292ZXJ5LlByaXZhdGVEbnNOYW1lc3BhY2UodGhpcywgJ05hbWVzcGFjZScsIHtcbiAgICAgICAgbmFtZTogbmFtZXNwYWNlTmFtZSxcbiAgICAgICAgdnBjLFxuICAgICAgICBkZXNjcmlwdGlvbjogYFNoYXJlZCBzZXJ2aWNlIGRpc2NvdmVyeSBuYW1lc3BhY2UgZm9yIFBvc3RvbGlvICR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBIVFRQIG5hbWVzcGFjZSBmb3Igc2VydmVybGVzcyBzZXJ2aWNlcyAoTGFtYmRhKVxuICAgICAgdGhpcy5uYW1lc3BhY2UgPSBuZXcgc2VydmljZWRpc2NvdmVyeS5IdHRwTmFtZXNwYWNlKHRoaXMsICdOYW1lc3BhY2UnLCB7XG4gICAgICAgIG5hbWU6IG5hbWVzcGFjZU5hbWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBgU2hhcmVkIHNlcnZpY2UgZGlzY292ZXJ5IG5hbWVzcGFjZSBmb3IgUG9zdG9saW8gJHtlbnZpcm9ubWVudH1gLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5uYW1lc3BhY2VJZCA9IHRoaXMubmFtZXNwYWNlLm5hbWVzcGFjZUlkO1xuICAgIHRoaXMubmFtZXNwYWNlTmFtZSA9IHRoaXMubmFtZXNwYWNlLm5hbWVzcGFjZU5hbWU7XG5cbiAgICAvLyBFeHBvcnQgbmFtZXNwYWNlIGRldGFpbHMgZm9yIG90aGVyIHN0YWNrcyB0byBpbXBvcnRcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTmFtZXNwYWNlSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5uYW1lc3BhY2VJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWQgTWFwIE5hbWVzcGFjZSBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgU2VydmljZURpc2NvdmVyeS0ke2Vudmlyb25tZW50fS1OYW1lc3BhY2VJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTmFtZXNwYWNlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm5hbWVzcGFjZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkIE1hcCBOYW1lc3BhY2UgTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgU2VydmljZURpc2NvdmVyeS0ke2Vudmlyb25tZW50fS1OYW1lc3BhY2VOYW1lYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdOYW1lc3BhY2VBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5uYW1lc3BhY2UubmFtZXNwYWNlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZCBNYXAgTmFtZXNwYWNlIEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgU2VydmljZURpc2NvdmVyeS0ke2Vudmlyb25tZW50fS1OYW1lc3BhY2VBcm5gLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIHRhZ3NcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ1NlcnZpY2UnLCAnU2VydmljZURpc2NvdmVyeScpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdNYW5hZ2VkQnknLCAnQ0RLJyk7XG4gIH1cbn0iXX0=