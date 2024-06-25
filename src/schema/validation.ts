/*
 * Copyright 2024 Avaiga Private Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 */

import { JsonMap } from "@iarna/toml";
import Ajv, { Schema, SchemaObject, ValidateFunction } from "ajv/dist/2020";
import { l10n, Uri, workspace } from "vscode";

import { getFileFromPythonPackages } from "../utils/utils";
import { TAIPY_CORE_SHEMA_PACKAGE, TAIPY_STUDIO_SETTINGS_NAME } from "../utils/constants";
import { getLog } from "../utils/logging";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let validationSchema: Schema;
let schemaResolving = false;
export const getValidationSchema = async () => {
  if (!validationSchema && schemaResolving) {
    // wait for validationSchema (timeout: 10 secs)
    const end = Date.now() + 10000;
    while (!validationSchema && Date.now() < end) {
      await sleep(300);
    }
    if (!validationSchema) {
      getLog().warn(l10n.t("Trying to resolve TOML Schema Validation again."));
    }
  }
  if (!validationSchema) {
    schemaResolving = true;
    if (workspace.getConfiguration(TAIPY_STUDIO_SETTINGS_NAME).get("config.useSchemaFromPackage", true)) {
      try {
        const schemas = await getFileFromPythonPackages("config.schema.json", [TAIPY_CORE_SHEMA_PACKAGE]);
        if (schemas && schemas[TAIPY_CORE_SHEMA_PACKAGE]) {
          const content = await workspace.fs.readFile(Uri.file(schemas[TAIPY_CORE_SHEMA_PACKAGE]));
          validationSchema = JSON.parse(Buffer.from(content).toString("utf8"));
          getLog().info(l10n.t("Using TOML Schema Validation from {0}", schemas[TAIPY_CORE_SHEMA_PACKAGE]));
        }
      } catch (e) {
        getLog().warn(l10n.t("Validation Schema not found in package. {0}", e.message || e));
      }
    }
    if (!validationSchema) {
      try {
        validationSchema = await import("../../schemas/core.config.schema.json");
        getLog().info(l10n.t("Using embedded TOML Schema Validation"));
      } catch {
        validationSchema = await import("../../schemas/config.schema.json");
        getLog().info(l10n.t("Using non fetched embedded TOML Schema Validation"));
      }
    }
  }
  return validationSchema;
};

let validationFunction: ValidateFunction<JsonMap>;
export const getValidationFunction = async () => {
  if (!validationFunction) {
    const schema = await getValidationSchema();
    const ajv = new Ajv({
      strictTypes: false,
      allErrors: true,
      allowUnionTypes: true,
      keywords: ["taipy_function", "taipy_class"],
    });
    validationFunction = await ajv.compile<JsonMap>(schema);
  }
  return validationFunction;
};

const enums = {} as Record<string, string[]>;
export const getEnum = (property: string) => enums[property];

export const getEnumProps = async () => {
  const props = Object.keys(enums);
  if (props.length) {
    return props;
  }
  const schema = (await getValidationSchema()) as SchemaObject;
  Object.values(schema.properties).forEach((v: any) => {
    addPropEnums(v.properties);
    addPropEnums(v.additionalProperties?.properties);
  });
  return Object.keys(enums);
};

const addPropEnums = (properties: any) => {
  properties &&
    Object.entries(properties)
      .filter(([_, p]) => (p as any).enum)
      .forEach(([property, p]) => {
        enums[property] = ((p as any).enum as string[]).filter((v) => v).map((v) => v);
      });
};

export enum PropType {
  string,
  array,
  object,
}

const _properties = {} as Record<string, string[]>;
const _propertyTypes = {} as Record<string, Record<string, PropType>>;
export const getProperties = async (nodeType: string) => {
  if (!Object.keys(_properties).length) {
    const schema = (await getValidationSchema()) as SchemaObject;
    Object.entries(schema.properties || {}).forEach(([k, v]: [string, any]) => {
      _properties[k] = [];
      _propertyTypes[k] = {};
      Object.entries(v.properties || {}).forEach(([key, obj]) => {
        _properties[k].push(key);
        _propertyTypes[k][key] =
          obj["type"] === "array" ? PropType.array : obj["type"] === "object" ? PropType.object : PropType.string;
      });
      Object.entries(v.additionalProperties?.properties || {})
        .filter(([key]) => key && key !== "if" && key !== "then" && key !== "else")
        .forEach(([key, obj]) => {
          _properties[k].push(key);
          _propertyTypes[k][key] = obj["type"] === "array" ? PropType.array : obj["type"] === "object" ? PropType.object : PropType.string;
        });
    });
  }
  return _properties[nodeType] || [];
};
export const getPropertyType = async (nodeType: string, property: string) => {
  if ((await getProperties(nodeType)).length) {
    return _propertyTypes[nodeType][property] || PropType.string;
  }
  return PropType.string;
};
export const getPropertyTypes = async (nodeType: string) => {
  if ((await getProperties(nodeType)).length) {
    return _propertyTypes[nodeType] || {};
  }
  return {};
};

let functions: string[] = undefined;
let classes: string[] = undefined;
export const calculatePythonSymbols = async () => {
  if (functions === undefined) {
    functions = [];
    const schema = (await getValidationSchema()) as SchemaObject;
    Object.values(schema.properties).forEach((v: any) => {
      functions.push(
        ...Object.entries(v.properties)
          .filter(([_, v]) => !!(v as any).taipy_function)
          .map(([k, _]) => k)
      );
      functions.push(
        ...Object.entries(v.additionalProperties?.properties || {})
          .filter(([_, v]) => !!(v as any).taipy_function)
          .map(([k, _]) => k)
      );
    });
  }
  if (classes === undefined) {
    classes = [];
    const schema = (await getValidationSchema()) as SchemaObject;
    Object.values(schema.properties).forEach((v: any) => {
      classes.push(
        ...Object.entries(v.properties)
          .filter(([_, v]) => !!(v as any).taipy_class)
          .map(([k, _]) => k)
      );
      classes.push(
        ...Object.entries(v.additionalProperties?.properties || {})
          .filter(([_, v]) => !!(v as any).taipy_class)
          .map(([k, _]) => k)
      );
    });
  }
};
export const isFunction = (property: string) => functions?.includes(property);
export const isClass = (property: string) => classes?.includes(property);

const pythonReferences = {} as Record<string, Record<string, boolean>>;
export const getPythonReferences = async () => {
  if (!Object.keys(pythonReferences).length) {
    const schema = (await getValidationSchema()) as SchemaObject;
    Object.entries(schema.properties).forEach(([nodeType, node]: [string, any]) => {
      pythonReferences[nodeType] = {};
      Object.entries(node.properties).forEach(([prop, v]) => {
        if (!!(v as any).taipy_function || !!(v as any).taipy_class) {
          pythonReferences[nodeType] = pythonReferences[nodeType] || {};
          pythonReferences[nodeType][prop] = !!(v as any).taipy_function;
        }
      });
      Object.entries(node.additionalProperties?.properties || {}).forEach(([prop, v]) => {
        if (!!(v as any).taipy_function || !!(v as any).taipy_class) {
          pythonReferences[nodeType] = pythonReferences[nodeType] || {};
          pythonReferences[nodeType][prop] = !!(v as any).taipy_function;
        }
      });
    });
  }
  return pythonReferences;
};

const defaultValues = {} as Record<string, Record<string, string>>;
export const getDefaultValues = async (nodeType: string) => {
  if (!Object.keys(defaultValues).length) {
    const schema = (await getValidationSchema()) as SchemaObject;
    Object.entries(schema.properties).forEach(([nodeType, node]: [string, any]) => {
      defaultValues[nodeType] = {};
      Object.entries(node.properties).forEach(([prop, v]) => {
        if ((v as any).default) {
          defaultValues[nodeType] = defaultValues[nodeType] || {};
          defaultValues[nodeType][prop] = (v as any).default;
        }
      });
      Object.entries(node.additionalProperties?.properties || {}).forEach(([prop, v]) => {
        if ((v as any).default) {
          defaultValues[nodeType] = defaultValues[nodeType] || {};
          defaultValues[nodeType][prop] = (v as any).default;
        }
      });
    });
  }
  return defaultValues[nodeType] || {};
};
