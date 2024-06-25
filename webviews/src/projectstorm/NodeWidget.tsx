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

import { useCallback, useEffect, useState } from "react";
import { DiagramEngine, NodeModelListener } from "@projectstorm/react-diagrams-core";
import styled from "@emotion/styled";
import { BaseEntityEvent, DefaultPortModel, PortWidget } from "@projectstorm/react-diagrams";

import { IN_PORT_NAME, OUT_PORT_NAME, getNodeContext } from "../utils/diagram";
import { getNodeIcon } from "../utils/config";
import { ICON_CHANGED_EVENT, TaipyNodeModel } from "./factories";

namespace S {
  export const Node = styled.div<{ background?: string; selected?: boolean }>`
    background-color: ${(p) => p.background};
    border-radius: 5px;
    color: white;
    border: solid 2px black;
    overflow: visible;
    border: solid 2px ${(p) => (p.selected ? "rgb(0,192,255)" : "black")};
  `;

  export const Title = styled.div`
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    white-space: nowrap;
    justify-items: center;
  `;

  export const TitleName = styled.div`
    flex-grow: 1;
    padding: 0.3em 0.3em 0.3em 0;
  `;

  export const SubTitleName = styled.span`
    font-size: smaller;
    padding-left: 0.7em;
  `;

  export const TitleIcon = styled.div`
    padding: 0.3em;
  `;

  export const Ports = styled.div`
    display: flex;
    background-image: linear-gradient(rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.2));
  `;

  export const PortsContainer = styled.div`
    flex-grow: 1;
    display: flex;
    flex-direction: column;
  `;

  export const OutPortLabel = styled.div`
    display: flex;
    align-items: end;
    justify-content: end;
    & svg {
      display: block;
    }
    & i:hover {
      background: rgb(192, 255, 0);
    }
  `;

  export const InPortLabel = styled.div`
    display: flex;
    align-items: end;
    & svg {
      display: block;
    }
    & i:hover {
      background: rgb(192, 255, 0);
    }
  `;
}

interface NodeProps {
  node: TaipyNodeModel;
  engine: DiagramEngine;
  perspective: string;
}

const NodeWidget = ({ node, perspective, engine }: NodeProps) => {
  const [extraIcon, setExtraIcon] = useState<string[]>();
  useEffect(() => {
    node.registerListener({
      [ICON_CHANGED_EVENT]: (event: BaseEntityEvent<TaipyNodeModel>) =>
        setExtraIcon(
          event.entity.extraIcon && !event.entity.extraIcon.startsWith("-")
            ? event.entity.extraIcon.split(".", 2)
            : undefined
        ),
    } as unknown as NodeModelListener);
  }, [node]);

  const generatePort = useCallback(
    (port: DefaultPortModel) =>
      port.getName() === IN_PORT_NAME ? (
        <S.InPortLabel key={IN_PORT_NAME}>
          <PortWidget engine={engine} port={port} key={port.getID()}>
            <i className="taipy-icon-input"></i>
          </PortWidget>
        </S.InPortLabel>
      ) : (
        <S.OutPortLabel key={OUT_PORT_NAME}>
          <PortWidget engine={engine} port={port} key={port.getID()}>
            <i className="taipy-icon-output"></i>
          </PortWidget>
        </S.OutPortLabel>
      ),
    [engine]
  );

  return (
    <S.Node
      data-default-node-name={node.getOptions().name}
      data-vscode-context={getNodeContext(node, perspective)}
      selected={node.isSelected()}
      background={node.getOptions().color}
    >
      <S.Title>
        <S.TitleIcon className="icon" title={node.getType()}>
          <i className={getNodeIcon(node.getType())}></i>
        </S.TitleIcon>
        <S.TitleName>{node.getOptions().name}</S.TitleName>
        {extraIcon?.length ? (
          <S.TitleIcon className="icon" title={extraIcon[1]}>
            <i className={getNodeIcon(extraIcon[0])}></i>
          </S.TitleIcon>
        ) : null}
      </S.Title>
      <S.Ports>
        <S.PortsContainer>{node.getInPorts().map(generatePort)}</S.PortsContainer>
        <S.PortsContainer>{node.getOutPorts().map(generatePort)}</S.PortsContainer>
      </S.Ports>
    </S.Node>
  );
};

export default NodeWidget;
