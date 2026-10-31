// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { TestDriver, onlyJson } from "../../test-helper";

// End-to-end coverage for ephemeral resources: `cdktn get` against a Terraform
// CLI that emits `ephemeral_resource_schemas`, the generated
// `EphemeralRandomPassword` binding, synth and plan. Pinned to current stable
// Terraform in `pinnedRuntimes` in tools/build-test-matrix.mjs.
describe("ephemeral resources", () => {
  let driver: TestDriver;

  beforeAll(async () => {
    driver = new TestDriver(__dirname);
    await driver.setupTypescriptProject();
    await driver.synth();
  }, 500_000);

  test("generates a binding for the ephemeral resource", () => {
    const binding = driver.readLocalFile(
      ".gen/providers/random/ephemeral-random-password/index.ts",
    );
    expect(binding).toContain("class EphemeralRandomPassword");
  });

  test("does not warn about ephemeral resources when targets admit them", async () => {
    const { stdout, stderr } = await driver.exec("cdktn", ["get"]);
    expect(`${stdout}${stderr}`).not.toMatch(/warn/i);
  });

  onlyJson("synthesizes an ephemeral block", () => {
    const synthesized = JSON.parse(
      driver.synthesizedStackContentsRaw("ephemeral"),
    );
    expect(synthesized.ephemeral.random_password.password).toMatchObject({
      length: 16,
      special: false,
    });
    expect(synthesized.resource).toBeUndefined();
  });

  test("plans successfully", () => {
    const output = driver.diff("ephemeral");
    expect(output).toContain("ephemeral.random_password.password: Opening");
    expect(output).toContain("No changes");
  }, 300_000);
});
