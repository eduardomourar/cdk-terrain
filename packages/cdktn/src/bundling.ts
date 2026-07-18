// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
// Simplified Docker bundling - following AWS CDK patterns

import { spawnSync } from "child_process";

/**
 * Bundling options for Docker-based builds
 */
export interface BundlingOptions {
  /**
   * The Docker image where the command will run.
   *
   * @example 'node:18-alpine'
   * @example 'public.ecr.aws/lambda/python:3.11'
   */
  readonly image: string;

  /**
   * The command to run in the Docker container.
   *
   * @example ['npm', 'run', 'build']
   * @default - run the command defined in the image
   */
  readonly command?: string[];

  /**
   * The entrypoint to run in the Docker container.
   *
   * @example ['/bin/sh', '-c']
   * @default - run the entrypoint defined in the image
   */
  readonly entrypoint?: string[];

  /**
   * Environment variables to pass to the Docker container.
   *
   * @default - no environment variables
   */
  readonly environment?: { [key: string]: string };

  /**
   * Working directory inside the Docker container.
   *
   * @default /asset-input
   */
  readonly workingDirectory?: string;

  /**
   * The user to use when running the Docker container.
   *
   * @example '1000:1000'
   * @default - root
   */
  readonly user?: string;

  /**
   * Networking mode for the Docker container.
   *
   * @default - bridge
   */
  readonly network?: string;

  /**
   * Platform to build for (requires Docker Buildx).
   *
   * @example 'linux/amd64'
   * @default - no platform specified
   */
  readonly platform?: string;

  /**
   * Security options for the container.
   *
   * @example 'no-new-privileges'
   * @default - none
   */
  readonly securityOpt?: string;

  /**
   * The type of output that this bundling operation is producing.
   *
   * @default BundlingOutput.AUTO_DISCOVER
   */
  readonly outputType?: BundlingOutput;

  /**
   * Local bundling provider.
   *
   * If provided, this will be tried first before Docker bundling.
   * If it returns true, Docker bundling will be skipped.
   *
   * @default - no local bundling
   */
  readonly local?: ILocalBundling;
}

/**
 * The type of output that a bundling operation is producing.
 */
export enum BundlingOutput {
  /**
   * The bundling output directory includes a single archive file (zip or jar).
   * If the output directory does not include exactly a single archive, bundling will fail.
   */
  ARCHIVED = "archived",

  /**
   * The bundling output directory contains one or more files which will be
   * archived and uploaded as a .zip file.
   */
  NOT_ARCHIVED = "not-archived",

  /**
   * If the bundling output directory contains a single archive file (zip or jar)
   * it will be used as-is. Otherwise, all files will be zipped.
   */
  AUTO_DISCOVER = "auto-discover",

  /**
   * The bundling output directory includes a single file.
   * Similar to ARCHIVED but for non-archive files.
   */
  SINGLE_FILE = "single-file",
}

/**
 * Local bundling interface
 */
export interface ILocalBundling {
  /**
   * Try to bundle locally.
   *
   * @param outputDir the directory where the bundled asset should be output
   * @param options bundling options for this asset
   * @returns true if local bundling was performed, false otherwise
   */
  tryBundle(outputDir: string, options: BundlingOptions): boolean;
}

/**
 * Runs Docker commands
 */
export function dockerExec(
  args: string[],
  options?: { quiet?: boolean },
): { stdout: Buffer; stderr: Buffer } {
  const result = spawnSync("docker", args, {
    stdio: options?.quiet
      ? ["ignore", "pipe", "pipe"]
      : ["ignore", "inherit", "pipe"],
    encoding: "buffer",
  });

  if (result.error) {
    throw new Error(`Failed to run docker command: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr.toString();
    throw new Error(
      `Docker command failed with exit code ${result.status}: ${stderr}`,
    );
  }

  return {
    stdout: result.stdout || Buffer.from(""),
    stderr: result.stderr || Buffer.from(""),
  };
}

/**
 * Run Docker bundling
 */
export function runDockerBundling(
  inputDir: string,
  outputDir: string,
  options: BundlingOptions,
): void {
  const dockerArgs: string[] = ["run", "--rm"];

  // Mount input directory (read-only)
  dockerArgs.push("-v", `${inputDir}:/asset-input:ro`);

  // Mount output directory (read-write)
  dockerArgs.push("-v", `${outputDir}:/asset-output:rw`);

  // Working directory
  const workdir = options.workingDirectory || "/asset-input";
  dockerArgs.push("-w", workdir);

  // Environment variables
  if (options.environment) {
    for (const [key, value] of Object.entries(options.environment)) {
      dockerArgs.push("-e", `${key}=${value}`);
    }
  }

  // User
  if (options.user) {
    dockerArgs.push("--user", options.user);
  }

  // Network
  if (options.network) {
    dockerArgs.push("--network", options.network);
  }

  // Platform
  if (options.platform) {
    dockerArgs.push("--platform", options.platform);
  }

  // Security options
  if (options.securityOpt) {
    dockerArgs.push("--security-opt", options.securityOpt);
  }

  // Entrypoint (must come before image)
  if (options.entrypoint && options.entrypoint.length > 0) {
    dockerArgs.push("--entrypoint", options.entrypoint[0]);
  }

  // Image
  dockerArgs.push(options.image);

  // Entrypoint args (after image) + Command
  if (options.entrypoint && options.entrypoint.length > 1) {
    dockerArgs.push(...options.entrypoint.slice(1));
  }

  // Command
  if (options.command) {
    dockerArgs.push(...options.command);
  }

  dockerExec(dockerArgs);
}
