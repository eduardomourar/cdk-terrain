// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { AttributeType } from "@cdktn/commons";
import {
  AttributeTypeModel,
  ListAttributeTypeModel,
  MapAttributeTypeModel,
  SetAttributeTypeModel,
  SimpleAttributeTypeModel,
} from "../../generator/models/attribute-type-model";
import { buildProviderFunctionsModel } from "../../generator/models/provider-function-model";

// The provider-function parameter mapping documents that it mirrors the
// resource attribute input mapping branch for branch. These tests fail when
// one side changes without the other.

function attributeModel(type: AttributeType): AttributeTypeModel {
  if (type === "bool") return new SimpleAttributeTypeModel("boolean");
  if (type === "string") return new SimpleAttributeTypeModel("string");
  if (type === "number") return new SimpleAttributeTypeModel("number");
  if (type === "dynamic") {
    return new MapAttributeTypeModel(new SimpleAttributeTypeModel("any"));
  }
  const [kind, element] = type as [string, AttributeType];
  const elementModel = attributeModel(element);
  switch (kind) {
    case "list":
      return new ListAttributeTypeModel(elementModel, false, false);
    case "set":
      return new SetAttributeTypeModel(elementModel, false, false);
    case "map":
      return new MapAttributeTypeModel(elementModel);
    default:
      throw new Error(`unsupported type ${JSON.stringify(type)}`);
  }
}

function attributeInputType(type: AttributeType): string {
  return attributeModel(type).inputTypeDefinition;
}

function functionParameterType(type: AttributeType): string {
  const model = buildProviderFunctionsModel("test", {
    fn: { return_type: "string", parameters: [{ name: "value", type }] },
  });
  return model!.functions[0].parameters[0].tsType;
}

describe("type mapping parity between resource inputs and provider functions", () => {
  describe("types that map identically", () => {
    it.each<[string, AttributeType, string]>([
      ["string", "string", "string"],
      ["number", "number", "number"],
      ["bool", "bool", "boolean | cdktn.IResolvable"],
      ["list of string", ["list", "string"], "string[]"],
      ["list of number", ["list", "number"], "number[]"],
      [
        "list of bool",
        ["list", "bool"],
        "Array<boolean | cdktn.IResolvable> | cdktn.IResolvable",
      ],
      ["set of string", ["set", "string"], "string[]"],
      [
        "set of bool",
        ["set", "bool"],
        "Array<boolean | cdktn.IResolvable> | cdktn.IResolvable",
      ],
      ["map of string", ["map", "string"], "{ [key: string]: string }"],
      ["map of number", ["map", "number"], "{ [key: string]: number }"],
      [
        "map of bool",
        ["map", "bool"],
        "{ [key: string]: (boolean | cdktn.IResolvable) }",
      ],
      [
        "list of list of string",
        ["list", ["list", "string"]],
        "string[][] | cdktn.IResolvable",
      ],
      [
        "list of set of number",
        ["list", ["set", "number"]],
        "number[][] | cdktn.IResolvable",
      ],
      [
        "set of list of string",
        ["set", ["list", "string"]],
        "string[][] | cdktn.IResolvable",
      ],
    ])("%s", (_name, type, expected) => {
      expect(attributeInputType(type)).toBe(expected);
      expect(functionParameterType(type)).toBe(expected);
    });
  });

  // Provider functions deliberately widen nested shapes that the attribute
  // model types more precisely, because jsii cannot express them in a
  // parameter. Both sides are pinned so a change to either is a conscious one.
  describe("types where provider functions degrade to any", () => {
    it.each<[string, AttributeType, string, string]>([
      ["dynamic", "dynamic", "{ [key: string]: any }", "any"],
      [
        "list of map of string",
        ["list", ["map", "string"]],
        "{ [key: string]: string }[] | cdktn.IResolvable",
        "any[] | cdktn.IResolvable",
      ],
      [
        "list of dynamic",
        ["list", "dynamic"],
        "{ [key: string]: any }[] | cdktn.IResolvable",
        "any[] | cdktn.IResolvable",
      ],
      [
        "map of list of string",
        ["map", ["list", "string"]],
        "{ [key: string]: string[] } | cdktn.IResolvable",
        "any",
      ],
      [
        "map of map of string",
        ["map", ["map", "string"]],
        "{ [key: string]: { [key: string]: string } } | cdktn.IResolvable",
        "any",
      ],
    ])("%s", (_name, type, attribute, fn) => {
      expect(attributeInputType(type)).toBe(attribute);
      expect(functionParameterType(type)).toBe(fn);
    });
  });

  // Known gap: the attribute model appends `[]` to an element type that is
  // itself a union, so the result binds as `A | B[] | C` instead of
  // `Array<A | B> | C`. The provider-function mapping avoids it by widening to
  // `any[] | cdktn.IResolvable`.
  it("documents the unparenthesized union for a list of list of bool", () => {
    const type: AttributeType = ["list", ["list", "bool"]];

    expect(attributeInputType(type)).toBe(
      "Array<boolean | cdktn.IResolvable> | cdktn.IResolvable[] | cdktn.IResolvable",
    );
    expect(functionParameterType(type)).toBe("any[] | cdktn.IResolvable");
  });
});
