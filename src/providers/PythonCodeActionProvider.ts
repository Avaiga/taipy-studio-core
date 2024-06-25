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
  CodeAction,
  CodeActionContext,
  CodeActionKind,
  CodeActionProvider,
  ExtensionContext,
  l10n,
  languages,
  Range,
  Selection,
  TextDocument,
  Uri,
  workspace,
  WorkspaceEdit,
} from "vscode";
import { TAIPY_STUDIO_SETTINGS_CONFIG_NAME, TAIPY_STUDIO_SETTINGS_MAIN_PYTHON } from "../utils/constants";
import { MAIN_PYTHON_MODULE } from "../utils/pythonSymbols";
import { getPythonSuffix, getUnsuffixedName } from "../utils/symbols";

export class PythonCodeActionProvider implements CodeActionProvider {
  private static readonly providedCodeActionKinds = [CodeActionKind.QuickFix];

  static register(context: ExtensionContext): void {
    context.subscriptions.push(
      languages.registerCodeActionsProvider({ language: "toml" }, new PythonCodeActionProvider(), {
        providedCodeActionKinds: PythonCodeActionProvider.providedCodeActionKinds,
      })
    );
  }

  provideCodeActions(document: TextDocument, range: Range | Selection, context: CodeActionContext, token: CancellationToken): CodeAction[] {
    const mainFile = workspace.workspaceFolders?.length ? workspace.getConfiguration(TAIPY_STUDIO_SETTINGS_CONFIG_NAME, workspace.workspaceFolders[0]).get<string>(TAIPY_STUDIO_SETTINGS_MAIN_PYTHON) : "main.py";
    return context.diagnostics
      .filter((diagnostic) => {
        const code = diagnostic.code as { target: Uri; value: string };
        return !!code && !!code.value && !!code.target && !!code.target.query && code.target.query.includes("taipy-config=");
      })
      .map((diagnostic) => {
        const code = diagnostic.code as { target: Uri; value: string };
        const isFunction = code.target.query.split("&")[0] === "taipy-config=function";
        const pythonName = getUnsuffixedName(document.getText(diagnostic.range).slice(1, -1));
        const parts = pythonName.split(".");
        const pythonSymbol = parts.at(-1);
        parts.pop(); // ignore symbol name
        const pythonFile = parts.at(-1);
        parts.pop();
        const pythonUri = code.target
          ? code.target
          : Uri.joinPath(workspace.workspaceFolders[0].uri, ...parts, pythonFile === MAIN_PYTHON_MODULE ? mainFile : `${pythonFile}.py`);
        const codeAction = new CodeAction(
          l10n.t("Create Python {0} '{1}' in {2}", getPythonSuffix(isFunction), pythonSymbol, workspace.asRelativePath(pythonUri)),
          CodeActionKind.QuickFix
        );
        codeAction.diagnostics = [diagnostic];
        codeAction.isPreferred = true;
        codeAction.edit = new WorkspaceEdit();
        if (!code.target) {
          if (workspace.workspaceFolders?.length) {
            code.target = pythonUri;
            codeAction.edit.createFile(code.target);
          }
        }
        if (code.target) {
          codeAction.edit.insert(
            code.target,
            document.lineAt(document.lineCount ? document.lineCount - 1 : 0).rangeIncludingLineBreak.end,
            getPythonDecl(pythonSymbol, isFunction)
          );
        }
        return codeAction;
      });
  }
}

const getPythonDecl = (pythonName: string, isFunction: boolean) => (isFunction ? `\n\ndef ${pythonName}():\n\tpass\n` : `\nclass ${pythonName}:\n\tpass\n`);
