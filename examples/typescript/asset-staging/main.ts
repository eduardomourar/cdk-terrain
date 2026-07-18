// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0

/**
 * Example demonstrating CDKTN AssetStaging with Docker bundling
 *
 * This example shows how to use the AssetStaging class to:
 * - Stage file assets with content hashing
 * - Exclude files from assets
 * - Use Docker-based bundling (opt-in)
 */

import * as path from "path";
import * as fs from "fs";
import { App, TerraformStack, AssetStaging, AssetHashType } from "cdktn";

class AssetStagingExampleStack extends TerraformStack {
  constructor(scope: App, id: string) {
    super(scope, id);

    // Example 1: Simple file asset
    // This will copy the file to cdktf.out/assets/<hash>.txt
    const simpleFile = path.join(__dirname, "sample-file.txt");
    if (!fs.existsSync(simpleFile)) {
      fs.writeFileSync(simpleFile, "Hello from CDKTN Asset Staging!");
    }

    const fileAsset = new AssetStaging(this, "SimpleFile", {
      sourcePath: simpleFile,
      assetHashType: AssetHashType.SOURCE,
    });

    console.log("Simple File Asset:");
    console.log("  Hash:", fileAsset.assetHash);
    console.log("  Staged Path:", fileAsset.absoluteStagedPath);
    console.log("  Is Archive:", fileAsset.isArchive);

    // Example 2: Directory asset with exclusions
    const sampleDir = path.join(__dirname, "sample-dir");
    if (!fs.existsSync(sampleDir)) {
      fs.mkdirSync(sampleDir, { recursive: true });
      fs.writeFileSync(path.join(sampleDir, "index.js"), "console.log('hi')");
      fs.writeFileSync(path.join(sampleDir, "README.md"), "# Docs");
      fs.mkdirSync(path.join(sampleDir, "node_modules"), { recursive: true });
      fs.writeFileSync(
        path.join(sampleDir, "node_modules", "dep.js"),
        "// dep",
      );
    }

    const directoryAsset = new AssetStaging(this, "DirectoryAsset", {
      sourcePath: sampleDir,
      exclude: ["*.md", "node_modules"],
      assetHashType: AssetHashType.SOURCE,
    });

    console.log("\nDirectory Asset (with exclusions):");
    console.log("  Hash:", directoryAsset.assetHash);
    console.log("  Staged Path:", directoryAsset.absoluteStagedPath);
    console.log("  Excluded: *.md, node_modules");

    // Example 3: Asset with extra hash for cache busting
    const cacheableAsset = new AssetStaging(this, "CacheableAsset", {
      sourcePath: simpleFile,
      extraHash: "v2", // Change this to invalidate cache
    });

    console.log("\nCacheable Asset (with extra hash):");
    console.log("  Hash:", cacheableAsset.assetHash);
    console.log("  Extra Hash: v2");

    // Example 4: Custom hash
    const customHashAsset = new AssetStaging(this, "CustomHashAsset", {
      sourcePath: simpleFile,
      assetHash: "my-custom-version-v1.0.0",
      assetHashType: AssetHashType.CUSTOM,
    });

    console.log("\nCustom Hash Asset:");
    console.log("  Hash:", customHashAsset.assetHash);
    console.log("  Custom identifier: my-custom-version-v1.0.0");

    // Example 5: Docker bundling (opt-in feature)
    const bundledDir = path.join(__dirname, "bundle-source");
    if (!fs.existsSync(bundledDir)) {
      fs.mkdirSync(bundledDir, { recursive: true });
      fs.writeFileSync(
        path.join(bundledDir, "package.json"),
        JSON.stringify({ name: "my-app", version: "1.0.0" }),
      );
      fs.writeFileSync(
        path.join(bundledDir, "index.js"),
        "console.log('bundled!');",
      );
    }

    const bundledAsset = new AssetStaging(this, "BundledAsset", {
      sourcePath: bundledDir,
      bundling: {
        image: "node:18-alpine",
        command: [
          "/bin/sh",
          "-c",
          "cp -r /asset-input/* /asset-output/ && echo 'Bundled!'",
        ],
        workingDirectory: "/asset-input",
        environment: {
          NODE_ENV: "production",
        },
      },
    });

    console.log("\nBundled Asset (Docker):");
    console.log("  Hash:", bundledAsset.assetHash);
    console.log("  Image: node:18-alpine");

    // Note: In a real implementation, you would:
    // 1. Use these staged assets with cloud provider resources
    // 2. Upload to S3/Azure Blob/GCS
    // 3. Reference in Lambda/Azure Functions/Cloud Functions
  }
}

const app = new App();
new AssetStagingExampleStack(app, "asset-staging-example");
app.synth();

console.log("\n✅ Asset staging complete!");
console.log(
  "Check cdktf.out/assets/ directory to see staged assets with their hash-based filenames.",
);
