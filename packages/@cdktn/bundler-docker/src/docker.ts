// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0

import { spawnSync } from "child_process";

/**
 * The docker binary to invoke.
 *
 * Honours the `CDK_DOCKER` environment variable so an alternative runtime
 * (e.g. `podman`) can be swapped in, matching the convention used by the AWS
 * CDK and TerraConstructs.
 */
function dockerBinary(): string {
  return process.env.CDK_DOCKER ?? "docker";
}

/**
 * Result of a docker invocation.
 */
export interface DockerExecResult {
  /**
   * The process exit status.
   */
  readonly status: number;

  /**
   * The captured standard output.
   */
  readonly stdout: string;
}

/**
 * A single docker container filesystem mount.
 */
export interface DockerVolume {
  /**
   * Absolute path on the host.
   */
  readonly hostPath: string;

  /**
   * Absolute path inside the container.
   */
  readonly containerPath: string;
}

/**
 * Options for {@link DockerImage.run}.
 */
export interface DockerRunOptions {
  /**
   * The command to run in the container, as an argv array.
   *
   * @default - the image's default command
   */
  readonly command?: string[];

  /**
   * The user to run the container as (`-u`).
   *
   * @default - the image's default user
   */
  readonly user?: string;

  /**
   * Environment variables to set in the container.
   *
   * @default - no extra environment
   */
  readonly environment?: { [key: string]: string };

  /**
   * Override the image entrypoint.
   *
   * @default - the image's default entrypoint
   */
  readonly entrypoint?: string[];

  /**
   * The working directory inside the container (`-w`).
   *
   * @default - the image's default working directory
   */
  readonly workingDirectory?: string;

  /**
   * Bind mounts to attach to the container.
   *
   * @default - no bind mounts
   */
  readonly volumes?: DockerVolume[];

  /**
   * Containers whose volumes are mounted with `--volumes-from`.
   *
   * @default - none
   */
  readonly volumesFrom?: string[];

  /**
   * The container network to attach to (`--network`).
   *
   * @default - the default docker network
   */
  readonly network?: string;

  /**
   * The platform to run the container as (`--platform`).
   *
   * @default - the host platform
   */
  readonly platform?: string;

  /**
   * A `--security-opt` value passed to the container.
   *
   * @default - none
   */
  readonly securityOpt?: string;
}

/**
 * Runs docker commands and captures their output.
 *
 * Throws on a non-zero exit so a failed build surfaces as an error rather than
 * a silently empty artifact.
 */
export function dockerExec(args: string[]): DockerExecResult {
  const binary = dockerBinary();
  const proc = spawnSync(binary, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (proc.error) {
    throw proc.error;
  }
  if (proc.status !== 0) {
    const reason =
      proc.signal != null ? `signal ${proc.signal}` : `status ${proc.status}`;
    throw new Error(
      `${binary} exited with ${reason}\n` +
        `--> Command: ${binary} ${args.join(" ")}`,
    );
  }
  return { status: proc.status ?? 0, stdout: String(proc.stdout ?? "") };
}

/**
 * Run a docker image once with the given options and wait for it to exit.
 *
 * The `DockerImage` class in `./bundling` is the public entry point; this is
 * the shared arg-building/exec step beneath both `fromRegistry` and
 * `fromBuild` images.
 */
export function runDockerImage(
  image: string,
  options: DockerRunOptions = {},
): void {
  const args = ["run", "--rm"];
  if (options.securityOpt) {
    args.push("--security-opt", options.securityOpt);
  }
  if (options.user) {
    args.push("-u", options.user);
  }
  for (const [key, value] of Object.entries(options.environment ?? {})) {
    args.push("-e", `${key}=${value}`);
  }
  if (options.workingDirectory) {
    args.push("-w", options.workingDirectory);
  }
  if (options.entrypoint) {
    args.push("--entrypoint", options.entrypoint.join(" "));
  }
  for (const volume of options.volumes ?? []) {
    args.push("-v", `${volume.hostPath}:${volume.containerPath}`);
  }
  for (const from of options.volumesFrom ?? []) {
    args.push("--volumes-from", from);
  }
  if (options.network) {
    args.push("--network", options.network);
  }
  if (options.platform) {
    args.push("--platform", options.platform);
  }
  args.push(image, ...(options.command ?? []));
  dockerExec(args);
}
