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

import { createRoot } from "react-dom/client";
import { config } from "@vscode/l10n";
import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";

import { containerId } from "../../shared/views";
import WebView from "./webview";

// @ts-ignore
__webpack_nonce__ = document.currentScript?.nonce;

declare global {
  interface Window {
      taipyConfig: {
          icons: Record<string, string>;
          l10nUri?: string;
      };
      [key: string]: unknown;
  }
}

provideVSCodeDesignSystem().register(vsCodeButton());

window.taipyConfig.l10nUri && config({uri: window.taipyConfig.l10nUri});

const container = document.getElementById(containerId);
if (container) {
  createRoot(container).render(<WebView />);
}
