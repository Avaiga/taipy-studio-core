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

import { exec } from "child_process";
import { commands, l10n, Position, Uri, Webview, workspace } from "vscode";

import { getLog } from "./logging";
import { ConfigItem } from "../providers/ConfigNodesProvider";

export const getNonce = () => {
  const crypto = require("crypto");
  return crypto?.randomBytes(16).toString("base64");
};

export const configFileExt = ".toml";
export const configFilePattern = `**/*${configFileExt}`;

export const getCspScriptSrc = (nonce: string) => {
  return "'nonce-" + nonce + "'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "");
};

export const textUriListMime = "text/uri-list";

export const joinPaths = (extensionUri: Uri, ...pathSegments: string[]): Uri =>
  Uri.joinPath(extensionUri, "dist", ...pathSegments);

export const getDefaultConfig = (webview: Webview, extensionUri: Uri) => {
  const bundleName = l10n.uri && l10n.uri.path.split("/").at(-1);
  return {
    icons: {},
    l10nUri: bundleName && webview.asWebviewUri(joinPaths(extensionUri, "l10n", bundleName)).toString(),
  };
};

export const getPositionFragment = (pos: Position) => `L${pos.line + 1}C${pos.character}`;

export const getFileFromPythonPackages = (file: string, packages: string[]) => {
  return new Promise<Record<string, string>>((resolve, reject) => {
    commands
      .executeCommand(
        "python.interpreterPath",
        workspace.workspaceFolders?.map(({ uri }) => uri.fsPath)
      )
      .then(
        (pythonPath: string) => doGetFileFromPythonPackage(pythonPath, file, packages, resolve, reject),
        () =>
          doGetFileFromPythonPackage(
            workspace.getConfiguration("python").get("defaultInterpreterPath", "python"),
            file,
            packages,
            resolve,
            reject
          )
      );
  });
};

const doGetFileFromPythonPackage = (
  pythonPath: string,
  file: string,
  packages: string[],
  resolve: (val: Record<string, string>) => void,
  reject: (err: unknown) => void
) => {
  getLog().info(l10n.t("Using Python interpreter: {0}", pythonPath));
  const cmd = `"${pythonPath}" "${
    Uri.joinPath(Uri.file(__dirname), "python", "find_file_in_package.py").fsPath
  }" "${file}" "${packages.join('" "')}"`;
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      error.code > 1 && getLog().warn(cmd, "=>", error);
      stderr &&
        getLog().warn(
          stderr
            .split(/\r?\n|\r|\n/g)
            .filter((v) => v)
            .join("\n")
        );
      return reject(error.code);
    }
    return resolve(JSON.parse(stdout));
  });
};

export const getExtras = (node: object) =>
  node
    ? Object.entries(node).reduce((o, [k, v]) => {
        k.startsWith("__") && (o[k.substring(2)] = v);
        return o;
      }, {} as Record<string, string>)
    : {};

export const getArrayText = (array?: string[], fn: (a:string) => string = (a: string) => a) => array?.length ? `[${'"' + array.map(fn).join('", "') + '"'}]` : '[]';