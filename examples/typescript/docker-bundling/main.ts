// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0

/**
 * Example: Docker Bundling with CDKTN
 *
 * Shows how to use Docker to bundle assets during synthesis.
 */

import { App, TerraformStack, AssetStaging } from "cdktn";
import type { ILocalBundling, BundlingOptions } from "cdktn";
import { BundlingOutput } from "cdktn";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Example: Local bundling implementation
export class LocalNodeBundler implements ILocalBundling {
  tryBundle(outputDir: string, _options: BundlingOptions): boolean {
    try {
      console.log("Trying local bundling...");

      // Try to run npm locally
      execSync("npm --version", { stdio: "ignore" });

      // Run the build locally
      execSync("npm ci && npm run build", {
        cwd: process.cwd(),
        stdio: "inherit",
      });

      // Copy output to the output directory
      const distDir = path.join(process.cwd(), "dist");
      if (fs.existsSync(distDir)) {
        fs.cpSync(distDir, outputDir, { recursive: true });
        console.log("✅ Local bundling succeeded");
        return true;
      }

      return false;
    } catch {
      console.log("❌ Local bundling failed, falling back to Docker");
      return false;
    }
  }
}

class DockerBundlingExampleStack extends TerraformStack {
  constructor(scope: App, id: string) {
    super(scope, id);

    // Example 1: Simple file staging (no Docker required)
    console.log("\n=== Example 1: Simple File Staging ===");

    const nodeAppDir = path.join(__dirname, "sample-node-app");

    // Simple staging without bundling
    const nodeAsset = new AssetStaging(this, "NodeApp", {
      sourcePath: nodeAppDir,
    });

    console.log("Node Asset Hash:", nodeAsset.assetHash);
    console.log("Node Asset Path:", nodeAsset.absoluteStagedPath);
    console.log("Node Asset Packaging:", nodeAsset.packaging);

    const bundledAsset = new AssetStaging(this, "BundledNodeApp", {
      sourcePath: nodeAppDir,
      bundling: {
        image: "node:18-alpine",
        command: [
          "/bin/sh",
          "-c",
          "cp -r /asset-input/* /asset-output/ && cd /asset-output && npm ci && npm run build",
        ],
        environment: {
          NODE_ENV: "production",
        },
      },
    });

    console.log("Bundled Asset Hash:", bundledAsset.assetHash);
    console.log("Bundled Asset Path:", bundledAsset.absoluteStagedPath);

    // Example 2: Python bundling with dependencies
    console.log("\n=== Example 2: Python Docker Bundling ===");

    const pythonAppDir = path.join(__dirname, "sample-python-app");

    const pythonAsset = new AssetStaging(this, "PythonLambda", {
      sourcePath: pythonAppDir,
      bundling: {
        image: "public.ecr.aws/lambda/python:3.11",
        entrypoint: ["/bin/sh", "-c"],
        command: [
          "pip install -r requirements.txt -t /asset-output && cp *.py /asset-output/",
        ],
        outputType: BundlingOutput.NOT_ARCHIVED,
      },
    });

    console.log("Python Asset Hash:", pythonAsset.assetHash);
    console.log("Python Asset Path:", pythonAsset.absoluteStagedPath);

    // Example 3: Local bundling with Docker fallback
    console.log("\n=== Example 3: Local Bundling with Fallback ===");

    const hybridAsset = new AssetStaging(this, "HybridApp", {
      sourcePath: nodeAppDir,
      bundling: {
        image: "node:18-alpine",
        command: [
          "/bin/sh",
          "-c",
          "cp -r /asset-input/* /asset-output/ && cd /asset-output && npm ci && npm run build",
        ],
        local: new LocalNodeBundler(),
      },
    });

    console.log("Hybrid Asset Hash:", hybridAsset.assetHash);
    console.log("Hybrid Asset Path:", hybridAsset.absoluteStagedPath);

    // Example 4: Go binary compilation
    console.log("\n=== Example 4: Go Binary Compilation ===");

    const goAppDir = path.join(__dirname, "sample-go-app");

    const goAsset = new AssetStaging(this, "GoApp", {
      sourcePath: goAppDir,
      bundling: {
        image: "golang:1.21-alpine",
        command: [
          "/bin/sh",
          "-c",
          "CGO_ENABLED=0 GOOS=linux go build -o /asset-output/bootstrap .",
        ],
        platform: "linux/amd64",
        outputType: BundlingOutput.SINGLE_FILE,
      },
    });

    console.log("Go Asset Hash:", goAsset.assetHash);
    console.log("Go Asset Path:", goAsset.absoluteStagedPath);
  }
}

const app = new App();
new DockerBundlingExampleStack(app, "docker-bundling-example");
app.synth();

console.log("\n✅ Synthesis complete!");
