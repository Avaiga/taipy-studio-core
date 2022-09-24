import { WebviewViewProvider, WebviewView, Webview, Uri, window } from "vscode";
import { config, MessageFormat } from "vscode-nls";

import { getCspScriptSrc, getNonce } from "../utils";
import {
  DataNodeDetailsId,
  NoDetailsId,
  webviewsLibraryDir,
  webviewsLibraryName,
  containerId,
} from "../../shared/views";

const localize = config({ messageFormat: MessageFormat.file })();

const emptyContent = localize("ConfigDetailsView.emptyContent", "No selected element");

export class ConfigDetailsView implements WebviewViewProvider {
  private _view: WebviewView;

  constructor(
    private readonly extensionPath: Uri,
    private data: any,
    private view: any = null
  ) {
    this.setEmptyContent();
  }

  setEmptyContent(): void {
    this._view?.webview.postMessage({
      name: NoDetailsId,
      props: { message: emptyContent },
    });
  }

  setDataNodeContent(name: string, storage_type: string, scope: string): void {
    this._view?.webview.postMessage({
      name: DataNodeDetailsId,
      props: { name: name, storage_type: storage_type, scope: scope },
    });
  }

  refresh(context: any): void {
    this._view.webview.html = this._getHtmlForWebview(this._view?.webview);
  }

  //called when a view first becomes visible
  resolveWebviewView(webviewView: WebviewView): void | Thenable<void> {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionPath],
    };
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    this._view = webviewView;
    this._view.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "SHOW_WARNING_LOG":
          window.showWarningMessage(message.data.message);
          break;
        case "refresh":
          this.setEmptyContent();
          break;
        case "action":
          window.showErrorMessage(
            "Action from webview",
            message.id,
            message.msg
          );
          break;
        default:
          break;
      }
    });
  }

  private joinPaths(...pathSegments: string[]): Uri {
    // TODO remove dist from production
    return Uri.joinPath(this.extensionPath, "dist", ...pathSegments);
  }

  private _getHtmlForWebview(webview: Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    // Script to handle user action
    const scriptUri = webview.asWebviewUri(
      this.joinPaths(webviewsLibraryDir, webviewsLibraryName)
    );
    // CSS file to handle styling
    const styleUri = webview.asWebviewUri(
      this.joinPaths("views", "config-panel.css")
    );

    const codiconsUri = webview.asWebviewUri(
      this.joinPaths("@vscode/codicons", "dist", "codicon.css")
    );

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
				</head>
				<body>
					<div id="${containerId}"></div>
				</body>
            </html>`;
  }
}
