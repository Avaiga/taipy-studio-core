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

export type NodeType = string;
export type NodeName = string;
export type PosX = number;
export type PosY = number;
export type Pos = [PosX, PosY];
export type NodeDetail = { position?: Pos };
export type Nodes = Record<NodeType, Record<NodeName, NodeDetail>>;
export type LinkName = [NodeType, NodeName, NodeType, NodeName];
export type LinkDetail = { positions: Pos[] };
export type Link = [LinkName, LinkDetail];
export type ScenarioSequence = Record<string, NodeName[]>;
export type Sequences = Record<NodeName, ScenarioSequence>;
export type DisplayModel = { nodes: Nodes; links: Link[]; sequences: Sequences };
export type Positions = Record<string, Pos[]>;
export type WebContext = {
  baseUri?: string;
  preventDefaultContextMenuItems: boolean;
  webviewSection: string;
  nodeType: string;
  nodeName?: string;
  scenario?: string;
  sequence?: string;
};
