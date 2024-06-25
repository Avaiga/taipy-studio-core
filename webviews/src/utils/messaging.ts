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
  ACTION,
  CREATE_LINK,
  CREATE_NODE,
  DELETE_LINK,
  GET_NODE_NAME,
  SAVE_AS_PNG_URL,
  REFRESH,
  REMOVE_EXTRA_ENTITIES,
  REMOVE_NODE,
  SAVE_DOCUMENT,
  SET_EXTRA_ENTITIES,
  SET_POSITIONS,
  UPDATE_EXTRA_ENTITIES,
  EDIT_PROPERTY,
  EDIT_NODE_NAME,
  DELETE_PROPERTY,
} from "../../../shared/commands";
import { Positions } from "../../../shared/diagram";

type VsCodeApiRet = { postMessage: (pl: Record<string, unknown>) => void };

declare global {
  interface Window {
    acquireVsCodeApi: () => VsCodeApiRet;
    __webpack_nonce__: string;
  }
}

let vsCodeApi: VsCodeApiRet;

export const getVsCodeApi = () => {
  if (!vsCodeApi) {
    vsCodeApi = window.acquireVsCodeApi();
  }
  return vsCodeApi;
};

export const postActionMessage = (id: string, msg?: string, command = ACTION) =>
  getVsCodeApi()?.postMessage({ command, id, msg });
export const postRefreshMessage = () => getVsCodeApi()?.postMessage({ command: REFRESH });
export const postPositionsMessage = (positions: Positions) =>
  getVsCodeApi()?.postMessage({ command: SET_POSITIONS, positions });
export const postNodeCreation = (nodeType: string, nodeName: string) =>
  getVsCodeApi()?.postMessage({ command: CREATE_NODE, nodeType, nodeName });
export const postNodeRemoval = (nodeType: string, nodeName: string) =>
  getVsCodeApi()?.postMessage({ command: REMOVE_NODE, nodeType, nodeName });
export const postLinkCreation = (sourceType: string, sourceName: string, targetType: string, targetName: string) =>
  getVsCodeApi()?.postMessage({ command: CREATE_LINK, sourceType, sourceName, targetType, targetName });
export const postLinkDeletion = (sourceType: string, sourceName: string, targetType: string, targetName: string) =>
  getVsCodeApi()?.postMessage({ command: DELETE_LINK, sourceType, sourceName, targetType, targetName });
export const postGetNodeName = (nodeType: string, extras?: Record<string, unknown>) =>
  getVsCodeApi()?.postMessage({ command: GET_NODE_NAME, nodeType, extras });
export const postSetExtraEntities = (extraEntities: string) =>
  getVsCodeApi()?.postMessage({ command: SET_EXTRA_ENTITIES, extraEntities });
export const postUpdateExtraEntities = (extraEntities: string) =>
  getVsCodeApi()?.postMessage({ command: UPDATE_EXTRA_ENTITIES, extraEntities });
export const postRemoveExtraEntities = (extraEntities: string) =>
  getVsCodeApi()?.postMessage({ command: REMOVE_EXTRA_ENTITIES, extraEntities });
export const postSaveMessage = () => getVsCodeApi()?.postMessage({ command: SAVE_DOCUMENT });
export const postSaveAsPngUrl = (pngAsUrl: string) =>
  getVsCodeApi()?.postMessage({ command: SAVE_AS_PNG_URL, url: pngAsUrl });
export const postDeleteProperty = (
  nodeType: string,
  nodeName: string,
  propertyName?: string,
  extras?: Record<string, unknown>
) => getVsCodeApi()?.postMessage({ command: DELETE_PROPERTY, nodeType, nodeName, propertyName, extras });
export const postEditProperty = (
  nodeType: string,
  nodeName: string,
  propertyName?: string,
  propertyValue?: string | string[],
  extras?: Record<string, unknown>
) => getVsCodeApi()?.postMessage({ command: EDIT_PROPERTY, nodeType, nodeName, propertyName, propertyValue, extras });
export const postEditNodeName = (nodeType: string, nodeName: string, extras?: Record<string, unknown>) =>
  getVsCodeApi()?.postMessage({ command: EDIT_NODE_NAME, nodeType, nodeName, extras });
