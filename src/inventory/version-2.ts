import {
  generateText,
  isStepCount,
  Output,
  tool,
  ToolLoopAgent,
  uploadFile,
} from "ai";
import { geminiModel } from "../model";
import { desktop } from "../desktop";
import * as Terminator from "@mediar-ai/terminator";
import { delay } from "../delay";
import { findElementInTree } from "./search-element";
import robot from "robotjs";
import fs from "node:fs";
import path from "node:path";
import { google } from "@ai-sdk/google";
import z from "zod";

const vangrexAgent = new ToolLoopAgent({
  model: geminiModel,
  instructions: `You are responsible to take actions. Use inspectUi initially and after every operation to check for state and update the next steps. Stop when the task is completed at last.`,
  stopWhen: isStepCount(20),
  tools: {
    inspectUi: tool({
      description:
        "Use to inspect the current ui with screenshot and return element to take action.",
      inputSchema: z.object({
        task: z
          .string()
          .describe(
            "The overall task to perform. Example: Install thunder client.",
          ),
      }),
      execute: async ({ task }) => {
        const app = await desktop.getCurrentApplication();

        const tree = desktop.getWindowTreeResult(app.processName(), undefined, {
          propertyMode: Terminator.PropertyLoadingMode.Complete,
          formatOutput: true,
          treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
          includeMonitorScreenshots: false,
          includeWindowScreenshot: true,
        });

        saveScreenshot(tree.windowScreenshotPath as string);

        const { providerReference } = await uploadFile({
          api: google.files(),
          data: fs.readFileSync("screenshots/screenshot.png"),
          filename: "screenshot.png",
        });

        const { output } = await generateText({
          model: geminiModel,
          instructions: `You tell the next step to perform based on the application state. You return keywords to search the element. e.g ["Extensions", "Manage", "Explorer"...]. The application is ${app.processName()}`,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `The Task is ${task}`,
                },
                {
                  type: "file",
                  mediaType: "image/png",
                  data: providerReference,
                },
              ],
            },
          ],
          output: Output.object({
            schema: z.object({
              keywords: z.array(z.string()),
            }),
          }),
        });

        const searchedElements = findElementInTree(
          tree.formatted as string,
          output.keywords,
        );

        const selectElementResult = await generateText({
          model: geminiModel,
          instructions: `You select the proper element and return its exact name and exact role which are enclosed in square brackets from the matching elements line. Always return the role in pascal case.`,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `The Task is ${task}. Matching elements: ${JSON.stringify(searchedElements)}. The application is ${app.processName()}`,
                },
                {
                  type: "file",
                  mediaType: "image/png",
                  data: providerReference,
                },
              ],
            },
          ],
          output: Output.object({
            schema: z.object({
              selectedElement: z.object({
                role: z.string(),
                name: z.string(),
              }),
            }),
          }),
        });

        return {
          selected_element: selectElementResult.output.selectedElement,
        };
      },
    }),
    operate: tool({
      description: "Use to perform actions on the selected element.",
      inputSchema: z.object({
        role: z.string(),
        name: z.string(),
      }),
      execute: async ({ role, name }) => {
        const app = await desktop.getCurrentApplication();

        const selector = `role:${role} && text:${name}`;

        const element = await app.locator(selector).first(3000);

        const { x, y, width, height } = element.bounds();

        const targetX = Math.round(x + width / 2);
        const targetY = Math.round(y + height / 2);

        robot.moveMouseSmooth(targetX, targetY);
        robot.mouseClick();
      },
    }),
  },
});

async function main(task: string) {
  await delay(2000);

  const result = await vangrexAgent.generate({
    prompt: task,
  });

  console.log(result.text, result.usage.inputTokens);
}

main("Change theme to solarized light.");

const saveScreenshot = (screenshotPath: string) => {
  const outputDir = "D:\\projects\\vangrex-automation-v6\\screenshots";

  fs.mkdirSync(outputDir, { recursive: true });

  if (screenshotPath) {
    const destination = path.join(outputDir, "screenshot.png");

    fs.copyFileSync(screenshotPath, destination);

    console.log("Screenshot saved to:", destination);
  } else {
    console.log("No screenshot was generated.");
  }
};
