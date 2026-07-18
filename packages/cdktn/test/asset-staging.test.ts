// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  AssetStaging,
  AssetHashType,
  FileAssetPackaging,
  TerraformStack,
  Testing,
} from "../lib";

describe("AssetStaging", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cdktn-asset-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("basic functionality", () => {
    test("can stage a single file", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      // Create a test file
      const testFile = path.join(tempDir, "test.txt");
      fs.writeFileSync(testFile, "Hello, World!");

      const asset = new AssetStaging(stack, "Asset", {
        sourcePath: testFile,
      });

      expect(asset.assetHash).toBeDefined();
      expect(asset.assetHash).toHaveLength(64); // SHA256 hash
      expect(asset.isArchive).toBe(false);
      expect(asset.packaging).toBe(FileAssetPackaging.FILE);
      expect(asset.sourcePath).toBe(testFile);
      expect(asset.absoluteStagedPath).toBeDefined();
    });

    test("can stage a directory", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      // Create a test directory with files
      const testDir = path.join(tempDir, "test-dir");
      fs.mkdirSync(testDir);
      fs.writeFileSync(path.join(testDir, "file1.txt"), "Content 1");
      fs.writeFileSync(path.join(testDir, "file2.txt"), "Content 2");

      const asset = new AssetStaging(stack, "Asset", {
        sourcePath: testDir,
      });

      expect(asset.assetHash).toBeDefined();
      expect(asset.isArchive).toBe(true);
      expect(asset.packaging).toBe(FileAssetPackaging.ZIP_DIRECTORY);
    });

    test("throws error for non-existent path", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      expect(() => {
        new AssetStaging(stack, "Asset", {
          sourcePath: "/non/existent/path",
        });
      }).toThrow("Cannot find asset at /non/existent/path");
    });
  });

  describe("hashing", () => {
    test("produces consistent hash for same content", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      const testFile1 = path.join(tempDir, "test1.txt");
      const testFile2 = path.join(tempDir, "test2.txt");
      fs.writeFileSync(testFile1, "Same content");
      fs.writeFileSync(testFile2, "Same content");

      const asset1 = new AssetStaging(stack, "Asset1", {
        sourcePath: testFile1,
      });

      const asset2 = new AssetStaging(stack, "Asset2", {
        sourcePath: testFile2,
      });

      expect(asset1.assetHash).toBe(asset2.assetHash);
    });

    test("produces different hash for different content", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      const testFile1 = path.join(tempDir, "test1.txt");
      const testFile2 = path.join(tempDir, "test2.txt");
      fs.writeFileSync(testFile1, "Content A");
      fs.writeFileSync(testFile2, "Content B");

      const asset1 = new AssetStaging(stack, "Asset1", {
        sourcePath: testFile1,
      });

      const asset2 = new AssetStaging(stack, "Asset2", {
        sourcePath: testFile2,
      });

      expect(asset1.assetHash).not.toBe(asset2.assetHash);
    });

    test("supports custom hash", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      const testFile = path.join(tempDir, "test.txt");
      fs.writeFileSync(testFile, "Content");

      const customHash = "my-custom-hash-v1";
      const asset = new AssetStaging(stack, "Asset", {
        sourcePath: testFile,
        assetHash: customHash,
        assetHashType: AssetHashType.CUSTOM,
      });

      // Custom hash should be normalized to SHA256
      expect(asset.assetHash).toBeDefined();
      expect(asset.assetHash).toHaveLength(64);
    });

    test("uses extraHash in hash calculation", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      const testFile = path.join(tempDir, "test.txt");
      fs.writeFileSync(testFile, "Same content");

      const asset1 = new AssetStaging(stack, "Asset1", {
        sourcePath: testFile,
        extraHash: "extra-1",
      });

      const asset2 = new AssetStaging(stack, "Asset2", {
        sourcePath: testFile,
        extraHash: "extra-2",
      });

      expect(asset1.assetHash).not.toBe(asset2.assetHash);
    });

    test("throws error when custom hash type without hash value", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      const testFile = path.join(tempDir, "test.txt");
      fs.writeFileSync(testFile, "Content");

      expect(() => {
        new AssetStaging(stack, "Asset", {
          sourcePath: testFile,
          assetHashType: AssetHashType.CUSTOM,
          // assetHash is missing
        });
      }).toThrow("assetHash must be specified when assetHashType is CUSTOM");
    });
  });

  describe("exclusions", () => {
    test("excludes files matching patterns", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      // Create directory with files to exclude
      const testDir = path.join(tempDir, "test-dir");
      fs.mkdirSync(testDir);
      fs.writeFileSync(path.join(testDir, "include.txt"), "Include me");
      fs.writeFileSync(path.join(testDir, "exclude.md"), "Exclude me");
      fs.writeFileSync(path.join(testDir, "README.md"), "Exclude me too");

      const asset1 = new AssetStaging(stack, "Asset1", {
        sourcePath: testDir,
      });

      const asset2 = new AssetStaging(stack, "Asset2", {
        sourcePath: testDir,
        exclude: ["*.md"],
      });

      // Hash should be different because asset2 excludes .md files
      expect(asset1.assetHash).not.toBe(asset2.assetHash);
    });

    test("excludes directories matching patterns", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      const testDir = path.join(tempDir, "test-dir");
      fs.mkdirSync(testDir);
      fs.mkdirSync(path.join(testDir, "node_modules"));
      fs.writeFileSync(path.join(testDir, "index.js"), "code");
      fs.writeFileSync(
        path.join(testDir, "node_modules", "dep.js"),
        "dependency",
      );

      const asset1 = new AssetStaging(stack, "Asset1", {
        sourcePath: testDir,
      });

      const asset2 = new AssetStaging(stack, "Asset2", {
        sourcePath: testDir,
        exclude: ["node_modules"],
      });

      expect(asset1.assetHash).not.toBe(asset2.assetHash);
    });
  });

  describe("symlinks", () => {
    test("ignores symlinks by default", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      const testDir = path.join(tempDir, "test-dir");
      fs.mkdirSync(testDir);
      fs.writeFileSync(path.join(testDir, "real.txt"), "real content");

      const linkPath = path.join(testDir, "link.txt");
      try {
        fs.symlinkSync(path.join(testDir, "real.txt"), linkPath);
      } catch (e) {
        // Skip test if symlinks are not supported (e.g., Windows without admin)
        return;
      }

      const asset = new AssetStaging(stack, "Asset", {
        sourcePath: testDir,
      });

      expect(asset.assetHash).toBeDefined();
    });
  });

  describe("directory hashing", () => {
    test("hashes directories recursively", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      const testDir = path.join(tempDir, "test-dir");
      fs.mkdirSync(testDir);
      fs.mkdirSync(path.join(testDir, "subdir"));
      fs.writeFileSync(path.join(testDir, "file1.txt"), "Content 1");
      fs.writeFileSync(path.join(testDir, "subdir", "file2.txt"), "Content 2");

      const asset = new AssetStaging(stack, "Asset", {
        sourcePath: testDir,
      });

      expect(asset.assetHash).toBeDefined();
      expect(asset.isArchive).toBe(true);
    });

    test("produces consistent hash for same directory structure", () => {
      const app = Testing.app();
      const stack = new TerraformStack(app, "test");

      // Create two identical directory structures
      const dir1 = path.join(tempDir, "dir1");
      const dir2 = path.join(tempDir, "dir2");

      for (const dir of [dir1, dir2]) {
        fs.mkdirSync(dir);
        fs.mkdirSync(path.join(dir, "subdir"));
        fs.writeFileSync(path.join(dir, "a.txt"), "A");
        fs.writeFileSync(path.join(dir, "subdir", "b.txt"), "B");
      }

      const asset1 = new AssetStaging(stack, "Asset1", {
        sourcePath: dir1,
      });

      const asset2 = new AssetStaging(stack, "Asset2", {
        sourcePath: dir2,
      });

      expect(asset1.assetHash).toBe(asset2.assetHash);
    });
  });
});
