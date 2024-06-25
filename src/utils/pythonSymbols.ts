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

import { commands, DocumentSymbol, l10n, SymbolKind, Uri, window, workspace } from "vscode";
import {
  TAIPY_STUDIO_SETTINGS_CONFIG_NAME,
  TAIPY_STUDIO_SETTINGS_EXCLUDE_GLOB_PATTERN,
  TAIPY_STUDIO_SETTINGS_MAIN_PYTHON,
} from "./constants";
import { getLog } from "./logging";

export const getMainPythonUri = async () => {
  const workspaceConfig = workspace.getConfiguration(
    TAIPY_STUDIO_SETTINGS_CONFIG_NAME,
    workspace.workspaceFolders && workspace.workspaceFolders[0]
  );
  const mainFile = workspaceConfig.get<string>(TAIPY_STUDIO_SETTINGS_MAIN_PYTHON);
  const mainUris = await workspace.findFiles(mainFile, null, 1);
  let mainUri = mainUris.length ? mainUris[0] : undefined;
  if (!mainUri) {
    const pyFiles = await workspace.findFiles("*.py", null, 1);
    mainUri = pyFiles.length ? pyFiles[0] : undefined;
    if (mainUri) {
      workspaceConfig.update(TAIPY_STUDIO_SETTINGS_MAIN_PYTHON, workspace.asRelativePath(mainUri));
      window.showInformationMessage(
        l10n.t("Main module file has been set up as {0} in Workspace settings", workspace.asRelativePath(mainUri))
      );
      getLog().info(
        l10n.t("Main module file has been set up as {0} in Workspace settings", workspace.asRelativePath(mainUri))
      );
    } else {
      getLog().warn(l10n.t("No symbol detection as there is no Python file in workspace."));
    }
  }
  return mainUri || null;
};

export const getCreateFunctionOrClassLabel = (isFunction: boolean) =>
  isFunction ? l10n.t("Create a new function") : l10n.t("Create a new class");

export const MAIN_PYTHON_MODULE = "__main__";

export const getModulesAndSymbols = async (
  isFunction: boolean
): Promise<[string[], Record<string, string>, string | undefined]> => {
  const workspaceConfig = workspace.getConfiguration(
    TAIPY_STUDIO_SETTINGS_CONFIG_NAME,
    workspace.workspaceFolders && workspace.workspaceFolders[0]
  );
  const excludePattern = workspaceConfig.get<string>(TAIPY_STUDIO_SETTINGS_EXCLUDE_GLOB_PATTERN);
  const pythonUris = await workspace.findFiles("**/*.py", excludePattern ? excludePattern : null);
  const mainUri = await getMainPythonUri();
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
  const symbolsWithModule = [] as string[];
  let mainModule: string = undefined;
  const modulesByUri = pythonUris.reduce((pv, uri) => {
    const uriStr = uri.path;
    const paths = workspace.asRelativePath(uri).split("/");
    const file = paths.at(-1);
    paths.pop();
    const fileMod = `${file.split(".", 2)[0]}`;
    const module = paths.length ? `${paths.join(".")}.${fileMod}` : fileMod;
    if (uriStr === mainUri?.path) {
      pv[uriStr] = MAIN_PYTHON_MODULE;
      mainModule = module;
    } else {
      pv[uriStr] = module;
    }
    return pv;
  }, {} as Record<string, string>);
  symbolsByUri.forEach((su) => {
    Array.isArray(su.symbols) &&
      su.symbols.forEach((symbol) => {
        if ((isFunction && symbol.kind === SymbolKind.Function) || (!isFunction && symbol.kind === SymbolKind.Class)) {
          const mod = modulesByUri[su.uri.path];
          symbolsWithModule.push(`${mod}.${symbol.name}`);
          if (mod === MAIN_PYTHON_MODULE && mainModule) {
            symbolsWithModule.push(`${mainModule}.${symbol.name}`);            
          }
        }
      });
  });
  return [symbolsWithModule, modulesByUri, mainModule];
};

const IDENTIFIER_RE = /^[A-Za-z]\w*$/;
const isValidPythonIdentifier = (value: string) => !!value && IDENTIFIER_RE.test(value);
export const checkPythonIdentifierValidity = (value: string) =>
  isValidPythonIdentifier(value) ? null : l10n.t("Not a valid Python identifier.");

export const getNodeNameValidationFunction = (typeSymbol?: DocumentSymbol, nodeName?: string) => {
  return (value: string) => {
    if (!isValidPythonIdentifier(value) || value.toLowerCase() === "default") {
      return l10n.t(
        "Element {0} identifier should be a valid Python identifier and not 'default': '{1}'",
        typeSymbol?.name,
        value
      );
    }
    if (value !== nodeName && typeSymbol?.children.some((s) => s.name === value)) {
      return l10n.t("Another {0} element has the identifier {1}", typeSymbol?.name, value);
    }
    return undefined as string;
  };
};
