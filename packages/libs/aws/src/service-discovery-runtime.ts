import {
  ServiceDiscoveryClient,
  DiscoverInstancesCommand,
} from "@aws-sdk/client-servicediscovery";

const client = new ServiceDiscoveryClient({});

export async function discoverService(serviceName: string): Promise<string> {
  const command = new DiscoverInstancesCommand({
    NamespaceName: process.env.SERVICE_DISCOVERY_NAMESPACE || "postolio.local",
    ServiceName: serviceName,
    HealthStatus: "HEALTHY",
  });

  const response = await client.send(command);
  const instance = response.Instances?.[0];

  if (!instance) {
    throw new Error(`Service not found: ${serviceName}`);
  }

  const url = instance.Attributes?.["AWS_INSTANCE_IPV4"] || "localhost";
  const port = instance.Attributes?.["AWS_INSTANCE_PORT"] || "3000";

  return `http://${url}:${port}`;
}
