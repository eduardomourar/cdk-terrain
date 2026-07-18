// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0

/**
 * Example demonstrating CDKTN generic asset types
 *
 * This example shows how to use the cloud-agnostic asset interfaces
 * that can be extended for AWS, Azure, GCP, or any other cloud provider.
 */

import { App, TerraformStack, AssetHashType, FileAssetPackaging } from "cdktn";
import type {
  FileAssetSource,
  FileAssetLocation,
  DockerImageAssetSource,
  DockerImageAssetLocation,
} from "cdktn";

class AssetsExampleStack extends TerraformStack {
  constructor(scope: App, id: string) {
    super(scope, id);

    // Example 1: File asset for Lambda-style function
    const lambdaAsset: FileAssetSource = {
      sourceHash: "abc123def456",
      fileName: "lambda-code.zip",
      packaging: FileAssetPackaging.ZIP_DIRECTORY,
      deployTime: true, // Can be cleaned up after deployment
      displayName: "Lambda Function Code",
    };

    console.log("Lambda Asset:", lambdaAsset);

    // Example 2: File asset location in S3
    const s3Location: FileAssetLocation = {
      bucketName: "my-deployment-bucket",
      objectKey: `assets/${lambdaAsset.sourceHash}.zip`,
      httpUrl: `https://s3-us-east-1.amazonaws.com/my-deployment-bucket/assets/${lambdaAsset.sourceHash}.zip`,
      objectUrl: `s3://my-deployment-bucket/assets/${lambdaAsset.sourceHash}.zip`,
    };

    console.log("S3 Location:", s3Location);

    // Example 3: Docker image asset
    const dockerAsset: DockerImageAssetSource = {
      sourceHash: "ghi789jkl012",
      directoryName: "./docker",
      dockerFile: "Dockerfile",
      dockerBuildArgs: {
        NODE_ENV: "production",
        VERSION: "1.0.0",
      },
      dockerBuildTarget: "production",
      platform: "linux/amd64",
      dockerCacheFrom: [
        {
          type: "registry",
          params: { ref: "myregistry.azurecr.io/cache:latest" },
        },
      ],
      displayName: "Web Application",
    };

    console.log("Docker Asset:", dockerAsset);

    // Example 4: Multi-cloud container registry locations

    // AWS ECR
    const ecrLocation: DockerImageAssetLocation = {
      imageUri: `123456789012.dkr.ecr.us-east-1.amazonaws.com/web-app:${dockerAsset.sourceHash}`,
      repositoryName: "web-app",
      imageTag: dockerAsset.sourceHash,
    };

    // Azure ACR
    const acrLocation: DockerImageAssetLocation = {
      imageUri: `myregistry.azurecr.io/web-app:${dockerAsset.sourceHash}`,
      repositoryName: "web-app",
      imageTag: dockerAsset.sourceHash,
    };

    // GCP Artifact Registry
    const garLocation: DockerImageAssetLocation = {
      imageUri: `us-docker.pkg.dev/my-project/web-app/image:${dockerAsset.sourceHash}`,
      repositoryName: "web-app",
      imageTag: dockerAsset.sourceHash,
    };

    console.log("ECR Location:", ecrLocation);
    console.log("ACR Location:", acrLocation);
    console.log("GAR Location:", garLocation);

    // Example 5: Asset with custom hash
    const customHashAsset: FileAssetSource = {
      sourceHash: "custom-v1-abc",
      fileName: "static-assets.zip",
      packaging: FileAssetPackaging.ZIP_DIRECTORY,
      displayName: "Static Assets",
    };

    console.log("Custom Hash Asset:", customHashAsset);

    // Note: In a real implementation, you would:
    // 1. Calculate the sourceHash based on file contents
    // 2. Stage the assets to the output directory
    // 3. Use cloud-specific constructs to upload to storage
    // 4. Reference the asset locations in your resources
  }
}

const app = new App();
new AssetsExampleStack(app, "assets-example");
app.synth();
