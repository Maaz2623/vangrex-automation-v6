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

// ============================================================
// TOKEN TRACKING
// ============================================================

let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalTokens = 0;
let totalLlmCalls = 0;

function logUsage(label: string, usage: any) {
  totalLlmCalls++;

  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const callTotalTokens = usage?.totalTokens ?? inputTokens + outputTokens;

  totalInputTokens += inputTokens;
  totalOutputTokens += outputTokens;
  totalTokens += callTotalTokens;

  console.log(`\n========== TOKEN USAGE: ${label} ==========`);

  console.log("Input tokens:", inputTokens);
  console.log("Output tokens:", outputTokens);
  console.log("Total tokens:", callTotalTokens);

  console.log("Cumulative LLM calls:", totalLlmCalls);
  console.log("Cumulative input tokens:", totalInputTokens);
  console.log("Cumulative output tokens:", totalOutputTokens);
  console.log("Cumulative total tokens:", totalTokens);

  console.log("===========================================\n");
}

// ============================================================
// LOGGING HELPERS
// ============================================================

function logSection(title: string) {
  console.log("\n");
  console.log("==================================================");
  console.log(`[VANGREX] ${title}`);
  console.log("==================================================");
}

function logError(label: string, error: unknown) {
  console.error(`\n[ERROR] ${label}`);

  if (error instanceof Error) {
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
  } else {
    console.error(error);
  }
}

// ============================================================
// SCREENSHOT HELPER
// ============================================================

function saveScreenshot(screenshotPath: string) {
  console.log("[Screenshot] Source path:", screenshotPath);

  const outputDir = "D:\\projects\\vangrex-automation-v6\\screenshots";

  fs.mkdirSync(outputDir, { recursive: true });

  if (!screenshotPath) {
    console.warn("[Screenshot] No screenshot path provided.");
    return;
  }

  if (!fs.existsSync(screenshotPath)) {
    console.error(
      "[Screenshot] Source screenshot does not exist:",
      screenshotPath,
    );

    throw new Error("Screenshot file does not exist.");
  }

  const destination = path.join(outputDir, "screenshot.png");

  fs.copyFileSync(screenshotPath, destination);

  console.log("[Screenshot] Saved to:", destination);
}

// ============================================================
// VANGREX AGENT
// ============================================================

const vangrexAgent = new ToolLoopAgent({
  model: geminiModel,

  instructions: `
You are Vangrex, a desktop automation agent responsible for completing user tasks.

WORKFLOW:

1. INITIAL INSPECTION
- Call inspectUi before performing any actions.
- Use the result to understand the current application state.
- Determine the next action based on the task and current state.

2. TASK EXECUTION
- Use operate for all intermediate task operations.
- Call operate repeatedly until the entire task is completed.
- Each operate call must perform the next appropriate action.
- Do not call inspectUi between normal operations.
- Do not stop after a single action if further actions are necessary.
- Do not claim the task is complete merely because an action was executed.

3. FINAL VERIFICATION
- After all required operations have been performed, call inspectUi to verify the final application state.
- If the task is complete, stop.
- If the task is incomplete, use operate to perform the remaining actions and inspect again afterward.
- Do not claim success unless the final state supports that conclusion.

STRICT RULES:
- The intended workflow is initial inspectUi -> one or more operate calls -> final inspectUi.
- Never use operate before the initial inspection.
- Do not use inspectUi between ordinary task operations.
- Use operate for intermediate desktop actions.
- Complete the entire task rather than performing only one action.
- Do not invent successful outcomes.
`,

  stopWhen: isStepCount(20),

  prepareStep: async ({ stepNumber }) => {
    console.log(`\n[Agent] Preparing step ${stepNumber}`);
    console.log("[Agent] Waiting 2 seconds...");
    await delay(2000);
    console.log("[Agent] Continuing.");
  },

  tools: {
    // ========================================================
    // INSPECT UI
    // ========================================================

    inspectUi: tool({
      description:
        "Inspect the current application UI with a screenshot. Use before starting a task and after performing operations to verify completion.",

      inputSchema: z.object({
        task: z.string().describe("The overall task to perform."),
      }),

      execute: async ({ task }) => {
        logSection("inspectUi START");

        console.log("[inspectUi] Task:", task);

        try {
          // --------------------------------------------------
          // Get current application
          // --------------------------------------------------

          console.log("[inspectUi] Getting current application...");

          const app = await desktop.getCurrentApplication();
          const appName = app.processName();

          console.log("[inspectUi] Application:", appName);

          // --------------------------------------------------
          // Capture UI tree and screenshot
          // --------------------------------------------------

          console.log("[inspectUi] Extracting UI tree and screenshot...");

          const tree = desktop.getWindowTreeResult(appName, undefined, {
            propertyMode: Terminator.PropertyLoadingMode.Complete,

            formatOutput: true,

            treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,

            includeMonitorScreenshots: false,
            includeWindowScreenshot: true,
          });

          console.log("[inspectUi] UI tree extracted.");

          console.log("[inspectUi] Tree length:", tree.formatted?.length ?? 0);

          console.log(
            "[inspectUi] Screenshot path:",
            tree.windowScreenshotPath,
          );

          // --------------------------------------------------
          // Save screenshot
          // --------------------------------------------------

          saveScreenshot(tree.windowScreenshotPath as string);

          // --------------------------------------------------
          // Upload screenshot
          // --------------------------------------------------

          console.log("[inspectUi] Reading screenshot...");

          const screenshotData = fs.readFileSync("screenshots/screenshot.png");

          console.log(
            "[inspectUi] Screenshot size:",
            screenshotData.length,
            "bytes",
          );

          console.log("[inspectUi] Uploading screenshot...");

          const { providerReference } = await uploadFile({
            api: google.files(),
            data: screenshotData,
            filename: "screenshot.png",
          });

          console.log("[inspectUi] Screenshot uploaded.");

          // --------------------------------------------------
          // Generate search keywords
          // --------------------------------------------------

          console.log("[inspectUi] Asking Gemini for relevant UI keywords...");

          const keywordResult = await generateText({
            model: geminiModel,

            instructions: `
You are a desktop UI analysis assistant.

Determine useful UI element keywords for the next action
needed to accomplish the user's task.

Return a short list of relevant keywords.
Prefer exact visible labels from the application.
Do not invent elements that are not visible.

Application: ${appName}
`,

            messages: [
              {
                role: "user",

                content: [
                  {
                    type: "text",
                    text: `Task: ${task}`,
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

          logUsage("inspectUi: keyword selection", keywordResult.usage);

          const keywords = keywordResult.output.keywords;

          console.log("[inspectUi] Keywords:", keywords);

          // --------------------------------------------------
          // Search UI tree
          // --------------------------------------------------

          console.log("[inspectUi] Searching UI tree for matching elements...");

          const searchedElements = findElementInTree(
            tree.formatted as string,
            keywords,
          );

          console.log(
            "[inspectUi] Matching elements:",
            JSON.stringify(searchedElements, null, 2),
          );

          // --------------------------------------------------
          // Select element
          // --------------------------------------------------

          console.log("[inspectUi] Asking Gemini to select an element...");

          const selectionResult = await generateText({
            model: geminiModel,

            instructions: `
Select the most appropriate UI element for the user's task.

Choose an element from the provided matching elements.
Return its exact role and exact name.
Do not invent or modify either value.
Return the role in PascalCase.

Use the screenshot to resolve ambiguity when necessary.

Application: ${appName}
`,

            messages: [
              {
                role: "user",

                content: [
                  {
                    type: "text",

                    text: `
Task: ${task}

Matching elements:
${JSON.stringify(searchedElements)}

Select the element that should be acted upon next.
`,
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

          logUsage("inspectUi: element selection", selectionResult.usage);

          const selectedElement = selectionResult.output.selectedElement;

          console.log(
            "[inspectUi] Selected element:",
            JSON.stringify(selectedElement, null, 2),
          );

          logSection("inspectUi END");

          return {
            selected_element: selectedElement,
          };
        } catch (error) {
          logError("inspectUi failed", error);
          throw error;
        }
      },
    }),

    // ========================================================
    // OPERATE
    // ========================================================

    operate: tool({
      description:
        "Perform the next desktop action required to complete the overall task. Use repeatedly for intermediate operations. Do not use this tool merely to inspect the UI.",

      inputSchema: z.object({
        task: z
          .string()
          .describe("The overall task and the next operation to perform."),
      }),

      execute: async ({ task }) => {
        logSection("operate START");

        console.log("[operate] Task:", task);

        try {
          // --------------------------------------------------
          // Get current application
          // --------------------------------------------------

          console.log("[operate] Getting current application...");

          const app = await desktop.getCurrentApplication();
          const appName = app.processName();

          console.log("[operate] Application:", appName);

          // --------------------------------------------------
          // Extract UI tree WITHOUT requesting a screenshot
          // --------------------------------------------------

          console.log(
            "[operate] Extracting UI tree; window screenshot disabled...",
          );

          const tree = desktop.getWindowTreeResult(appName, undefined, {
            propertyMode: Terminator.PropertyLoadingMode.Complete,

            formatOutput: true,

            treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,

            includeMonitorScreenshots: false,
            includeWindowScreenshot: false,
          });

          console.log("[operate] UI tree extracted.");

          console.log("[operate] Tree length:", tree.formatted?.length ?? 0);

          // --------------------------------------------------
          // Generate keywords
          // --------------------------------------------------

          console.log("[operate] Asking Gemini for relevant UI keywords...");

          const keywordResult = await generateText({
            model: geminiModel,

            instructions: `
You are a desktop UI automation assistant.

Determine the next UI element needed to advance the user's task.

Return a short list of useful keywords that match elements
in the provided application UI tree.

Prefer exact visible labels.
Do not invent elements.
Return keywords for the next action only.

Application: ${appName}
`,

            prompt: `
Overall task: ${task}

Current application UI tree:
${tree.formatted}
`,

            output: Output.object({
              schema: z.object({
                keywords: z.array(z.string()),
              }),
            }),
          });

          logUsage("operate: keyword selection", keywordResult.usage);

          const keywords = keywordResult.output.keywords;

          console.log("[operate] Keywords:", keywords);

          // --------------------------------------------------
          // Search tree
          // --------------------------------------------------

          console.log("[operate] Searching UI tree for matching elements...");

          const searchedElements = findElementInTree(
            tree.formatted as string,
            keywords,
          );

          console.log(
            "[operate] Matching elements:",
            JSON.stringify(searchedElements, null, 2),
          );

          if (
            !searchedElements ||
            (Array.isArray(searchedElements) && searchedElements.length === 0)
          ) {
            throw new Error(
              "No matching UI elements found in the current UI tree.",
            );
          }

          // --------------------------------------------------
          // Select element
          // --------------------------------------------------

          console.log(
            "[operate] Asking Gemini to select the target element...",
          );

          const selectionResult = await generateText({
            model: geminiModel,

            instructions: `
Select the most appropriate UI element for the next action.

Choose only from the provided matching elements.
Return the exact role and exact name as they appear in the UI tree.
Do not invent, rename, or normalize element names.
Return the role in PascalCase.

Application: ${appName}
`,

            prompt: `
Overall task: ${task}

Matching elements:
${JSON.stringify(searchedElements)}

Select the element that should be acted upon next.
`,

            output: Output.object({
              schema: z.object({
                selectedElement: z.object({
                  role: z.string(),
                  name: z.string(),
                }),
              }),
            }),
          });

          logUsage("operate: element selection", selectionResult.usage);

          const selectedElement = selectionResult.output.selectedElement;

          console.log(
            "[operate] Selected element:",
            JSON.stringify(selectedElement, null, 2),
          );

          // --------------------------------------------------
          // Locate target
          // --------------------------------------------------

          const selector = `role:${selectedElement.role} && text:${selectedElement.name}`;

          console.log("[operate] Selector:", selector);

          console.log("[operate] Locating element; timeout = 3000ms...");

          const element = await app.locator(selector).first(3000);

          console.log("[operate] Element located.");

          // --------------------------------------------------
          // Calculate click coordinates
          // --------------------------------------------------

          const bounds = element.bounds();

          console.log("[operate] Element bounds:", bounds);

          const targetX = Math.round(bounds.x + bounds.width / 2);

          const targetY = Math.round(bounds.y + bounds.height / 2);

          console.log("[operate] Target coordinates:", {
            x: targetX,
            y: targetY,
          });

          // --------------------------------------------------
          // Perform click
          // --------------------------------------------------

          console.log("[operate] Moving mouse...");

          robot.moveMouseSmooth(targetX, targetY);

          console.log("[operate] Clicking target...");

          robot.mouseClick();

          console.log("[operate] Click command executed.");

          logSection("operate END");

          return {
            success: true,
            action: "click",
            selected_element: selectedElement,
            coordinates: {
              x: targetX,
              y: targetY,
            },
            message: `Clicked ${selectedElement.name}. Continue with the overall task if more actions are required.`,
          };
        } catch (error) {
          logError("operate failed", error);
          throw error;
        }
      },
    }),
  },
});

// ============================================================
// MAIN
// ============================================================

async function main(task: string) {
  try {
    logSection("TASK START");

    console.log("[Vangrex] Task:", task);
    console.log("[Vangrex] Waiting 2 seconds before starting...");

    await delay(2000);

    console.log("[Vangrex] Starting agent execution...");

    const result = await vangrexAgent.generate({
      prompt: task,
    });

    logSection("AGENT RESULT");

    console.log(result.text);

    console.log("\n========== AGENT REPORTED USAGE ==========");
    console.log(result.usage);
    console.log("==========================================");

    console.log("\n========== NESTED LLM USAGE ==============");
    console.log("Tracked generateText calls:", totalLlmCalls);
    console.log("Input tokens:", totalInputTokens);
    console.log("Output tokens:", totalOutputTokens);
    console.log("Total tokens:", totalTokens);
    console.log("==========================================");

    console.log("\n[Vangrex] Task execution finished.");
  } catch (error) {
    logError("Agent execution failed", error);
  }
}

// ============================================================
// RUN TASK
// ============================================================

main("Click on manage then themes.");
