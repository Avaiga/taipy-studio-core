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
  commands,
  Event,
  EventEmitter,
  ExtensionContext,
  FileDecoration,
  FileDecorationProvider,
  l10n,
  ProviderResult,
  Uri,
  window,
  workspace,
} from "vscode";
import { TAIPY_STUDIO_SETTINGS_CONFIG_NAME, TAIPY_STUDIO_SETTINGS_MAIN_PYTHON } from "../utils/constants";
import { getLog } from "../utils/logging";

export class MainModuleDecorationProvider implements FileDecorationProvider {
  private _onDidChangeFileDecorations: EventEmitter<Uri | Uri[]> = new EventEmitter<Uri | Uri[]>();
  readonly onDidChangeFileDecorations: Event<Uri | Uri[]>  = this._onDidChangeFileDecorations.event;

  static register(context: ExtensionContext): void {
    context.subscriptions.push(
      window.registerFileDecorationProvider(new MainModuleDecorationProvider(context)),
    );
  }

  private constructor(context: ExtensionContext) {
      // file explorer context command
      context.subscriptions.push(commands.registerCommand("taipy.explorer.file.setMainModule", this.setMainModule, this));
  }

  provideFileDecoration(uri: Uri, token: CancellationToken): ProviderResult<FileDecoration> {
    const workspaceConfig = workspace.getConfiguration(TAIPY_STUDIO_SETTINGS_CONFIG_NAME, workspace.workspaceFolders && workspace.workspaceFolders[0]);
    if (workspaceConfig.get<string>(TAIPY_STUDIO_SETTINGS_MAIN_PYTHON) === workspace.asRelativePath(uri)) {
      return new FileDecoration("T", l10n.t("Taipy Main module"));
    }
    return undefined;
  }

  private setMainModule(fileUri: Uri) {
    const workspaceConfig = workspace.getConfiguration(TAIPY_STUDIO_SETTINGS_CONFIG_NAME, workspace.workspaceFolders && workspace.workspaceFolders[0]);
    const uris = [fileUri];
    const oldPath = workspaceConfig.get<string>(TAIPY_STUDIO_SETTINGS_MAIN_PYTHON);
    if (oldPath && workspace.workspaceFolders?.length) {
      uris.push(Uri.joinPath(workspace.workspaceFolders[0].uri, oldPath));
    }
    workspaceConfig.update(TAIPY_STUDIO_SETTINGS_MAIN_PYTHON, workspace.asRelativePath(fileUri)).then(() => this._onDidChangeFileDecorations.fire(uris));
    getLog().info(l10n.t("Main module file has been set up as {0} in Workspace settings", workspace.asRelativePath(fileUri)));
  }
}


