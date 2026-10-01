/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

// Build the language packages via jsii-pacmak.
//
// This package bundles no runtime dependencies (it relies only on Node
// built-ins and takes cdktn as a peer), so it needs none of the staging dance
// cdktn's pack script performs to work around pnpm's symlinked node_modules.

import { pacmak } from "jsii-pacmak";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = process.argv.slice(2);

await pacmak({
  inputDirectories: [packageDir],
  ...(targets.length > 0 ? { targets } : {}),
});

console.log("Done.");
