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

import { Fragment, MouseEvent, useCallback, useMemo } from "react";
import * as l10n from "@vscode/l10n";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

import { postDeleteProperty, postEditNodeName, postEditProperty } from "../utils/messaging";
import { EntityDetailsProps as EntityDetailsProps, WebDiag } from "../../../shared/views";

const getAsString = (val: string | string[]) =>
  Array.isArray(val) ? (val as string[]).join(", ") : typeof val === "string" ? val : JSON.stringify(val);

const getDiagContext = (diag: WebDiag) =>
  JSON.stringify({
    webviewSection: "taipy-property",
    baseUri: diag.uri,
  });

const getDiagStyle = (diag: WebDiag) =>
  (diag.severity !== undefined
    ? {
        textDecorationLine: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor:
          diag.severity === 0
            ? "var(--vscode-editorError-foreground)"
            : diag.severity === 1
            ? "var(--vscode-editorWarning-foreground)"
            : "var(--vscode-editorInfo-foreground)",
      }
    : { textDecorationLine: "underline" }) as React.CSSProperties;

const EntityPanel = ({ nodeType, nodeName, node, diagnostics, orderedProps, allProps }: EntityDetailsProps) => {
  const extras = useMemo(
    () =>
      Object.entries(node).reduce((o, [k, v]) => {
        if (k.startsWith("__")) {
          o[k.substring(2)] = v;
        }
        return o;
      }, {} as typeof node),
    [node]
  );

  const editPropertyValue = useCallback(
    (evt: MouseEvent<HTMLElement>) => {
      const propertyName = evt.currentTarget.dataset.propertyName;
      postEditProperty(nodeType, nodeName, propertyName, propertyName && node[propertyName], extras);
    },
    [nodeType, nodeName, node, extras]
  );

  const deleteProperty = useCallback(
    (evt: MouseEvent<HTMLElement>) =>
      postDeleteProperty(nodeType, nodeName, evt.currentTarget.dataset.propertyName, extras),
    [nodeType, nodeName, node, extras]
  );

  const editNodeName = useCallback(() => postEditNodeName(nodeType, nodeName, extras), [nodeType, nodeName, extras]);

  const sortProps = useCallback(
    ([propa, _a]: [string, any], [propb, _b]: [string, any]) =>
      orderedProps ? orderedProps.indexOf(propa) - orderedProps.indexOf(propb) : 0,
    [orderedProps]
  );

  return (
    <div className="taipy-entity-panel">
      <div className="property-grid">
        <h2>{nodeType}</h2>
        <h2 className="edit-value" onClick={editNodeName}>
          {nodeName}
        </h2>
        <div />
        {Object.entries(node)
          .filter(([k]) => !k.startsWith("__"))
          .sort(sortProps)
          .map(([k, n]) => {
            const valProps =
              diagnostics && diagnostics[k]
                ? {
                    title: diagnostics[k].message,
                    "data-vscode-context": getDiagContext(diagnostics[k]),
                    style: getDiagStyle(diagnostics[k]),
                  }
                : {};
            return (
              <Fragment key={k}>
                <div {...valProps}>{k}</div>
                <div className="edit-value" {...valProps} data-property-name={k} onClick={editPropertyValue}>
                  {getAsString(n)}
                </div>
                <div
                  className="panel-button icon"
                  data-property-name={k}
                  title={l10n.t("Delete")}
                  onClick={deleteProperty}
                >
                  <i className="codicon codicon-trash"></i>
                </div>
              </Fragment>
            );
          })}
        {allProps ? null : (
          <>
            <div className="new-property">
              <VSCodeButton onClick={editPropertyValue}>
                {l10n.t("Create new property")}&nbsp;
                <span className="codicon codicon-add" />
              </VSCodeButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EntityPanel;
