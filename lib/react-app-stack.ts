import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class ReactAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -------- S3 Bucket Details -------- 
    // Creates private bucket with name pattern react-app-bucket-{account}-{region}
    const bucket = new s3.Bucket(this, 'ReactAppBucket', {
      bucketName: `react-app-bucket-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // -------- Origin Access Identity -------- 
    // Creates CloudFront OAI for secure S3 access
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for React App'
    });
    
    
    // -------- Lambda Function  -------- 
    // AWS Lambda is serverless compute - write code that runs in response to events without managing any servers.
    // in this case it's my POST endpoint that accepts a parmeter (name) and returns: Hello [name].
    bucket.grantRead(originAccessIdentity);

    const lambdaFunction = new lambda.Function(this, 'ApiLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
            const headers = {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            };

            if (event.httpMethod === 'OPTIONS') {
                return {
                    statusCode: 200,
                    headers: headers,
                    body: ''
                };
            }

            let responseBody = {
                message: 'Hello from Lambda!',
                method: event.httpMethod,
                timestamp: new Date().toISOString()
            };

            if (event.httpMethod === 'POST' && event.body) {
                try {
                    const requestBody = JSON.parse(event.body);
                    const name = requestBody.name;
                    
                    if (name) {
                        responseBody.message = \`Hello, \${name}!\`;
                    }
                } catch (error) {
                    responseBody.message = 'Error parsing request body';
                    responseBody.error = error.message;
                }
            }

            return {
                statusCode: 200,
                headers: headers,
                body: JSON.stringify(responseBody)
            };
        };
      `),
      timeout: cdk.Duration.seconds(30)
    });

    // -------- CloudFront Distribution  -------- 
    // Serves static files from S3 
    const api = new apigateway.RestApi(this, 'ReactAppApi', {
      restApiName: 'React App API',
      description: 'API for React application',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization']
      }
    });

    const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);

    const apiResource = api.root.addResource('api');
    apiResource.addMethod('GET', lambdaIntegration);
    apiResource.addMethod('POST', lambdaIntegration);
    
    const itemsResource = apiResource.addResource('items');
    itemsResource.addMethod('GET', lambdaIntegration);
    itemsResource.addMethod('POST', lambdaIntegration);

    const distribution = new cloudfront.Distribution(this, 'ReactAppDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket, {
          originAccessIdentity: originAccessIdentity
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED
      },


      // -------- Stack Outputs  -------- 
      // Exports key values after deployment: CloudFront URL, S3 bucket name, API Gateway URL, Lambda function name
      // After running CDK deploy this is the output you see in the console.
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN
        }
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        }
      ]
    });

    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: distribution.domainName,
      description: 'CloudFront Distribution URL'
    });

    new cdk.CfnOutput(this, 'S3BucketName', {
      value: bucket.bucketName,
      description: 'S3 Bucket Name'
    });

    new cdk.CfnOutput(this, 'APIGatewayURL', {
      value: api.url,
      description: 'API Gateway URL'
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: lambdaFunction.functionName,
      description: 'Lambda Function Name'
    });
  }
}