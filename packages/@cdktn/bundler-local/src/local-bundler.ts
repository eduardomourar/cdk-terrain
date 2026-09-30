// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0

import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readdirSync, statSync } from "fs";
import * as path from "path";
import { BundleOptions, BundleResult, BundlerKey, IAssetBundler } from "cdktn";

/**
 * How the bundler interprets what its command wrote to the output directory.
 */
export enum BundlingOutput {
  /**
   * The output directory contains a single archive file that is the artifact.
   */
  ARCHIVED = "archived",

  /**
   * The output directory holds the artifact as a tree of files.
   */
  NOT_ARCHIVED = "not-archived",

  /**
   * The output directory contains a single file that is the artifact.
   */
  SINGLE_FILE = "single-file",

  /**
   * A single file in the output directory is treated as the artifact;
   * otherwise the directory itself is.
   */
  AUTO_DISCOVER = "auto-discover",
}

/**
 * Configuration for {@link LocalBundler}.
 */
export interface LocalBundlerProps {
  /**
   * The command to run on the host, as an argv array.
   *
   * The first element is the program; the rest are its arguments. The command
   * runs with `ASSET_INPUT_DIR` set to the source and `ASSET_OUTPUT_DIR` set
   * to the output directory, and it is expected to write the built artifact
   * into `ASSET_OUTPUT_DIR`.
   */
  readonly command: string[];

  /**
   * Environment variables to set for the command.
   *
   * @default - only the caller's environment plus `ASSET_INPUT_DIR` and
   * `ASSET_OUTPUT_DIR`
   */
  readonly environment?: { [key: string]: string };

  /**
   * The working directory the command runs in.
   *
   * @default - the asset source directory
   */
  readonly workingDirectory?: string;

  /**
   * How the command's output is interpreted.
   *
   * @default BundlingOutput.AUTO_DISCOVER
   */
  readonly outputType?: BundlingOutput;

  /**
   * Extra content folded into the bundler key so a change to it invalidates
   * the asset hash even when the source and command are unchanged.
   *
   * @default - nothing extra is folded in
   */
  readonly extraHash?: string;
}

/**
 * Runs a build command on the host and stages its output as a CDK for
 * Terraform asset.
 *
 * The command is spawned with the asset source and a caller-owned output
 * directory exposed through the `ASSET_INPUT_DIR` and `ASSET_OUTPUT_DIR`
 * environment variables. Unlike a container bundler, the build runs directly
 * on the machine performing the synth, so the required toolchain must already
 * be installed there.
 */
export class LocalBundler implements IAssetBundler {
  public readonly bundlerKey?: string;

  private readonly command: string[];
  private readonly environment?: { [key: string]: string };
  private readonly workingDirectory?: string;
  private readonly outputType: BundlingOutput;

  constructor(props: LocalBundlerProps) {
    this.command = props.command;
    this.environment = props.environment;
    this.workingDirectory = props.workingDirectory;
    this.outputType = props.outputType ?? BundlingOutput.AUTO_DISCOVER;

    // The source tree cannot observe the build, so every input that can move
    // the output has to reach identity through the key: command, environment
    // and the declared output shape. A digest keeps the key short while still
    // changing whenever any of those change.
    let key = BundlerKey.of("local", ...this.command).add(this.outputType);
    if (this.environment) {
      key = key.withEnv(this.environment);
    }
    if (props.extraHash) {
      key = key.add(props.extraHash);
    }
    this.bundlerKey = `local::${createHash("sha256")
      .update(key.toString())
      .digest("hex")
      .slice(0, 16)}`;
  }

  public bundle(options: BundleOptions): BundleResult {
    const { source, outputDir } = options;
    const [program, ...args] = this.command;

    const result = spawnSync(program, args, {
      cwd: this.workingDirectory ?? source,
      encoding: "utf-8",
      env: {
        ...process.env,
        ...this.environment,
        ASSET_INPUT_DIR: source,
        ASSET_OUTPUT_DIR: outputDir,
      },
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const reason =
        result.signal != null
          ? `signal ${result.signal}`
          : `status ${result.status}`;
      throw new Error(
        `Local bundling exited with ${reason} (${program} ${args.join(" ")})\n` +
          `${result.stdout ?? ""}${result.stderr ?? ""}`,
      );
    }
    if (!existsSync(outputDir)) {
      throw new Error(
        `Local bundling did not create the output directory ${outputDir}`,
      );
    }

    const artifact = determineBundledArtifact(outputDir, this.outputType);
    return statSync(artifact).isDirectory()
      ? BundleResult.directory(artifact)
      : BundleResult.file(artifact);
  }
}

/**
 * Resolves the built artifact inside an output directory according to the
 * declared output type.
 */
export function determineBundledArtifact(
  outputDir: string,
  outputType: BundlingOutput = BundlingOutput.AUTO_DISCOVER,
): string {
  const entries = readdirSync(outputDir);
  const singleFile = entries.find((entry) =>
    statSync(path.join(outputDir, entry)).isFile(),
  );

  switch (outputType) {
    case BundlingOutput.NOT_ARCHIVED:
      return outputDir;
    case BundlingOutput.ARCHIVED:
    case BundlingOutput.SINGLE_FILE:
      if (!singleFile) {
        throw new Error(
          `Bundling output directory has no single file: ${outputDir}`,
        );
      }
      return path.join(outputDir, singleFile);
    case BundlingOutput.AUTO_DISCOVER:
      return entries.length === 1 && singleFile
        ? path.join(outputDir, singleFile)
        : outputDir;
    default:
      throw new Error(`Unsupported bundling output type: ${outputType}`);
  }
}
