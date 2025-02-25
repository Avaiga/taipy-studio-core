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

import { CancellationToken, DataTransfer, DocumentDropEdit, DocumentDropEditProvider, Position, TextDocument, Uri, workspace } from "vscode";

import { Context } from "../context";
import { TAIPY_STUDIO_SETTINGS_NAME } from "../utils/constants";
import { getLog } from "../utils/logging";
import { getPropertyToDropType, getSectionName } from "../utils/symbols";
import { textUriListMime } from "../utils/utils";
import { getNodeFromUri, getPerspectiveFromUri, isUriEqual } from "./PerpectiveContentProvider";

export class ConfigDropEditProvider implements DocumentDropEditProvider {
  static register(context: Context) {
    return new ConfigDropEditProvider(context);
  }

  private constructor(private readonly context: Context) {}

  async provideDocumentDropEdits(
    document: TextDocument,
    position: Position,
    dataTransfer: DataTransfer,
    token: CancellationToken
  ): Promise<DocumentDropEdit | undefined> {
    const enabled = workspace.getConfiguration(TAIPY_STUDIO_SETTINGS_NAME).get("editor.drop.enabled", true);
    if (!enabled) {
      return undefined;
    }

    if (!dataTransfer || token.isCancellationRequested) {
      return undefined;
    }
    const urlList = await dataTransfer.get(textUriListMime)?.asString();
    if (!urlList) {
      return undefined;
    }
    const uris: Uri[] = [];
    urlList.split("\n").forEach((u) => {
      try {
        u && uris.push(Uri.parse(u, true));
      } catch {
        getLog().warn("provideDocumentDropEdits: Cannot parse ", u);
      }
    });
    if (!uris.length) {
      return undefined;
    }
    const dropEdit = new DocumentDropEdit("");
    if (isUriEqual(uris[0], document.uri)) {
      // TODO handle multi-uris case (but you can't drag more than one treeItem ...)
      const [nodeType, nodeName] = getPerspectiveFromUri(uris[0]).split(".", 2);
      const properties = getPropertyToDropType(nodeType);
      if (nodeName) {
        const line = document.lineAt(position.line);
        const lineProperty = line.text.split("=", 2)[0];
        if (properties.some((p) => p === lineProperty.trim())) {
          const endPos = line.text.lastIndexOf("]");
          const startPos = line.text.indexOf("[", lineProperty.length + 1);
          if (position.character <= endPos && position.character > startPos) {
            const lastChar = line.text.substring(0, position.character).trim().at(-1);
            if (lastChar === '"' || lastChar === "'" || lastChar === "[" || lastChar === ",") {
              dropEdit.insertText =
                (lastChar === '"' || lastChar === "'" ? ", " : "") +
                '"' +
                getSectionName(nodeName) +
                '"' +
                (lastChar === "," ? ", " : "");
            }
          }
        }
      }
    } else {
      const node = getNodeFromUri(uris[0]);
      if (node) {
        const lines: string[] = ["", "[" + getPerspectiveFromUri(uris[0]) + "]"];
        node.split("\n").forEach((l) => lines.push(l && "\t" + l));
        dropEdit.insertText = lines.join("\n");
      }
    }
    return dropEdit;
  }
}
