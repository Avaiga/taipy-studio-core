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
  EventEmitter,
  l10n,
  Position,
  ProviderResult,
  TextEdit,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  Uri,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";

import { selectConfigFileCmd } from "../utils/commands";
import { Context } from "../context";
import { configFileExt, configFilePattern } from "../utils/utils";
import { TAIPY_CORE_VERSION } from "../utils/constants";

export const FILE_CONTEXT = "File";
class ConfigFileItem extends TreeItem {
  public constructor(
    baseName: string,
    readonly resourceUri: Uri,
    readonly tooltip: string,
    readonly description: string | null = null
  ) {
    super(baseName, TreeItemCollapsibleState.None);
    this.command = {
      command: selectConfigFileCmd,
      title: l10n.t("Select file"),
      arguments: [resourceUri],
    };
    this.contextValue = FILE_CONTEXT;
  }
}

class ConfigFilesProvider implements TreeDataProvider<ConfigFileItem> {
  private _onDidChangeTreeData = new EventEmitter<ConfigFileItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  items: ConfigFileItem[] = [];

  constructor() {}

  getTreeItem(element: ConfigFileItem): TreeItem {
    return element;
  }

  getChildren(element?: ConfigFileItem): Thenable<ConfigFileItem[]> {
    return Promise.resolve(element ? [] : this.items);
  }

  getParent(element: ConfigFileItem): ProviderResult<ConfigFileItem> {
    return undefined;
  }

  treeDataChanged(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}

interface FileDesc {
  uri: Uri;
  label: string;
  path: string;
  dir: string;
}

const DEFAULT_CONFIG_PREFIX = "taipy-config";

const configFileNameValidation = async (value: string) => {
  if (!value) {
    return l10n.t("File name cannot be empty.");
  }
  const fileName = value.endsWith(configFileExt) ? value : `${value}${configFileExt}`;
  if ((await workspace.findFiles(fileName, null, 1))?.length) {
    return l10n.t("File name {0} already exists.", fileName);
  }
  return undefined as string;
};

export class ConfigFilesView {
  private view: TreeView<ConfigFileItem>;
  private dataProvider: ConfigFilesProvider;

  constructor(private readonly context: Context, id: string, lastSelectedUri?: string) {
    this.dataProvider = new ConfigFilesProvider();
    this.view = window.createTreeView(id, {
      treeDataProvider: this.dataProvider,
    });
    this.refresh(lastSelectedUri);

    commands.registerCommand("taipy.config.revealInExplorer", this.revealInExplorer, this);
    commands.registerCommand("taipy.config.file.create", this.createNewConfig, this);
  }

  private revealInExplorer(fileItem: ConfigFileItem) {
    commands.executeCommand("revealInExplorer", fileItem.resourceUri);
  }

  private async createNewConfig() {
    if (!workspace.workspaceFolders?.length) {
      window.showWarningMessage(l10n.t("Cannot create a Config file if you don't have at least one workspace folder."));
      return;
    }
    const rootFiles = await workspace.findFiles(`*${configFileExt}`);
    const baseName = (rootFiles || [])
      .map((uri) => workspace.asRelativePath(uri))
      .filter((filePath) => filePath.split("/").at(-1).startsWith(DEFAULT_CONFIG_PREFIX))
      .sort()
      .reduce((pv, filePath) => {
        const baseName = filePath.split(".")[0];
        const numSuffix = /^(.*)(-\d+)$/.exec(baseName);
        if (numSuffix?.length === 3) {
          return numSuffix[1] + "-" + (parseInt(numSuffix[2].substring(1), 10) + 1);
        }
        if (DEFAULT_CONFIG_PREFIX === baseName && pv === DEFAULT_CONFIG_PREFIX) {
          return `${pv}-1`;
        }
        return pv;
      }, DEFAULT_CONFIG_PREFIX);
    const newName = await window.showInputBox({
      prompt: l10n.t("Enter a new Config file name."),
      title: l10n.t("new Config file"),
      validateInput: configFileNameValidation,
      value: baseName,
    });
    if (newName) {
      const we = new WorkspaceEdit();
      const newUri = Uri.joinPath(
        workspace.workspaceFolders[0].uri,
        newName.endsWith(configFileExt) ? newName : `${newName}${configFileExt}`
      );
      we.createFile(newUri);
      we.set(newUri, [TextEdit.insert(new Position(0, 0), `[CORE]\ncore_version="${TAIPY_CORE_VERSION}"\n`)]);
      const self = this;
      workspace.applyEdit(we).then((applied) => applied && setTimeout(() => self.selectAndReveal(newUri), 500));
    }
  }

  private selectAndReveal(uri: Uri) {
    this.context.selectConfigUri(uri);
    this.select(uri, true);
  }

  select(uri: Uri, force = false) {
    if (!this.view.selection?.length || force) {
      const uriStr = uri.toString();
      const item = this.dataProvider.items.find((item) => item.resourceUri.toString() === uriStr);
      item && this.view.reveal(item, { select: true });
    }
  }

  async refresh(lastSelectedUri?: string): Promise<void> {
    const configItems: ConfigFileItem[] = [];
    const uris: Uri[] = await workspace.findFiles(configFilePattern, "**/node_modules/**");
    const baseDescs: Record<string, Array<FileDesc>> = {};
    uris.forEach((uri) => {
      let path = uri.path;
      let lastSepIndex = path.lastIndexOf("/");
      const baseName = path.substring(lastSepIndex + 1, path.length - configFileExt.length);
      // Drop first workspace folder name
      // TODO: Note that this works properly only when the workspace has
      // a single folder, and that the configuration files are located
      // within these folders.
      const rootFolder: string = workspace.workspaceFolders[0].uri.path;
      if (path.startsWith(rootFolder)) {
        path = path.substring(rootFolder.length);
      }
      lastSepIndex = path.lastIndexOf("/");
      const fileDesc = {
        uri: uri,
        label: baseName,
        path: path,
        dir: lastSepIndex === -1 ? "" : path.substring(0, lastSepIndex),
      };
      if (baseName in baseDescs) {
        baseDescs[baseName].push(fileDesc);
      } else {
        baseDescs[baseName] = [fileDesc];
      }
    });
    Object.keys(baseDescs)
      .sort()
      .forEach((base) => {
        const desc = baseDescs[base];
        if (desc.length > 1) {
          // Find common prefix to all paths for that base
          const dirs = desc.map((d) => d.dir);
          let prefix = dirs[0];
          dirs.slice(1).forEach((d) => {
            while (prefix && d.substring(0, prefix.length) !== prefix) {
              prefix = prefix.substring(0, prefix.length - 1);
              if (!prefix) {
                break;
              }
            }
          });
          const pl = prefix.length;
          desc.forEach((d) => {
            const dir = d.dir.substring(pl);
            configItems.push(new ConfigFileItem(base, d.uri, d.path, dir));
          });
        } else {
          configItems.push(new ConfigFileItem(base, desc[0].uri, desc[0].path));
        }
      });
    this.dataProvider.items = configItems;
    commands.executeCommand("setContext", "taipy.config.numberOfConfigFiles", configItems.length);
    this.dataProvider.treeDataChanged();
    if (lastSelectedUri && this.view.visible) {
      setTimeout(() => {
        const sel = configItems.find((item) => item.resourceUri.toString() === lastSelectedUri);
        if (sel) {
          this.view.reveal(sel, { select: true });
          this.context.selectConfigUri(Uri.parse(lastSelectedUri));
        }
      }, 1);
    }
  }
}
