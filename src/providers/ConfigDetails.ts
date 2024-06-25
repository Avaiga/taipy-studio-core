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
  WebviewViewProvider,
  WebviewView,
  Webview,
  Uri,
  window,
  ExtensionContext,
  QuickPickItem,
  workspace,
  Range,
  TextEdit,
  WorkspaceEdit,
  TextDocument,
  l10n,
  languages,
  commands,
  DocumentLink,
  QuickPickItemKind,
  Position,
  ProgressLocation,
  Diagnostic,
  DocumentSymbol,
} from "vscode";

import { getCspScriptSrc, getDefaultConfig, getNonce, getPositionFragment, joinPaths } from "../utils/utils";
import {
  ENTITY_DETAILS_ID,
  NO_DETAILS_ID,
  webviewsLibraryDir,
  webviewsLibraryName,
  containerId,
  EntityDetailsProps,
  NoDetailsProps,
  WebDiag,
} from "../../shared/views";
import { ACTION, DELETE_PROPERTY, EDIT_NODE_NAME, EDIT_PROPERTY, REFRESH } from "../../shared/commands";
import { ViewMessage } from "../../shared/messages";
import { Context } from "../context";
import { getOriginalUri, isUriEqual } from "./PerpectiveContentProvider";
import {
  getEnum,
  getEnumProps,
  getProperties,
  calculatePythonSymbols,
  isFunction,
  isClass,
  getDefaultValues,
} from "../schema/validation";
import {
  extractModule,
  getNodeFromSymbol,
  getParentTypes,
  getPythonSuffix,
  getSectionName,
  getSymbol,
  getSymbolArrayValue,
  getUnsuffixedName,
} from "../utils/symbols";
import { stringify } from "@iarna/toml";
import {
  checkPythonIdentifierValidity,
  getCreateFunctionOrClassLabel,
  getModulesAndSymbols,
  getNodeNameValidationFunction,
  MAIN_PYTHON_MODULE,
} from "../utils/pythonSymbols";
import { getLog } from "../utils/logging";
import { getDescendantProperties } from "../../shared/nodeTypes";
import { PROP_SEQUENCES, Scenario, Sequence } from "../../shared/names";

export class ConfigDetailsView implements WebviewViewProvider {
  private _view: WebviewView;
  private readonly extensionUri: Uri;
  private configUri: Uri;
  private nodeType: string;
  private nodeName: string;

  constructor(private readonly context: ExtensionContext, private readonly taipyContext: Context) {
    this.extensionUri = context.extensionUri;
    this.setEmptyContent();
  }

  setEmptyContent(): void {
    this._view?.webview.postMessage({
      viewId: NO_DETAILS_ID,
      props: { message: l10n.t("No selected element.") } as NoDetailsProps,
    } as ViewMessage);
  }

  async setConfigNodeContent(nodeType: string, name: string, node: object, uri: Uri) {
    this.configUri = getOriginalUri(uri);
    this.nodeType = nodeType;
    this.nodeName = name;
    const props = await getProperties(nodeType);
    const allProps = !props.some((p) => !(p in node));
    const orderedProps = allProps ? props : props.filter((prop) => prop in node);
    this.getNodeDiagnosticsAndLinks(node, name).then((diags) => {
      this._view?.webview.postMessage({
        viewId: ENTITY_DETAILS_ID,
        props: {
          nodeType,
          nodeName: name,
          node,
          diagnostics: Object.keys(diags).length ? diags : undefined,
          orderedProps,
          allProps,
        } as EntityDetailsProps,
      } as ViewMessage);
    });
  }

  private addDiagnostic(symbol: DocumentSymbol, diags: Diagnostic[], links: DocumentLink[], key: string, obj: object) {
    if (symbol) {
      const diag = diags.find((d) => !!d.range.intersection(symbol.range));
      if (diag) {
        obj[key] = {
          message: diag.message,
          severity: diag.severity,
          uri: this.configUri.with({ fragment: getPositionFragment(diag.range.start) }).toString(),
        };
      }
      const link = links.find((l) => !!l.range.intersection(symbol.range));
      if (link) {
        obj[key] = obj[key] || { uri: "" };
        obj[key].uri = link.target?.toString();
        obj[key].link = true;
      }
    }
    return obj;
  }

  private async getNodeDiagnosticsAndLinks(node: object, name: string) {
    const diags = languages.getDiagnostics(this.configUri);
    const links = (await commands.executeCommand("vscode.executeLinkProvider", this.configUri)) as DocumentLink[];
    if (diags.length || links.length) {
      const symbols = this.taipyContext.getSymbols(this.configUri.toString());
      if (this.nodeType === Sequence) {
        return this.addDiagnostic(
          getSymbol(symbols, Scenario, node[`__${Scenario}`], PROP_SEQUENCES, name),
          diags,
          links,
          "tasks",
          {}
        );
      }
      const parentSymbol = getSymbol(symbols, this.nodeType, this.nodeName);
      if (parentSymbol) {
        return Object.keys(node).reduce((obj, key) => {
          if (key.startsWith("_")) {
            return obj;
          }
          return this.addDiagnostic(getSymbol(parentSymbol.children, key), diags, links, key, obj);
        }, {} as Record<string, WebDiag>);
      }
    }
    return {};
  }

  //called when a view first becomes visible
  resolveWebviewView(webviewView: WebviewView): void | Thenable<void> {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
      enableCommandUris: true,
    };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    this._view = webviewView;
    this._view.webview.onDidReceiveMessage(
      (e) => {
        switch (e.command) {
          case "SHOW_WARNING_LOG":
            window.showWarningMessage(e.data.message);
            break;
          case REFRESH:
            this.setEmptyContent();
            break;
          case ACTION:
            window.showErrorMessage("Action from webview", e.id, e.msg);
            break;
          case EDIT_PROPERTY:
            this.editProperty(e.nodeType, e.nodeName, e.propertyName, e.propertyValue, e.extras);
            break;
          case DELETE_PROPERTY:
            this.deleteProperty(e.nodeType, e.nodeName, e.propertyName, e.extras);
            break;
          case EDIT_NODE_NAME:
            this.editNodeName(e.nodeType, e.nodeName, e.extras);
            break;
          default:
            break;
        }
      },
      this,
      this.context.subscriptions
    );

    this.taipyContext.registerDocChangeListener(this.docListener, this);
    this._view.onDidDispose(() => {
      this.taipyContext.unregisterDocChangeListener(this.docListener, this);
    });
  }

  private docListener(textDocument: TextDocument) {
    if (isUriEqual(this.configUri, textDocument.uri)) {
      const symbols = this.taipyContext.getSymbols(this.configUri.toString());
      if (!symbols) {
        this.setEmptyContent();
      }
      const nameSymbol = getSymbol(symbols, this.nodeType, this.nodeName);
      const node = getNodeFromSymbol(textDocument, nameSymbol);
      this._view?.webview.postMessage({
        viewId: ENTITY_DETAILS_ID,
        props: { nodeType: this.nodeType, nodeName: this.nodeName, node: node } as EntityDetailsProps,
      } as ViewMessage);
    }
}

  private async deleteProperty(
    nodeType: string,
    nodeName: string,
    propertyName: string,
    extras?: Record<string, string>
  ) {
    const yes = l10n.t("Yes");
    const res = await window.showInformationMessage(
      l10n.t("Do you confirm the deletion of property {0} from entity {1} in toml?", propertyName, nodeName),
      l10n.t("No"),
      yes
    );
    if (res !== yes) {
      return;
    }
    const symbols = this.taipyContext.getSymbols(this.configUri.toString());
    if (!symbols) {
      return;
    }
    const propertyRange = getSymbol(symbols, nodeType, nodeName, propertyName).range;
    const we = new WorkspaceEdit();
    we.set(this.configUri, [TextEdit.delete(propertyRange.with(propertyRange.start.with(undefined, 0)))]);
    return workspace.applyEdit(we);
  }

  private async editProperty(
    nodeType: string,
    nodeName: string,
    propertyName?: string,
    propertyValue?: string | string[],
    extras?: Record<string, string>
  ) {
    const symbols = this.taipyContext.getSymbols(this.configUri.toString());
    if (!symbols) {
      return;
    }
    const isSequence = nodeType === Sequence;
    const insert = !propertyName;
    let propertyRange: Range;
    if (insert) {
      const nameSymbol = getSymbol(symbols, nodeType, nodeName);
      propertyRange = nameSymbol.range;
      const currentProps = nameSymbol.children.map((s) => s.name.toLowerCase());
      currentProps.push(PROP_SEQUENCES);
      const properties = (await getProperties(nodeType)).filter((p) => !currentProps.includes(p.toLowerCase()));
      propertyName = await window.showQuickPick(properties, {
        canPickMany: false,
        title: l10n.t("Select property for {0}.", nodeType),
      });
      if (!propertyName) {
        return;
      }
    } else {
      propertyRange =
        isSequence && extras
          ? getSymbol(symbols, Scenario, extras[Scenario], PROP_SEQUENCES, nodeName).range
          : getSymbol(symbols, nodeType, nodeName, propertyName).range;
    }
    let newVal: string | string[];
    const linksPropType = getDescendantProperties(nodeType)
      .filter((p) => p)
      .reduce((pv, cv) => {
        Object.entries(cv).forEach((a) => pv.push(a));
        return pv;
      }, [])
      .find(([p]) => p.toLowerCase() === propertyName?.toLowerCase());
    if (linksPropType) {
      const childType = linksPropType[1];
      const values = ((propertyValue || []) as string[]).map((v) => getUnsuffixedName(v.toLowerCase()));
      const childNames = getSymbol(symbols, childType).children.map(
        (s) =>
          ({
            label: getSectionName(s.name),
            picked: values.includes(getUnsuffixedName(s.name.toLowerCase())),
          } as QuickPickItem)
      );
      if (!childNames.length) {
        window.showInformationMessage(l10n.t("No {0} entity in toml.", childType));
        getLog().info(l10n.t("No {0} entity in toml.", childType));
        return;
      }
      const res = await window.showQuickPick(childNames, {
        canPickMany: true,
        title: l10n.t("Select {0} entities for {1}.{2}", childType, nodeType, propertyName),
      });
      if (!res) {
        return;
      }
      newVal = res.map((q) => q.label);
    } else {
      await calculatePythonSymbols();
      const isFn = isFunction(propertyName);
      if (isFn || isClass(propertyName)) {
        const [symbolsWithModule, modulesByUri, mainModule] = await window.withProgress(
          { location: ProgressLocation.Notification, title: l10n.t("Retrieving Python information") },
          () => getModulesAndSymbols(isFn)
        );
        const currentModule = extractModule(propertyValue as string);
        let resMod: string;
        if (Object.keys(modulesByUri).length) {
          let mainIdx = -1;
          const items = Object.entries(modulesByUri).map(([uri, module], idx) => {
            module === MAIN_PYTHON_MODULE && (mainIdx = idx);
            return {
              label: module,
              description: module === MAIN_PYTHON_MODULE ? uri.split("/").at(-1) : undefined,
              picked: module === currentModule,
              uri: uri,
            } as QuickPickItem & { uri?: string; create?: boolean };
          });
          if (mainIdx > -1 && mainModule) {
            items.splice(mainIdx, 0, {
              label: mainModule,
              uri: items[mainIdx].uri,
              picked: mainModule === currentModule,
            });
          }
          items.push({ label: "", kind: QuickPickItemKind.Separator });
          items.push({ label: l10n.t("New module name"), create: true });
          const item = await window.showQuickPick(items, {
            canPickMany: false,
            title: l10n.t("Select Python module for {0}.{1}", nodeType, propertyName),
          });
          if (!item) {
            return;
          }
          if (!item.create) {
            resMod = item.label;
          }
        }
        if (!resMod) {
          resMod = await window.showInputBox({
            title: l10n.t("Enter Python module for {0}.{1}", nodeType, propertyName),
            value: currentModule,
          });
          if (resMod) {
            resMod = resMod.trim();
          }
        }
        if (!resMod) {
          return;
        }
        const symbols = symbolsWithModule.filter((s) => s.startsWith(resMod + "."));
        let resFunc: string;
        if (symbols.length) {
          const currentfunc =
            propertyValue &&
            propertyValue.includes(".") &&
            (propertyValue as string).startsWith(resMod + ".") &&
            (propertyValue as string).substring(resMod.length + 1);
          const items = symbols.map(
            (fn) => ({ label: fn, picked: fn === currentfunc } as QuickPickItem & { create?: boolean })
          );
          items.push({ label: "", kind: QuickPickItemKind.Separator });
          items.push({ label: getCreateFunctionOrClassLabel(isFn), create: true });
          const item = await window.showQuickPick(items, {
            canPickMany: false,
            title: l10n.t("Select Python {0} for {1}.{2}", getPythonSuffix(isFn), nodeType, propertyName),
          });
          if (!item) {
            return;
          }
          if (!item.create) {
            resFunc = item.label;
          }
        }
        if (!resFunc) {
          resFunc = await window.showInputBox({
            title: l10n.t("Enter Python {0} name for {1}.{2}", getPythonSuffix(isFn), nodeType, propertyName),
            value: getPythonSuffix(isFn),
            valueSelection: [0, getPythonSuffix(isFn).length],
            validateInput: checkPythonIdentifierValidity,
          });
        }
        if (!resFunc) {
          return;
        }
        newVal = `${resFunc}:${getPythonSuffix(isFn)}`;
      } else {
        const enumProps = await getEnumProps();
        const enumProp = enumProps.find((p) => p.toLowerCase() === propertyName?.toLowerCase());
        const defaultValue = (await getDefaultValues(nodeType))[propertyName];
        const res = enumProp
          ? await window.showQuickPick(
              getEnum(enumProp).map((v) => ({ label: v, picked: v === (propertyValue || defaultValue) })),
              { canPickMany: false, title: l10n.t("Select value for {0}.{1}", nodeType, propertyName) }
            )
          : await window.showInputBox({
              title: l10n.t("Enter value for {0}.{1}", nodeType, propertyName),
              value: (propertyValue || defaultValue) as string,
            });
        if (res === undefined) {
          return;
        }
        newVal = typeof res === "string" ? res : res.label;
      }
    }
    if (insert) {
      propertyRange = propertyRange.with({ end: propertyRange.end.with({ character: 0 }) });
    }
    const we = new WorkspaceEdit();
    we.set(this.configUri, [
      insert
        ? TextEdit.insert(propertyRange.end, `${propertyName} = ${stringify.value(newVal).trim()}\n`)
        : TextEdit.replace(propertyRange, stringify.value(newVal).trim()),
    ]);
    return workspace.applyEdit(we);
  }

  private async editNodeName(nodeType: string, nodeName: string, extras?: Record<string, string>) {
    return this.doRenameNode(this.configUri, nodeType, nodeName, extras);
  }

  async createSequence(uri: Uri, nodeType: string, nodeName: string) {
    const symbols = this.taipyContext.getSymbols(uri.toString());
    if (!symbols) {
      return false;
    }
    const scenarioSymbol = getSymbol(symbols, nodeType, nodeName);
    const parentSymbol = getSymbol(scenarioSymbol.children, PROP_SEQUENCES);
    const seqs = parentSymbol ? parentSymbol.children.map((c) => c.name) : [];
    let idx = 1;
    while (seqs.includes(`${Sequence}_${idx}`)) {
      idx++;
    }
    const newName = await window.showInputBox({
      title: l10n.t("Enter new identifier for {0}", Sequence),
      value: `${Sequence}_${idx}`,
      validateInput: getNodeNameValidationFunction(parentSymbol),
    });
    if (newName === undefined || newName === nodeName) {
      return false;
    }
    const range = parentSymbol ? parentSymbol.range : scenarioSymbol.range;
    const text = parentSymbol
      ? `${newName} = []\n`
      : `\n[${nodeType}.${nodeName}.${PROP_SEQUENCES}]\n${newName} = []\n`;
    const we = new WorkspaceEdit();
    we.set(uri, [TextEdit.insert(range.end.translate(1), text)]);
    return workspace.applyEdit(we);
  }

  async doRenameNode(uri: Uri, nodeType: string, nodeName: string, extras?: Record<string, string>) {
    const symbols = this.taipyContext.getSymbols(uri.toString());
    if (!symbols) {
      return false;
    }
    const isSequence = nodeType === Sequence;
    const parentSymbol =
      isSequence && extras
        ? getSymbol(symbols, Scenario, extras[Scenario], PROP_SEQUENCES)
        : getSymbol(symbols, nodeType);
    const newName = await window.showInputBox({
      title: l10n.t("Enter new identifier for {0}", nodeType),
      value: nodeName,
      validateInput: getNodeNameValidationFunction(parentSymbol, nodeName),
    });
    if (newName === undefined || newName === nodeName) {
      return false;
    }
    const blockRange = getSymbol(parentSymbol.children, nodeName).range;
    const doc = await this.taipyContext.getDocFromUri(uri);
    const text = isSequence ? doc.lineAt(blockRange.start.line).text : doc.getText(blockRange);
    const base = isSequence ? text.indexOf(nodeName) : text.indexOf(nodeType + ".");
    if (base === -1) {
      return false;
    }
    const startPos = isSequence
      ? blockRange.start.with(undefined, base)
      : blockRange.start.translate(undefined, base + nodeType.length + 1);
    const nameRange = blockRange.with({ start: startPos, end: startPos.translate(undefined, nodeName.length) });

    if (this.nodeType === nodeType && this.nodeName === nodeName) {
      this.nodeName = newName;
    }
    const tes = [TextEdit.replace(nameRange, newName)];

    if (!isSequence) {
      const seqSymbol = nodeType === Scenario && getSymbol(parentSymbol.children, nodeName, PROP_SEQUENCES);
      if (seqSymbol) {
        const text = doc.lineAt(seqSymbol.range.start.line).text;
        const base = text.indexOf(`${nodeType}.${nodeName}.`);
        if (base > -1) {
          const start = seqSymbol.range.start.with(undefined, base + nodeType.length + 1);
          const nameRange = seqSymbol.range.with(start, start.translate(undefined, nodeName.length));
          tes.push(TextEdit.replace(nameRange, newName));
        }
      }
      this.taipyContext.updateElement(nodeType, nodeName, newName);
      // Apply change to references
      const parentTypes = getParentTypes(nodeType);
      parentTypes &&
        parentTypes.forEach((parentType) => {
          const descProps = getDescendantProperties(parentType).filter((p) => p);
          if (descProps.length) {
            const oldNameRegexp = new RegExp(`(['"]${getUnsuffixedName(nodeName)}['":])`);
            if (parentType !== Sequence) {
              getSymbol(symbols, parentType).children.forEach((parentSymbol) => {
                descProps.forEach((desc) => {
                  Object.keys(desc).forEach((property) => {
                    this.replaceSymbol(
                      doc,
                      getSymbol(parentSymbol.children, property),
                      nodeName,
                      newName,
                      oldNameRegexp,
                      tes
                    );
                  });
                });
              });
            } else {
              getSymbol(symbols, Scenario)
                .children.map((c) => {
                  const seqs = getSymbol(c.children, PROP_SEQUENCES);
                  return seqs ? seqs.children : [];
                })
                .flat()
                .forEach((propSymbol) => this.replaceSymbol(doc, propSymbol, nodeName, newName, oldNameRegexp, tes));
            }
          }
        });
    }

    const we = new WorkspaceEdit();
    we.set(uri, tes);
    return workspace.applyEdit(we);
  }

  private replaceSymbol(
    doc: TextDocument,
    propSymbol: DocumentSymbol,
    nodeName: string,
    newName: string,
    re: RegExp,
    textEdits: TextEdit[]
  ) {
    if (getSymbolArrayValue(doc, propSymbol)?.some((val) => nodeName === getUnsuffixedName(val))) {
      for (let i = propSymbol.range.start.line; i <= propSymbol.range.end.line; i++) {
        const line = doc.lineAt(i).text;
        const res = re.exec(line);
        if (res) {
          const start = line.indexOf(res[1]) + 1;
          textEdits.push(
            TextEdit.replace(new Range(new Position(i, start), new Position(i, start + res[1].length - 2)), newName)
          );
        }
      }
    }
  }

  private getHtmlForWebview(webview: Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    // Script to handle user action
    const scriptUri = webview.asWebviewUri(joinPaths(this.extensionUri, webviewsLibraryDir, webviewsLibraryName));
    // CSS file to handle styling
    const styleUri = webview.asWebviewUri(joinPaths(this.extensionUri, webviewsLibraryDir, "config-panel.css"));

    const codiconsUri = webview.asWebviewUri(joinPaths(this.extensionUri, "@vscode/codicons", "dist", "codicon.css"));

    // Use a nonce to only allow a specific script to be run.
    const nonce = getNonce();
    return `<html>
                <head>
                    <meta charSet="utf-8"/>
                    <meta http-equiv="Content-Security-Policy" 
                                content="default-src 'none';
                                img-src vscode-resource: https:;
                                font-src ${webview.cspSource};
                                style-src ${webview.cspSource} 'unsafe-inline';
                                script-src ${getCspScriptSrc(nonce)};">             
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <link href="${styleUri}" rel="stylesheet" />
                    <link href="${codiconsUri}" rel="stylesheet" />
                    <script nonce="${nonce}" defer type="text/javascript" src="${scriptUri}"></script>
          <script nonce="${nonce}" type="text/javascript">window.taipyConfig=${JSON.stringify(
      getDefaultConfig(webview, this.extensionUri)
    )};</script>
                </head>
                <body>
                    <div id="${containerId}"></div>
                </body>
      </html>`;
  }
}
