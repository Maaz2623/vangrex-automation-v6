import { generateText, Output } from "ai";
import * as Terminator from "@mediar-ai/terminator";
import { geminiModel } from "./src/model";
import z from "zod";
import robot from "robotjs";
import { desktop } from "./src/desktop";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Change this to any desktop task.
const task =
  "Check if Tailwind CSS IntelliSense is installed. Install it if it is not installed.";

const MAX_STEPS = 10;
const MAX_REPEATED_ACTIONS = 2;

const resultSchema = z.object({
  message: z.string(),

  status: z.enum(["in_progress", "completed", "unknown", "blocked"]),

  intent: z.string(),

  role: z.string(),
  name: z.string(),

  clickAction: z.object({
    isRequired: z.boolean(),
  }),

  typeAction: z.object({
    isRequired: z.boolean(),
    text: z.string(),
  }),
});

type ActionRecord = {
  action: string;
  target: string;
};

const actionHistory: ActionRecord[] = [];

let previousActionKey = "";
let repeatedActionCount = 0;

for (let step = 1; step <= MAX_STEPS; step++) {
  await delay(1500);

  console.log(`\n--- Step ${step}/${MAX_STEPS} ---`);
  console.log("Task:", task);

  try {
    // 1. Inspect the current desktop state.
    const { formatted } = desktop.getWindowTreeResult("Code", undefined, {
      propertyMode: Terminator.PropertyLoadingMode.Complete,
      formatOutput: true,
      treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
      includeMonitorScreenshots: false,
      includeWindowScreenshot: false,
    });

    // Include recent actions so the model can avoid repeating them.
    const recentActions = actionHistory
      .slice(-6)
      .map((item, index) => `${index + 1}. ${item.action} -> ${item.target}`)
      .join("\n");

    // 2. Ask the model to determine the next necessary action.
    const result = await generateText({
      model: geminiModel,

      prompt: `
USER TASK:
${task}

CURRENT STEP:
${step}/${MAX_STEPS}

PREVIOUS ACTIONS:
${recentActions || "No actions have been performed yet."}

CURRENT UI TREE:
${formatted}

Determine the next necessary step.

Consider the previous actions and current UI state.
Do not repeat an action that has already succeeded.
If the task is complete, return status "completed".
If the available UI does not establish the necessary information,
return status "unknown".
If progress is impossible, return status "blocked".
Use the shortest possible path by understanding the current UI.
For typing don't enable click is required because we focus it in the program ourselves.
`,

      instructions: `
You are a general-purpose desktop automation agent.

Your job is to complete the user's requested task using the current
desktop UI tree and the available click and typing actions.

You must distinguish between:
- Inspecting information.
- Performing an action.
- Verifying progress.
- Completing the task.

GENERAL RULES:

1. Follow the user's task exactly.
2. Do not hardcode a particular application, extension, theme, or workflow.
3. Inspect the current UI tree before selecting an action.
4. Return a concise user-facing message on every iteration.
5. Perform only the next necessary action.
6. After each action, inspect the updated UI tree.
7. Use previous actions and the current UI state to determine progress.
8. Do not repeat successful actions unnecessarily.
9. Never invent a UI element that is absent from the UI tree.
10. Use exact role and name values from the UI tree.
11. Use PascalCase roles where applicable.
12. Do not include keyboard shortcuts in element names.
13. Do not claim success until there is evidence of completion.
14. If the task requires no action, return both action flags as false.
15. If information cannot be determined, explain why instead of guessing.
16. Never perform actions unrelated to the user's task.

ACTION SCHEMA:

Your output has two independent action flags:

clickAction.isRequired
typeAction.isRequired

Exactly one flag must be true when an action is needed.

When no action is needed, both must be false.

CLICKING:

When the next necessary action is a click:
- Set clickAction.isRequired = true.
- Set typeAction.isRequired = false.
- Return the exact target role and name.
- Set typeAction.text to an empty string.

TYPING:

When the next necessary action is typing:
- Set clickAction.isRequired = false.
- Set typeAction.isRequired = true.
- Return the exact input role and name.
- Return the exact text in typeAction.text.

If the input must first be focused, click it in one iteration
and inspect the updated UI before deciding whether to type.

NO ACTION:

When the task is complete:
- Set status = "completed".
- Set both action flags to false.
- Set role, name, and typeAction.text to empty strings.
- Explain the result in message.

When the task cannot be determined:
- Set status = "unknown".
- Set both action flags to false.
- Explain what evidence is missing.

When the task cannot proceed:
- Set status = "blocked".
- Set both action flags to false.
- Explain the obstacle.

TASK PROGRESS:

For tasks that require several actions:
1. Identify the current state.
2. Determine the next missing step.
3. Execute only that step.
4. Inspect the updated UI.
5. Verify whether the step succeeded.
6. Continue with the next missing step.

Do not keep reopening a view that is already open.
Do not repeatedly click an input when it is already available.
Do not repeat an action merely because the desired final state has
not yet been reached.

If the same action has failed to produce progress, choose a different
valid next step if one exists. Otherwise return status "blocked".

For extension installation tasks:
- First determine whether the requested extension is installed.
- If installed, report completion without reinstalling it.
- If not installed, navigate to the extension search only as needed.
- Search for the requested extension.
- Identify the correct extension from the visible results.
- Click its Install button only if it is not already installed.
- Inspect the updated UI to verify the installation.
- Do not claim installation succeeded based only on clicking Install.

For informational tasks:
- Answer from the supplied UI tree.
- Do not interact with the desktop unless interaction is genuinely
  necessary and explicitly appropriate for the user's task.

MESSAGE RULES:

Every response must include a short user-facing message.

For an action, describe the next step.
For an informational task, report the available information.
For a completed task, summarize the result.
For an unknown or blocked task, explain the limitation.

Do not describe an action as successful before inspecting its result.

OUTPUT:
- message: User-facing progress or final message.
- status: in_progress, completed, unknown, or blocked.
- intent: Short description of the next step.
- role: Exact target role, or empty if no action is needed.
- name: Exact target name, or empty if no action is needed.
- clickAction.isRequired: Whether a click is required.
- typeAction.isRequired: Whether typing is required.
- typeAction.text: Exact text to enter, or empty if not typing.
`,

      output: Output.object({
        schema: resultSchema,
      }),
    });

    const output = result.output;

    // 3. Display the user-facing message.
    console.log("\nMessage:", output.message);
    console.log("Status:", output.status);
    console.log("Intent:", output.intent);

    console.log("Target:", {
      role: output.role,
      name: output.name,
    });

    console.log("Actions:", {
      click: output.clickAction.isRequired,
      type: output.typeAction.isRequired,
      text: output.typeAction.text,
    });

    console.log("Input tokens:", result.usage.inputTokens);

    // 4. Stop if the task is complete, unknown, or blocked.
    if (output.status !== "in_progress") {
      console.log("\nTask finished:", output.status);
      break;
    }

    // 5. Validate the action flags.
    const shouldClick = output.clickAction.isRequired;
    const shouldType = output.typeAction.isRequired;

    if (shouldClick && shouldType) {
      console.error(
        "Invalid model output: click and type cannot both be required.",
      );
      break;
    }

    if (!shouldClick && !shouldType) {
      console.log(
        "No action requested. Stopping to avoid an unnecessary loop.",
      );
      break;
    }

    if (!output.role.trim() || !output.name.trim()) {
      console.error("The model requested an action without a valid target.");
      break;
    }

    if (shouldType && !output.typeAction.text.length) {
      console.error("The model requested typing but provided no text.");
      break;
    }

    // 6. Detect repeated actions.
    const actionType = shouldClick ? "click" : "type";

    const actionKey = JSON.stringify({
      action: actionType,
      role: output.role,
      name: output.name,
      text: shouldType ? output.typeAction.text : "",
    });

    if (actionKey === previousActionKey) {
      repeatedActionCount++;
    } else {
      previousActionKey = actionKey;
      repeatedActionCount = 1;
    }

    if (repeatedActionCount >= MAX_REPEATED_ACTIONS) {
      console.error("\nStopping: the same action was requested repeatedly.");

      console.error("Target:", output.role, output.name);

      console.error("The action loop was stopped to prevent repeated clicks.");

      break;
    }

    // 7. Find the requested UI element.
    const selector = `role:${output.role} && text:${output.name}`;

    const app = await desktop.getCurrentApplication();

    const element = await app.locator(selector).first(3000);

    // Record the action before executing it.
    actionHistory.push({
      action: actionType,
      target: `${output.role}: ${output.name}${
        shouldType ? ` [${output.typeAction.text}]` : ""
      }`,
    });

    // 8. Execute exactly one action.
    if (shouldClick) {
      const { x, y, width, height } = element.bounds();

      const targetX = Math.round(x + width / 2);
      const targetY = Math.round(y + height / 2);

      robot.moveMouseSmooth(targetX, targetY);
      robot.mouseClick();

      console.log("\nExecuted click:", output.name);
    } else if (shouldType) {
      // Terminator's Element.typeText handles typing into the element.
      // Do not issue an additional click here: the model should request
      // a separate click first if the input needs to be focused.
      await element.typeText(output.typeAction.text);

      console.log("\nExecuted typing:", output.typeAction.text);
    }

    // Allow the UI to update before the next inspection.
    await delay(1000);
  } catch (error) {
    console.error(
      "\nDesktop task failed:",
      error instanceof Error ? error.message : error,
    );

    break;
  }
}

console.log("\nDesktop agent finished.");
