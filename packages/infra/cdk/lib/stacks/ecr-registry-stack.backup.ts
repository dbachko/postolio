import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export interface EcrRegistryStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
}

export class EcrRegistryStack extends cdk.Stack {
  public readonly repository: ecr.IRepository;

  constructor(scope: Construct, id: string, props: EcrRegistryStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // Primary ECR repository for API container images
    // Import existing repository if it exists, otherwise create new one
    this.repository = ecr.Repository.fromRepositoryName(this, 'PostolioRepository', 'postolio');

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'URI of the ECR repository for API images',
      exportName: `postolio-${environment}-ecr-uri`,
    });
  }
}
