import * as vscode from "vscode";
import { execSync } from "child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from "fs";
import HermitRepairProvider from "../repair/HermitRepairProvider";
import { sendNotification } from "../extension";

const HERMIT_DYNAMIC_ANALYSIS_DURATION = 5;

function hermitGenerationCleanup(generatedFromScratch: boolean) {
  const dir = getWorkDir();

  ["Dockerfile.strace", "syscall.log"].forEach((file) =>
    unlinkSync(dir + "/" + file)
  );

  if (generatedFromScratch) {
    ["Dockerfile", "tmp/syscall.log"].forEach((file) =>
      unlinkSync(dir + "/" + file)
    );
    rmdirSync(dir + "/tmp");
    renameSync(dir + "/Dockerfile.hermit", dir + "/Dockerfile");
  } else unlinkSync(dir + "/.dockerignore");
}

function getWorkDir(): string {
  const folders = vscode.workspace.workspaceFolders;

  if (folders === undefined) return "";

  return folders[0].uri.fsPath;
}

export async function generate() {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating Dockerfile",
      cancellable: false,
    },
    async (progress, _token) => {
      const cwd = getWorkDir();

      await new Promise((r) => setTimeout(r, 1000)); //workaround to avoid losing focus when the extension starts and the output panel steals focus

      const command = await vscode.window.showInputBox({
        prompt: "Enter the command used to start the service",
        ignoreFocusOut: true,
      });

      if (command === undefined) return;

      progress.report({
        increment: 0,
        message: "Generating initial Dockerfile...",
      });

      try {
        execSync(`hermit -t ${HERMIT_DYNAMIC_ANALYSIS_DURATION} "${command}"`, {
          cwd,
        });

        progress.report({ increment: 50, message: "Analyzing container..." });

        execSync(`hermit -c -t ${HERMIT_DYNAMIC_ANALYSIS_DURATION}`, { cwd });
      } catch (e) {
        return new Promise<void>((resolve) => {
          resolve();

          vscode.window.showErrorMessage(
            "There was an error while trying to generate the Dockerfile. Please make sure the required tools are installed and that the command you provided is correct."
          );
        });
      }

      hermitGenerationCleanup(true);

      progress.report({
        increment: 50,
        message: "Finishing generation and performing cleanup...",
      });

      return new Promise<void>((resolve) => {
        resolve();
        vscode.window.showInformationMessage(
          "Dockerfile generation has been completed!"
        );
      });
    }
  );
}

export function generateAlternative(hermitRepair: HermitRepairProvider) {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating Dockerfile",
      cancellable: false,
    },
    (progress, _token) => {
      progress.report({
        increment: 0,
        message: "Performing analysis...",
      });

      const cwd = getWorkDir();

      try {
        execSync(`hermit -c -t ${HERMIT_DYNAMIC_ANALYSIS_DURATION}`, {
          cwd,
        });
      } catch (e) {
        return new Promise<void>((resolve) => {
          resolve();
          vscode.window.showErrorMessage(
            "Could not execute the tools required to generate the Dockerfile!"
          );
        });
      }

      const dockerfilePath = cwd + "/Dockerfile.hermit";

      if (!existsSync(dockerfilePath)) return new Promise<void>((r) => r());

      const dockerfileContent = readFileSync(dockerfilePath).toString();
      hermitRepair.setHermitDockerfileContent(dockerfileContent);

      sendNotification("dockerlive/forceValidation");

      progress.report({
        increment: 100,
        message: "Finishing generation and performing cleanup...",
      });

      hermitGenerationCleanup(false);

      return new Promise<void>((resolve) => {
        resolve();
        vscode.window.showInformationMessage(
          "Dockerfile generation has been completed!"
        );
      });
    }
  );
}
