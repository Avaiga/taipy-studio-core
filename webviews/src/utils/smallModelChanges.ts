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

import { getDiff } from "recursive-diff";
import { DisplayModel } from "../../../shared/diagram";

import { TaipyDiagramModel, TaipyPortModel } from "../projectstorm/models";
import { createNode, getNodeByName, IN_PORT_NAME, OUT_PORT_NAME } from "./diagram";

export const applySmallChanges = (model: TaipyDiagramModel, displayModel: DisplayModel, oldDisplayModel?: DisplayModel) => {
  if (!oldDisplayModel) {
    return false;
  }
  const diff = getDiff(oldDisplayModel, displayModel, true);
  if (diff.length > 0) {
    // TODO Not Working right now ... Is it needed ?
    return false;
  }
  const ops = diff.map((d) => d.op);
  const delI = ops.indexOf("delete");
  const addI = ops.indexOf("add");
  if (delI === -1 || addI === -1) {
    return false;
  }
  const pathLen = diff[addI].path.length;
  if (pathLen !== diff[delI].path.length || !diff[addI].path.slice(0, -1).every((p, i) => p === diff[delI].path[i])) {
    // only deal with last path changes
    return false;
  }
  if (diff[addI].path[pathLen - 1] === diff[delI].path[pathLen - 1]) {
    // Change in links
    return false;
  }
  // Change in name
  const oldNode = getNodeByName(model, diff[delI].path as string[]);
  if (!oldNode) {
    return false;
  }
  const [nodeType, ...parts] = diff[addI].path as string[];
  const name = parts.join(".");
  const node = createNode(nodeType, name, false);
  node.setPosition(oldNode.getPosition());

  const inPort = oldNode.getPort(IN_PORT_NAME);
  if (inPort) {
    const port = node.addPort(TaipyPortModel.createInPort());
    model.getLinkLayers().forEach((ll) =>
      Object.entries(ll.getLinks())
        .filter(([_, l]) => l.getTargetPort() === inPort)
        .forEach(([id]) => ll.removeModel(id))
    );
  }

  const outPort = oldNode.getPort(OUT_PORT_NAME);
  if (outPort) {
    const port = node.addPort(TaipyPortModel.createOutPort());
    model.getLinkLayers().forEach((ll) =>
      Object.entries(ll.getLinks())
        .filter(([_, l]) => l.getSourcePort() === outPort)
        .forEach(([_, l]) => {
          l.setSourcePort(port);
        })
    );
  }
  model.removeNode(oldNode);
  model.addNode(node);

  return true;
};
