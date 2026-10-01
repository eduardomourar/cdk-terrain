// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0

import * as child_process from "child_process";
import * as path from "path";
import { BundleOutputType } from "cdktn";
import {
  BUNDLING_INPUT_DIR,
  BUNDLING_OUTPUT_DIR,
  BundlingFileAccess,
  DockerBundler,
} from "../docker-bundler";
import { DockerImage } from "../bundling";

jest.mock("child_process");

const spawnSyncMock = child_process.spawnSync as unknown as jest.Mock;

function mockSpawn(): jest.Mock {
  spawnSyncMock.mockReset();
  spawnSyncMock.mockReturnValue({ status: 0, signal: null, stdout: "" } as any);
  return spawnSyncMock;
}

/** The docker argv of every invocation captured by the mock. */
function invocations(mock: jest.Mock): string[][] {
  return mock.mock.calls.map((call) => call[1] as string[]);
}

describe("DockerBundler bind mount", () => {
  afterEach(() => jest.restoreAllMocks());

  test("runs the image with source and output bind-mounted", () => {
    const spy = mockSpawn();
    const bundler = new DockerBundler({
      image: "alpine",
      command: ["sh", "-c", "build"],
      user: "1000:1000",
    });

    const result = bundler.bundle({ source: "/src", outputDir: "/out" });

    expect(result.outputType).toBe(BundleOutputType.DIRECTORY);
    expect(result.path).toBe("/out");
    const args = invocations(spy)[0];
    expect(args).toContain("run");
    expect(args).toContain("--rm");
    expect(args).toContain(`/src:${BUNDLING_INPUT_DIR}`);
    expect(args).toContain(`/out:${BUNDLING_OUTPUT_DIR}`);
    expect(args).toContain("alpine");
    expect(args.slice(-3)).toEqual(["sh", "-c", "build"]);
  });

  test("defaults the user to the host uid:gid", () => {
    const spy = mockSpawn();
    jest.spyOn(process, "getuid").mockReturnValue(501);
    jest.spyOn(process, "getgid").mockReturnValue(20);

    new DockerBundler({ image: "alpine", command: ["build"] }).bundle({
      source: "/src",
      outputDir: "/out",
    });

    const args = invocations(spy)[0];
    const userIdx = args.indexOf("-u");
    expect(args[userIdx + 1]).toBe("501:20");
  });

  test("passes environment, network, platform and security options", () => {
    const spy = mockSpawn();
    new DockerBundler({
      image: "node:20",
      command: ["build"],
      environment: { NODE_ENV: "production" },
      network: "host",
      platform: "linux/amd64",
      securityOpt: "no-new-privileges",
    }).bundle({ source: "/src", outputDir: "/out" });

    const args = invocations(spy)[0];
    expect(args).toContain("NODE_ENV=production");
    expect(args).toContain("--network");
    expect(args).toContain("host");
    expect(args).toContain("--platform");
    expect(args).toContain("linux/amd64");
    expect(args).toContain("--security-opt");
    expect(args).toContain("no-new-privileges");
  });

  test("throws when docker exits non-zero", () => {
    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValue({
      status: 1,
      signal: null,
      stderr: "boom",
    } as any);

    expect(() =>
      new DockerBundler({ image: "alpine", command: ["build"] }).bundle({
        source: "/src",
        outputDir: "/out",
      }),
    ).toThrow(/exited with status 1/);
  });
});

describe("DockerBundler volume copy", () => {
  afterEach(() => jest.restoreAllMocks());

  test("creates volumes, copies in and out, and cleans up", () => {
    const spy = mockSpawn();
    const bundler = new DockerBundler({
      image: "alpine",
      command: ["build"],
      bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
    });

    const result = bundler.bundle({ source: "/src", outputDir: "/out" });

    expect(result.outputType).toBe(BundleOutputType.DIRECTORY);
    expect(result.path).toBe("/out");
    const calls = invocations(spy);
    const flat = calls.map((c) => c.join(" "));
    // The helper container reuses the build image, so no second image is pulled.
    const helperRun = calls.find((c) => c.includes("--name"));
    expect(helperRun).toContain("alpine");
    expect(flat.join("\n")).not.toContain("public.ecr.aws");
    expect(flat.some((c) => c.startsWith("volume create assetInput"))).toBe(
      true,
    );
    expect(flat.some((c) => c.startsWith("volume create assetOutput"))).toBe(
      true,
    );
    expect(flat.some((c) => c.startsWith("cp /src/."))).toBe(true);
    expect(flat.some((c) => c.includes("/asset-output/. /out"))).toBe(true);
    expect(flat.some((c) => c.startsWith("volume rm assetInput"))).toBe(true);
    expect(flat.some((c) => c.startsWith("volume rm assetOutput"))).toBe(true);
  });

  test("cleans up even when the build fails", () => {
    let call = 0;
    spawnSyncMock.mockReset();
    const spy = spawnSyncMock.mockImplementation((_bin: any, args: any) => {
      call += 1;
      // Fail on the build container run (the invocation carrying the image).
      if ((args as string[]).includes("alpine") && call > 3) {
        return { status: 7, signal: null, stderr: "build failed" } as any;
      }
      return { status: 0, signal: null, stdout: "" } as any;
    });

    const bundler = new DockerBundler({
      image: "alpine",
      command: ["build"],
      bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
    });

    expect(() =>
      bundler.bundle({ source: "/src", outputDir: "/out" }),
    ).toThrow();

    const flat = invocations(spy).map((c) => c.join(" "));
    expect(flat.some((c) => c.startsWith("volume rm assetInput"))).toBe(true);
    expect(flat.some((c) => c.startsWith("volume rm assetOutput"))).toBe(true);
  });
});

describe("DockerBundler volume copy helper image", () => {
  afterEach(() => jest.restoreAllMocks());

  test("defaults the helper container to the build image", () => {
    const spy = mockSpawn();
    new DockerBundler({
      image: "node:20",
      command: ["build"],
      bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
    }).bundle({ source: "/src", outputDir: "/out" });

    const helperRun = invocations(spy).find((c) => c.includes("--name"));
    expect(helperRun).toContain("node:20");
  });

  test("uses an explicit helper image when given", () => {
    const spy = mockSpawn();
    new DockerBundler({
      image: "myregistry.example.com/build:1",
      command: ["build"],
      bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      volumeCopyHelperImage: "myregistry.example.com/busybox:1",
    }).bundle({ source: "/src", outputDir: "/out" });

    const helperRun = invocations(spy).find((c) => c.includes("--name"));
    expect(helperRun).toContain("myregistry.example.com/busybox:1");
  });
});

describe("DockerBundler bundlerKey", () => {
  test("changes with image, command and file access", () => {
    const base = new DockerBundler({ image: "alpine", command: ["build"] });
    const otherImage = new DockerBundler({ image: "node", command: ["build"] });
    const otherCmd = new DockerBundler({ image: "alpine", command: ["make"] });
    const otherAccess = new DockerBundler({
      image: "alpine",
      command: ["build"],
      bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
    });

    expect(base.bundlerKey).not.toBe(otherImage.bundlerKey);
    expect(base.bundlerKey).not.toBe(otherCmd.bundlerKey);
    expect(base.bundlerKey).not.toBe(otherAccess.bundlerKey);
  });

  test("changes when the helper image is overridden", () => {
    const base = new DockerBundler({
      image: "alpine",
      command: ["build"],
      bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
    });
    const withHelper = new DockerBundler({
      image: "alpine",
      command: ["build"],
      bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
      volumeCopyHelperImage: "busybox",
    });

    expect(base.bundlerKey).not.toBe(withHelper.bundlerKey);
  });
});

describe("DockerImage", () => {
  afterEach(() => jest.restoreAllMocks());

  test("fromRegistry keeps the reference", () => {
    expect(DockerImage.fromRegistry("node:20").image).toBe("node:20");
  });

  test("run builds the expected argv order", () => {
    const spy = mockSpawn();
    DockerImage.fromRegistry("alpine").run({
      command: ["echo", "hi"],
      user: "1:1",
      workingDirectory: "/work",
      volumes: [{ hostPath: "/h", containerPath: "/c" }],
    });

    const args = invocations(spy)[0];
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(args).toContain("/h:/c");
    expect(args[args.indexOf("-w") + 1]).toBe("/work");
    expect(args.slice(-3)).toEqual(["alpine", "echo", "hi"]);
  });

  test("fromBuild runs docker build and tags the result", () => {
    const spy = mockSpawn();

    const image = DockerImage.fromBuild("/project", {
      buildArgs: { FOO: "bar" },
      file: "Dockerfile.build",
      platform: "linux/amd64",
      cacheFrom: [{ type: "registry", params: { ref: "cache:latest" } }],
      cacheTo: { type: "inline" },
    });

    const args = invocations(spy)[0];
    expect(args[0]).toBe("build");
    expect(args).toContain("--build-arg");
    expect(args).toContain("FOO=bar");
    expect(args).toContain("-f");
    expect(args).toContain(path.join("/project", "Dockerfile.build"));
    expect(args).toContain("--platform");
    expect(args).toContain("linux/amd64");
    expect(args).toContain("--cache-from");
    expect(args).toContain("type=registry,ref=cache:latest");
    expect(args).toContain("--cache-to");
    expect(args).toContain("type=inline");
    expect(args[args.length - 1]).toBe("/project");
    expect(image.image).toMatch(/^cdktn-/);
  });

  test("cp creates, copies from and removes a helper container", () => {
    const spy = mockSpawn();

    const destination = DockerImage.fromRegistry("alpine").cp(
      "/asset-output",
      "/dest",
    );

    expect(destination).toBe("/dest");
    const calls = invocations(spy);
    expect(calls[0]).toEqual(
      expect.arrayContaining(["create", "--name", "alpine"]),
    );
    expect(calls[1][0]).toBe("cp");
    expect(calls[1][2]).toBe("/dest");
    expect(calls[2][0]).toBe("rm");
  });
});
