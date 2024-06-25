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

import createEngine, {
  DefaultLinkModel,
  DefaultPortModel,
  DiagramListener,
  DiagramModel,
  LinkModel,
  LinkModelListener,
  NodeModelListener,
  DefaultDiagramState,
  PortModel,
  LinkModelGenerics,
  DiagramEngine,
  DagreEngine,
  PointModel,
  DefaultNodeModelOptions,
} from "@projectstorm/react-diagrams";
import { BaseEvent, BaseEntityEvent } from "@projectstorm/react-canvas-core";
import debounce from "debounce";

import { SELECT } from "../../../shared/commands";
import { DisplayModel, Positions, WebContext } from "../../../shared/diagram";
import { EditorAddNodeMessage } from "../../../shared/messages";
import { DataNode, Scenario, Task } from "../../../shared/names";

import { nodeTypes, isRoot, getNodeColor } from "./config";
import {
  postActionMessage,
  postLinkCreation,
  postLinkDeletion,
  postNodeCreation,
  postNodeRemoval,
  postPositionsMessage,
  postUpdateExtraEntities,
} from "./messaging";
import { TaipyDiagramModel, TaipyPortModel } from "../projectstorm/models";
import { TaipyNodeFactory, TaipyNodeModel, TaipyPortFactory } from "../projectstorm/factories";

export const initDiagram = (): [DiagramEngine, DagreEngine, TaipyDiagramModel] => {
  const engine = createEngine();
  nodeTypes.forEach((nodeType) => engine.getNodeFactories().registerFactory(new TaipyNodeFactory(nodeType)));
  engine.getPortFactories().registerFactory(new TaipyPortFactory());
  const state = engine.getStateMachine().getCurrentState();
  if (state instanceof DefaultDiagramState) {
    state.dragNewLink.config.allowLooseLinks = false;
  }
  const dagreEngine = new DagreEngine({
    graph: {
      rankdir: "LR",
      ranker: "longest-path",
      marginx: 25,
      marginy: 25,
    },
    includeLinks: true,
  });
  const model = new TaipyDiagramModel();
  engine.setModel(model);
  return [engine, dagreEngine, model];
};

export const setFactoriesSettings = (engine: DiagramEngine, perspective: string) => {
  const fact = engine.getNodeFactories();
  nodeTypes.forEach((nodeType) => (fact.getFactory(nodeType) as TaipyNodeFactory).setSettings(perspective));
};

const openPerspective: Record<string, boolean> = {
  [Scenario]: true,
};
export const shouldOpenPerspective = (nodeType: string) => !!(nodeType && openPerspective[nodeType]);

export const getModelNodes = (model: TaipyDiagramModel) => Object.values(model.getActiveNodeLayer().getNodes());
export const getModelLinks = (model: TaipyDiagramModel) => Object.values(model.getActiveLinkLayer().getLinks());

export const getNodeByName = (model: TaipyDiagramModel, paths: string[]) => {
  const [nodeType, ...parts] = paths;
  const name = parts.join(".");
  return name
    ? (getModelNodes(model).find(
        (n) => n.getType() == nodeType && (n.getOptions() as DefaultNodeModelOptions).name === name
      ) as TaipyNodeModel)
    : undefined;
};

export const IN_PORT_NAME = "In";
export const OUT_PORT_NAME = "Out";

const nodePorts: Record<string, [boolean, boolean]> = {
  [DataNode]: [true, true],
  [Task]: [true, true],
  [Scenario]: [false, true],
};
const setPorts = (node: TaipyNodeModel) => {
  const [inPort, outPort] = nodePorts[node.getType()];
  inPort && node.addPort(TaipyPortModel.createInPort());
  outPort && node.addPort(TaipyPortModel.createOutPort());
};

export const getLinkId = (link: LinkModel) =>
  `LINK.${getNodeId(link.getSourcePort().getNode() as TaipyNodeModel)}.${getNodeId(
    link.getTargetPort().getNode() as TaipyNodeModel
  )}`;
export const getNodeId = (node: TaipyNodeModel) => `${node.getType()}.${node.getOptions().name}`;

const fireNodeSelected = (nodeType: string, name?: string) => name && postActionMessage(nodeType, name, SELECT);

export const cachePositions = (model: DiagramModel) => {
  const pos = getModelNodes(model).reduce((ps, node) => {
    const pNode = node as TaipyNodeModel;
    const nodeName = getNodeId(pNode);
    const pos = pNode.getPosition();
    if (nodeName && pos) {
      ps[nodeName] = [[pos.x, pos.y]];
    }
    return ps;
  }, {} as Positions);
  const posL = getModelLinks(model).reduce((ps, link) => {
    const linkName = getLinkId(link);
    const points = link.getPoints();
    if (linkName && points) {
      ps[linkName] = points.map((p) => [p.getPosition().x, p.getPosition().y]);
    }
    return ps;
  }, pos);
  postPositionsMessage(posL);
};

const getNodeAndLinksPositions = (node: TaipyNodeModel, positions: Positions = {}) => {
  const nodeId = getNodeId(node);
  const pos = node.getPosition();
  if (nodeId && pos) {
    positions[nodeId] = [[pos.x, pos.y]];
  }
  Object.values(node.getPorts()).forEach((port) =>
    Object.values(port.getLinks()).forEach((l) => {
      const linkName = getLinkId(l);
      const points = l.getPoints();
      if (linkName && points) {
        positions[linkName] = points.map((p) => [p.getPosition().x, p.getPosition().y]);
      }
    })
  );
  return positions;
};

const postPoss = (getPoss: (node: TaipyNodeModel) => Positions, node: TaipyNodeModel) =>
  postPositionsMessage(getPoss(node));
const debouncedPostPoss = debounce(postPoss, 500);

const nodeListener = {
  selectionChanged: (e: BaseEvent) => {
    if ((e as any).isSelected) {
      const node = (e as BaseEntityEvent<TaipyNodeModel>).entity;
      if (node.getType() && node.getOptions().name) {
        fireNodeSelected(node.getType(), node.getOptions().name);
      }
    }
  },
  positionChanged: (e: BaseEvent) =>
    debouncedPostPoss(getNodeAndLinksPositions, (e as BaseEntityEvent<TaipyNodeModel>).entity),
} as NodeModelListener;

const linkListener = {
  targetPortChanged: (e: BaseEvent) => {
    const evt = e as BaseEntityEvent<DefaultLinkModel> & { port: null | PortModel };
    if (evt.port) {
      const link = evt.entity;
      const sourceNode = link.getSourcePort()?.getNode() as TaipyNodeModel;
      const targetNode = evt.port.getNode() as TaipyNodeModel;
      if (sourceNode && targetNode) {
        postLinkCreation(
          sourceNode.getType(),
          sourceNode.getOptions().name || "",
          targetNode.getType(),
          targetNode.getOptions().name || ""
        );
      }
    }
  },
} as LinkModelListener;

const DO_NOT_POST_REMOVE = "doNotPostRemove";

export const diagramListener = {
  nodesUpdated: (e: BaseEvent) => {
    const evt = e as BaseEntityEvent<DiagramModel> & { node: TaipyNodeModel; isCreated: boolean };
    const node = evt.node;
    if (evt.isCreated) {
      postNodeCreation(node.getType(), node.getOptions().name || "");
    } else {
      //mark the link as not post to
      Object.values(node.getPorts()).forEach((p) =>
        Object.values(p.getLinks()).forEach((l) => (l.getOptions().extras = DO_NOT_POST_REMOVE))
      );
      postNodeRemoval(node.getType(), node.getOptions().name || "");
    }
  },
  linksUpdated: (e: BaseEvent) => {
    const evt = e as BaseEntityEvent<DiagramModel> & { link: DefaultLinkModel; isCreated: boolean };
    if (evt.isCreated) {
      evt.link.registerListener(linkListener);
    }
  },
} as DiagramListener;

export const onLinkRemove = (link: LinkModel<LinkModelGenerics>) => {
  if (link.getOptions().extras === DO_NOT_POST_REMOVE) {
    console.log("onLinkRemove blocked by node removal");
    return;
  }
  const sourceNode = link.getSourcePort()?.getNode() as TaipyNodeModel;
  const targetNode = link.getTargetPort()?.getNode() as TaipyNodeModel;
  if (sourceNode && targetNode) {
    postLinkDeletion(
      sourceNode.getType(),
      sourceNode.getOptions().name || "",
      targetNode.getType(),
      targetNode.getOptions().name || ""
    );
  }
};

export const createNode = (nodeType: string, nodeName: string, createPorts = true) => {
  const node = new TaipyNodeModel({
    type: nodeType,
    name: nodeName,
    color: getNodeColor(nodeType),
  });
  createPorts && setPorts(node);
  node.registerListener(nodeListener);
  return node;
};

const createLink = (outPort: DefaultPortModel, inPort: DefaultPortModel) => {
  const link = outPort.link<DefaultLinkModel>(inPort);
  return link;
};

export const showNode = (engine: DiagramEngine, message: EditorAddNodeMessage) => {
  const model = engine.getModel();
  let node = getModelNodes(model).find(
    (n) => n.getType() === message.nodeType && (n as TaipyNodeModel).getOptions().name === message.nodeName
  );
  if (node) {
    const canvas = engine.getCanvas();
    const ratio = model.getZoomLevel() / 100;
    model.setOffset(
      (canvas.offsetWidth - node.width * ratio) / 2 - node.getPosition().x * ratio,
      (canvas.offsetHeight - node.height * ratio) / 2 - node.getPosition().y * ratio
    );
  } else {
    node = model.addNode(createNode(message.nodeType, message.nodeName));
    node.setPosition(-model.getOffsetX(), -model.getOffsetY());
  }
  engine.repaintCanvas();
  postUpdateExtraEntities(`${message.nodeType}.${message.nodeName}`);
};

const isInLine = (pnt: PointModel, startLine: PointModel, endLine: PointModel) => {
  const L2 =
    (endLine.getX() - startLine.getX()) * (endLine.getX() - startLine.getX()) +
    (endLine.getY() - startLine.getY()) * (endLine.getY() - startLine.getY());
  if (L2 === 0) {
    return false;
  }
  const r =
    ((pnt.getX() - startLine.getX()) * (endLine.getX() - startLine.getX()) +
      (pnt.getY() - startLine.getY()) * (endLine.getY() - startLine.getY())) /
    L2;

  //Assume line thickness is circular
  if (0 <= r && r <= 1) {
    //On the line segment
    const s =
      ((startLine.getY() - pnt.getY()) * (endLine.getX() - startLine.getX()) -
        (startLine.getX() - pnt.getX()) * (endLine.getY() - startLine.getY())) /
      L2;
    return Math.abs(s) * Math.sqrt(L2) <= lineLeeway;
  }
  return false;
};

const lineLeeway = 0.1;

export const relayoutDiagram = (engine: DiagramEngine, dagreEngine: DagreEngine) => {
  const model = engine.getModel();
  dagreEngine.redistribute(model);
  //  engine.getLinkFactories().getFactory<PathFindingLinkFactory>(PathFindingLinkFactory.NAME).calculateRoutingMatrix();
  getModelLinks(model).forEach((l) => {
    const points = l.getPoints();
    if (points.length === 3) {
      // remove unnecessary intermediate if same level
      if (
        Math.abs(points[0].getX() - points[2].getX()) < lineLeeway ||
        Math.abs(points[0].getY() - points[2].getY()) < lineLeeway
      ) {
        points.splice(1, 1);
        l.setPoints(points);
      }
    } else if (points.length > 3) {
      const pointsToRemove = [] as number[];
      let startIdx = 0;
      while (startIdx + 2 < points.length) {
        if (isInLine(points[startIdx + 1], points[startIdx], points[startIdx + 2])) {
          pointsToRemove.push(startIdx + 1);
        }
        startIdx++;
      }
      pointsToRemove.reverse().forEach((idx) => points.splice(idx, 1));
      l.setPoints(points);
    }
  });
  engine.repaintCanvas();
  cachePositions(model);
};

export const getNodeContext = (node: TaipyNodeModel, perspective: string) => {
  const vscodeContext: WebContext = {
    preventDefaultContextMenuItems: true,
    webviewSection: "taipy-dup",
    nodeType: node.getType(),
    nodeName: node.getOptions().name,
  };
  if (!isRoot(perspective)) {
    vscodeContext.webviewSection += "-del";
    if (Task === vscodeContext.nodeType && node.extraIcon) {
      const [perspType, perspName] = perspective.split(".");
      const [sType, sequence] = node.extraIcon.split(".");
      if (sequence && perspType === Scenario) {
        vscodeContext.scenario = perspName;
        vscodeContext.sequence = sequence;
      }
    }
  }
  if (shouldOpenPerspective(node.getType())) {
    vscodeContext.webviewSection += "-persp";
  }
  if (vscodeContext.sequence && node.extraIcon) {
    vscodeContext.webviewSection += node.extraIcon.startsWith("-") ? "-addSeq" : "-rmSeq";
  }
  return JSON.stringify(vscodeContext);
};

export const populateModel = (displayModel: DisplayModel, model: TaipyDiagramModel) => {
  let needsPosition = 0;
  let needsNotPosition = 0;
  const linkModels: DefaultLinkModel[] = [];
  const nodeModels: Record<string, Record<string, TaipyNodeModel>> = {};

  displayModel.nodes &&
    Object.entries(displayModel.nodes).forEach(([nodeType, n]) => {
      Object.entries(n).forEach(([nodeName, nodeDetail]) => {
        const node = createNode(nodeType, nodeName);
        if (Array.isArray(nodeDetail.position) && nodeDetail.position.length > 1) {
          node.setPosition(nodeDetail.position[0], nodeDetail.position[1]);
          needsNotPosition++;
        } else {
          needsPosition++;
        }
        nodeModels[nodeType] = nodeModels[nodeType] || {};
        nodeModels[nodeType][nodeName] = node;
      });
    });

  Array.isArray(displayModel.links) &&
    displayModel.links.forEach(([[nodeType, nodeName, childType, childName], linkDetail]) => {
      const parentNode = nodeModels[nodeType] && nodeModels[nodeType][nodeName];
      const childNode = nodeModels[childType] && nodeModels[childType][childName];
      if (parentNode && childNode) {
        const link = createLink(
          parentNode.getPort(OUT_PORT_NAME) as DefaultPortModel,
          childNode.getPort(IN_PORT_NAME) as DefaultPortModel
        );
        if (Array.isArray(linkDetail.positions) && linkDetail.positions.length) {
          link.setPoints(linkDetail.positions.map(([x, y]) => link.point(x, y)));
        }
        linkModels.push(link);
      }
    });

  const nodeLayer = model.getActiveNodeLayer();
  Object.values(nodeModels).forEach((nm) => Object.values(nm).forEach((n) => nodeLayer.addModel(n)));
  const linkLayer = model.getActiveLinkLayer();
  linkModels.forEach((l) => linkLayer.addModel(l));

  return needsPosition > needsNotPosition;
};
