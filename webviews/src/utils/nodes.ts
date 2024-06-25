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

import { DisplayModel, Link, Nodes } from "../../../shared/diagram";
import { DataNode, Scenario, Sequence, Task } from "../../../shared/names";
import { perspectiveRootId } from "../../../shared/views";
import { isRoot } from "./config";

const applyNode = (displayModel: DisplayModel, nodeType: string, nodeName: string): DisplayModel => {
  if (!displayModel.nodes || !Array.isArray(displayModel.links)) {
    return displayModel;
  }
  const nodes = {} as Nodes;
  const links = [] as Link[];
  const queue: Array<[string, string, boolean]> = [];
  const doneNodes: Set<string> = new Set();
  const modelLinks = [...displayModel.links];
  let follow = true;
  while (true) {
    if (!nodeType || !nodeName) {
      break;
    }
    if (!doneNodes.has(`${nodeType}.${nodeName}`)) {
      doneNodes.add(`${nodeType}.${nodeName}`);
      const node = displayModel.nodes[nodeType] && displayModel.nodes[nodeType][nodeName];
      if (node) {
        nodes[nodeType] = nodes[nodeType] || {};
        nodes[nodeType][nodeName] = node;
        if (!follow) {
          continue;
        }
        const foundLinks = [] as number[];
        modelLinks.forEach((link, idx) => {
          const [[sourceType, sourceName, targetType, targetName], _] = link;
          if (sourceType === nodeType && sourceName === nodeName) {
            queue.push([targetType, targetName, DataNode !== targetType]);
            links.push(link);
            foundLinks.push(idx);
          } else if (sourceType === DataNode && targetType === nodeType && targetName === nodeName) {
            queue.push([sourceType, sourceName, false]);
            links.push(link);
            foundLinks.push(idx);
          }
        });
        foundLinks
          .sort()
          .reverse()
          .forEach((idx) => modelLinks.splice(idx, 1));
      }
    }
    [nodeType, nodeName, follow] = queue.shift() || ["", "", false];
  }
  return { nodes, links, sequences: {} };
};

export const applyPerspective = (
  displayModel: DisplayModel,
  perspectiveId: string,
  extraEntities?: string
): [DisplayModel, string | undefined] => {
  if (!displayModel || isRoot(perspectiveId)) {
    return [displayModel, undefined];
  }
  const appliedEntities: string[] = [];
  const [nodeType, nodeName] = perspectiveId.split(".");
  const res = applyNode(displayModel, nodeType, nodeName);
  delete res.nodes[nodeType];
  extraEntities &&
    extraEntities.split(";").forEach((e) => {
      const [nt, nn] = e.split(".", 2);
      if (nt && nn && !(res.nodes[nt] && res.nodes[nt][nn])) {
        appliedEntities.push(e);
        const nodeRes = applyNode(displayModel, nt, nn);
        Object.entries(nodeRes.nodes).forEach(([t, e]) => {
          if (!res.nodes[t]) {
            res.nodes[t] = e;
          } else {
            Object.entries(e).forEach(([n, d]) => (res.nodes[t][n] = d));
          }
        });
        res.links.push(...nodeRes.links);
      }
    });
  if (displayModel.sequences[nodeName]) {
    res.sequences[nodeName] = displayModel.sequences[nodeName];
  }
  return [res, appliedEntities.length ? appliedEntities.join(";") : undefined];
};

const orderedTypes: Record<string, string[]> = {
  [Scenario]: [Sequence, Task, DataNode],
  [perspectiveRootId]: [Scenario, Task, DataNode],
};

export const getNodeTypes = (perspectiveId: string) =>
  orderedTypes[perspectiveId.split(".", 2)[0]] || orderedTypes[perspectiveRootId];
