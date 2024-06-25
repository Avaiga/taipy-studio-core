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

import { DocumentSymbol, SymbolKind, TextDocument, workspace } from "vscode";

import { DisplayModel, Link, LinkName, Nodes, Positions, Sequences } from "../../shared/diagram";
import { DataNode, Scenario, Task, PROP_INPUTS, PROP_OUTPUTS, PROP_TASKS, PROP_DATANODES, PROP_SEQUENCES, Sequence } from "../../shared/names";
import { getDescendantProperties } from "../../shared/nodeTypes";
import { TAIPY_STUDIO_SETTINGS_NAME } from "./constants";

export const getDescendantPropertiesForType = (parentType: string, childType: string) =>
  getDescendantProperties(parentType)
    .filter((p) => p)
    .map(
      (desc) =>
        Object.entries(desc).reduce((pv, [p, t]) => {
          t === childType && pv.push(p);
          return pv;
        }),
      []
    )
    .flat()
    .filter((p) => p);

const dropByTypes: Record<string, string[]> = {
  [DataNode]: [PROP_INPUTS, PROP_OUTPUTS, PROP_DATANODES],
  [Task]: [PROP_TASKS],
};
export const getPropertyToDropType = (nodeType: string) => dropByTypes[nodeType] || [];

const parentTypes: Record<string, string[]> = {
  [DataNode]: [Task, Scenario],
  [Task]: [Scenario, Sequence],
};
export const getParentTypes = (nodeType: string) => parentTypes[nodeType] || [];

export const getSymbol = (symbols: DocumentSymbol[], ...names: string[]): DocumentSymbol => {
  if (!symbols) {
    return undefined;
  }
  if (!names || names.length === 0) {
    return symbols[0];
  }
  return names.reduce((o, n) => o?.children?.find((s) => s.name === n), { children: symbols } as DocumentSymbol);
};

const supportedNodeTypes = {
  [DataNode.toLowerCase()]: true,
  [Task.toLowerCase()]: true,
  [Scenario.toLowerCase()]: true,
};
const ignoredNodeNames = {
  default: true,
};

export const getNodeFromSymbol = (doc: TextDocument, symbol: DocumentSymbol) => {
  const node = {};
  symbol &&
    symbol.children.forEach(
      (s) => (node[s.name] = s.kind === SymbolKind.Array ? getSymbolArrayValue(doc, s) : s.kind === SymbolKind.Object ? getNodeFromSymbol(doc, s) : getSymbolValue(doc, s))
    );
  return node;
};

const EXTRACT_STRINGS_RE = /['"]\s*,\s*["']/s;
const EXTRACT_ARRAY_INNER_CONTENT = /^\s*\[\s*['"](.*)['"]\s*,?\s*\]\s*$/s;

export const getArrayFromText = (text: string) => {
  if (text.trim()) {
    const res = EXTRACT_ARRAY_INNER_CONTENT.exec(text);
    if (res?.length === 2) {
      return res[1].split(EXTRACT_STRINGS_RE).filter((v) => v);
    }
  }
  return [];
};

export const getSymbolArrayValue = (doc: TextDocument, symbol: DocumentSymbol, prop?: string) =>
  (getSymbolValue(doc, symbol, prop) as string[]) || [];

export const getSymbolValue = (doc: TextDocument, symbol: DocumentSymbol, prop?: string) => {
  const propSymbol = prop ? symbol?.children.find((s) => s.name === prop) : symbol;
  if (propSymbol) {
    if (propSymbol.kind === SymbolKind.Array) {
      return getArrayFromText(doc.getText(propSymbol.range));
    } else if (propSymbol.kind === SymbolKind.String) {
      return doc.getText(propSymbol.range).trim().slice(1, -1);
    } else {
      return doc.getText(propSymbol.range);
    }
  }
  return undefined;
};

export const toDisplayModel = (doc: TextDocument, symbols: DocumentSymbol[], positions?: Positions): DisplayModel => {
  const nodes = {} as Nodes;
  const links = [] as Link[];
  const sequences = {} as Sequences;
  symbols.forEach((typeSymbol) => {
    if (!supportedNodeTypes[typeSymbol.name.toLowerCase()]) {
      return;
    }
    nodes[typeSymbol.name] = {};
    const [inDesc, outDesc] = getDescendantProperties(typeSymbol.name);
    typeSymbol.children.forEach((nameSymbol) => {
      if (ignoredNodeNames[nameSymbol.name.toLowerCase()]) {
        return;
      }
      nodes[typeSymbol.name][nameSymbol.name] = {};
      const nodeId = `${typeSymbol.name}.${nameSymbol.name}`;
      positions &&
        positions[nodeId] &&
        positions[nodeId].length &&
        (nodes[typeSymbol.name][nameSymbol.name].position = positions[nodeId][0]);
      outDesc &&
        Object.entries(outDesc).forEach(([outputProp, childType]) =>
          getSymbolArrayValue(doc, nameSymbol, outputProp).forEach((childName: string) =>
            links.push(
              getLink(
                [typeSymbol.name, nameSymbol.name, childType, getUnsuffixedName(childName)] as LinkName,
                positions
              )
            )
          )
        );
      inDesc &&
        Object.entries(inDesc).forEach(([inputProp, childType]) =>
          getSymbolArrayValue(doc, nameSymbol, inputProp).forEach((childName: string) =>
            links.push(
              getLink(
                [childType, getUnsuffixedName(childName), typeSymbol.name, nameSymbol.name] as LinkName,
                positions
              )
            )
          )
        );
      nameSymbol.children.filter(childSymbol => childSymbol.name === PROP_SEQUENCES).forEach(sequencesSymbol => {
        sequences[nameSymbol.name] = {};
        sequencesSymbol.children.forEach(seqSymbol => sequences[nameSymbol.name][seqSymbol.name] = getSymbolArrayValue(doc, seqSymbol).map(getUnsuffixedName) );
      });
    });
  });
  return { nodes, links, sequences };
};

const getLink = (linkName: LinkName, positions?: Positions) => {
  const linkId = ["LINK", ...linkName].join(".");
  return [linkName, { positions: positions && positions[linkId] ? positions[linkId] : [] }] as Link;
};

const defaultContents: Record<string, Record<string, string | string[]>> = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  [DataNode]: { storage_type: "", scope: "" },
  [Task]: { [PROP_INPUTS]: [], [PROP_OUTPUTS]: [], function: "", skippable: "" },
  [Scenario]: { [PROP_DATANODES]: [], [PROP_TASKS]: [] },
};
export const getDefaultContent = (nodeType: string, nodeName: string) => ({
  [nodeType]: { [nodeName]: defaultContents[nodeType] || {} },
});

export const getUnsuffixedName = (name: string) => {
  const p = name.lastIndexOf(":");
  if (p === -1) {
    return name;
  }
  return name.substring(0, p);
};

export const getSectionName = (name: string, withSection?: boolean, sectionName = "SECTION") => {
  if (withSection === undefined) {
    withSection = workspace.getConfiguration(TAIPY_STUDIO_SETTINGS_NAME).get("editor.type.suffix.enabled", true);
  }
  name = getUnsuffixedName(name);
  return withSection ? name + ":" + sectionName : name;
};

export const getPythonSuffix = (isFunction: boolean) => (isFunction ? "function" : "class");

export const extractModule = (modSmb: string) => {
  if (modSmb) {
    const p = modSmb.lastIndexOf(".");
    if (p > -1) {
      return modSmb.substring(0, p);
    }
  }
  return "";
};
