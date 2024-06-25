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
  DataTransfer,
  Event,
  EventEmitter,
  l10n,
  ProviderResult,
  TreeDataProvider,
  TreeDragAndDropController,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from "vscode";

import { selectConfigNodeCmd } from "../utils/commands";
import { Context } from "../context";
import { getPerspectiveUri } from "./PerpectiveContentProvider";
import { DataNode, Sequence, Scenario, Task } from "../../shared/names";
import { getNodeFromSymbol } from "../utils/symbols";

const titles = {
  [DataNode]: l10n.t("Select data node"),
  [Task]: l10n.t("Select task"),
  [Sequence]: l10n.t("Select sequence"),
  [Scenario]: l10n.t("Select scenario"),
};
const getTitleFromType = (nodeType: string) => titles[nodeType] || "Select Something";

const treeViewIdFromTypes = {
  [DataNode]: "taipy-config-datanodes",
  [Task]: "taipy-config-tasks",
  [Scenario]: "taipy-config-scenarios",
};
export const getTreeViewIdFromType = (nodeType: string) => treeViewIdFromTypes[nodeType] || "";
const getMimeTypeFromType = (nodeType: string) => "application/vnd.code.tree." + getTreeViewIdFromType(nodeType);

const refreshCommandIdFromTypes = {
  [DataNode]: "taipy.refreshDataNodes",
  [Task]: "taipy.refreshTasks",
  [Sequence]: "taipy.refreshSequences",
  [Scenario]: "taipy.refreshScenarios",
};
export const getRefreshCommandIdFromType = (nodeType: string) => refreshCommandIdFromTypes[nodeType];

const createCommandIdFromType = {
  [DataNode]: "taipy.config.datanode.create",
  [Task]: "taipy.config.task.create",
  [Sequence]: "taipy.config.sequence.create",
  [Scenario]: "taipy.config.scenario.create",
};
export const getCreateCommandIdFromType = (nodeType: string) => createCommandIdFromType[nodeType];

const hasSequences = (node: JsonMap) => !!node?.sequences;

export abstract class ConfigItem extends TreeItem {
  abstract getNodeType();
  baseUri: Uri;
  parent: ConfigItem | undefined;
  constructor(name: string, private readonly node: JsonMap) {
    super(name, hasSequences(node) ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None);
    this.iconPath = "-";
    this.contextValue = name === "default" ? name : this.getNodeType();
    this.tooltip = name;
  }
  setResourceUri(uri: Uri) {
    this.baseUri = uri;
    this.resourceUri = getPerspectiveUri(
      uri,
      this.getNodeType() + "." + this.label,
      typeof this.node === "object"
        ? Array.isArray(this.node)
          ? JSON.stringify(this.node)
          : stringify(this.node)
        : "" + this.node
    );
    this.command = {
      command: selectConfigNodeCmd,
      title: getTitleFromType(this.contextValue),
      arguments: [this.contextValue, this.label, this.node, this.resourceUri],
    };
  }
  getNode() {
    return this.node;
  }
  getChildren(): ConfigItem[] {
    return [];
  }
  setParent(parent: ConfigItem) {
    this.parent = parent;
  }
}
export class DataNodeItem extends ConfigItem {
  getNodeType() {
    return DataNode;
  }
}

export class TaskItem extends ConfigItem {
  getNodeType() {
    return Task;
  }
}

export class SequenceItem extends ConfigItem {
  getNodeType() {
    return Sequence;
  }
}

export class ScenarioItem extends ConfigItem {
  getNodeType() {
    return Scenario;
  }
  getChildren() {
    return this.getNode()
      ? Object.entries(this.getNode().sequences || {}).map(([k, v]) => {
          const si = new SequenceItem(k, { ["__" + Scenario]: this.label as string, tasks: v });
          si.setParent(this);
          si.setResourceUri(this.baseUri);
          return si;
        })
      : [];
  }
}

export type TreeNodeCtor<T extends ConfigItem> = new (name: string, node: object) => T;

export class ConfigNodesProvider<T extends ConfigItem = ConfigItem>
  implements TreeDataProvider<T>, TreeDragAndDropController<T>
{
  private _onDidChangeTreeData: EventEmitter<T | undefined> = new EventEmitter<T | undefined>();
  readonly onDidChangeTreeData: Event<T | undefined> = this._onDidChangeTreeData.event;

  private configItems: T[] = [];
  private nodeType: string;

  constructor(context: Context, private readonly nodeCtor: TreeNodeCtor<T>) {
    this.nodeType = new nodeCtor(undefined, undefined).getNodeType();
    this.dragMimeTypes = [getMimeTypeFromType(this.nodeType)];
    this.refresh(context, context.getConfigUri());
  }

  dropMimeTypes: readonly string[];
  dragMimeTypes: readonly string[];
  handleDrag?(source: T[], treeDataTransfer: DataTransfer, token: CancellationToken): ProviderResult<void> {
    // This need to be present so that drag can be initiated from treeviews
  }

  getNodeForUri(uri: string) {
    return this.configItems.find((i) => i.resourceUri.toString() === uri);
  }

  async refresh(context: Context, uri?: Uri): Promise<void> {
    if (uri) {
      const doc = await context.getDocFromUri(uri);
      const configNodeSymbols = context.getConfigNodes(this.nodeType);
      const configNodes: T[] = configNodeSymbols.map((s) => {
        const item = new this.nodeCtor(s.name, getNodeFromSymbol(doc, s));
        item.setResourceUri(uri);
        return item;
      });
      this.configItems = configNodes;
    } else {
      this.configItems = [];
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getItem(nodeName: string) {
    return nodeName && this.configItems.find((n) => n.label === nodeName);
  }

  getNodeType() {
    return this.nodeType;
  }

  getTreeItem(element: T): TreeItem {
    return element;
  }

  getChildren(element?: T): Thenable<T[]> {
    if (element) {
      return Promise.resolve(element.getChildren() as T[]);
    } else if (!this.configItems) {
      return Promise.resolve([]);
    } else {
      return Promise.resolve(this.configItems);
    }
  }

  getParent(element: T): ProviderResult<T> {
    return element.parent as T;
  }
}
