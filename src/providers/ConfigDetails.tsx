import { WebviewViewProvider, WebviewView, Webview, Uri, window } from "vscode";
import { getNonce } from "../utils";
import NoDetails from '../components/NoDetails';
import DataNodeDetails from '../components/DataNodeDetails';
import { renderToString } from "react-dom/server";
import { hydrate } from "react-dom";

export class ConfigDetailsView implements WebviewViewProvider {
	private panelContent: JSX.Element;

	constructor(private readonly extensionPath: Uri,
							private data: any,
						  private _view: any = null) {
		this.setEmptyContent()
	}
	
	setEmptyContent(): void {
		this.panelContent = (<NoDetails message={"No selected element"}></NoDetails>)
	}

	setDataNodeContent(name: string, storage_type: string, scope: string): void {
		this.panelContent =
			(<DataNodeDetails name={name} storage_type={storage_type} scope={scope}></DataNodeDetails>)
		this.refresh(null)
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
				case 'SHOW_WARNING_LOG':
					window.showWarningMessage(message.data.message);
					break;
				case 'action':
					window.showErrorMessage("Action from webview", message.id, message.msg);
					break;
				default:
					break;
			}
		});
	}

	private joinPaths(...pathSegments: string[]): Uri {
		return Uri.joinPath(this.extensionPath, "dist", ...pathSegments)
	}

	private _getHtmlForWebview(webview: Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		// Script to handle user action
		const scriptUri = webview.asWebviewUri(this.joinPaths("views", "config-panel-provider.js"));
		const utilsUri = webview.asWebviewUri(this.joinPaths("components", "utils.js"));
		const constantUri = webview.asWebviewUri(this.joinPaths("constants.js"));
		// CSS file to handle styling
		const styleUri = webview.asWebviewUri(this.joinPaths("views", "config-panel.css"));

		//vscode-icon file from codicon lib
		const codiconsUri = webview.asWebviewUri(this.joinPaths("assets", "codicon.css"));

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
											script-src 'nonce-${nonce}';">             
								<meta name="viewport" content="width=device-width, initial-scale=1.0">
								<link href="${codiconsUri}" rel="stylesheet" />
								<link href="${styleUri}" rel="stylesheet">
							</head>
							<body>
								${renderToString(this.panelContent)}
							  <script nonce="${nonce}" >const exports = {};</script>
							  <script nonce="${nonce}" type="text/javascript" src="${constantUri}"></script>
							  <script nonce="${nonce}" src="${scriptUri}"></script>
							  <script nonce="${nonce}" src="${utilsUri}"></script>
							  <script nonce="${nonce}" >document.querySelectorAll("button").forEach(elt => !elt.onclick && (elt.onclick = (e) => postActionMessage(e.currentTarget.id)));</script>
							</body>
            </html>`;
	}
}
