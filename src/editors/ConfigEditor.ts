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

import { JsonMap, stringify } from "@iarna/toml";
import {
  CancellationToken,
  commands,
  CustomTextEditorProvider,
  DocumentSymbol,
  ExtensionContext,
  l10n,
  languages,
  Position,
  TextDocument,
  TextEdit,
  TreeItem,
  Uri,
  Webview,
  WebviewPanel,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";

import {
  configFilePattern,
  getArrayText,
  getCspScriptSrc,
  getDefaultConfig,
  getExtras,
  getNonce,
  joinPaths,
} from "../utils/utils";
import { revealConfigNodeCmd } from "../utils/commands";
import {
  getCleanPerpsectiveUriString,
  getOriginalDocument,
  getOriginalUri,
  getPerspectiveFromUri,
  getPerspectiveUri,
  isUriEqual,
} from "../providers/PerpectiveContentProvider";
import {
  CREATE_LINK,
  CREATE_NODE,
  DELETE_LINK,
  GET_NODE_NAME,
  REFRESH,
  REMOVE_EXTRA_ENTITIES,
  REMOVE_NODE,
  SAVE_AS_PNG_URL,
  SAVE_DOCUMENT,
  SELECT,
  SET_EXTRA_ENTITIES,
  SET_POSITIONS,
  UPDATE_EXTRA_ENTITIES,
} from "../../shared/commands";
import { EditorAddNodeMessage, EditorShowSequenceMessage, ViewMessage } from "../../shared/messages";
import {
  CONFIG_EDITOR_ID,
  ConfigEditorProps,
  containerId,
  webviewsLibraryDir,
  webviewsLibraryName,
  perspectiveRootId,
} from "../../shared/views";
import { TAIPY_STUDIO_SETTINGS_NAME } from "../utils/constants";
import { Context } from "../context";
import {
  getDefaultContent,
  getDescendantPropertiesForType,
  getNodeFromSymbol,
  getParentTypes,
  getSectionName,
  getSymbol,
  getSymbolArrayValue,
  getUnsuffixedName,
  toDisplayModel,
} from "../utils/symbols";
import { Positions, WebContext } from "../../shared/diagram";
import { ConfigCompletionItemProvider } from "../providers/CompletionItemProvider";
import { ConfigDropEditProvider } from "../providers/DocumentDropEditProvider";
import { getNodeNameValidationFunction } from "../utils/pythonSymbols";
import { getLog } from "../utils/logging";
import { getDefaultValues } from "../schema/validation";
import { DataNode, PROP_DATANODES, PROP_SEQUENCES, PROP_TASKS, Scenario, Sequence, Task } from "../../shared/names";
import { getChildTypes, getDescendantProperties } from "../../shared/nodeTypes";
import { ConfigItem } from "../providers/ConfigNodesProvider";

interface EditorCache {
  positions?: Positions;
  extraEntities?: string;
  [key: string]: unknown;
}
interface ProviderCache {
  [key: string]: EditorCache;
}

const nodeTypes4config = ["datanode", "task", "sequence", "scenario"];

export class ConfigEditorProvider implements CustomTextEditorProvider {
  static register(context: ExtensionContext, taipyContext: Context): ConfigEditorProvider {
    const provider = new ConfigEditorProvider(context, taipyContext);
    const providerRegistration = window.registerCustomEditorProvider(ConfigEditorProvider.viewType, provider, {
      webviewOptions: { enableFindWidget: true },
    });
    context.subscriptions.push(providerRegistration);
    return provider;
  }

  private static readonly cacheName = "taipy.editor.cache";
  static readonly viewType = "taipy.config.editor.diagram";

  private readonly extensionUri: Uri;
  // Perspective Uri => cache
  private cache: ProviderCache;
  // original Uri => perspective Id => panels
  private panelsByUri: Record<string, Record<string, WebviewPanel[]>> = {};

  private constructor(private readonly context: ExtensionContext, private readonly taipyContext: Context) {
    this.extensionUri = context.extensionUri;
    this.cache = context.workspaceState.get(ConfigEditorProvider.cacheName, {} as ProviderCache);
    context.subscriptions.push(
      // Drop Edit Provider
      languages.registerDocumentDropEditProvider(
        { pattern: configFilePattern },
        ConfigDropEditProvider.register(this.taipyContext)
      ),
      // Completion Item Provider
      languages.registerCompletionItemProvider(
        { pattern: configFilePattern },
        ConfigCompletionItemProvider.register(this.taipyContext)
      ),
      // Commands
      commands.registerCommand("taipy.config.clearCache", this.clearCache, this),
      commands.registerCommand("taipy.diagram.addNode", this.addNodeToCurrentDiagram, this),
      commands.registerCommand("taipy.config.deleteNode", this.deleteConfigurationNode, this),
      commands.registerCommand("taipy.perspective.removeFromDiagram", this.removeNodeFromPerspective, this),
      commands.registerCommand("taipy.perspective.duplicateNode", this.duplicateNode, this),
      commands.registerCommand("taipy.scenario.showSequence", this.showSequenceInScenario, this),
      commands.registerCommand("taipy.perspective.removeFromSequence", this.removeFromSequence, this),
      commands.registerCommand("taipy.perspective.addToSequence", this.addToSequence, this)
    );
  }

  private async showSequenceInScenario(item: ConfigItem) {
    const scenarioName = getExtras(item.getNode())[Scenario];
    if (!scenarioName) {
      return;
    }
    const pps = this.panelsByUri[getOriginalUri(item.resourceUri).toString()];
    if (!pps) {
      return;
    }
    const ps = pps[`${Scenario}.${scenarioName}`];
    ps &&
      ps.forEach((panel) => {
        try {
          panel.webview.postMessage({
            sequence: item.label,
          } as EditorShowSequenceMessage);
        } catch (e) {
          getLog().info("showSequenceInScenario: ", e.message || e);
        }
      });
  }

  async createNewElement(uri: Uri, nodeType: string) {
    const doc = await workspace.openTextDocument(getOriginalUri(uri));
    const nodeName = await this.getNodeName(doc, nodeType, undefined, false);
    if (nodeName) {
      if (await this.applyEdits(doc.uri, await this.doCreateElement(doc, nodeType, nodeName))) {
        this.addNodeToActiveDiagram(nodeType, nodeName, false);
      }
    }
  }

  private async doCreateElement(doc: TextDocument, nodeType: string, nodeName: string, edits: TextEdit[] = []) {
    const content = getDefaultContent(nodeType, nodeName);
    const defaultValues = await getDefaultValues(nodeType);
    Object.keys(content[nodeType][nodeName])
      .filter((key) => defaultValues[key] !== undefined)
      .forEach((key) => {
        content[nodeType][nodeName][key] = defaultValues[key];
      });
    return this.addElementAtEnd(doc, content, edits);
  }

  private addElementAtEnd(doc: TextDocument, content: JsonMap, edits: TextEdit[] = []) {
    edits.push(
      TextEdit.insert(
        doc.lineCount ? doc.lineAt(doc.lineCount - 1).range.end : new Position(0, 0),
        "\n" + stringify(content).trimEnd() + "\n"
      )
    );
    return edits;
  }

  private clearCache() {
    this.cache = {};
    this.context.workspaceState.update(ConfigEditorProvider.cacheName, this.cache);
  }

  private getPositionsCache(perspectiveUri: string): Positions {
    this.cache[perspectiveUri] = this.cache[perspectiveUri] || { positions: {} };
    return this.cache[perspectiveUri].positions || {};
  }

  private getCache(perspectiveUri: string) {
    this.cache[perspectiveUri] = this.cache[perspectiveUri] || {};
    return this.cache[perspectiveUri];
  }

  private async deleteConfigurationNode(item: ConfigItem) {
    return this.doDeleteConfigurationNode(
      item.contextValue,
      item.label as string,
      item.resourceUri,
      false,
      getExtras(item.getNode())
    );
  }

  private async doDeleteConfigurationNode(
    nodeType?: string,
    nodeName?: string,
    resourceUri?: Uri,
    refreshOnFail?: boolean,
    extras?: Record<string, string>
  ) {
    const answer = await window.showWarningMessage(
      l10n.t(
        "Do you really want to permanently delete {0}:{1} from the configuration?",
        nodeType,
        nodeName.toLowerCase()
      ),
      "Yes",
      "No"
    );
    if (answer === "Yes") {
      const uri = getOriginalUri(resourceUri);
      const realDocument = await this.taipyContext.getDocFromUri(uri);
      const symbols = this.taipyContext.getSymbols(uri.toString());
      const isSequence = nodeType === Sequence;
      const nameSymbol =
        isSequence && extras
          ? getSymbol(symbols, Scenario, extras[Scenario], PROP_SEQUENCES, nodeName)
          : getSymbol(symbols, nodeType, nodeName);
      if (!nameSymbol) {
        if (refreshOnFail) {
          this.updateWebview(realDocument, realDocument.isDirty);
        }
        return false;
      }
      const edits: TextEdit[] = [
        TextEdit.delete(
          isSequence ? nameSymbol.range.with(nameSymbol.range.start.with(undefined, 0)) : nameSymbol.range
        ),
      ];
      await this.removeNodeLinks(realDocument, nodeType, nodeName, symbols, edits);
      const res = await this.applyEdits(realDocument.uri, edits);
      if (res) {
        await this.taipyContext.refreshSymbols(realDocument);
      }
      if (res || refreshOnFail) {
        this.updateWebview(realDocument, realDocument.isDirty);
      }
      return res;
    } else if (refreshOnFail) {
      const uri = getOriginalUri(resourceUri);
      const realDocument = await this.taipyContext.getDocFromUri(uri);
      this.updateWebview(realDocument, realDocument.isDirty);
    }
  }

  private addNodeToCurrentDiagram(item: TreeItem) {
    this.addNodeToActiveDiagram(item.contextValue, item.label as string, true);
  }

  private addNodeToActiveDiagram(nodeType: string, nodeName: string, check = false) {
    for (const pps of Object.values(this.panelsByUri)) {
      for (const [pId, ps] of Object.entries(pps)) {
        const panel = ps && ps.find((p) => p.active);
        if (panel) {
          if (check) {
            const perspType = pId.split(".", 2)[0];
            const childTypes = [perspType];
            let childType;
            while ((childType = childTypes.shift())) {
              const cts = getChildTypes(childType);
              if (cts.has(nodeType)) {
                break;
              }
              childTypes.push(...cts);
            }
            if (!childType) {
              window.showWarningMessage(l10n.t("Cannot show a {0} entity in a {1} Perpective.", nodeType, perspType));
              return;
            }
          }
          try {
            panel.webview.postMessage({
              editorMessage: true,
              nodeType: nodeType,
              nodeName: nodeName,
            } as EditorAddNodeMessage);
          } catch (e) {
            getLog().info("addNodeToCurrentDiagram: ", e.message || e);
          }
          return;
        }
      }
    }
  }

  async updateWebview(doc: TextDocument, isDirty = false) {
    const originalUri = getOriginalUri(doc.uri);
    const baseUri = originalUri.toString();
    const panelsByPersp = this.panelsByUri[baseUri];
    const symbols = this.taipyContext.getSymbols(baseUri);
    if (panelsByPersp) {
      const realDocument = await getOriginalDocument(doc);
      Object.entries(panelsByPersp).forEach(([perspectiveId, panels]) => {
        const perspSymbol =
          perspectiveId === perspectiveRootId ? true : getSymbol(symbols, ...perspectiveId.split("."));
        if (!perspSymbol) {
          panels.forEach((p) => p.dispose());
          return;
        }
        const cache = this.getCache(getPerspectiveUri(originalUri, perspectiveId).toString());
        const model = toDisplayModel(realDocument, symbols, cache.positions);
        panels.forEach((p) => {
          try {
            p.webview.postMessage({
              viewId: CONFIG_EDITOR_ID,
              props: {
                displayModel: model,
                perspectiveId: perspectiveId,
                baseUri: baseUri,
                extraEntities: cache.extraEntities,
                isDirty: isDirty,
              } as ConfigEditorProps,
            } as ViewMessage);
          } catch (e) {
            getLog().info(l10n.t("Looks like this panelView was disposed. {0}", e.message || e));
          }
        });
      });
    }
  }

  /**
   * Called when our custom editor is opened.
   */
  public async resolveCustomTextEditor(
    document: TextDocument,
    webviewPanel: WebviewPanel,
    token: CancellationToken
  ): Promise<void> {
    // Setup initial content for the webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [joinPaths(this.extensionUri)],
    };

    // retrieve and work with the original document
    const realDocument = await getOriginalDocument(document);

    await this.taipyContext.readSymbolsIfNeeded(realDocument);

    const perspId = getPerspectiveFromUri(document.uri);
    const originalUri = getOriginalUri(document.uri).toString();
    this.panelsByUri[originalUri] = this.panelsByUri[originalUri] || {};
    this.panelsByUri[originalUri][perspId] = this.panelsByUri[originalUri][perspId] || [];
    this.panelsByUri[originalUri][perspId].push(webviewPanel);

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);

    const docListener = (textDocument: TextDocument) => {
      if (isUriEqual(document.uri, textDocument.uri)) {
        this.updateWebview(document, textDocument.isDirty);
      }
    };

    // Hook up event handlers so that we can synchronize the webview with the text document.
    this.taipyContext.registerDocChangeListener(docListener, this);

    // Receive message from the webview.
    const receiveMessageSubscription = webviewPanel.webview.onDidReceiveMessage((e) => {
      switch (e.command) {
        case SELECT:
          this.revealSection(document.uri, e.id, e.msg);
          return;
        case REFRESH:
          this.updateWebview(document);
          break;
        case SET_POSITIONS:
          this.setPositions(document.uri, e.positions);
          break;
        case CREATE_LINK:
          this.createLink(realDocument, e.sourceType, e.sourceName, e.targetType, e.targetName);
          break;
        case DELETE_LINK:
          this.deleteLink(realDocument, e.sourceType, e.sourceName, e.targetType, e.targetName);
          break;
        case CREATE_NODE:
          this.createNode(realDocument, document.uri, e.nodeType, e.nodeName);
          break;
        case REMOVE_NODE:
          this.doDeleteConfigurationNode(e.nodeType, e.nodeName, document.uri, true);
          break;
        case GET_NODE_NAME:
          this.getNodeName(realDocument, e.nodeType, e.extras);
          break;
        case SET_EXTRA_ENTITIES:
          this.setExtraEntitiesInCache(document.uri, e.extraEntities);
          break;
        case UPDATE_EXTRA_ENTITIES:
          this.updateExtraEntitiesInCache(document.uri, e.extraEntities);
          break;
        case REMOVE_EXTRA_ENTITIES:
          this.removeExtraEntitiesInCache(document.uri, e.extraEntities);
          break;
        case SAVE_DOCUMENT:
          this.saveDocument(realDocument);
          break;
        case SAVE_AS_PNG_URL:
          this.saveAsPng(e.url);
          break;
      }
    }, this);

    // clean-up when our editor is closed.
    webviewPanel.onDidDispose(() => {
      this.panelsByUri[originalUri] &&
        this.panelsByUri[originalUri][perspId] &&
        (this.panelsByUri[originalUri][perspId] = this.panelsByUri[originalUri][perspId].filter(
          (p) => p !== webviewPanel
        ));
      receiveMessageSubscription.dispose();
      this.taipyContext.unregisterDocChangeListener(docListener, this);
    });

    webviewPanel.onDidChangeViewState((e) => {
      this.refreshVisibleContext();
    });
    this.refreshVisibleContext();
  }

  updateElement(nodeType: string, oldNodeName: string, nodeName: string) {
    const oldPerspectiveId = `${nodeType}.${oldNodeName}`;
    const newPerspectiveId = `${nodeType}.${nodeName}`;
    Object.values(this.panelsByUri).forEach((val) => {
      if (oldPerspectiveId in val) {
        val[newPerspectiveId] = val[oldPerspectiveId];
        delete val[oldPerspectiveId];
      }
    });
  }

  private refreshVisibleContext() {
    commands.executeCommand(
      "setContext",
      "taipy.config.diagram.visible",
      Object.values(this.panelsByUri).some((val) =>
        Object.values(val).some((panels) =>
          panels.some((panel) => {
            try {
              return panel.visible;
            } catch {
              return false;
            }
          })
        )
      )
    );
  }

  private async saveDocument(document: TextDocument) {
    return !document.isDirty || document.save();
  }

  private async saveAsPng(url: string) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const newFileUri = await window.showSaveDialog({ filters: { Images: ["png"] } });
    newFileUri && workspace.fs.writeFile(newFileUri, Buffer.from(url.split(",", 2).at(-1), "base64url"));
  }

  private async applyEdits(uri: Uri, edits: TextEdit[]) {
    if (edits?.length) {
      const we = new WorkspaceEdit();
      we.set(uri, edits);
      return workspace.applyEdit(we);
    }
    return false;
  }

  private async deleteLink(
    realDocument: TextDocument,
    sourceType: string,
    sourceName: string,
    targetType: string,
    targetName: string
  ) {
    return this.applyEdits(
      realDocument.uri,
      this.createOrDeleteLink(realDocument, sourceType, sourceName, targetType, targetName, false, false)
    );
  }

  private async createLink(
    realDocument: TextDocument,
    sourceType: string,
    sourceName: string,
    targetType: string,
    targetName: string
  ) {
    return this.applyEdits(
      realDocument.uri,
      this.createOrDeleteLink(realDocument, sourceType, sourceName, targetType, targetName, true, false)
    );
  }

  private createOrDeleteLink(
    realDocument: TextDocument,
    sourceType: string,
    sourceName: string,
    targetType: string,
    targetName: string,
    create: boolean,
    deleteAll: boolean,
    edits = [] as TextEdit[]
  ) {
    const reverse = !deleteAll && sourceType === DataNode;
    const nodeType = reverse ? targetType : sourceType;
    const childType = reverse ? sourceType : targetType;
    const nodeName = reverse ? targetName : sourceName;
    const childName = reverse ? sourceName : targetName;
    const [inputProp, outputProp] = getDescendantProperties(nodeType);
    const property = deleteAll
      ? targetType
      : Object.entries((reverse ? inputProp : outputProp) || {})
          .filter((a) => a[1] === childType)
          .map((a) => a[0])
          .pop();
    if (!property) {
      return edits;
    }

    const symbols = this.taipyContext.getSymbols(realDocument.uri.toString());
    const linksSymbol = getSymbol(symbols, nodeType, nodeName, property);
    const links = linksSymbol && getSymbolArrayValue(realDocument, linksSymbol);

    if (!create && links.length === 0) {
      return edits;
    }
    // if link datanode/task, check the scenario additional list
    if ((targetType === DataNode || sourceType === DataNode) && (targetType === Task || sourceType === Task)) {
      const scenarios = getSymbol(symbols, Scenario);
      if (scenarios) {
        const [taskName, dnName] = nodeType === Task ? [nodeName, childName] : [childName, nodeName];
        scenarios.children.find((sc) => {
          const tasks = getSymbolArrayValue(realDocument, sc, PROP_TASKS);
          if (tasks.some((t) => getUnsuffixedName(t) === taskName)) {
            const additionalsSymbol = getSymbol(sc.children, PROP_DATANODES);
            const additionals = additionalsSymbol && getSymbolArrayValue(realDocument, additionalsSymbol);
            if (additionals) {
              // remove dn from addtionals
              const newAdd = additionals.filter((dn) => getUnsuffixedName(dn) !== dnName);
              if (newAdd.length < additionals.length) {
                edits.push(TextEdit.replace(additionalsSymbol.range, stringify.value(newAdd).trimEnd()));
                return true;
              }
            }
          }
          return false;
        });
      }
    }
    if (linksSymbol) {
      const newLinks = create
        ? [...links, getSectionName(childName)]
        : deleteAll
        ? []
        : links.filter((l) => getUnsuffixedName(l) !== childName);
      edits.push(TextEdit.replace(linksSymbol.range, stringify.value(newLinks).trimEnd()));
      return edits;
    } else {
      const nameSymbol = getSymbol(symbols, nodeType, nodeName);
      if (nameSymbol) {
        edits.push(
          TextEdit.insert(
            nameSymbol.range.end,
            property + " = " + stringify.value(create ? [getSectionName(childName)] : []) + "\n"
          )
        );
        return edits;
      }
    }
  }

  private async getNodeName(
    doc: TextDocument,
    nodeType: string,
    extras?: Record<string, string>,
    addNodeToActiveDiagram = true
  ) {
    const symbols = this.taipyContext.getSymbols(doc.uri.toString());
    const typeSymbol =
      nodeType === Sequence && extras
        ? getSymbol(symbols, Scenario, extras[Scenario], PROP_SEQUENCES)
        : getSymbol(symbols, nodeType);
    const nodeName = (typeSymbol?.children || [])
      .filter((s) => s.name.toLowerCase().startsWith(nodeType.toLowerCase()))
      .sort()
      .reduce((pv, s) => {
        if (s.name.toLowerCase() === pv.toLowerCase()) {
          const numSuffix = /^(.*)(_\d+)$/.exec(pv);
          if (numSuffix?.length === 3) {
            return numSuffix[1] + "_" + (parseInt(numSuffix[2].substring(1), 10) + 1);
          } else {
            return pv + "_1";
          }
        }
        return pv;
      }, nodeType + "_1");
    const newName = await window.showInputBox({
      prompt: l10n.t("Enter an identifier for a new {0} element.", nodeType),
      title: l10n.t("new {0} identifier", nodeType),
      validateInput: getNodeNameValidationFunction(typeSymbol),
      value: nodeName,
    });
    if (newName && addNodeToActiveDiagram) {
      if (nodeType === Sequence) {
        const range = typeSymbol ? typeSymbol.range : extras && getSymbol(symbols, Scenario, extras[Scenario])?.range;
        if (range) {
          this.applyEdits(doc.uri, [
            TextEdit.insert(
              range.start.translate(1).with(undefined, 0),
              (typeSymbol ? "" : `[${Scenario}.${extras[Scenario]}.${PROP_SEQUENCES}]\n`) + `${newName} = []\n`
            ),
          ]);
        }
      } else {
        this.addNodeToActiveDiagram(nodeType, newName);
      }
    }
    return newName;
  }

  private async createNode(realDocument: TextDocument, perspectiveUri: Uri, nodeType: string, nodeName: string) {
    const perspectiveId = getPerspectiveFromUri(perspectiveUri);
    const [perspType, perspName] = perspectiveId.split(".", 2);
    await this.taipyContext.refreshSymbols(realDocument);
    const uri = realDocument.uri;
    const symbols = this.taipyContext.getSymbols(uri.toString());
    const nameSymbol = getSymbol(symbols, nodeType, nodeName);
    const edits = [] as TextEdit[];
    if (getChildTypes(perspType).has(nodeType) && getSymbol(symbols, perspType, perspName)) {
      this.createOrDeleteLink(realDocument, perspType, perspName, nodeType, nodeName, true, false, edits);
    } else {
      this.updateExtraEntitiesInCache(perspectiveUri, `${nodeType}.${nodeName}`);
    }
    if (!nameSymbol) {
      await this.doCreateElement(realDocument, nodeType, nodeName, edits);
    }
    return this.applyEdits(uri, edits);
  }

  private async removeNodeLinks(
    realDocument: TextDocument,
    nodeType: string,
    nodeName: string,
    symbols: DocumentSymbol[],
    edits: TextEdit[] = []
  ) {
    const parentTypes = getParentTypes(nodeType);
    parentTypes.forEach((parentType) => {
      const pTypeSymbol = getSymbol(symbols, parentType);
      const pp = getDescendantPropertiesForType(parentType, nodeType);
      pTypeSymbol &&
        pTypeSymbol.children.forEach((parentSymbol) => {
          pp.forEach((property, idx) => {
            if (
              property &&
              getSymbolArrayValue(realDocument, parentSymbol, property).some(
                (n: string) => getUnsuffixedName(n) === nodeName
              )
            ) {
              if (idx === 0) {
                // input property: reverse order
                this.createOrDeleteLink(
                  realDocument,
                  nodeType,
                  nodeName,
                  parentType,
                  parentSymbol.name,
                  false,
                  false,
                  edits
                );
              } else {
                // output property
                this.createOrDeleteLink(
                  realDocument,
                  parentType,
                  parentSymbol.name,
                  nodeType,
                  nodeName,
                  false,
                  false,
                  edits
                );
              }
            }
          });
        });
    });
    return edits;
  }

  private async duplicateNode({
    baseUri,
    nodeType,
    nodeName,
  }: {
    baseUri: string;
    nodeType: string;
    nodeName: string;
  }) {
    const resourceUri = Uri.parse(baseUri, true);
    const uri = getOriginalUri(resourceUri);
    const realDocument = await this.taipyContext.getDocFromUri(uri);
    return this.doDuplicateNode(realDocument, resourceUri, nodeType, nodeName);
  }

  private async doDuplicateNode(realDocument: TextDocument, perspectiveUri: Uri, nodeType: string, nodeName: string) {
    const uri = realDocument.uri;
    const symbols = this.taipyContext.getSymbols(uri.toString());
    const nameSymbol = getSymbol(symbols, nodeType, nodeName);
    if (!nameSymbol) {
      return false;
    }
    const newName = await this.getNodeName(realDocument, nodeType, undefined, false);
    if (!newName) {
      return false;
    }
    // duplicate Node
    const content = { [nodeType]: { [newName]: { ...getNodeFromSymbol(realDocument, nameSymbol) } } };
    const edits = this.addElementAtEnd(realDocument, content);
    this.addNodeToActiveDiagram(nodeType, newName);
    return this.applyEdits(uri, edits);
  }

  private async removeFromSequence(wc: WebContext) {
    return this.doAddRemoveTaskInSequence(wc, false);
  }

  private async addToSequence(wc: WebContext) {
    return this.doAddRemoveTaskInSequence(wc, true);
  }

  private async doAddRemoveTaskInSequence({ baseUri, nodeName, scenario, sequence }: WebContext, add: boolean) {
    const resourceUri = Uri.parse(baseUri, true);
    const uri = getOriginalUri(resourceUri);
    const realDocument = await this.taipyContext.getDocFromUri(uri);
    const symbols = this.taipyContext.getSymbols(uri.toString());
    const seqSymbol = getSymbol(symbols, Scenario, scenario, PROP_SEQUENCES, sequence);
    if (!seqSymbol) {
      return false;
    }
    const tasks = getSymbolArrayValue(realDocument, seqSymbol).map(getUnsuffixedName);
    add && tasks.push(nodeName);
    this.applyEdits(uri, [
      TextEdit.replace(
        seqSymbol.range,
        getArrayText(add ? tasks : tasks.filter((t) => t !== nodeName), (t: string) => getSectionName(t))
      ),
    ]);
  }

  private async removeNodeFromPerspective({ baseUri, nodeType, nodeName }: WebContext) {
    const resourceUri = Uri.parse(baseUri, true);
    const uri = getOriginalUri(resourceUri);
    const realDocument = await this.taipyContext.getDocFromUri(uri);
    return this.doRemoveNodeFromPerspective(realDocument, resourceUri, nodeType, nodeName);
  }

  private async doRemoveNodeFromPerspective(
    realDocument: TextDocument,
    perspectiveUri: Uri,
    nodeType: string,
    nodeName: string
  ) {
    const uri = realDocument.uri;
    const symbols = this.taipyContext.getSymbols(uri.toString());
    const nameSymbol = getSymbol(symbols, nodeType, nodeName);
    if (!nameSymbol) {
      return false;
    }
    // edit document
    const edits: TextEdit[] = [];
    getChildTypes(nodeType).forEach(
      (p) => p && this.createOrDeleteLink(realDocument, nodeType, nodeName, p, "", false, true, edits)
    );
    await this.removeNodeLinks(realDocument, nodeType, nodeName, symbols, edits);
    const ret = await this.applyEdits(realDocument.uri, edits);
    if (ret) {
      this.removeExtraEntitiesInCache(perspectiveUri, `${nodeType}.${nodeName}`);
    } else {
      this.updateWebview(realDocument, realDocument.isDirty);
    }
    return ret;
  }

  private setPositions(docUri: Uri, positions: Positions) {
    let modified = false;
    const perspUri = getCleanPerpsectiveUriString(docUri);
    let pos = this.getPositionsCache(perspUri);
    if (positions) {
      pos = Object.entries(positions).reduce((pv, [k, v]) => {
        modified = true;
        pv[k] = v;
        return pv;
      }, pos);
    }
    if (modified) {
      this.cache[perspUri] = this.cache[perspUri];
      this.cache[perspUri].positions = pos;
      this.context.workspaceState.update(ConfigEditorProvider.cacheName, this.cache);
    }
  }

  private setExtraEntitiesInCache(docUri: Uri, extraEntities: string) {
    const editorCache = this.getCache(getCleanPerpsectiveUriString(docUri));
    if (extraEntities !== editorCache.extraEntities) {
      editorCache.extraEntities = extraEntities;
      this.context.workspaceState.update(ConfigEditorProvider.cacheName, this.cache);
    }
  }

  private updateExtraEntitiesInCache(docUri: Uri, extraEntities: string) {
    if (!extraEntities) {
      return;
    }
    let modified = false;
    const editorCache = this.getCache(getCleanPerpsectiveUriString(docUri));
    if (editorCache.extraEntities) {
      const ee = editorCache.extraEntities.split(";");
      const len = ee.length;
      extraEntities.split(";").forEach((e) => !ee.includes(e) && ee.push(e));
      if (len < ee.length) {
        editorCache.extraEntities = ee.join(";");
        modified = true;
      }
    } else {
      editorCache.extraEntities = extraEntities;
      modified = true;
    }
    if (modified) {
      this.context.workspaceState.update(ConfigEditorProvider.cacheName, this.cache);
    }
  }

  private removeExtraEntitiesInCache(docUri: Uri, extraEntities: string) {
    if (!extraEntities) {
      return;
    }
    const editorCache = this.getCache(getCleanPerpsectiveUriString(docUri));
    if (editorCache.extraEntities) {
      let modified = false;
      const ee = editorCache.extraEntities.split(";");
      const len = ee.length;
      extraEntities.split(";").forEach((e) => {
        const p = ee.indexOf(e);
        p > -1 && ee.splice(p, 1);
      });
      if (len > ee.length) {
        editorCache.extraEntities = ee.length ? ee.join(";") : undefined;
        modified = true;
      }
      if (modified) {
        this.context.workspaceState.update(ConfigEditorProvider.cacheName, this.cache);
      }
    }
  }

  private getHtmlForWebview(webview: Webview, document: TextDocument) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    // Script to handle user action
    const scriptUri = webview.asWebviewUri(joinPaths(this.extensionUri, webviewsLibraryDir, webviewsLibraryName));
    // CSS file to handle styling
    const styleUri = webview.asWebviewUri(joinPaths(this.extensionUri, webviewsLibraryDir, "config-editor.css"));

    const codiconsUri = webview.asWebviewUri(joinPaths(this.extensionUri, "@vscode/codicons", "dist", "codicon.css"));
    const taipyiconsUri = webview.asWebviewUri(joinPaths(this.extensionUri, webviewsLibraryDir, "taipy-icons.css"));

    const config = workspace.getConfiguration(TAIPY_STUDIO_SETTINGS_NAME);
    const configObj = nodeTypes4config.reduce((co, nodeType) => {
      co.icons[nodeType] = config.get("diagram." + nodeType + ".icon", "codicon-refresh");
      return co;
    }, getDefaultConfig(webview, this.extensionUri));

    const cssVars = nodeTypes4config
      .map((nodeType) => "--taipy-" + nodeType + "-color:" + config.get("diagram." + nodeType + ".color", "cyan") + ";")
      .join(" ");
    // Use a nonce to only allow a specific script to be run.
    const nonce = getNonce();
    return `<html style="${cssVars}">
              <head>
                  <meta charSet="utf-8"/>
                  <meta http-equiv="Content-Security-Policy" 
                        content="default-src 'none';
                        connect-src ${webview.cspSource} https:;
                        img-src ${webview.cspSource} https: data:;
                        font-src ${webview.cspSource};
                        style-src ${webview.cspSource} 'unsafe-inline';
                        script-src ${getCspScriptSrc(nonce)};">             
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <link href="${styleUri}" rel="stylesheet" />
                  <link href="${codiconsUri}" rel="stylesheet" />
                  <link href="${taipyiconsUri}" rel="stylesheet" />
                  <script nonce="${nonce}" defer type="text/javascript" src="${scriptUri}"></script>
                  <script nonce="${nonce}" type="text/javascript">window.taipyConfig=${JSON.stringify(
      configObj
    )};</script>
              </head>
              <body>
                <div id="${containerId}"></div>
              </body>
            </html>`;
  }

  private revealSection(uri: Uri, nodeType: string, name: string) {
    commands.executeCommand(revealConfigNodeCmd, getOriginalUri(uri), nodeType, name);
  }
}
