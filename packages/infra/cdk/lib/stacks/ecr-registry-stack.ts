import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

export interface EcrRegistryStackProps extends cdk.StackProps {
  environment: "dev" | "staging" | "prod";
}

export class EcrRegistryStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrRegistryStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // Primary ECR repository for API container images
    this.repository = new ecr.Repository(this, "PostolioRepository", {
      repositoryName: "postolio",
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE, // allow moving the `*-latest` tags
      lifecycleRules: [
        // Keep a reasonable number of images overall (tagged or untagged)
        { maxImageCount: 100, tagStatus: ecr.TagStatus.ANY },
        // Cleanup untagged images quickly to save space
        {
          tagStatus: ecr.TagStatus.UNTAGGED,
          maxImageAge: cdk.Duration.days(7),
        },
      ],
    });

    new cdk.CfnOutput(this, "EcrRepositoryUri", {
      value: this.repository.repositoryUri,
      description: "URI of the ECR repository for API images",
      exportName: `postolio-${environment}-ecr-uri`,
    });
  }
}
