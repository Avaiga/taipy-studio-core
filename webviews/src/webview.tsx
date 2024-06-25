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

import { useEffect, lazy, useState, Suspense } from "react";
import * as l10n from "@vscode/l10n";

import { ViewMessage } from "../../shared/messages";
import { CONFIG_EDITOR_ID, ConfigEditorProps, ENTITY_DETAILS_ID, EntityDetailsProps, NO_DETAILS_ID, NoDetailsProps } from "../../shared/views";
import { postRefreshMessage } from "./utils/messaging";

const NoDetails = lazy(() => import(/* webpackChunkName: "NoDetails" */ "./components/NoDetails"));
const EntityDetails = lazy(() => import(/* webpackChunkName: "EntityDetails" */ "./components/EntityDetails"));
const Editor = lazy(() => import(/* webpackChunkName: "Editor" */ "./components/Editor"));

const Loading = () => <div>Loading...</div>;

const WebView = () => {
  const [message, setMessage] = useState<ViewMessage>();

  useEffect(() => {
    // Manage Post Message reception
    const messageListener = (event: MessageEvent) => {
      if (event.data.viewId) {
        setMessage(event.data as ViewMessage);
      }
    };
    window.addEventListener("message", messageListener);
    return () => window.removeEventListener("message", messageListener);
  }, []);

  useEffect(() => {
    message || postRefreshMessage();
  }, [message]);

  if (message) {
    switch (message.viewId) {
      case NO_DETAILS_ID:
        return (
          <Suspense fallback={<Loading />}>
            <NoDetails {...(message.props as NoDetailsProps)} />
          </Suspense>
        );
      case ENTITY_DETAILS_ID:
        return (
          <Suspense fallback={<Loading />}>
            <EntityDetails {...(message.props as EntityDetailsProps)} />
          </Suspense>
        );
      case CONFIG_EDITOR_ID:
        return (
          <Suspense fallback={<Loading />}>
            <Editor {...(message.props as ConfigEditorProps)} />
          </Suspense>
        );
      default:
        break;
    }
  }
  return (
    <>
      <div className="icon" title={l10n.t("refresh")} onClick={postRefreshMessage}>
        <i className="codicon codicon-refresh"></i>
      </div>
      <Loading />
    </>
  );
};

export default WebView;
