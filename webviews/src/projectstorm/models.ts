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

import { DefaultPortModel, DefaultPortModelOptions, DiagramModel, LinkModel, LinkModelGenerics, PortModelAlignment } from "@projectstorm/react-diagrams";

import { IN_PORT_NAME, onLinkRemove, OUT_PORT_NAME } from "../utils/diagram";
import { DataNode, Task } from "../../../shared/names";
import { getChildTypes } from "../../../shared/nodeTypes";

export class TaipyDiagramModel extends DiagramModel {}

export class TaipyPortModel extends DefaultPortModel {
  static createInPort() {
    return new TaipyPortModel({ in: true, name: IN_PORT_NAME, label: IN_PORT_NAME, alignment: PortModelAlignment.LEFT });
  }

  static createOutPort() {
    return new TaipyPortModel({ in: false, name: OUT_PORT_NAME, label: OUT_PORT_NAME, alignment: PortModelAlignment.RIGHT });
  }

  constructor(options: DefaultPortModelOptions) {
    super({
      ...options,
      type: "taipy-port",
    });
  }

  /**
   * Verify that a port can be linked to
   * @param {PortModel} port The port being linked to
   */
  canLinkToPort(port: TaipyPortModel) {
    // only out => In
    if (this.options.in || !port.getOptions().in) {
      return false;
    }
    // child type
    if (!getChildTypes(this.getNode()?.getType()).has(port.getNode()?.getType())) {
      // Task -> DataNode Link
      if (port.getNode().getType() !== Task || this.getNode().getType() !== DataNode) {
        return false;
      }
    }
    // Check unicity
    if (Object.values(this.getLinks()).some((link) => link.getTargetPort() === port)) {
      return false;
    }
    return true;
  }

  removeLink(link: LinkModel<LinkModelGenerics>): void {
    onLinkRemove(link);
    super.removeLink(link);
  }
}
