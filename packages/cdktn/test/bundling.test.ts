// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
// Simplified bundling tests for CDKTN

import { spawnSync } from "child_process";
import { BundlingOutput, runDockerBundling, dockerExec } from "../lib/bundling";

jest.mock("child_process");

const dockerCmd = process.env.CDK_DOCKER ?? "docker";

describe("bundling", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("dockerExec", () => {
    test("runs docker command successfully", () => {
      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stdout: Buffer.from("success"),
        stderr: Buffer.from(""),
      });

      const result = dockerExec(["version"]);

      expect(spawnSync).toHaveBeenCalledWith("docker", ["version"], {
        stdio: ["ignore", "inherit", "pipe"],
        encoding: "buffer",
      });
      expect(result.stdout.toString()).toBe("success");
    });

    test("throws when docker command fails", () => {
      (spawnSync as jest.Mock).mockReturnValue({
        status: 1,
        stderr: Buffer.from("docker error"),
      });

      expect(() => dockerExec(["invalid"])).toThrow(
        /Docker command failed with exit code 1/,
      );
    });

    test("throws when docker command has spawn error", () => {
      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        error: new Error("spawn error"),
      });

      expect(() => dockerExec(["run"])).toThrow(/Failed to run docker command/);
    });

    test("runs with quiet option", () => {
      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      });

      dockerExec(["version"], { quiet: true });

      expect(spawnSync).toHaveBeenCalledWith("docker", ["version"], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "buffer",
      });
    });
  });

  describe("runDockerBundling", () => {
    beforeEach(() => {
      (spawnSync as jest.Mock).mockReturnValue({
        status: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      });
    });

    test("mounts input and output directories", () => {
      runDockerBundling("/input", "/output", {
        image: "alpine",
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining([
          "run",
          "--rm",
          "-v",
          "/input:/asset-input:ro",
          "-v",
          "/output:/asset-output:rw",
          "-w",
          "/asset-input",
          "alpine",
        ]),
        expect.any(Object),
      );
    });

    test("passes through command", () => {
      runDockerBundling("/input", "/output", {
        image: "node:18",
        command: ["npm", "install"],
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining(["node:18", "npm", "install"]),
        expect.any(Object),
      );
    });

    test("sets working directory", () => {
      runDockerBundling("/input", "/output", {
        image: "alpine",
        workingDirectory: "/custom-dir",
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining(["-w", "/custom-dir"]),
        expect.any(Object),
      );
    });

    test("passes environment variables", () => {
      runDockerBundling("/input", "/output", {
        image: "alpine",
        environment: {
          NODE_ENV: "production",
          API_KEY: "secret",
        },
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining([
          "-e",
          "NODE_ENV=production",
          "-e",
          "API_KEY=secret",
        ]),
        expect.any(Object),
      );
    });

    test("sets user", () => {
      runDockerBundling("/input", "/output", {
        image: "alpine",
        user: "1000:1000",
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining(["--user", "1000:1000"]),
        expect.any(Object),
      );
    });

    test("sets network", () => {
      runDockerBundling("/input", "/output", {
        image: "alpine",
        network: "host",
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining(["--network", "host"]),
        expect.any(Object),
      );
    });

    test("sets platform", () => {
      runDockerBundling("/input", "/output", {
        image: "alpine",
        platform: "linux/amd64",
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining(["--platform", "linux/amd64"]),
        expect.any(Object),
      );
    });

    test("sets security opt", () => {
      runDockerBundling("/input", "/output", {
        image: "alpine",
        securityOpt: "no-new-privileges",
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining(["--security-opt", "no-new-privileges"]),
        expect.any(Object),
      );
    });

    test("handles entrypoint correctly", () => {
      runDockerBundling("/input", "/output", {
        image: "alpine",
        entrypoint: ["/bin/sh", "-c"],
        command: ["echo", "hello"],
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining([
          "--entrypoint",
          "/bin/sh",
          "alpine",
          "-c",
          "echo",
          "hello",
        ]),
        expect.any(Object),
      );
    });

    test("entrypoint with single element", () => {
      runDockerBundling("/input", "/output", {
        image: "alpine",
        entrypoint: ["/bin/sh"],
      });

      expect(spawnSync).toHaveBeenCalledWith(
        dockerCmd,
        expect.arrayContaining(["--entrypoint", "/bin/sh", "alpine"]),
        expect.any(Object),
      );
    });
  });

  describe("BundlingOutput", () => {
    test("has expected enum values", () => {
      expect(BundlingOutput.ARCHIVED).toBe("archived");
      expect(BundlingOutput.NOT_ARCHIVED).toBe("not-archived");
      expect(BundlingOutput.AUTO_DISCOVER).toBe("auto-discover");
      expect(BundlingOutput.SINGLE_FILE).toBe("single-file");
    });
  });
});
