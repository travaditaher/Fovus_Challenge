import * as cdk from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, CorsRule, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Function, Runtime, Code, StartingPosition} from 'aws-cdk-lib/aws-lambda';
import {DynamoEventSource} from 'aws-cdk-lib/aws-lambda-event-sources';
import { Effect, Role, ServicePrincipal, PolicyStatement, ManagedPolicy, CfnInstanceProfile, ArnPrincipal } from 'aws-cdk-lib/aws-iam';
import { RestApi, LambdaIntegration, Cors } from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import {Table, AttributeType, StreamViewType} from 'aws-cdk-lib/aws-dynamodb';
import {SecurityGroup, Vpc, Peer, Port, CfnKeyPair, SubnetType} from 'aws-cdk-lib/aws-ec2';
import { CfnOutput } from 'aws-cdk-lib';

//fix 2nd bucket policy to allow all 

export class FovusChallengeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const StoreuserFilesS3Bucket = new Bucket(this, 'StoreuserFilesS3Bucket', {
      bucketName: 'store-react-challenge-files',
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const WebUIHostingS3Bucket = new Bucket(this, 'WebUIHostingS3Bucket', {
      bucketName: 'react-challenge-website',
      websiteIndexDocument: 'index.html',
      versioned: true,
      publicReadAccess: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    //fix if not working
    const WebUIHostingbucketPolicyStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new ArnPrincipal('*')],
      actions: ['s3:GetObject'],
      resources: [
        WebUIHostingS3Bucket.arnForObjects('*')
      ]
    });

    WebUIHostingS3Bucket.addToResourcePolicy(WebUIHostingbucketPolicyStatement);

    new BucketDeployment(this, 'DeployWebsiteContent', {
      sources: [
        Source.asset('front-end/react-challenge/dist'),
        Source.asset('./scripts')
      ],
      destinationBucket: WebUIHostingS3Bucket,
    });

    const websiteUrl = WebUIHostingS3Bucket.bucketWebsiteUrl;

    const LambdaFunctionPresignedURL = new Function(this, 'LambdaFunctionPresignedURL', {
      runtime: Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: Code.fromAsset('lambda_PresignedURL'),
      timeout: cdk.Duration.seconds(60),
      environment: {
        BUCKET_NAME: StoreuserFilesS3Bucket.bucketName,
      },
    });

    LambdaFunctionPresignedURL.addToRolePolicy(new PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [
        StoreuserFilesS3Bucket.arnForObjects('*')
      ],
    }));

    const PresignedURLAPI = new RestApi(this, 'PresignedURLAPI', {
      restApiName: 'PresignedURL-API',
      description: 'API for my Lambda function to generate pre-signed-URL',
    });

    const lambdaIntegration = new LambdaIntegration(LambdaFunctionPresignedURL);

    const generatePresignedUrlResource = PresignedURLAPI.root.addResource('generate-presigned-url');
    generatePresignedUrlResource.addMethod('POST', lambdaIntegration);

    generatePresignedUrlResource.addCorsPreflight({
      allowOrigins: [websiteUrl],
      allowMethods: ['OPTIONS', 'POST'],
      allowHeaders: ['*'],
    });

    const DynamoEnteriesTable = new Table(this, 'DynamoEnteriesTable', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      tableName: 'InputEntries',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const Dynamo_lambdaRole = new Role(this, 'StoreDataLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });

    Dynamo_lambdaRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'dynamodb:PutItem',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',

      ],
      resources: [
        DynamoEnteriesTable.tableArn,
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`,
      ],
    }));

    const StoreDataDynamoLambda = new Function(this, 'StoreDataDynamoLambda', {
      runtime: Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: Code.fromAsset('Dynamo_lambda'),
      timeout: cdk.Duration.seconds(60),
      role: Dynamo_lambdaRole,
      environment: {
        TABLE_NAME: DynamoEnteriesTable.tableName
      },

    });

    const StoreDataAPI = new RestApi(this, 'StoreDataAPI', {
      restApiName: 'Store_Data_API',
      description: 'API for storing data in DynamoDB'
    });

    const storedDataIntegration = new LambdaIntegration(StoreDataDynamoLambda);

    const storeDataResource = StoreDataAPI.root.addResource('data-storage');
    storeDataResource.addMethod('POST', storedDataIntegration);

    storeDataResource.addCorsPreflight({
      allowOrigins: [websiteUrl],
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['*'],
    });

    const vpc = new Vpc(this, 'VPC', {
      maxAzs: 2,
      natGateways: 1,
    });

    const securityGroup = new SecurityGroup(this, 'InstanceSecurityGroup', {
      vpc,
      description: 'Allow SSH access to EC2 instances',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'Allow SSH access');

    const ec2Role = new Role(this, 'EC2InstanceRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
    });
    
    const combinedPolicyStatement = new PolicyStatement({
      actions: [
        's3:GetObject',
        's3:PutObject',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
      ],
      resources: [
        StoreuserFilesS3Bucket.arnForObjects('*'),
        DynamoEnteriesTable.tableArn,
      ],
    });

    ec2Role.addToPolicy(new PolicyStatement({
      actions: [
        'ssm:StartSession',
        'ssm:SendCommand',
        'sts:GetInstanceProfile',
        'ec2:TerminateInstances',
      ],
      resources: ['*'],
    }));
    
    ec2Role.addToPolicy(combinedPolicyStatement);
    
    ec2Role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    
    const ec2InstanceProfile = new CfnInstanceProfile(this, 'EC2InstanceProfile', {
      roles: [ec2Role.roleName],
    });    

    const ec2KeyPair = new CfnKeyPair(this, 'ec2KeyPair', {
      keyName: 'ec2-key-pair-challenge',
    });

    StoreuserFilesS3Bucket.addToResourcePolicy(new PolicyStatement({
      sid: 'AllowEC2RoleAccess',
      effect: Effect.ALLOW,
      principals: [new ArnPrincipal(ec2Role.roleArn)],
      actions: [
        's3:GetObject',
        's3:PutObject'
      ],
      resources: [
        StoreuserFilesS3Bucket.arnForObjects('*')
      ]
    })
    );

    const corsRule: CorsRule = {
      allowedHeaders: ['*'],
      allowedMethods: [
        HttpMethods.GET,
        HttpMethods.PUT,
        HttpMethods.POST,
        HttpMethods.DELETE,
        HttpMethods.HEAD
      ],
      allowedOrigins: [
        websiteUrl
      ],
      exposedHeaders: []
    };

    StoreuserFilesS3Bucket.addCorsRule(corsRule);

    const privateSubnet = vpc.privateSubnets[0];

    const DynamoDBStreamEC2SpinnerLambda = new Function(this, 'DynamoDBStreamEC2SpinnerLambda', {
      runtime: Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: Code.fromAsset('lambda_script_runner'),
      timeout: cdk.Duration.seconds(60),
      vpc,
      securityGroups: [securityGroup],
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      environment: {
        KEY_NAME: ec2KeyPair.keyName,
        SECURITY_GROUP_ID: securityGroup.securityGroupId,
        INSTANCE_PROFILE_NAME: ec2InstanceProfile.ref,
        SUBNET_ID: privateSubnet.subnetId,
        SCRIPT_BUCKET_NAME: WebUIHostingS3Bucket.bucketName,
        TABLE_NAME: DynamoEnteriesTable.tableName
      },

    });

    const eventSource = new DynamoEventSource(DynamoEnteriesTable, {
      startingPosition: StartingPosition.LATEST,
    });
    DynamoDBStreamEC2SpinnerLambda.addEventSource(eventSource);

    DynamoEnteriesTable.grantStreamRead(DynamoDBStreamEC2SpinnerLambda);

    DynamoDBStreamEC2SpinnerLambda.addToRolePolicy(new PolicyStatement({
      actions: [
        'ec2:RunInstances',
        'ec2:DescribeImages', 
        'ec2:DescribeInstances',
        'iam:PassRole',
      ],
      resources: ['*'],
    })
    );

  }

}
