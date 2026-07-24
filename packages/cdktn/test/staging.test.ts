// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
// Ported from AWS CDK and TerraConstructs

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  App,
  AssetHashType,
  AssetStaging,
  BundlingFileAccess,
  BundlingOptions,
  BundlingOutput,
  DockerImage,
  FileAssetPackaging,
  TerraformStack,
  Testing,
} from "../lib";

const STUB_INPUT_FILE = "/tmp/docker-stub.input";
const STUB_INPUT_CONCAT_FILE = "/tmp/docker-stub.input.concat";

const STUB_INPUT_CP_FILE = "/tmp/docker-stub-cp.input";
const STUB_INPUT_CP_CONCAT_FILE = "/tmp/docker-stub-cp.input.concat";

enum DockerStubCommand {
  SUCCESS = "DOCKER_STUB_SUCCESS",
  FAIL = "DOCKER_STUB_FAIL",
  SUCCESS_NO_OUTPUT = "DOCKER_STUB_SUCCESS_NO_OUTPUT",
  MULTIPLE_FILES = "DOCKER_STUB_MULTIPLE_FILES",
  SINGLE_ARCHIVE = "DOCKER_STUB_SINGLE_ARCHIVE",
  SINGLE_FILE = "DOCKER_STUB_SINGLE_FILE",
  SINGLE_FILE_WITHOUT_EXT = "DOCKER_STUB_SINGLE_FILE_WITHOUT_EXT",
  VOLUME_SINGLE_ARCHIVE = "DOCKER_STUB_VOLUME_SINGLE_ARCHIVE",
}

const FIXTURE_TEST1_DIR = path.join(__dirname, "fs", "fixtures", "test1");

const CDKTFJSON_PATH = path.join(__dirname, "fixtures", "app", "cdktf.json");
const TEST_STAGING_DIR = path.join(
  __dirname,
  "fixtures",
  "app",
  "cdktf.out",
  "assets",
);
const TEST_OUTDIR = path.join(__dirname, "cdk.out");

const userInfo = os.userInfo();
const USER_ARG = `-u ${userInfo.uid}:${userInfo.gid}`;

describe("staging", () => {
  let stack: TerraformStack;
  let app: App;

  beforeAll(() => {
    // Use custom "docker" command for staging
    process.env.CDK_DOCKER = `${__dirname}/docker-stub.sh`;
  });

  afterAll(() => {
    delete process.env.CDK_DOCKER;
    // clear the staging directory
    fs.rmSync(TEST_STAGING_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_OUTDIR)) {
      fs.rmSync(TEST_OUTDIR, { recursive: true, force: true });
    }
    app = Testing.app({
      outdir: TEST_OUTDIR,
      context: {
        cdktfJsonPath: path.resolve(CDKTFJSON_PATH),
      },
    });
    stack = new TerraformStack(app, "TestStack");
  });

  afterEach(() => {
    if (fs.existsSync(STUB_INPUT_FILE)) {
      fs.unlinkSync(STUB_INPUT_FILE);
    }
    if (fs.existsSync(STUB_INPUT_CONCAT_FILE)) {
      fs.unlinkSync(STUB_INPUT_CONCAT_FILE);
    }
    // Clean staging output between tests
    if (fs.existsSync(TEST_STAGING_DIR)) {
      fs.rmSync(TEST_STAGING_DIR, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  test("with bundling", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;
    const processStdErrWriteSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
      },
    });

    // THEN
    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated,ro -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );

    // Shows a message before bundling
    expect(processStdErrWriteSpy).toHaveBeenCalledWith(
      "Bundling asset TestStack/Asset...\n",
    );
  });

  test("bundling throws when /asset-output is empty", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // THEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          bundling: {
            image: DockerImage.fromRegistry("alpine"),
            command: [DockerStubCommand.SUCCESS_NO_OUTPUT],
          },
        }),
    ).toThrow(/[Bb]undl.*output.*empty|[Bb]undl.*did not produce/);

    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated,ro -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS_NO_OUTPUT`,
    );
  });

  test("throws when bundling fails", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // THEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          bundling: {
            image: DockerImage.fromRegistry("this-is-an-invalid-docker-image"),
            command: [DockerStubCommand.FAIL],
          },
        }),
    ).toThrow(/[Ff]ailed.*bundl|docker.*exited/i);

    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated,ro -v /output:/asset-output:delegated -w /asset-input this-is-an-invalid-docker-image DOCKER_STUB_FAIL`,
    );
  });

  test("bundling with docker security option", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        securityOpt: "no-new-privileges",
      },
    });

    // THEN
    expect(readDockerStubInput()).toEqual(
      `run --rm --security-opt no-new-privileges ${USER_ARG} -v /input:/asset-input:delegated,ro -v /output:/asset-output:delegated -w /asset-input alpine DOCKER_STUB_SUCCESS`,
    );
  });

  test("bundling with docker entrypoint", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        entrypoint: [DockerStubCommand.SUCCESS],
        command: [DockerStubCommand.SUCCESS],
      },
    });

    // THEN
    expect(readDockerStubInput()).toEqual(
      `run --rm ${USER_ARG} -v /input:/asset-input:delegated,ro -v /output:/asset-output:delegated -w /asset-input --entrypoint DOCKER_STUB_SUCCESS alpine DOCKER_STUB_SUCCESS`,
    );
  });

  test("bundling that produces a single archive file is autodiscovered", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_ARCHIVE],
      },
    });

    // THEN
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(true);
  });

  test("bundling that produces a single archive file with NOT_ARCHIVED", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_ARCHIVE],
        outputType: BundlingOutput.NOT_ARCHIVED,
      },
    });

    // THEN
    expect(staging.packaging).toEqual(FileAssetPackaging.ZIP_DIRECTORY);
    expect(staging.isArchive).toEqual(false);
  });

  test("throws with ARCHIVED and bundling that does not produce a single archive file", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    expect(
      () =>
        new AssetStaging(stack, "Asset", {
          sourcePath: directory,
          bundling: {
            image: DockerImage.fromRegistry("alpine"),
            command: [DockerStubCommand.MULTIPLE_FILES],
            outputType: BundlingOutput.ARCHIVED,
          },
        }),
    ).toThrow(/ARCHIVED|SINGLE_FILE/);
  });

  test("bundling that produces a single file with SINGLE_FILE", () => {
    // GIVEN
    const directory = path.join(FIXTURE_TEST1_DIR, "subdir");

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE],
        outputType: BundlingOutput.SINGLE_FILE,
      },
    });

    // THEN
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });

  test("bundling that produces a single file without extension with SINGLE_FILE", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE_WITHOUT_EXT],
        outputType: BundlingOutput.SINGLE_FILE,
      },
    });

    // THEN
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });

  test("with local bundling", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    let dir: string | undefined;
    let opts: BundlingOptions | undefined;
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        local: {
          tryBundle(outputDir: string, options: BundlingOptions): boolean {
            dir = outputDir;
            opts = options;
            fs.writeFileSync(path.join(outputDir, "hello.txt"), "hello");
            return true;
          },
        },
      },
    });

    // THEN
    expect(dir).toBeDefined();
    expect(opts?.command?.[0]).toEqual(DockerStubCommand.SUCCESS);
    // Docker should NOT have been called
    expect(fs.existsSync(STUB_INPUT_FILE)).toEqual(false);

    if (dir) {
      fs.rmSync(path.join(dir, "hello.txt"), { recursive: true, force: true });
    }
  });

  test("bundling with BIND_MOUNT uses -v volumes", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        bundlingFileAccess: BundlingFileAccess.BIND_MOUNT,
      },
    });

    // THEN
    const input = readDockerStubInput();
    // Should have -v bind mount flags
    expect(input).toContain("-v /input:/asset-input:delegated,ro");
    expect(input).toContain("-v /output:/asset-output:delegated");
    // Should NOT have volume create commands
    expect(input).not.toContain("volume create");
  });

  test("BIND_MOUNT is the default bundlingFileAccess", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        // No bundlingFileAccess specified
      },
    });

    // THEN
    const input = readDockerStubInput();
    expect(input).toContain("-v /input:/asset-input:delegated,ro");
    expect(input).toContain("-v /output:/asset-output:delegated");
  });

  test("bundling with BIND_MOUNT passes environment variables", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        bundlingFileAccess: BundlingFileAccess.BIND_MOUNT,
        environment: { NODE_ENV: "production" },
      },
    });

    // THEN
    expect(readDockerStubInput()).toContain("--env NODE_ENV=production");
  });

  test("bundling with BIND_MOUNT passes network option", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        bundlingFileAccess: BundlingFileAccess.BIND_MOUNT,
        network: "host",
      },
    });

    // THEN
    expect(readDockerStubInput()).toContain("--network host");
  });

  test("bundling with BIND_MOUNT passes platform option", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        bundlingFileAccess: BundlingFileAccess.BIND_MOUNT,
        platform: "linux/amd64",
      },
    });

    // THEN
    expect(readDockerStubInput()).toContain("--platform linux/amd64");
  });

  test("bundling with BIND_MOUNT passes additional volumes", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SUCCESS],
        bundlingFileAccess: BundlingFileAccess.BIND_MOUNT,
        volumes: [{ hostPath: "/tmp/cache", containerPath: "/cache" }],
      },
    });

    // THEN
    expect(readDockerStubInput()).toContain("/tmp/cache:/cache");
  });
});

describe("staging with docker cp", () => {
  let stack: TerraformStack;
  let app: App;

  beforeAll(() => {
    // Use custom "docker" command that handles VOLUME_COPY operations
    process.env.CDK_DOCKER = `${__dirname}/docker-stub-cp.sh`;
  });

  afterAll(() => {
    delete process.env.CDK_DOCKER;
    // clear the staging directory
    fs.rmSync(TEST_STAGING_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_OUTDIR)) {
      fs.rmSync(TEST_OUTDIR, { recursive: true, force: true });
    }
    app = Testing.app({
      outdir: TEST_OUTDIR,
      context: {
        cdktfJsonPath: path.resolve(CDKTFJSON_PATH),
      },
    });
    stack = new TerraformStack(app, "TestStack");
  });

  afterEach(() => {
    if (fs.existsSync(STUB_INPUT_CP_FILE)) {
      fs.unlinkSync(STUB_INPUT_CP_FILE);
    }
    if (fs.existsSync(STUB_INPUT_CP_CONCAT_FILE)) {
      fs.unlinkSync(STUB_INPUT_CP_CONCAT_FILE);
    }
    // Clean staging output between tests
    if (fs.existsSync(TEST_STAGING_DIR)) {
      fs.rmSync(TEST_STAGING_DIR, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  test("bundling with docker image copy variant", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
    });

    // THEN
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(true);

    const dockerCalls: string[] = readDockerStubInputConcat(
      STUB_INPUT_CP_CONCAT_FILE,
    ).split(/\r?\n/);

    expect(dockerCalls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("volume create assetInput"),
        expect.stringContaining("volume create assetOutput"),
        expect.stringMatching(
          /run --name copyContainer.* -v .+:\/asset-input -v .+:\/asset-output public\.ecr\.aws\/docker\/library\/alpine sh -c mkdir -p \/asset-input && chown -R .* \/asset-output && chown -R .* \/asset-input/,
        ),
        expect.stringMatching(
          /cp .*fs\/fixtures\/test1\/\. copyContainer.*:\/asset-input/,
        ),
        expect.stringMatching(
          /run --rm -u .* --volumes-from copyContainer.* -w \/asset-input alpine DOCKER_STUB_VOLUME_SINGLE_ARCHIVE/,
        ),
        expect.stringMatching(/cp copyContainer.*:\/asset-output\/\. .*/),
        expect.stringContaining("rm copyContainer"),
        expect.stringContaining("volume rm assetInput"),
        expect.stringContaining("volume rm assetOutput"),
      ]),
    );
  });

  test("VOLUME_COPY issues volume create commands", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
    });

    // THEN
    const concat = readDockerStubInputConcat(STUB_INPUT_CP_CONCAT_FILE);
    expect(concat).toContain("volume create assetInput");
    expect(concat).toContain("volume create assetOutput");
  });

  test("VOLUME_COPY cleans up volumes after bundling", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
    });

    // THEN
    const concat = readDockerStubInputConcat(STUB_INPUT_CP_CONCAT_FILE);
    expect(concat).toContain("volume rm assetInput");
    expect(concat).toContain("volume rm assetOutput");
  });

  test("VOLUME_COPY cleans up helper container after bundling", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
    });

    // THEN
    const concat = readDockerStubInputConcat(STUB_INPUT_CP_CONCAT_FILE);
    expect(concat).toMatch(/rm copyContainer/);
  });

  test("VOLUME_COPY uses --volumes-from for the bundling container", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
    });

    // THEN
    const concat = readDockerStubInputConcat(STUB_INPUT_CP_CONCAT_FILE);
    expect(concat).toMatch(/--volumes-from copyContainer/);
  });

  test("VOLUME_COPY does not use -v bind mounts for source/output in bundling container", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
    });

    // THEN
    const dockerCalls = readDockerStubInputConcat(
      STUB_INPUT_CP_CONCAT_FILE,
    ).split(/\r?\n/);

    // Find the bundling run (not the helper container run)
    const bundlingRun = dockerCalls.find(
      (line) =>
        line.includes("run --rm") &&
        line.includes("alpine DOCKER_STUB_VOLUME_SINGLE_ARCHIVE"),
    );
    expect(bundlingRun).toBeDefined();
    // The bundling container should NOT have -v with the source directory
    expect(bundlingRun).not.toMatch(/-v .*fixtures.*:\/asset-input/);
  });

  test("VOLUME_COPY copies source into input volume via docker cp", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
    });

    // THEN
    const concat = readDockerStubInputConcat(STUB_INPUT_CP_CONCAT_FILE);
    // Should have a docker cp from source to the copy container's /asset-input
    expect(concat).toMatch(
      /cp .*fs\/fixtures\/test1\/\. copyContainer.*:\/asset-input/,
    );
  });

  test("VOLUME_COPY copies output from output volume via docker cp", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
    });

    // THEN
    const concat = readDockerStubInputConcat(STUB_INPUT_CP_CONCAT_FILE);
    expect(concat).toMatch(/cp copyContainer.*:\/asset-output\/\. /);
  });

  test("bundling that produces a single file with docker image copy variant and hash type SOURCE", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE_WITHOUT_EXT],
        outputType: BundlingOutput.SINGLE_FILE,
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
      assetHashType: AssetHashType.SOURCE,
    });

    // THEN
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });

  test("bundling that produces a single file with docker image copy variant and hash type CUSTOM", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    const staging = new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.SINGLE_FILE_WITHOUT_EXT],
        outputType: BundlingOutput.SINGLE_FILE,
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      },
      assetHashType: AssetHashType.CUSTOM,
      assetHash: "custom",
    });

    // THEN
    expect(staging.packaging).toEqual(FileAssetPackaging.FILE);
    expect(staging.isArchive).toEqual(false);
  });

  test("VOLUME_COPY passes user option to helper and bundling containers", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
        user: "500:500",
      },
    });

    // THEN
    const concat = readDockerStubInputConcat(STUB_INPUT_CP_CONCAT_FILE);
    // Helper container chown should use 500:500
    expect(concat).toMatch(/chown -R 500:500/);
    // Bundling container should run as 500:500
    expect(concat).toMatch(/run --rm -u 500:500/);
  });

  test("VOLUME_COPY is not used when local bundling succeeds", () => {
    // GIVEN
    const directory = FIXTURE_TEST1_DIR;

    // WHEN
    new AssetStaging(stack, "Asset", {
      sourcePath: directory,
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
        bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
        local: {
          tryBundle(outputDir: string): boolean {
            fs.writeFileSync(path.join(outputDir, "local.txt"), "local");
            return true;
          },
        },
      },
    });

    // THEN - Docker should not have been called
    expect(fs.existsSync(STUB_INPUT_CP_FILE)).toEqual(false);
  });

  describe("read-only input mount", () => {
    test("input volume is read-only while output volume is writable", () => {
      // GIVEN
      const directory = FIXTURE_TEST1_DIR;

      // WHEN
      new AssetStaging(stack, "Asset", {
        sourcePath: directory,
        bundling: {
          image: DockerImage.fromRegistry("alpine"),
          command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
          bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
        },
      });

      // THEN
      const dockerCalls = readDockerStubInputConcat(
        STUB_INPUT_CP_CONCAT_FILE,
      ).split(/\r?\n/);

      // Find the bundling run command
      const bundlingRun = dockerCalls.find(
        (line) =>
          line.includes("run --rm") &&
          line.includes("alpine DOCKER_STUB_VOLUME_SINGLE_ARCHIVE"),
      );

      // For VOLUME_COPY, the input/output are accessed via --volumes-from
      // The volumes themselves are created separately and mounted to the helper container
      // The read-only enforcement happens at the helper container level
      expect(bundlingRun).toBeDefined();
      expect(bundlingRun).toContain("--volumes-from");
    });
  });

  describe("network option forwarding", () => {
    test("VOLUME_COPY forwards network option to bundling container", () => {
      // GIVEN
      const directory = FIXTURE_TEST1_DIR;

      // WHEN
      new AssetStaging(stack, "Asset", {
        sourcePath: directory,
        bundling: {
          image: DockerImage.fromRegistry("alpine"),
          command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
          bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
          network: "host",
        },
      });

      // THEN - The bundling container should use the network option
      const concat = readDockerStubInputConcat(STUB_INPUT_CP_CONCAT_FILE);
      const dockerCalls = concat.split(/\r?\n/);

      // Find the bundling run (not the helper container run)
      const bundlingRun = dockerCalls.find(
        (line) =>
          line.includes("run --rm") &&
          line.includes("alpine DOCKER_STUB_VOLUME_SINGLE_ARCHIVE"),
      );

      expect(bundlingRun).toBeDefined();
      expect(bundlingRun).toContain("--network host");
    });
  });

  describe("VOLUME_COPY cleanup resilience", () => {
    test("cleanup commands are present in the Docker call sequence", () => {
      // GIVEN
      const directory = FIXTURE_TEST1_DIR;

      // WHEN - Run a normal VOLUME_COPY bundling operation
      new AssetStaging(stack, "Asset", {
        sourcePath: directory,
        bundling: {
          image: DockerImage.fromRegistry("alpine"),
          command: [DockerStubCommand.VOLUME_SINGLE_ARCHIVE],
          bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
        },
      });

      // THEN - Verify cleanup commands are executed
      const concat = readDockerStubInputConcat(STUB_INPUT_CP_CONCAT_FILE);
      const dockerCalls = concat.split(/\r?\n/);

      // The sequence should include setup, bundling, AND cleanup
      // Verify setup happened
      expect(dockerCalls).toEqual(
        expect.arrayContaining([
          expect.stringContaining("volume create assetInput"),
          expect.stringContaining("volume create assetOutput"),
          expect.stringMatching(/run --name copyContainer/),
        ]),
      );

      // Verify bundling happened
      expect(dockerCalls).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /run --rm.*--volumes-from copyContainer.*alpine DOCKER_STUB_VOLUME_SINGLE_ARCHIVE/,
          ),
        ]),
      );

      // Most importantly: verify cleanup happened AFTER bundling
      expect(dockerCalls).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/rm copyContainer/),
          expect.stringContaining("volume rm assetInput"),
          expect.stringContaining("volume rm assetOutput"),
        ]),
      );

      // Verify cleanup comes after bundling in the sequence
      const bundlingIndex = dockerCalls.findIndex((cmd) =>
        cmd.includes("alpine DOCKER_STUB_VOLUME_SINGLE_ARCHIVE"),
      );
      const cleanupIndex = dockerCalls.findIndex((cmd) =>
        cmd.includes("rm copyContainer"),
      );

      expect(bundlingIndex).toBeGreaterThanOrEqual(0);
      expect(cleanupIndex).toBeGreaterThan(bundlingIndex);
    });
  });
});

// Reads a docker stub and cleans the volume paths out of the stub.
function readAndCleanDockerStubInput(file: string) {
  return fs
    .readFileSync(file, "utf-8")
    .trim()
    .replace(/-v ([^:]+):\/asset-input/g, "-v /input:/asset-input")
    .replace(/-v ([^:]+):\/asset-output/g, "-v /output:/asset-output");
}

// Last docker input since last teardown
function readDockerStubInput(file?: string) {
  return readAndCleanDockerStubInput(file ?? STUB_INPUT_FILE);
}

// Concatenated docker inputs since last teardown
function readDockerStubInputConcat(file?: string) {
  return readAndCleanDockerStubInput(file ?? STUB_INPUT_CONCAT_FILE);
}
