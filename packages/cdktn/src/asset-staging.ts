// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
// Simplified from AWS CDK and TerraConstructs patterns

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Construct } from "constructs";
import { AssetHashType, AssetOptions, FileAssetPackaging } from "./assets";
import { BundlingOptions, BundlingOutput, runDockerBundling } from "./bundling";

const ASSET_SALT_CONTEXT_KEY = "cdktn:assetHashSalt";

/**
 * Initialization properties for `AssetStaging`.
 */
export interface AssetStagingProps extends AssetOptions {
  /**
   * The source file or directory to copy from.
   */
  readonly sourcePath: string;

  /**
   * File paths matching these patterns will be excluded.
   *
   * @default - nothing is excluded
   */
  readonly exclude?: string[];

  /**
   * Extra information to encode into the fingerprint.
   *
   * @default - no extra data
   */
  readonly extraHash?: string;

  /**
   * Bundle the asset by executing a command in a Docker container.
   *
   * The asset path will be mounted at `/asset-input`. The Docker
   * container is responsible for putting content at `/asset-output`.
   * The content at `/asset-output` will be used as the final asset.
   *
   * @default - uploaded as-is
   */
  readonly bundling?: BundlingOptions;
}

/**
 * Stages a file or directory from a location on the file system into a staging
 * directory.
 *
 * This follows AWS CDK and TerraConstructs patterns but keeps implementation simple.
 * Features can be added gradually as needed.
 *
 * The file/directory are staged based on their content hash (fingerprint). This
 * means that only if content was changed, copy will happen.
 */
export class AssetStaging extends Construct {
  /**
   * Absolute path to the asset data after staging.
   */
  public readonly absoluteStagedPath: string;

  /**
   * The absolute path of the asset as it was referenced by the user.
   */
  public readonly sourcePath: string;

  /**
   * A cryptographic hash of the asset.
   */
  public readonly assetHash: string;

  /**
   * How this asset should be packaged.
   */
  public readonly packaging: FileAssetPackaging;

  /**
   * Whether this asset is an archive (zip or jar).
   */
  public readonly isArchive: boolean;

  private readonly assetOutdir: string;
  private readonly sourceStats: fs.Stats;

  constructor(scope: Construct, id: string, props: AssetStagingProps) {
    super(scope, id);

    this.sourcePath = path.resolve(props.sourcePath);

    if (!fs.existsSync(this.sourcePath)) {
      throw new Error(`Cannot find asset at ${this.sourcePath}`);
    }

    this.sourceStats = fs.statSync(this.sourcePath);

    // Determine output directory - try to find cdktf.json or use app outdir
    const cdktfJsonPath = this.findCdktfJson();
    if (cdktfJsonPath) {
      this.assetOutdir = path.join(
        path.dirname(cdktfJsonPath),
        "cdktf.out",
        "assets",
      );
    } else {
      // Fallback to app outdir
      const app = this.node.root;
      if ("outdir" in app && typeof (app as any).outdir === "string") {
        this.assetOutdir = path.join((app as any).outdir, "assets");
      } else {
        this.assetOutdir = path.join("cdktf.out", "assets");
      }
    }

    // Calculate hash (before bundling if possible)
    const hashType = this.determineHashType(props);

    // If bundling, handle it
    let finalSourcePath = this.sourcePath;
    if (props.bundling) {
      if (!this.sourceStats.isDirectory()) {
        throw new Error("Asset must be a directory when bundling");
      }

      // Try local bundling first
      let bundled = false;
      if (props.bundling.local) {
        const tempDir = path.join(this.assetOutdir, `temp-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        try {
          bundled = props.bundling.local.tryBundle(tempDir, props.bundling);
          if (bundled) {
            finalSourcePath = tempDir;
          } else {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (err) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          throw err;
        }
      }

      // Docker bundling if local didn't work
      if (!bundled) {
        const bundleDir = path.join(this.assetOutdir, `bundle-${Date.now()}`);
        fs.mkdirSync(bundleDir, { recursive: true });

        try {
          process.stderr.write(`Bundling asset ${this.node.path}...\n`);
          runDockerBundling(this.sourcePath, bundleDir, props.bundling);
          finalSourcePath = bundleDir;
        } catch (err) {
          fs.rmSync(bundleDir, { recursive: true, force: true });
          throw err;
        }
      }
    }

    this.assetHash = this.calculateHash(hashType, props, finalSourcePath);

    // Stage the asset
    const extension = this.getExtension(finalSourcePath);
    const targetPath = path.resolve(
      this.assetOutdir,
      `asset.${this.assetHash}${extension}`,
    );

    this.absoluteStagedPath = targetPath;

    // Determine packaging based on bundling output type
    const bundlingOutputType =
      props.bundling?.outputType ?? BundlingOutput.AUTO_DISCOVER;

    if (props.bundling) {
      const bundledStat = fs.statSync(finalSourcePath);

      if (bundledStat.isDirectory()) {
        // Check if it's a single archive file
        const files = fs.readdirSync(finalSourcePath);
        if (files.length === 1) {
          const singleFile = path.join(finalSourcePath, files[0]);
          const singleStat = fs.statSync(singleFile);

          if (
            singleStat.isFile() &&
            this.isArchiveExtension(path.extname(files[0]))
          ) {
            // Single archive file
            if (
              bundlingOutputType === BundlingOutput.AUTO_DISCOVER ||
              bundlingOutputType === BundlingOutput.ARCHIVED
            ) {
              this.packaging = FileAssetPackaging.FILE;
              this.isArchive = true;
              // Use the archive file directly
              finalSourcePath = singleFile;
            } else {
              this.packaging = FileAssetPackaging.ZIP_DIRECTORY;
              this.isArchive = false;
            }
          } else {
            // Single non-archive file
            if (bundlingOutputType === BundlingOutput.SINGLE_FILE) {
              this.packaging = FileAssetPackaging.FILE;
              this.isArchive = false;
              finalSourcePath = singleFile;
            } else {
              this.packaging = FileAssetPackaging.ZIP_DIRECTORY;
              this.isArchive = false;
            }
          }
        } else {
          // Multiple files - always zip
          this.packaging = FileAssetPackaging.ZIP_DIRECTORY;
          this.isArchive = false;
        }
      } else {
        // Single file output
        this.packaging = FileAssetPackaging.FILE;
        this.isArchive = this.isArchiveExtension(extension);
      }
    } else {
      // No bundling - simple case
      if (this.sourceStats.isDirectory()) {
        this.packaging = FileAssetPackaging.ZIP_DIRECTORY;
        this.isArchive = true;
      } else {
        this.packaging = FileAssetPackaging.FILE;
        this.isArchive = this.isArchiveExtension(extension);
      }
    }

    // Copy if needed
    this.copyAsset(finalSourcePath, targetPath, props.exclude);
  }

  private findCdktfJson(): string | null {
    const contextPath = this.node.tryGetContext("cdktfJsonPath");
    if (contextPath) return contextPath;

    let dir = process.cwd();
    while (dir !== path.dirname(dir)) {
      const candidate = path.join(dir, "cdktf.json");
      if (fs.existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
    return null;
  }

  private determineHashType(props: AssetStagingProps): AssetHashType {
    const customHash = props.assetHash;
    const hashType = customHash
      ? (props.assetHashType ?? AssetHashType.CUSTOM)
      : (props.assetHashType ?? AssetHashType.SOURCE);

    if (customHash && hashType !== AssetHashType.CUSTOM) {
      throw new Error(
        `Cannot specify assetHashType when assetHash is provided. Use CUSTOM or leave undefined.`,
      );
    }

    if (hashType === AssetHashType.CUSTOM && !customHash) {
      throw new Error(
        "assetHash must be specified when assetHashType is CUSTOM.",
      );
    }

    return hashType;
  }

  private calculateHash(
    hashType: AssetHashType,
    props: AssetStagingProps,
    sourcePath?: string,
  ): string {
    const actualPath = sourcePath || this.sourcePath;
    if (hashType === AssetHashType.CUSTOM) {
      // Normalize custom hash to SHA256
      const customHash = props.assetHash!;
      if (/^[a-f0-9]{64}$/i.test(customHash)) {
        return customHash.toLowerCase();
      }
      return crypto.createHash("sha256").update(customHash).digest("hex");
    }

    // SOURCE hash type - hash the content
    const hash = crypto.createHash("sha256");

    // Add salt from context if present
    const salt = this.node.tryGetContext(ASSET_SALT_CONTEXT_KEY);
    if (salt) hash.update(salt);

    // Add extra hash if provided
    if (props.extraHash) hash.update(props.extraHash);

    // If bundling, include bundling config in hash
    if (props.bundling) {
      hash.update(JSON.stringify(props.bundling));
    }

    // Hash the file content
    this.hashPath(actualPath, hash, props.exclude || []);

    return hash.digest("hex");
  }

  private hashPath(filePath: string, hash: crypto.Hash, exclude: string[]) {
    const stat = fs.statSync(filePath);

    if (stat.isFile()) {
      hash.update(fs.readFileSync(filePath));
    } else if (stat.isDirectory()) {
      const entries = fs.readdirSync(filePath).sort();

      for (const entry of entries) {
        const fullPath = path.join(filePath, entry);
        const relativePath = path.relative(this.sourcePath, fullPath);

        // Check exclusions
        if (this.shouldExclude(relativePath, exclude)) {
          continue;
        }

        hash.update(entry);
        this.hashPath(fullPath, hash, exclude);
      }
    }
  }

  private shouldExclude(relativePath: string, exclude: string[]): boolean {
    if (exclude.length === 0) return false;

    for (const pattern of exclude) {
      // Simple glob matching - exact match or wildcard
      if (pattern === relativePath) return true;

      // *.ext pattern
      if (pattern.startsWith("*.")) {
        const ext = pattern.substring(1);
        if (relativePath.endsWith(ext)) return true;
      }

      // directory/ pattern
      if (pattern.endsWith("/") && relativePath.startsWith(pattern)) {
        return true;
      }

      // exact directory name
      if (
        relativePath === pattern ||
        relativePath.startsWith(pattern + path.sep)
      ) {
        return true;
      }
    }

    return false;
  }

  private copyAsset(source: string, target: string, exclude: string[] = []) {
    // Skip if already staged
    if (fs.existsSync(target)) return;

    // Ensure target directory exists
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const stat = fs.statSync(source);

    if (stat.isFile()) {
      fs.copyFileSync(source, target);
    } else if (stat.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      this.copyDirectory(source, target, exclude);
    }
  }

  private copyDirectory(source: string, target: string, exclude: string[]) {
    const entries = fs.readdirSync(source);

    for (const entry of entries) {
      const sourcePath = path.join(source, entry);
      const targetPath = path.join(target, entry);
      const relativePath = path.relative(this.sourcePath, sourcePath);

      if (this.shouldExclude(relativePath, exclude)) {
        continue;
      }

      const stat = fs.statSync(sourcePath);

      if (stat.isFile()) {
        fs.copyFileSync(sourcePath, targetPath);
      } else if (stat.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true });
        this.copyDirectory(sourcePath, targetPath, exclude);
      }
    }
  }

  private getExtension(filePath: string): string {
    const archiveExtensions = [".tar.gz", ".zip", ".jar", ".tar", ".tgz"];

    for (const ext of archiveExtensions) {
      if (filePath.toLowerCase().endsWith(ext)) {
        return ext;
      }
    }

    return path.extname(filePath);
  }

  private isArchiveExtension(ext: string): boolean {
    const archiveExtensions = [".tar.gz", ".zip", ".jar", ".tar", ".tgz"];
    return archiveExtensions.includes(ext.toLowerCase());
  }
}
