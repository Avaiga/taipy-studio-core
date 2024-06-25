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

import {
  CancellationToken,
  CompletionContext,
  CompletionItem,
  CompletionItemProvider,
  CompletionTriggerKind,
  l10n,
  Position,
  Range,
  SnippetString,
  TextDocument,
  TextEdit,
  workspace,
} from "vscode";

import { Core, DataNode, Job, Scenario, Taipy, Task } from "../../shared/names";
import { Context } from "../context";
import {
  calculatePythonSymbols,
  getEnum,
  getEnumProps,
  getProperties,
  getPropertyType,
  getPropertyTypes,
  isClass,
  isFunction,
  PropType,
} from "../schema/validation";
import { TAIPY_STUDIO_SETTINGS_NAME } from "../utils/constants";
import { getPythonSuffix, getSectionName, getSymbol, getSymbolArrayValue, getUnsuffixedName } from "../utils/symbols";
import { getOriginalUri } from "./PerpectiveContentProvider";
import { getCreateFunctionOrClassLabel, getModulesAndSymbols, MAIN_PYTHON_MODULE } from "../utils/pythonSymbols";
import { getDescendantProperties } from "../../shared/nodeTypes";

const nodeTypes = [DataNode, Task, Scenario];
export class ConfigCompletionItemProvider implements CompletionItemProvider<CompletionItem> {
  static register(taipyContext: Context) {
    return new ConfigCompletionItemProvider(taipyContext);
  }

  private constructor(private readonly taipyContext: Context) {}

  async provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: CompletionContext
  ) {
    if (context.triggerKind !== CompletionTriggerKind.Invoke) {
      return [];
    }
    const lineStart = document.getText(new Range(position.with({ character: 0 }), position)).trimEnd();
    const lineText = document.lineAt(position.line).text;

    if (
      (position.character === 0 || !lineText.trim()) &&
      position.line &&
      !document.lineAt(position.line - 1).isEmptyOrWhitespace
    ) {
      // propose new property to current entity
      const symbols = this.taipyContext.getSymbols(getOriginalUri(document.uri).toString());
      // find 2nd level symbol (name) holding last line
      const searchPos = position.translate(-1).with(undefined, 0);
      const typeSymbol = symbols.find((s) => s.range.contains(searchPos));
      const nameSymbol = typeSymbol?.children.find((s) => s.range.contains(searchPos));
      const currentProps = nameSymbol?.children.map((s) => s.name);
      if (currentProps) {
        const possibleProps = await getProperties(typeSymbol.name);
        const types = await getPropertyTypes(typeSymbol.name);
        const proposedProps = possibleProps.filter((p) => types[p] !== PropType.object && !currentProps.includes(p));
        if (proposedProps.length) {
          const enumProps = await getEnumProps();
          return proposedProps.map((p) => {
            const isArray = types[p] === PropType.array;
            const enums = enumProps.includes(p) && getEnum(p);
            const ci = new CompletionItem(p);
            const si = new SnippetString(p + (isArray ? " = [" : ' = "'));
            enums ? si.appendChoice(enums) : si.appendTabstop();
            isArray ? si.appendText("]\n") : si.appendText('"\n');
            ci.insertText = si;
            return ci;
          });
        }
      }
    }

    if (!lineStart || lineStart.trimStart() === "[") {
      // propose new entity
      const symbols = this.taipyContext.getSymbols(getOriginalUri(document.uri).toString());
      const props = getSymbol(symbols, Taipy) ? [] : [Taipy];
      getSymbol(symbols, Core) || props.push(Core);
      getSymbol(symbols, Job) || props.push(Job);
      props.push(...nodeTypes);
      return props.map((nodeType) => {
        const ci = new CompletionItem(nodeType);
        ci.insertText = nodeTypes.includes(nodeType)
          ? lineStart
            ? new SnippetString(nodeType + ".").appendPlaceholder("element identifier")
            : new SnippetString("[" + nodeType + ".").appendPlaceholder("element identifier").appendText("]\n")
          : lineStart
          ? new SnippetString(nodeType)
          : new SnippetString(`[${nodeType}]`);
        return ci;
      });
    }
    const lineSplit = lineStart.split(/\s+|=/);
    let found = false;
    const symbols = this.taipyContext.getSymbols(getOriginalUri(document.uri).toString());
    for (const typeSymbol of symbols) {
      const linkPropTypes: Array<[string, string]> = getDescendantProperties(typeSymbol.name)
        .filter((p) => p)
        .reduce((pv, cv) => {
          Object.entries(cv)
            .filter((a) => lineSplit.includes(a[0]))
            .forEach((p) => pv.push(p));
          return pv;
        }, []);
      for (const [linkProp, childType] of linkPropTypes) {
        const childTypeSymbol = childType && getSymbol(symbols, childType);
        if (!childTypeSymbol) {
          return;
        }
        for (const nameSymbol of typeSymbol.children) {
          for (const propSymbol of nameSymbol.children.filter((s) => s.name === linkProp)) {
            if (propSymbol.range.contains(position)) {
              const links = [
                "default",
                ...getSymbolArrayValue(document, propSymbol).map((name) => getUnsuffixedName(name).toLowerCase()),
              ];
              const addTypeSuffix = workspace
                .getConfiguration(TAIPY_STUDIO_SETTINGS_NAME)
                .get("editor.type.suffix.enabled", true);
              return childTypeSymbol.children
                .map((s) => s.name)
                .filter((nodeName) => !links.includes(nodeName.toLowerCase()))
                .map((nodeName) => getCompletionItemInArray(nodeName, lineText, position, addTypeSuffix));
            }
          }
        }
      }
    }
    if (!found) {
      const enumProps = await getEnumProps();
      const enumProp = enumProps.find((l) => lineSplit.includes(l));
      if (enumProp) {
        return (getEnum(enumProp) || []).map((v) => getCompletionItemInString(v, lineText, position));
      } else {
        await calculatePythonSymbols();
        if (lineSplit.some((l) => isFunction(l))) {
          return getPythonSymbols(true, lineText, position);
        } else if (lineSplit.some((l) => isClass(l))) {
          return getPythonSymbols(false, lineText, position);
        }
      }
    }
    return [];
  }
}

const getPythonSymbols = async (isFunction: boolean, lineText: string, position: Position) => {
  // get python symbols in repository
  const [symbolsWithModule, modulesByUri, mainModule] = await getModulesAndSymbols(isFunction);
  const modules = Object.values(modulesByUri);
  if (mainModule) {
    const mainIdx = modules.indexOf(MAIN_PYTHON_MODULE);
    mainIdx > -1 && modules.splice(mainIdx, 0, mainModule);
  }
  const cis = symbolsWithModule.map((v) =>
    getCompletionItemInString(v, lineText, position, undefined, getPythonSuffix(isFunction))
  );
  modules.push(l10n.t("New module name"));
  cis.push(
    getCompletionItemInString(
      getCreateFunctionOrClassLabel(isFunction),
      lineText,
      position,
      [modules.length === 1 ? modules[0] : modules, isFunction ? l10n.t("function name") : l10n.t("class name")],
      getPythonSuffix(isFunction)
    )
  );
  return cis;
};

const listRe = /(\w+)?\s*(=)?\s*(\[)?\s*(("[-\:\w]+"(\s*,\s*)?)*)\s*(.*)/; // inputs = ["DATA_NODE-1", "DATA_NODE-2", ]: gr1 inputs | gr2 = | gr3 [ | gr4 "DATA_NODE-1", "DATA_NODE-2", | gr5 "DATA_NODE-2", | gr6 , | gr7 ]
const getCompletionItemInArray = (value: string, line: string, position: Position, addTypeSuffix: boolean) => {
  const ci = new CompletionItem(value);
  value = getSectionName(value, addTypeSuffix);
  const matches = line.match(listRe);
  const matchPos = getPosFromMatches(matches, line);
  const matchIdx = matchPos.findIndex(
    (pos, idx) => position.character >= pos && position.character <= pos + (matches[idx] ? matches[idx].length : -1)
  );
  if (matchIdx === 7) {
    // replace last bit with choice
    let startPos = matchPos[7];
    let startVal = "";
    let quotePos = matches[7].substring(0, position.character).lastIndexOf('"');
    if (quotePos > -1) {
      startPos += quotePos;
    } else {
      startVal = '"';
    }
    let endPos = matchPos[7];
    let endVal = "";
    quotePos = matches[7].substring(position.character).indexOf('"');
    const rsqbPos = matches[7].substring(position.character).indexOf("]");
    if (quotePos > -1 && quotePos < rsqbPos) {
      endPos += quotePos;
    } else {
      endVal = '"';
      if (rsqbPos > -1) {
        endPos += rsqbPos;
      } else {
        endPos += matches[7].length;
        endVal += "]";
      }
    }
    ci.additionalTextEdits = [
      TextEdit.replace(
        new Range(position.with(undefined, startPos), position.with(undefined, endPos)),
        startVal + value + endVal
      ),
    ];
    ci.insertText = "";
  } else {
    // insert after the last comma
    let idx = matchIdx || matches.length - 2;
    for (; idx > 0; idx--) {
      if (matches[idx]) {
        break;
      }
    }
    let startVal = "";
    if (matches[6] || !matches[4]) {
      if (matches[6] && !matches[6].endsWith(" ")) {
        startVal = " ";
      }
      startVal += '"';
    } else {
      startVal = ', "';
    }
    ci.additionalTextEdits = [
      TextEdit.insert(position.with(undefined, matchPos[idx] + matches[idx].length), startVal + value + '"'),
    ];
    ci.insertText = "";
  }
  return ci;
};

const stringRe = /(\w+)?\s*(=)?\s*(")?(\w*)(")?/; // storage_type = "toto": gr1 storage_type | gr2 = | gr3 " | gr4 toto | gr5 "
const getCompletionItemInString = (
  value: string,
  line: string,
  position: Position,
  placeHolders?: [string[] | string, string],
  suffix?: string
) => {
  const ci = new CompletionItem(value);
  const matches = line.match(listRe);
  const matchPos = getPosFromMatches(matches, line);
  let val = "";
  let startPos = 0;
  let endPos = line.length - 1;
  const si = new SnippetString();
  suffix = suffix ? `:${suffix}` : "";
  if (!matches[2]) {
    startPos = matchPos[1] + matches[1].length;
    val = ` = "${value}${suffix}"`;
    si.appendText(' = "');
    appendPlaceHolders(si, placeHolders);
    si.appendText(`${suffix}"`);
  } else {
    if (!matches[3]) {
      startPos = matchPos[2] + matches[2].length;
      val = ` "${value}${suffix}"`;
      si.appendText(' "');
      appendPlaceHolders(si, placeHolders);
      si.appendText(`${suffix}"`);
    } else {
      startPos = matchPos[3] + matches[3].length;
      if (!matches[5]) {
        val = `${value}${suffix}"`;
        appendPlaceHolders(si, placeHolders);
        si.appendText(`${suffix}"`);
      } else {
        val = `${value}${suffix}`;
        appendPlaceHolders(si, placeHolders);
        suffix && si.appendText(suffix);
        endPos = matchPos[5];
      }
    }
  }
  const rng = new Range(position.with(undefined, startPos), position.with(undefined, endPos + 1));
  ci.additionalTextEdits = [TextEdit.replace(rng, placeHolders ? "" : val)];
  ci.insertText = placeHolders ? si : "";
  ci.sortText = placeHolders ? "ZZZ" + value : value;
  return ci;
};

const appendPlaceHolders = (si: SnippetString, placeHolders?: [string[] | string, string]) => {
  Array.isArray(placeHolders) &&
    placeHolders.forEach((ph, idx) => {
      if (idx > 0) {
        si.appendText(".");
      }
      if (Array.isArray(ph)) {
        si.appendChoice(ph);
      } else {
        si.appendPlaceholder(ph);
      }
    });
};

const getPosFromMatches = (matches: string[], line: string) => {
  let lastPos = 0;
  return matches.map((m) => {
    if (m) {
      lastPos = line.indexOf(m, lastPos);
    }
    return lastPos;
  });
};
