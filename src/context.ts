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
  DocumentSymbol,
  ExtensionContext,
  FileType,
  FileWillDeleteEvent,
  FileWillRenameEvent,
  l10n,
  Position,
  Range,
  TextDocument,
  TextDocumentChangeEvent,
  TextEdit,
  TextEditorRevealType,
  TreeItem,
  TreeView,
  Uri,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import { JsonMap } from "@iarna/toml";

import { ConfigFilesView, FILE_CONTEXT } from "./views/ConfigFilesView";
import { revealConfigNodeCmd, selectConfigFileCmd, selectConfigNodeCmd } from "./utils/commands";
import { CONFIG_DETAILS_ID, TAIPY_CORE_VERSION, TAIPY_STUDIO_SETTINGS_NAME } from "./utils/constants";
import { ConfigDetailsView } from "./providers/ConfigDetails";
import { configFileExt, getArrayText, getExtras } from "./utils/utils";
import {
  ConfigItem,
  ConfigNodesProvider,
  DataNodeItem,
  getCreateCommandIdFromType,
  getRefreshCommandIdFromType,
  getTreeViewIdFromType,
  SequenceItem,
  ScenarioItem,
  TaskItem,
  TreeNodeCtor,
} from "./providers/ConfigNodesProvider";
import {
  PerspectiveContentProvider,
  PERSPECTIVE_SCHEME,
  isUriEqual,
  getOriginalUri,
  getPerspectiveUri,
} from "./providers/PerpectiveContentProvider";
import { ConfigEditorProvider } from "./editors/ConfigEditor";
import { cleanDocumentDiagnostics, reportInconsistencies } from "./utils/errors";
import { ValidateFunction } from "ajv/dist/2020";
import { getValidationFunction } from "./schema/validation";
import { getSectionName, getSymbol, getSymbolArrayValue, getSymbolValue, getUnsuffixedName } from "./utils/symbols";
import { PythonCodeActionProvider } from "./providers/PythonCodeActionProvider";
import { PythonLinkProvider } from "./providers/PythonLinkProvider";
import { getLog } from "./utils/logging";
import { MainModuleDecorationProvider } from "./providers/MainModuleDecorationProvider";
import { PROP_SEQUENCES, PROP_TASKS, Scenario } from "../shared/names";

const configNodeKeySort = (a: DocumentSymbol, b: DocumentSymbol) =>
  a === b ? 0 : a.name === "default" ? -1 : b.name === "default" ? 1 : a.name > b.name ? 1 : -1;

interface NodeSelectionCache {
  fileUri?: string;
  lastView?: string;
  [key: string]: string;
}

export class Context {
  static create(vsContext: ExtensionContext): void {
    new Context(vsContext);
  }
  private static readonly cacheName = "taipy.selectedNodes.cache";

  private configFileUri?: Uri;
  private readonly configFilesView: ConfigFilesView;
  private readonly treeProviders: ConfigNodesProvider<ConfigItem>[] = [];
  private readonly treeViews: TreeView<TreeItem>[] = [];
  private readonly configDetailsView: ConfigDetailsView;
  private readonly selectionCache: NodeSelectionCache;
  // original Uri => symbols
  private readonly symbolsByUri: Record<string, Array<DocumentSymbol>> = {};
  // docChanged listeners
  private readonly docChangedListener: Array<[ConfigEditorProvider, (document: TextDocument) => void]> = [];
  // editors
  private readonly configEditorProvider: ConfigEditorProvider;
  // Json Schema Validator
  private validateSchema: ValidateFunction<JsonMap>;

  private constructor(private readonly vsContext: ExtensionContext) {
    this.selectionCache = vsContext.workspaceState.get(Context.cacheName, {} as NodeSelectionCache);
    // Configuration files
    this.configFilesView = new ConfigFilesView(this, "taipy-configs", this.selectionCache.fileUri);
    vsContext.subscriptions.push(
      commands.registerCommand("taipy.config.refresh", this.configFilesView.refresh, this.configFilesView),
      commands.registerCommand(selectConfigFileCmd, this.selectConfigUri, this),
      // global Commands
      commands.registerCommand(selectConfigNodeCmd, this.selectConfigNode, this),
      commands.registerCommand(revealConfigNodeCmd, this.revealConfigNodeInEditors, this),
      commands.registerCommand("taipy.perspective.show", this.showPerspective, this),
      commands.registerCommand("taipy.perspective.showFromDiagram", this.showPerspectiveFromDiagram, this),
      commands.registerCommand("taipy.details.showLink", this.showPropertyLink, this),
      commands.registerCommand("taipy.config.renameNode", this.renameNode, this),
      commands.registerCommand("taipy.scenario.addSequence", this.createSequenceForScenario, this)
    );
    // Main Module Management
    MainModuleDecorationProvider.register(vsContext);
    // Perspective Provider
    vsContext.subscriptions.push(
      workspace.registerTextDocumentContentProvider(PERSPECTIVE_SCHEME, new PerspectiveContentProvider())
    );
    // Create Tree Views
    this.treeViews.push(this.createTreeView(DataNodeItem));
    this.treeViews.push(this.createTreeView(TaskItem));
    this.treeViews.push(this.createTreeView(ScenarioItem));
    // Dispose when finished
    vsContext.subscriptions.push(...this.treeViews);
    // Config editor
    this.configEditorProvider = ConfigEditorProvider.register(vsContext, this);
    // Details
    this.configDetailsView = new ConfigDetailsView(vsContext, this);
    vsContext.subscriptions.push(window.registerWebviewViewProvider(CONFIG_DETAILS_ID, this.configDetailsView));
    // Document change listener
    workspace.onDidChangeTextDocument(this.onDocumentChanged, this, vsContext.subscriptions);
    // Workspace file system watcher
    vsContext.subscriptions.push(workspace.onDidCreateFiles(this.onFilesChanged, this));
    vsContext.subscriptions.push(workspace.onDidRenameFiles(this.onFilesChanged, this));
    vsContext.subscriptions.push(workspace.onDidDeleteFiles(this.onFilesChanged, this));
    vsContext.subscriptions.push(workspace.onWillRenameFiles(this.onFilesWillBeRenamed, this));
    vsContext.subscriptions.push(workspace.onWillDeleteFiles(this.onFilesWillBeDeleted, this));
    vsContext.subscriptions.push(workspace.onDidDeleteFiles(this.onFilesChanged, this));
    // Json schema validator
    getValidationFunction()
      .then((fn) => (this.validateSchema = fn))
      .catch(getLog().warn);
    // Quick fix
    PythonCodeActionProvider.register(vsContext);
    // python links
    PythonLinkProvider.register(vsContext, this);
  }

  private async onDocumentChanged(e: TextDocumentChangeEvent) {
    if (this.symbolsByUri[getOriginalUri(e.document.uri).toString()]) {
      await this.refreshSymbols(e.document);
      this.docChangedListener.forEach(([t, l]) => l.call(t, e.document));
    }
    if (isUriEqual(this.configFileUri, e.document.uri)) {
      this.treeProviders.forEach((p) => p.refresh(this, e.document.uri));
      this.revealConfigNodesInTrees();
    }
  }

  registerDocChangeListener(listener: (document: TextDocument) => void, thisArg: any) {
    this.docChangedListener.push([thisArg, listener]);
  }
  unregisterDocChangeListener(listener: (document: TextDocument) => void, thisArg: any) {
    const idx = this.docChangedListener.findIndex(([t, l]) => t === thisArg && l === listener);
    idx > -1 && this.docChangedListener.splice(idx, 1);
  }

  private createNewElement(nodeType: string) {
    this.configEditorProvider.createNewElement(this.configFileUri, nodeType);
  }

  private createTreeView<T extends ConfigItem>(nodeCtor: TreeNodeCtor<T>) {
    const provider = new ConfigNodesProvider(this, nodeCtor);
    const nodeType = provider.getNodeType();
    commands.registerCommand(
      getRefreshCommandIdFromType(nodeType),
      () => provider.refresh(this, this.configFileUri),
      this
    );
    commands.registerCommand(getCreateCommandIdFromType(nodeType), () => this.createNewElement(nodeType), this);
    this.treeProviders.push(provider);
    const treeView = window.createTreeView(getTreeViewIdFromType(nodeType), {
      treeDataProvider: provider,
      dragAndDropController: provider,
    });
    return treeView;
  }

  private revealConfigNodesInTrees() {
    this.unselectConfigNode();
    this.treeProviders.forEach((p, idx) => {
      if (!this.treeViews[idx].visible) {
        return;
      }
      const nodeType = p.getNodeType();
      const self = this;
      setTimeout(() => {
        const nodeName = this.selectionCache[nodeType];
        const item = p.getItem(nodeName);
        if (item) {
          self.treeViews[idx].reveal(item, { select: true });
          self.selectConfigNode(nodeType, item.label as string, item.getNode(), item.resourceUri, false);
        }
      }, 1);
    });
  }

  private onFilesChanged() {
    this.configFilesView.refresh(this.configFileUri?.toString());
  }

  private onFilesWillBeRenamed(evt: FileWillRenameEvent) {
    evt.files.forEach(({ oldUri, newUri }) =>
      evt.waitUntil(
        workspace.fs.stat(oldUri).then((stat) => {
          if (stat.type === FileType.Directory) {
            evt.waitUntil(this.directoryWillBeHandled(evt, oldUri, newUri, this.fileWillBeRenamed));
          } else {
            this.fileWillBeRenamed(oldUri, newUri);
          }
        })
      )
    );
  }

  private fileWillBeRenamed(oldUri: Uri, newUri: Uri) {
    if (oldUri.path.endsWith(configFileExt) || newUri.path.endsWith(configFileExt)) {
      const wasSelected = this.configFileUri?.toString() === oldUri.toString();
      if (wasSelected) {
        this.configFileUri = newUri;
      }
      if (oldUri.toString() in this.symbolsByUri) {
        this.symbolsByUri[newUri.toString()] = this.symbolsByUri[oldUri.toString()];
      }
      if (wasSelected) {
        this.treeProviders.forEach((p) => p.refresh(this, newUri));
      }
    }
  }

  private directoryWillBeHandled(
    evt: FileWillDeleteEvent | FileWillRenameEvent,
    uri: Uri,
    newUri: Uri | undefined,
    fileHandling: (uri: Uri, newUri?: Uri) => void
  ) {
    return workspace.fs.readDirectory(uri).then(
      (entries) =>
        entries.forEach(([fileName, fileType]) => {
          if (fileType === FileType.Directory) {
            evt.waitUntil(
              this.directoryWillBeHandled(
                evt,
                Uri.joinPath(uri, fileName),
                newUri && Uri.joinPath(newUri, fileName),
                fileHandling
              )
            );
          } else {
            fileHandling.call(this, Uri.joinPath(uri, fileName), newUri && Uri.joinPath(newUri, fileName));
          }
        }),
      console.log
    );
  }

  private onFilesWillBeDeleted(evt: FileWillDeleteEvent) {
    evt.files.forEach((uri) =>
      evt.waitUntil(
        workspace.fs.stat(uri).then((stat) => {
          if (stat.type === FileType.Directory) {
            evt.waitUntil(this.directoryWillBeHandled(evt, uri, undefined, this.fileWillBeDeleted));
          } else {
            this.fileWillBeDeleted(uri);
          }
        })
      )
    );
  }

  private fileWillBeDeleted(uri: Uri) {
    if (uri.path.endsWith(configFileExt)) {
      if (this.configFileUri?.toString() === uri.toString()) {
        this.configFileUri = undefined;
        this.treeProviders.forEach((p) => p.refresh(this));
      }
      if (this.selectionCache.fileUri === uri.toString()) {
        delete this.selectionCache.fileUri;
        this.vsContext.workspaceState.update(Context.cacheName, this.selectionCache);
      }
      delete this.symbolsByUri[uri.toString()];
    }
  }

  getConfigUri() {
    return this.configFileUri;
  }

  getConfigNodes(nodeType: string): Array<DocumentSymbol> {
    const symbols = this.getSymbols(this.configFileUri?.toString());
    const typeSymbol = getSymbol(symbols, nodeType);
    // Sort keys so that 'default' is always the first entry.
    return (typeSymbol && typeSymbol.children.sort(configNodeKeySort)) || [];
  }

  async selectConfigUri(uri: Uri): Promise<void> {
    if (isUriEqual(uri, this.configFileUri)) {
      return;
    }
    this.configFileUri = uri;
    if (!this.symbolsByUri[uri.toString()]) {
      await this.readSymbols(await this.getDocFromUri(uri));
    }
    this.treeProviders.forEach((p) => p.refresh(this, uri));
    this.revealConfigNodesInTrees();

    if (this.selectionCache.fileUri !== uri.toString()) {
      this.selectionCache.fileUri = uri.toString();
      this.vsContext.workspaceState.update(Context.cacheName, this.selectionCache);
    }
  }

  getDocFromUri(uri: Uri): Thenable<TextDocument> {
    return workspace.openTextDocument(getOriginalUri(uri));
  }

  private async checkCoreVersion(doc: TextDocument) {
    const symbols = this.getSymbols(doc.uri.toString());
    const versionSymbol = getSymbol(symbols, "CORE", "core_version");
    let foundVersion: string;
    if (versionSymbol) {
      foundVersion = getSymbolValue(doc, versionSymbol) as string;
      if (foundVersion && foundVersion.split(".", 2)[0] === TAIPY_CORE_VERSION.split(".", 2)[0]) {
        return;
      }
    }
    const answer = await window.showWarningMessage(
      foundVersion
        ? l10n.t(
            "Core version found ({0}) in the configuration is not compatible with the current version ({1}).\nWould you like to upgrade the configuration?",
            foundVersion,
            TAIPY_CORE_VERSION
          )
        : l10n.t(
            "No Core version found in the configuration.\nWould you like to upgrade the configuration to {0}?",
            TAIPY_CORE_VERSION
          ),
      "Yes",
      "No"
    );
    if (answer === "Yes") {
      const edits: TextEdit[] = [];
      if (versionSymbol) {
        edits.push(TextEdit.replace(versionSymbol.range, `"${TAIPY_CORE_VERSION}"`));
      } else {
        const coreSymbol = getSymbol(symbols, "CORE");
        if (coreSymbol) {
          edits.push(
            TextEdit.insert(
              coreSymbol.range.start.translate(1).with(undefined, 0),
              `core_version = "${TAIPY_CORE_VERSION}"\n`
            )
          );
        } else {
          edits.push(TextEdit.insert(new Position(0, 0), `[CORE]\ncore_version = "${TAIPY_CORE_VERSION}"\n`));
        }
      }
      const scenarios = getSymbol(symbols, Scenario)?.children;
      if (scenarios?.length) {
        const getSectionnedName = (a: string) => getSectionName(a);
        const pipelines = getSymbol(symbols, "PIPELINE")?.children;
        if (pipelines?.length) {
          const pipelineTasks: Record<string, string[]> = {};
          pipelines.forEach(
            (p) => (pipelineTasks[p.name] = getSymbolArrayValue(doc, p, PROP_TASKS).map(getUnsuffixedName))
          );
          scenarios.forEach((scenarioSymbol) => {
            const pipelines = getSymbolArrayValue(doc, scenarioSymbol, "pipelines").map(getUnsuffixedName);
            const tasksSymbol = getSymbol(scenarioSymbol.children, PROP_TASKS);
            const tasks = new Set(
              tasksSymbol ? getSymbolArrayValue(doc, tasksSymbol).map(getUnsuffixedName) : []
            );
            const sequencesSymbol = getSymbol(scenarioSymbol.children, PROP_SEQUENCES);
            const sequences: string[] = [];
            pipelines.forEach((p) => {
              (pipelineTasks[p] || []).forEach((t) => tasks.add(t));
              const seqSymbol = sequencesSymbol && getSymbol(sequencesSymbol.children, p);
              if (!seqSymbol) {
                sequences.push(`${p} = ${getArrayText(pipelineTasks[p], getSectionnedName)}`);
              }
            });
            (!tasksSymbol || pipelines.length) &&
              edits.push(
                tasksSymbol
                  ? TextEdit.replace(tasksSymbol.range, getArrayText(Array.from(tasks), getSectionnedName))
                  : TextEdit.insert(
                      scenarioSymbol.range.start.translate(1).with(undefined, 0),
                      `${PROP_TASKS} = ${getArrayText(Array.from(tasks), getSectionnedName)}\n`
                    )
              );
            edits.push(
              TextEdit.insert(
                (sequencesSymbol ? sequencesSymbol.range.start : scenarioSymbol.range.end)
                  .translate(1)
                  .with(undefined, 0),
                (sequencesSymbol ? "" : `\n[${Scenario}.${scenarioSymbol.name}.${PROP_SEQUENCES}]\n`) +
                  sequences.join("\n") +
                  (sequences.length ? "\n" : "")
              )
            );
          });
        }
      }
      if (edits.length) {
        const we = new WorkspaceEdit();
        we.set(doc.uri, edits);
        return workspace.applyEdit(we);
      }
    }
    return false;
  }

  private async unselectConfigNode(): Promise<void> {
    this.configDetailsView.setEmptyContent();
  }

  updateElement(nodeType: string, oldNodeName: string, nodeName: string) {
    if (this.selectionCache[nodeType] === oldNodeName) {
      this.selectionCache[nodeType] = nodeName;
      this.vsContext.workspaceState.update(Context.cacheName, this.selectionCache);
    }
    this.configEditorProvider.updateElement(nodeType, oldNodeName, nodeName);
  }

  private async selectConfigNode(
    nodeType: string,
    name: string,
    configNode: object,
    uri: Uri,
    reveal = true,
    fromInEditor = true
  ): Promise<void> {
    let updateCache = false;
    if (reveal || this.selectionCache.lastView === nodeType) {
      this.configDetailsView.setConfigNodeContent(nodeType, name, configNode, uri);
    }
    if (this.selectionCache[nodeType] !== name) {
      this.selectionCache[nodeType] = name;
      updateCache = true;
    }
    if (reveal && this.selectionCache.lastView !== nodeType) {
      this.selectionCache.lastView = nodeType;
      updateCache = true;
    }
    if (updateCache) {
      this.vsContext.workspaceState.update(Context.cacheName, this.selectionCache);
    }
    if (reveal && fromInEditor) {
      this.revealConfigNodeInEditors(uri, nodeType, name);
    }
  }

  private revealConfigNodeInEditors(docUri: Uri, nodeType: string, name: string) {
    if (!workspace.getConfiguration(TAIPY_STUDIO_SETTINGS_NAME).get("editor.reveal.enabled", true)) {
      return;
    }
    if (isUriEqual(docUri, this.configFileUri)) {
      const providerIndex = this.treeProviders.findIndex((p) => p.getNodeType() === nodeType);
      if (providerIndex > -1) {
        const item = this.treeProviders[providerIndex].getItem(name);
        if (item) {
          this.treeViews[providerIndex].reveal(item, { select: true });
          this.selectConfigNode(nodeType, name, item.getNode(), docUri, true, false);
        }
      }
    }
    const editors = window.visibleTextEditors.filter(
      (te) => isUriEqual(docUri, te.document.uri) && te !== window.activeTextEditor
    ); // don't reveal in the active editor
    if (editors.length) {
      const doc = editors[0].document;
      const section = `[${nodeType}.${name}`;
      for (let i = 0; i < doc.lineCount; i++) {
        const line = doc.lineAt(i);
        const p = line.text.indexOf(section);
        if (p > -1) {
          const range = new Range(line.range.start.translate(0, p), line.range.start.translate(0, p + section.length));
          editors.forEach((editor) => {
            editor.revealRange(range, TextEditorRevealType.InCenter);
          });
          return;
        }
      }
    }
  }

  private showPerspective(item: TreeItem) {
    if (item.contextValue === FILE_CONTEXT) {
      this.configFilesView.select(item.resourceUri);
    }
    commands.executeCommand("vscode.openWith", item.resourceUri, ConfigEditorProvider.viewType);
  }

  private showPerspectiveFromDiagram(item: { baseUri: string; nodeType: string; nodeName: string }) {
    commands.executeCommand(
      "vscode.openWith",
      getPerspectiveUri(Uri.parse(item.baseUri, true), `${item.nodeType}.${item.nodeName}`),
      ConfigEditorProvider.viewType
    );
  }

  private showPropertyLink(item: { baseUri: string }) {
    commands.executeCommand("vscode.open", Uri.parse(item.baseUri, true));
  }

  private async renameNode(item: ConfigItem) {
    this.configDetailsView.doRenameNode(
      getOriginalUri(item.resourceUri),
      item.contextValue,
      item.label as string,
      getExtras(item.getNode())
    );
  }

  private async createSequenceForScenario(item: ConfigItem) {
    this.configDetailsView.createSequence(getOriginalUri(item.resourceUri), item.contextValue, item.label as string);
  }

  getSymbols(uri: string) {
    return (uri && this.symbolsByUri[uri]) || [];
  }

  async refreshSymbols(document: TextDocument) {
    const uri = document.uri.toString();
    if (this.symbolsByUri[uri]) {
      await this.readSymbols(document);
    }
  }

  async readSymbolsIfNeeded(document: TextDocument) {
    const uri = document.uri.toString();
    if (!this.symbolsByUri[uri]) {
      if (await this.readSymbols(document)) {
        this.checkCoreVersion(document);
      }
    }
  }

  private async readSymbols(document: TextDocument) {
    cleanDocumentDiagnostics(document.uri);
    const symbols = (await commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      document.uri
    )) as DocumentSymbol[];
    this.symbolsByUri[document.uri.toString()] = symbols || [];
    reportInconsistencies(document, symbols, null);
    return true;
  }
}
