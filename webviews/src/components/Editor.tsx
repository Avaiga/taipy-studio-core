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

import { ChangeEvent, MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { Point } from '@projectstorm/geometry';
import { CanvasWidget } from "@projectstorm/react-canvas-core";
import DomToImage from "dom-to-image-more";
import deepEqual from "fast-deep-equal";
import * as l10n from "@vscode/l10n";

import { ConfigEditorProps, perspectiveRootId } from "../../../shared/views";
import {
  postGetNodeName,
  postSaveAsPngUrl,
  postRefreshMessage,
  postSaveMessage,
  postSetExtraEntities,
} from "../utils/messaging";
import { applyPerspective, getNodeTypes } from "../utils/nodes";
import { EditorAddNodeMessage, EditorShowSequenceMessage } from "../../../shared/messages";
import { getNodeIcon } from "../utils/config";
import {
  diagramListener,
  initDiagram,
  populateModel,
  relayoutDiagram,
  setFactoriesSettings,
  showNode,
} from "../utils/diagram";
import { TaipyDiagramModel } from "../projectstorm/models";
import { applySmallChanges } from "../utils/smallModelChanges";
import { DisplayModel, NodeName, ScenarioSequence } from "../../../shared/diagram";
import { Sequence, Task } from "../../../shared/names";
import { TaipyNodeModel } from "src/projectstorm/factories";

const [engine, dagreEngine] = initDiagram();

const relayout = () => relayoutDiagram(engine, dagreEngine);

const filter4Print = (node: Node) => node.nodeName !== "DIV" || !(node as HTMLDivElement).dataset.printIgnore;

const saveAsPng = () =>
  DomToImage.toPng(document.body, { filter: filter4Print }).then(postSaveAsPngUrl).catch(console.warn);

const zoomToFit = () => engine.zoomToFit();

const showSequence = (sequence: string, tasks?: NodeName[]) => {
  const ts = tasks?.length ? tasks.map((t) => t.split(":", 2)[0]) : [];
  (engine.getModel().getNodes() as TaipyNodeModel[]).forEach((n) => {
    if (n.getType() === Task && ts.includes(n.getOptions().name || "")) {
      n.setExtraIcon(`${Sequence}.${sequence}`);
    } else {
      n.setExtraIcon(sequence && `-${Sequence}.${sequence}`);
    }
  });
  engine.setModel(engine.getModel());
};

const Editor = ({
  displayModel: propsDisplayModel,
  perspectiveId,
  baseUri,
  extraEntities: propsExtraEntities,
  isDirty,
}: ConfigEditorProps) => {
  const [sequence, setSequence] = useState("");
  const [sequences, setSequences] = useState<ScenarioSequence>();
  const oldDisplayModel = useRef<DisplayModel>();
  const oldPerspId = useRef<string>();

  setFactoriesSettings(engine, perspectiveId);
  const titles = perspectiveId !== perspectiveRootId ? perspectiveId.split(".") : [];

  const [displayModel, extraEntities] = applyPerspective(propsDisplayModel, perspectiveId, propsExtraEntities);

  useEffect(() => {
    propsExtraEntities && extraEntities && extraEntities !== propsExtraEntities && postSetExtraEntities(extraEntities);
  }, [propsExtraEntities, extraEntities]);

  useEffect(() => {
    // Manage Post Message reception
    const messageListener = (event: MessageEvent) => {
      event.data?.editorMessage && showNode(engine, event.data as EditorAddNodeMessage);
      event.data?.sequence && setSequence((event.data as EditorShowSequenceMessage).sequence);
    };
    window.addEventListener("message", messageListener);
    return () => window.removeEventListener("message", messageListener);
  }, [sequences]);

  useEffect(() => {
    showSequence(sequence, sequences && sequences[sequence]);
  }, [sequences, sequence]);

  const onSequenceChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => setSequence(e.target.value), []);

  useEffect(() => {
    if (!displayModel || (perspectiveId === oldPerspId.current && deepEqual(oldDisplayModel.current, displayModel))) {
      return;
    }
    if (
      perspectiveId === oldPerspId.current &&
      applySmallChanges(engine.getModel(), displayModel, oldDisplayModel.current)
    ) {
      oldDisplayModel.current = displayModel;
      return;
    }

    oldDisplayModel.current = displayModel;
    oldPerspId.current = perspectiveId;

    // clear model
    const model = new TaipyDiagramModel();
    // populate model
    const needsPositions = populateModel(displayModel, model);
    // populate sequences
    const [perspType, perspName] = perspectiveId.split(".", 2);
    const sequences = displayModel.sequences && perspName ? displayModel.sequences[perspName] : undefined;
    setSequences(sequences);
    // add listener to Model
    model.registerListener(diagramListener);

    const rects =
      engine.getModel() &&
      engine
        .getModel()
        .getNodes()
        .reduce((pv, nm) => {
          pv[nm.getID()] = nm.getPosition();
          return pv;
        }, {} as Record<string, Point>);
    const hasPos = rects && Object.keys(rects).length;
    if (hasPos) {
      model.getNodes().forEach((nm) => rects[nm.getID()] && nm.setPosition(rects[nm.getID()]));
    }

    if (needsPositions && !hasPos) {
      setTimeout(relayout, 500);
    }
    engine.setModel(model);
  }, [displayModel, baseUri, perspectiveId]);

  const onCreateNode = useCallback(
    (evt: MouseEvent<HTMLDivElement>) => {
      const nodeType = evt.currentTarget.dataset.nodeType;
      const [perspType, perspName] = perspectiveId.split(".", 2);
      nodeType && postGetNodeName(nodeType, perspName ? { [perspType]: perspName } : undefined);
    },
    [perspectiveId]
  );

  return (
    <>
      <div className="diagram-title">
        {titles.map((t, idx) =>
          idx % 2 == 0 ? (
            <div key={t} className={"diagram-icon icon " + t.toLowerCase()} title={t}>
              <i className={getNodeIcon(t)}></i>
            </div>
          ) : (
            <div key={t} className="diagram-title-text">
              <span>{t}</span>
            </div>
          )
        )}
        {sequences && Object.keys(sequences).length ? (
          <>
            <div>&gt;</div>
            <div className="diagram-title-select">
              <select value={sequence} onChange={onSequenceChange}>
                <option value="">...</option>
                {Object.keys(sequences).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
      </div>
      <div className="diagram-root">
        <div className="diagram-icon-group" data-print-ignore>
          <div className="diagram-button icon" title={l10n.t("Re-layout")} onClick={relayout}>
            <i className="taipy-icon-relayout"></i>
          </div>
          <div className="diagram-button icon" title={l10n.t("Refresh")} onClick={postRefreshMessage}>
            <i className="codicon codicon-refresh"></i>
          </div>
          {perspectiveId !== perspectiveRootId ? (
            <div
              className="diagram-button icon"
              title={isDirty ? l10n.t("Save") : l10n.t("File saved")}
              {...(isDirty ? { onClick: postSaveMessage } : {})}
            >
              <i className={"codicon codicon-" + (isDirty ? "circle-filled" : "circle-outline")}></i>
            </div>
          ) : null}
          <div className="diagram-button icon" title={l10n.t("Save as PNG")} onClick={saveAsPng}>
            <i className="codicon codicon-save-as"></i>
          </div>
          <div className="diagram-button icon" title={l10n.t("Zoom to fit")} onClick={zoomToFit}>
            <i className="codicon codicon-zap"></i>
          </div>
        </div>
        <div />
        <div className="diagram-icon-group" data-print-ignore>
          {getNodeTypes(perspectiveId).map((nodeType) => (
            <div
              className={"diagram-button icon " + nodeType.toLowerCase()}
              title={l10n.t("Add {0}", nodeType)}
              key={nodeType}
              data-node-type={nodeType}
              onClick={onCreateNode}
            >
              <i className={getNodeIcon(nodeType) + "-add"}></i>
            </div>
          ))}
        </div>
        <div className="diagram-widget" data-vscode-context={JSON.stringify({ baseUri: baseUri })}>
          <CanvasWidget engine={engine} />
        </div>
      </div>
    </>
  );
};

export default Editor;
