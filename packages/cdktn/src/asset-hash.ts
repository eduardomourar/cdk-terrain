// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import * as crypto from "crypto";
import * as path from "path";
import { hashPath } from "./private/fs";
import { ExcludeIgnoreStrategy, IIgnoreStrategy } from "./ignore-strategy";

/**
 * Options for {@link AssetHash.of}.
 */
export interface AssetHashOptions {
  /**
   * Paths to exclude, relative to the hashed path. Ignored if
   * `ignoreStrategy` is given.
   *
   * @default - nothing is excluded
   */
  readonly exclude?: string[];

  /**
   * Extra information to fold into the hash.
   *
   * @default - no extra data
   */
  readonly extraHash?: string;

  /**
   * Exclusion matching, for callers that need `.gitignore` / `.dockerignore`
   * parity rather than the built-in exact-path / suffix / directory matcher.
   *
   * @default - `exclude` is used with the built-in matcher
   */
  readonly ignoreStrategy?: IIgnoreStrategy;
}

/**
 * Computes a content hash of a file or directory without staging it.
 *
 * Providers that read a local path directly — a Docker build `context`, for
 * example — need a content hash to drive `triggers`, but have no use for a
 * staged copy of the source. `Asset` and `TerraformAsset` always produce a
 * staged copy; this is the identity half without the staging half.
 */
export class AssetHash {
  /**
   * Content hash of a file or directory, without staging it.
   * @param filePath - path to a file or directory to hash
   * @param options - see {@link AssetHashOptions}
   */
  public static of(filePath: string, options: AssetHashOptions = {}): string {
    const resolved = path.resolve(filePath);
    const strategy =
      options.ignoreStrategy ??
      new ExcludeIgnoreStrategy(options.exclude ?? []);

    const baseHash = hashPath(resolved, {
      shouldExclude: (relativePath) => strategy.ignores(relativePath),
    });

    if (!options.extraHash) {
      return baseHash;
    }

    return crypto
      .createHash("md5")
      .update(baseHash)
      .update(options.extraHash)
      .digest("hex")
      .slice(0, 32)
      .toUpperCase();
  }

  private constructor() {}
}
