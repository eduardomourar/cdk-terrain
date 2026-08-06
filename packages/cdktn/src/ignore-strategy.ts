// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { excludeMatcher } from "./private/fs";

/**
 * Decides whether a path relative to an asset root is excluded from staging
 * and hashing.
 *
 * Core ships only the exact-path / `*.ext` / directory matcher used by
 * `exclude` today (`ExcludeIgnoreStrategy`). Full glob, `.gitignore`, and
 * `.dockerignore` parity can be implemented against this interface without
 * core taking on a glob parser.
 */
export interface IIgnoreStrategy {
  /**
   * Whether the given path should be excluded.
   * @param relativePath - `/`-separated path relative to the asset root
   */
  ignores(relativePath: string): boolean;
}

/**
 * The default ignore strategy: exact paths, `*.ext` suffixes, and
 * directories (with everything inside them).
 */
export class ExcludeIgnoreStrategy implements IIgnoreStrategy {
  private readonly matcher: (relativePath: string) => boolean;

  constructor(exclude: string[]) {
    this.matcher = excludeMatcher(exclude);
  }

  public ignores(relativePath: string): boolean {
    return this.matcher(relativePath);
  }
}
