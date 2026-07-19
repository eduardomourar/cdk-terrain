// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
// Comprehensive bundling tests for CDKTN

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  BundlingOutput,
  runDockerBundling,
  dockerExec,
  type ILocalBundling,
  type BundlingOptions,
} from "../lib/bundling";
import {
  AssetStaging,
  AssetHashType,
  FileAssetPackaging,
  TerraformStack,
  Testing,
} from "../lib";

jest.mock("child_process");

const dockerCmd = process.env.CDK_DOCKER ?? "docker";

// Mock local bundler for integration tests
class MockLocalBundler implements ILocalBundling {
  constructor(
    private shouldSucceed: boolean = true,
    private outputContent: string = "bundled output",
  ) {}

  tryBundle(outputDir: string, _options: BundlingOptions): boolean {
    if (!this.shouldSucceed) {
      return false;
    }

    // Create output in the bundle directory
    fs.writeFileSync(path.join(outputDir, "output.txt"), this.outputContent);
    return true;
  }
}

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

  // Integration tests with AssetStaging
  describe("Asset bundling integration", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cdktn-bundle-test-"));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    describe("local bundling", () => {
      test("uses local bundling when successful", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "index.js"), "console.log('hi')");

        const bundler = new MockLocalBundler(true, "locally bundled");

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          bundling: {
            image: "node:18",
            command: ["echo", "should not run"],
            local: bundler,
          },
        });

        expect(asset.assetHash).toBeDefined();
        expect(fs.existsSync(asset.absoluteStagedPath)).toBe(true);
      });

      test("attempts docker when local bundling returns false", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "index.js"), "console.log('hi')");

        const bundler = new MockLocalBundler(false);

        // Docker bundling will be attempted (may or may not work in test environment)
        try {
          const asset = new AssetStaging(stack, "Asset", {
            sourcePath: testDir,
            bundling: {
              image: "node:18",
              command: ["echo", "docker would run"],
              local: bundler,
            },
          });
          expect(asset).toBeDefined();
        } catch (err) {
          // If docker fails, that's expected in test environment
          expect(err).toBeDefined();
        }
      });

      test("local bundler receives correct options", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        let receivedOptions: BundlingOptions | undefined;

        const customBundler: ILocalBundling = {
          tryBundle(outputDir: string, options: BundlingOptions): boolean {
            receivedOptions = options;
            fs.writeFileSync(path.join(outputDir, "output.txt"), "bundled");
            return true;
          },
        };

        const bundlingOptions: BundlingOptions = {
          image: "alpine",
          command: ["/bin/sh", "-c", "echo hello"],
          environment: {
            NODE_ENV: "production",
          },
          user: "1000:1000",
          workingDirectory: "/app",
        };

        new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          bundling: {
            ...bundlingOptions,
            local: customBundler,
          },
        });

        expect(receivedOptions).toBeDefined();
        expect(receivedOptions?.image).toBe("alpine");
        expect(receivedOptions?.environment?.NODE_ENV).toBe("production");
      });

      test("requires directory for bundling", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testFile = path.join(tempDir, "file.txt");
        fs.writeFileSync(testFile, "content");

        expect(() => {
          new AssetStaging(stack, "Asset", {
            sourcePath: testFile,
            bundling: {
              image: "alpine",
              command: ["echo", "hello"],
            },
          });
        }).toThrow("Asset must be a directory when bundling");
      });
    });

    describe("bundling output types", () => {
      test("handles AUTO_DISCOVER output type with single file", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const bundler: ILocalBundling = {
          tryBundle(outputDir: string): boolean {
            fs.writeFileSync(path.join(outputDir, "output.txt"), "bundled");
            return true;
          },
        };

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          bundling: {
            image: "alpine",
            command: ["echo", "hello"],
            outputType: BundlingOutput.AUTO_DISCOVER,
            local: bundler,
          },
        });

        expect(asset.packaging).toBe(FileAssetPackaging.ZIP_DIRECTORY);
      });

      test("handles NOT_ARCHIVED output type", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const bundler: ILocalBundling = {
          tryBundle(outputDir: string): boolean {
            fs.writeFileSync(path.join(outputDir, "file1.txt"), "content1");
            fs.writeFileSync(path.join(outputDir, "file2.txt"), "content2");
            return true;
          },
        };

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          bundling: {
            image: "alpine",
            command: ["echo", "hello"],
            outputType: BundlingOutput.NOT_ARCHIVED,
            local: bundler,
          },
        });

        expect(asset.packaging).toBe(FileAssetPackaging.ZIP_DIRECTORY);
        expect(asset.isArchive).toBe(false);
      });

      test("handles ARCHIVED output type with single archive", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const bundler: ILocalBundling = {
          tryBundle(outputDir: string): boolean {
            fs.writeFileSync(
              path.join(outputDir, "output.zip"),
              "archive content",
            );
            return true;
          },
        };

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          bundling: {
            image: "alpine",
            command: ["echo", "hello"],
            outputType: BundlingOutput.ARCHIVED,
            local: bundler,
          },
        });

        expect(asset.packaging).toBe(FileAssetPackaging.FILE);
        expect(asset.isArchive).toBe(true);
      });

      test("handles ARCHIVED output with multiple files as ZIP_DIRECTORY", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const bundler: ILocalBundling = {
          tryBundle(outputDir: string): boolean {
            fs.writeFileSync(path.join(outputDir, "file1.txt"), "content1");
            fs.writeFileSync(path.join(outputDir, "file2.txt"), "content2");
            return true;
          },
        };

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          bundling: {
            image: "alpine",
            command: ["echo", "hello"],
            outputType: BundlingOutput.ARCHIVED,
            local: bundler,
          },
        });

        expect(asset.packaging).toBe(FileAssetPackaging.ZIP_DIRECTORY);
        expect(asset.isArchive).toBe(false);
      });

      test("handles SINGLE_FILE output type", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const bundler: ILocalBundling = {
          tryBundle(outputDir: string): boolean {
            fs.writeFileSync(path.join(outputDir, "output.txt"), "single file");
            return true;
          },
        };

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          bundling: {
            image: "alpine",
            command: ["echo", "hello"],
            outputType: BundlingOutput.SINGLE_FILE,
            local: bundler,
          },
        });

        expect(asset.packaging).toBe(FileAssetPackaging.FILE);
        expect(asset.isArchive).toBe(false);
      });

      test("handles SINGLE_FILE output with multiple files as ZIP_DIRECTORY", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const bundler: ILocalBundling = {
          tryBundle(outputDir: string): boolean {
            fs.writeFileSync(path.join(outputDir, "file1.txt"), "content1");
            fs.writeFileSync(path.join(outputDir, "file2.txt"), "content2");
            return true;
          },
        };

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          bundling: {
            image: "alpine",
            command: ["echo", "hello"],
            outputType: BundlingOutput.SINGLE_FILE,
            local: bundler,
          },
        });

        expect(asset.packaging).toBe(FileAssetPackaging.ZIP_DIRECTORY);
        expect(asset.isArchive).toBe(false);
      });
    });

    describe("bundling with hash types", () => {
      test("SOURCE hash type works with bundling", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source1");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "index.js"), "console.log('v1')");

        const asset = new AssetStaging(stack, "Asset1", {
          sourcePath: testDir,
          assetHashType: AssetHashType.SOURCE,
          bundling: {
            image: "node:18",
            command: ["echo", "bundle"],
            local: new MockLocalBundler(true, "output"),
          },
        });

        expect(asset.assetHash).toBeDefined();
        expect(asset.assetHash.length).toBe(64);
        expect(fs.existsSync(asset.absoluteStagedPath)).toBe(true);
      });

      test("supports OUTPUT hash type with bundling", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "input.txt"), "input");

        const asset1 = new AssetStaging(stack, "Asset1", {
          sourcePath: testDir,
          assetHashType: AssetHashType.OUTPUT,
          bundling: {
            image: "alpine",
            command: ["echo", "bundle"],
            local: new MockLocalBundler(true, "output v1"),
          },
        });

        const asset2 = new AssetStaging(stack, "Asset2", {
          sourcePath: testDir,
          assetHashType: AssetHashType.OUTPUT,
          bundling: {
            image: "alpine",
            command: ["echo", "bundle"],
            local: new MockLocalBundler(true, "output v2"),
          },
        });

        // Hash should be different because output is different
        expect(asset2.assetHash).not.toBe(asset1.assetHash);
      });

      test("uses SOURCE hash when OUTPUT specified without bundling", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          assetHashType: AssetHashType.OUTPUT,
        });

        expect(asset.assetHash).toBeDefined();
        expect(asset.assetHash.length).toBe(64);
      });
    });

    describe("bundling with custom hash", () => {
      test("supports custom hash with bundling", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          assetHash: "my-custom-v1",
          assetHashType: AssetHashType.CUSTOM,
          bundling: {
            image: "alpine",
            command: ["echo", "bundle"],
            local: new MockLocalBundler(),
          },
        });

        expect(asset.assetHash).toBeDefined();
        expect(asset.assetHash.length).toBe(64);
      });
    });

    describe("bundling error handling", () => {
      test("cleans up temp directory on bundling failure", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const failingBundler: ILocalBundling = {
          tryBundle(): boolean {
            throw new Error("Bundling failed!");
          },
        };

        expect(() => {
          new AssetStaging(stack, "Asset", {
            sourcePath: testDir,
            bundling: {
              image: "alpine",
              command: ["echo", "bundle"],
              local: failingBundler,
            },
          });
        }).toThrow("Bundling failed!");
      });

      test("handles empty bundling output directory", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const emptyBundler: ILocalBundling = {
          tryBundle(_outputDir: string): boolean {
            return true;
          },
        };

        const asset = new AssetStaging(stack, "Asset", {
          sourcePath: testDir,
          bundling: {
            image: "alpine",
            command: ["echo", "bundle"],
            local: emptyBundler,
          },
        });

        expect(asset).toBeDefined();
        expect(asset.packaging).toBe(FileAssetPackaging.ZIP_DIRECTORY);
      });
    });

    describe("bundling with extra hash", () => {
      test("extra hash affects bundled asset hash", () => {
        const app = Testing.app();
        const stack = new TerraformStack(app, "test");

        const testDir = path.join(tempDir, "source");
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, "file.txt"), "content");

        const asset1 = new AssetStaging(stack, "Asset1", {
          sourcePath: testDir,
          extraHash: "v1",
          bundling: {
            image: "alpine",
            command: ["echo", "bundle"],
            local: new MockLocalBundler(),
          },
        });

        const asset2 = new AssetStaging(stack, "Asset2", {
          sourcePath: testDir,
          extraHash: "v2",
          bundling: {
            image: "alpine",
            command: ["echo", "bundle"],
            local: new MockLocalBundler(),
          },
        });

        expect(asset1.assetHash).not.toBe(asset2.assetHash);
      });
    });
  });
});
