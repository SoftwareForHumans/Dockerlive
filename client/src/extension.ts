/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import * as vscode from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient";
import { PerformanceGraphs } from "./performance";
import { FilesystemVisualizer } from "./filesystem";
import { Analytics } from "./analytics";

import RepairProvider from "./repair/RepairProvider";
import HermitRepairProvider from "./repair/HermitRepairProvider";
import { generate, generateAlternative } from "./hermit/commands";

let client: LanguageClient;
let analytics: Analytics;
let performanceCurrentPanel: vscode.WebviewPanel | undefined;
let filesystemCurrentPanel: vscode.WebviewPanel | undefined;
let initialData: any;
let currentDocumentUri: string;

export async function activate(context: vscode.ExtensionContext) {
  let dockerlive = vscode.extensions.getExtension("david-reis.dockerlive");

  analytics = new Analytics(dockerlive.id, dockerlive.packageJSON.version);
  context.subscriptions.push(analytics.reporter);

  let pGraphs = new PerformanceGraphs();
  let fsViz = new FilesystemVisualizer();

  vscode.commands.registerCommand("dockerlive.stop", () => {
    client.sendNotification("dockerlive/stop");
    analytics.sendEvent("stopContainer");
  });

  vscode.commands.registerCommand("dockerlive.restart", () => {
    client.sendNotification("dockerlive/restart");
    analytics.sendEvent("restartContainer");
  });

  vscode.commands.registerCommand("dockerlive.openShell", () => {
    client.sendNotification("dockerlive/getContainerName");
  });

  vscode.commands.registerCommand("dockerlive.toggle", () => {
    client.sendNotification("dockerlive/toggle");
    analytics.sendEvent("toggleAnalysis");
  });

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: "dockerfile", scheme: "file" },
      new RepairProvider()
    )
  );

  const hermitRepair = new HermitRepairProvider();

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: "dockerfile", scheme: "file" },
      hermitRepair
    )
  );

  vscode.commands.registerCommand("dockerlive.generateWithHermit", generate);

  vscode.commands.registerCommand(
    "dockerlive.generateAlternativeWithHermit",
    generateAlternative.bind(null, hermitRepair)
  );

  let codeLensProvider = new DockerfileCodeLensProvider();

  initializePerformanceWebview(context, pGraphs);
  initializeFilesystemWebview(context, fsViz);
  initializeLanguageServer(context).then((_client: LanguageClient) => {
    client = _client;
    client.outputChannel.show();
    client.onNotification("dockerlive/performanceStats", (data) => {
      let message = pGraphs.update(data);

      if (performanceCurrentPanel) {
        performanceCurrentPanel.webview.postMessage(message); //No need to update graph if the webview panel doesn't exist / isn't visible
      }
    });

    client.onNotification("dockerlive/filesystemData", (data) => {
      initialData = data.data;
      if (filesystemCurrentPanel) {
        sendPartitionedFilesystemData(data.data);
      }
    });

    client.onNotification("dockerlive/containerName", (data) => {
      vscode.window
        .showInputBox({
          prompt: "Command to be executed",
          value: `docker exec -it ${data.containerName} /bin/sh`,
        })
        .then((command: string) => {
          if (!command) {
            return;
          }

          analytics.sendEvent("openShell", { command: command });
          const terminal = vscode.window.createTerminal("Dockerlive Container");
          terminal.sendText(command);
          terminal.show();
        });
    });

    client.onNotification("dockerlive/didChangeCodeLenses", (data) => {
      if (data.uri === currentDocumentUri || !currentDocumentUri) {
        codeLensProvider.didChangeCodeLenses(data.uri, data.codeLenses);
      }
    });

    vscode.commands.executeCommand("dockerlive.generateAlternativeWithHermit");
  });

  if (vscode.window.activeTextEditor)
    currentDocumentUri = vscode.window.activeTextEditor.document.uri.toString();

  vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor) => {
    if (editor && editor.document.uri.scheme === "file") {
      currentDocumentUri = editor.document.uri.toString();
    }
  });
}

function sendPartitionedFilesystemData(data) {
  let data_string = JSON.stringify(data);
  let index = 0;
  const chunk_size = 1024 * 256;
  while (index < data_string.length) {
    filesystemCurrentPanel.webview.postMessage({
      chunk: data_string.slice(index, index + chunk_size),
    });
    index += chunk_size;
  }
  filesystemCurrentPanel.webview.postMessage({ finished: true });
}

async function initializeFilesystemWebview(
  context: vscode.ExtensionContext,
  fsViz: FilesystemVisualizer
) {
  context.subscriptions.push(
    vscode.commands.registerCommand("dockerlive.showFilesystem", () => {
      const columnToShowIn = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn + 1
        : vscode.ViewColumn.Two;

      if (!filesystemCurrentPanel) {
        // Create and show a new webview
        filesystemCurrentPanel = vscode.window.createWebviewPanel(
          "dockerliveFilesystem", // Identifies the type of the webview. Used internally
          "Filesystem", // Title of the panel displayed to the user
          columnToShowIn, // Editor column to show the new webview panel in.
          {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)],
          } // Webview options.
        );
      } else {
        filesystemCurrentPanel.reveal();
      }
      analytics.startEvent("viewFilesystem");

      filesystemCurrentPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) {
          analytics.startEvent("viewFilesystem");
          sendPartitionedFilesystemData(initialData);
        } else {
          analytics.stopEvent("viewFilesystem");
        }
      });

      filesystemCurrentPanel.onDidDispose((_e) => {
        filesystemCurrentPanel = null;
        analytics.stopEvent("viewFilesystem");
      });

      const cssPath = vscode.Uri.file(
        path.join(
          context.extensionPath,
          "client",
          "resources",
          "filesystem",
          "css",
          "filesystem.css"
        )
      );

      const jsPath = vscode.Uri.file(
        path.join(
          context.extensionPath,
          "client",
          "resources",
          "filesystem",
          "js",
          "filesystem.js"
        )
      );

      filesystemCurrentPanel.webview.html = fsViz.getHTML(
        filesystemCurrentPanel.webview.asWebviewUri(cssPath),
        filesystemCurrentPanel.webview.asWebviewUri(jsPath)
      );

      if (initialData) {
        sendPartitionedFilesystemData(initialData);
      }
    })
  );
}

async function initializePerformanceWebview(
  context: vscode.ExtensionContext,
  pGraphs: PerformanceGraphs
) {
  context.subscriptions.push(
    vscode.commands.registerCommand("dockerlive.showPerformance", () => {
      const columnToShowIn = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn + 1
        : vscode.ViewColumn.Two;

      if (!performanceCurrentPanel) {
        // Create and show a new webview
        performanceCurrentPanel = vscode.window.createWebviewPanel(
          "dockerlivePerformance", // Identifies the type of the webview. Used internally
          "Performance", // Title of the panel displayed to the user
          columnToShowIn, // Editor column to show the new webview panel in.
          {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)],
          } // Webview options.
        );
      } else {
        performanceCurrentPanel.reveal();
      }
      analytics.startEvent("viewPerformance");

      performanceCurrentPanel.onDidDispose((_e) => {
        performanceCurrentPanel = null;
        analytics.stopEvent("viewPerformance");
      });

      const cssPath = vscode.Uri.file(
        path.join(
          context.extensionPath,
          "client",
          "resources",
          "performance",
          "css",
          "performance.css"
        )
      );

      const jsPath = vscode.Uri.file(
        path.join(
          context.extensionPath,
          "client",
          "resources",
          "performance",
          "js",
          "performance.js"
        )
      );

      const chartjsPath = vscode.Uri.file(
        path.join(
          context.extensionPath,
          "client",
          "resources",
          "performance",
          "js",
          "Chart@2.9.3.min.js"
        )
      );

      performanceCurrentPanel.webview.html = pGraphs.getHTML(
        performanceCurrentPanel.webview.asWebviewUri(cssPath),
        performanceCurrentPanel.webview.asWebviewUri(jsPath),
        performanceCurrentPanel.webview.asWebviewUri(chartjsPath)
      );

      performanceCurrentPanel.webview.postMessage(pGraphs.getCurrent());

      performanceCurrentPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) {
          analytics.startEvent("viewPerformance");
          performanceCurrentPanel.webview.postMessage(pGraphs.getCurrent());
        } else {
          analytics.stopEvent("viewPerformance");
        }
      });

      performanceCurrentPanel.webview.onDidReceiveMessage(
        (message) => {
          switch (message.command) {
            case "stop":
              vscode.commands.executeCommand("dockerlive.stop");
              return;
            case "restartBuild":
              vscode.commands.executeCommand("dockerlive.restart");
              return;
            case "openShell":
              vscode.commands.executeCommand("dockerlive.openShell");
              return;
          }
        },
        undefined,
        context.subscriptions
      );
    })
  );
}

async function initializeLanguageServer(
  context: vscode.ExtensionContext
): Promise<LanguageClient> {
  // The server is implemented in node
  let serverModule = context.asAbsolutePath(
    path.join(
      "dockerfile-language-server-nodejs",
      "out",
      "dockerfile-language-server-nodejs",
      "src",
      "server.js"
    )
  );

  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
      args: ["--node-ipc"],
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  let dockerMicrosoftExtensionExists =
    vscode.extensions.getExtension("ms-azuretools.vscode-docker") != undefined;

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [{ scheme: "file", language: "dockerfile" }],
    initializationOptions: { provideCommands: !dockerMicrosoftExtensionExists },
  };

  // Create the language client and start the client.
  let client = new LanguageClient(
    "dockerlive",
    "dockerlive",
    serverOptions,
    clientOptions
  );

  // Start the client. This will also launch the server
  client.start();

  await client.onReady();

  return client;
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  analytics.stopAllEvents();
  analytics.reporter.dispose();
  client.sendNotification("dockerlive/stop");
  return client.stop();
}

//	Necessary workaround in order to change the text of an existing CodeLens
//	since the event onDidChangeCodeLenses is not yet supported in the LSP
//	See: https://github.com/microsoft/language-server-protocol/issues/192
class DockerfileCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> =
    this._onDidChangeCodeLenses.event;

  private codeLenses = {};

  constructor() {
    vscode.languages.registerCodeLensProvider(
      {
        scheme: "file",
        language: "dockerfile",
      },
      this
    );
  }

  didChangeCodeLenses(documentURI: string, codeLenses: vscode.CodeLens[]) {
    this.codeLenses[documentURI] = codeLenses;
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return this.codeLenses[document.uri.toString()];
  }

  resolveCodeLens(codeLens: vscode.CodeLens): vscode.CodeLens {
    return codeLens;
  }
}

export function sendNotification(method: string) {
  client.sendNotification(method);
}
