// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { App, TerraformStack } from "cdktn";
import { Construct } from "constructs";
import { EphemeralRandomPassword } from "./.gen/providers/random/ephemeral-random-password";
import { RandomProvider } from "./.gen/providers/random/provider";

// Ephemeral resources are only emitted into a provider schema by Terraform
// >= 1.10, so this stack can only be generated and synthesized by the runtime
// this test is pinned to. See pinnedRuntimes in tools/build-test-matrix.mjs.
class EphemeralStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new RandomProvider(this, "random");
    new EphemeralRandomPassword(this, "password", {
      length: 16,
      special: false,
    });
  }
}

const app = new App();
new EphemeralStack(app, "ephemeral");
app.synth();
