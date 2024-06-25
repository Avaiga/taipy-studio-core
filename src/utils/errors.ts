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
  commands,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  l10n,
  languages,
  Range,
  SymbolKind,
  TextDocument,
  Uri,
  workspace,
} from "vscode";
import { ErrorObject } from "ajv";

import { getOriginalUri } from "../providers/PerpectiveContentProvider";
import { getArrayFromText, getPythonSuffix, getSymbol, getUnsuffixedName } from "./symbols";
import { DataNode, PROP_SEQUENCES, PROP_TASKS, Scenario, Sequence, Task } from "../../shared/names";
import { getPythonReferences } from "../schema/validation";
import { getMainPythonUri, MAIN_PYTHON_MODULE } from "./pythonSymbols";
import { getLog } from "./logging";
import { getDescendantProperties } from "../../shared/nodeTypes";

const diagnoticsCollection = languages.createDiagnosticCollection("taipy-config-symbol");

const linkNodeTypes = [DataNode, Task, Sequence];

export const reportInconsistencies = async (
  doc: TextDocument,
  symbols: Array<DocumentSymbol>,
  schemaErrors: ErrorObject[] | null
) => {
  const nodeIds = new Set<string>();
  const diagnostics = [] as Diagnostic[];
  if (Array.isArray(symbols)) {
    // Check the existence of the linked elements
    symbols.forEach((symbol) => {
      getDescendantProperties(symbol.name)
        .filter((p) => p)
        .forEach((desc) => {
          Object.entries(desc).forEach(([prop, childType]) =>
            symbol.children.forEach((s) => {
              const linksSymbol = s.children.find((ss) => ss.name === prop);
              if (!linksSymbol) {
                return;
              }
              const startOffset = doc.offsetAt(linksSymbol.range.start);
              const value = doc.getText(linksSymbol.range);
              value &&
                getArrayFromText(value).forEach((name: string) => {
                  const childName = getUnsuffixedName(name.trim());
                  nodeIds.add(`${childType}.${childName}`);
                  const sType = getSymbol(symbols, childType);
                  if (sType && sType.children.find((s) => s.name === childName)) {
                    // all good
                    return;
                  }
                  const startPos = doc.positionAt(startOffset + value.indexOf(name));
                  diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: new Range(startPos, startPos.with({ character: startPos.character + name.length })),
                    message: l10n.t("Element '{0}.{1}' does not exist.", childType, name),
                    source: "Consistency checker",
                  });
                });
            })
          );
        });
        if (symbol.name === Scenario) {
          symbol.children.forEach(scenarioSymbol => {
            const tasksSymbol = getSymbol(scenarioSymbol.children, PROP_TASKS);
            if (!tasksSymbol) {return;}
            const value = doc.getText(tasksSymbol.range);
            const tasks = getArrayFromText(value).map(getUnsuffixedName);
            getSymbol(scenarioSymbol.children, PROP_SEQUENCES)?.children.forEach(seqSymbol => {
              const startOffset = doc.offsetAt(seqSymbol.range.start);
              const seqText = doc.getText(seqSymbol.range);
              seqText && getArrayFromText(seqText).forEach(t => {
                if (!tasks.includes(getUnsuffixedName(t))) {
                  const startPos = doc.positionAt(startOffset + seqText.indexOf(t));
                  diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: new Range(startPos, startPos.translate(undefined, t.length)),
                    message: l10n.t("Element '{0}.{1}' does not exist in {2}.{3}.{4}.", Task, getUnsuffixedName(t), Scenario, scenarioSymbol.name, PROP_TASKS),
                    source: "Consistency checker",
                  });

                }
              });
            });
          });
        }
    });
    // Check the use of the elements
    symbols
      .filter((s) => linkNodeTypes.includes(s.name))
      .forEach((typeSymbol) =>
        typeSymbol.children
          .filter(
            (nameSymbol) => "default" !== nameSymbol.name && !nodeIds.has(`${typeSymbol.name}.${nameSymbol.name}`)
          )
          .forEach((nameSymbol) => {
            const range = nameSymbol.range.isSingleLine
              ? nameSymbol.range
              : nameSymbol.range.with(
                  nameSymbol.range.start,
                  nameSymbol.range.start.translate(0, typeSymbol.name.length + nameSymbol.name.length + 50)
                );
            diagnostics.push({
              severity: DiagnosticSeverity.Information,
              range: range,
              message: l10n.t("No reference to element '{0}.{1}'.", typeSymbol.name, nameSymbol.name),
              source: "Consistency checker",
            });
          })
      );
  }
  // check python function or class references
  const pythonReferences = await getPythonReferences();
  const pythonSymbol2TomlSymbols = {} as Record<
    string,
    { uri?: Uri; symbols: Array<DocumentSymbol>; isFunction: boolean }
  >;
  symbols
    ?.filter((typeSymbol) => !!pythonReferences[typeSymbol.name])
    .forEach((typeSymbol) =>
      typeSymbol.children.forEach((nameSymbol) =>
        nameSymbol.children
          .filter((propSymbol) => pythonReferences[typeSymbol.name][propSymbol.name] !== undefined)
          .forEach((propSymbol) => {
            const pythonSymbol = getUnsuffixedName(doc.getText(propSymbol.range).slice(1, -1));
            if (pythonSymbol) {
              const parts = pythonSymbol.split(".");
              if (parts.length < 2) {
                diagnostics.push({
                  severity: DiagnosticSeverity.Error,
                  range: propSymbol.range,
                  message: l10n.t(
                    "Python reference should include a module '{0}.{1}.{2}'.",
                    typeSymbol.name,
                    nameSymbol.name,
                    propSymbol.name
                  ),
                  source: "Python reference checker",
                });
              } else {
                pythonSymbol2TomlSymbols[pythonSymbol] = pythonSymbol2TomlSymbols[pythonSymbol] || {
                  symbols: [],
                  isFunction: !!pythonReferences[typeSymbol.name][propSymbol.name],
                };
                pythonSymbol2TomlSymbols[pythonSymbol].symbols.push(propSymbol);
              }
            }
          })
      )
    );
  const pythonSymbols = Object.keys(pythonSymbol2TomlSymbols);
  const pythonUris = [] as Uri[];
  if (!workspace.workspaceFolders?.length) {
    getLog().warn(l10n.t("No symbol detection as we are not in the context of a workspace."));
  }
  if (pythonSymbols.length && workspace.workspaceFolders?.length) {
    const mainUri = await getMainPythonUri();
    // check module availability
    for (const ps of pythonSymbols) {
      const parts = ps.split(".");
      parts.pop();
      const uris =
        parts[0] === MAIN_PYTHON_MODULE ? [mainUri] : await workspace.findFiles(`${parts.join("/")}.py`, null, 1);
      if (!uris.length) {
        pythonSymbol2TomlSymbols[ps].symbols.forEach((propSymbol) =>
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: propSymbol.range,
            message: l10n.t(
              "Cannot find file for Python {0}: '{1}'.",
              getPythonSuffix(pythonSymbol2TomlSymbols[ps].isFunction),
              ps
            ),
            source: "Python reference checker",
          })
        );
        pythonSymbol2TomlSymbols[ps].uri = null;
      } else {
        pythonSymbol2TomlSymbols[ps].uri = uris[0];
        pythonUris.push(uris[0]);
      }
    }
    // read python symbols for selected uris
    const symbolsByUri = await Promise.all(
      pythonUris.map(
        (uri) =>
          new Promise<{ uri: Uri; symbols: DocumentSymbol[] }>((resolve, reject) => {
            commands
              .executeCommand("vscode.executeDocumentSymbolProvider", uri)
              .then((symbols: DocumentSymbol[]) => resolve({ uri, symbols }), reject);
          })
      )
    );
    // check availability of python symbols
    for (const ps of pythonSymbols) {
      const parts = ps.split(".");
      const fn = parts.at(-1);
      let found = pythonSymbol2TomlSymbols[ps].uri === null;
      if (!found) {
        const symbols = symbolsByUri.find(({ uri }) => uri.toString() === pythonSymbol2TomlSymbols[ps].uri.toString());
        found =
          Array.isArray(symbols?.symbols) &&
          symbols.symbols.some(
            (pySymbol) =>
              pySymbol.kind === (pythonSymbol2TomlSymbols[ps].isFunction ? SymbolKind.Function : SymbolKind.Class) &&
              pySymbol.name === fn
          );
      }
      if (!found) {
        pythonSymbol2TomlSymbols[ps].symbols.forEach((propSymbol) =>
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: propSymbol.range,
            message: l10n.t(
              "Cannot find Python {0}: '{1}'.",
              getPythonSuffix(pythonSymbol2TomlSymbols[ps].isFunction),
              ps
            ),
            source: "python reference checker",
            code: {
              target: pythonSymbol2TomlSymbols[ps].uri.with({
                query: `taipy-config=${getPythonSuffix(pythonSymbol2TomlSymbols[ps].isFunction)}&name=${ps}`,
              }),
              value: workspace.asRelativePath(pythonSymbol2TomlSymbols[ps].uri),
            },
          } as Diagnostic)
        );
      }
    }
  }
  // schema validation
  Array.isArray(schemaErrors) &&
    schemaErrors.forEach((err) => {
      const paths = err.instancePath.split("/").filter((p) => p);
      const symbol = getSymbol(symbols, ...paths);
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: symbol.range,
        message: `${paths.join(".")} ${err.message}${err.keyword === "enum" ? `: ${err.params.allowedValues}` : ""}.`,
        source: "Schema validation",
      });
    });
  if (diagnostics.length) {
    diagnoticsCollection.set(getOriginalUri(doc.uri), diagnostics);
  }
};

export const cleanDocumentDiagnostics = (uri: Uri) => diagnoticsCollection.delete(getOriginalUri(uri));
