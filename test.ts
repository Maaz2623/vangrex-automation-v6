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
  "Do i have monokai pro theme and one dark pro theme in my theme list. Don't check extensions.";

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
    clearBeforeTyping: z.boolean(),
  }),

  scrollAction: z.object({
    isRequired: z.boolean(),
    x: z.number(),
    y: z.number(),
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

Consider the previous actions and the current UI state.

Do not repeat an action that has already succeeded.
If the task is complete, return status "completed".
If the available UI does not establish the necessary information,
return status "unknown".
If progress is impossible, return status "blocked".

Use the shortest possible path by understanding the current UI.

IMPORTANT:
- Choose only one action per iteration.
- You may click, type, scroll, or request no action.
- The program focuses the target element before typing.
- For typing, do not request an additional click just to focus
  the same input.
- For scrolling, specify the UI element whose area should scroll.
- After every action, the UI will be inspected again.
- Do not assume an action succeeded without checking the UI.
- If an action did not change the UI, determine a different
  appropriate action when possible.
- If the requested task is already complete, do not perform
  additional actions.
`,

      instructions: `
You are a general-purpose desktop automation agent.

Your job is to complete the user's requested task using the
current desktop UI tree and the available click, typing,
and scrolling actions.

You must distinguish between:
- Inspecting information.
- Performing an action.
- Verifying progress.
- Completing the task.

GENERAL RULES:

IF YOU HAVE TO RETURN ANY ACTION. ALWAYS RETURN THE ELEMENT ROLE AND NAME BECAUSE IT IS REQUIRED TO PERFORM ACTION.

1. Follow the user's task exactly.
2. Do not hardcode a particular application, extension, theme,
   or workflow.
3. Inspect the current UI tree before selecting an action.
4. Return a concise user-facing message on every iteration.
5. Perform only the next necessary action.
6. After each action, inspect the updated UI tree.
7. Use previous actions and the current UI state to determine
   progress.
8. Do not repeat successful actions unnecessarily.
9. Never invent a UI element that is absent from the UI tree.
10. Use exact role and name values from the UI tree.
11. Use PascalCase roles where applicable.
12. Do not include keyboard shortcuts in element names.
13. Do not claim success until there is evidence of completion.
14. If no action is needed, set all action flags to false.
15. If information cannot be determined, explain why instead
    of guessing.
16. Never perform actions unrelated to the user's task.
17. Choose the action that makes the most progress toward
    the user's goal.
18. Do not scroll when the required information or target is
    already visible.
19. Do not click an element merely to inspect information
    that is already visible.
20. After scrolling, inspect the updated UI before deciding
    what to do next.
21. Prefer small, purposeful steps over unnecessary navigation.
22. Use the action history to avoid repeating unsuccessful actions.
23. Never report that a click, typing action, or scroll succeeded
    until the updated UI provides evidence.

ACTION SCHEMA:

You have three independent action flags:

- clickAction.isRequired
- typeAction.isRequired
- scrollAction.isRequired

When an action is needed, exactly ONE of these flags must be true.

When no action is needed, all three flags must be false.

CLICKING:

When the next necessary action is a click:
- Set clickAction.isRequired = true.
- Set typeAction.isRequired = false.
- Set scrollAction.isRequired = false.
- Return the exact target role and name from the UI tree.
- Set typeAction.text to an empty string.
- Set scrollAction.x = 0 and scrollAction.y = 0.

TYPING:

When the next necessary action is typing:
- Set clickAction.isRequired = false.
- Set typeAction.isRequired = true.
- Set scrollAction.isRequired = false.
- Return the exact input role and name from the UI tree.
- Return the exact text in typeAction.text.
- Set scrollAction.x = 0 and scrollAction.y = 0.

The program focuses the target element before typing.
Therefore, you do not need to request a separate click solely
to focus the same input.

Only request typing when the target element is a suitable
input or text-entry control.
SCROLLING:

When the next necessary action is scrolling:

- Set clickAction.isRequired = false.
- Set typeAction.isRequired = false.
- Set scrollAction.isRequired = true.
- Return the exact target role and name from the UI tree.
- Set scrollAction.x to the horizontal scroll amount.
- Set scrollAction.y to the vertical scroll amount.
- Use 0 for an axis that does not need to scroll.

SCROLL DIRECTION CONVENTIONS:

The scroll direction follows these sign conventions:

Vertical scrolling (Y):
- Negative y values scroll DOWN.
- Positive y values scroll UP.
- y = 0 means no vertical scrolling.

Horizontal scrolling (X):
- Negative x values scroll LEFT.
- Positive x values scroll RIGHT.
- x = 0 means no horizontal scrolling.

Examples:
- Scroll down: x = 0, y = -300.
- Scroll up: x = 0, y = 300.
- Scroll right: x = 300, y = 0.
- Scroll left: x = -300, y = 0.
- Scroll diagonally down and right: x = 300, y = -300.

ACTION GUIDELINES:

- Choose a reasonable scroll amount based on the visible content.
- Scroll the relevant panel, list, menu, or content area.
- Do not scroll an unrelated part of the desktop.
- Do not scroll if the required information is already visible.
- After scrolling, inspect the updated UI before deciding what to do next.
- Do not repeatedly scroll in the same direction without checking whether the previous scroll changed the UI.
- If scrolling does not help, choose a different valid action or return status "blocked" if no valid path remains.
NO ACTION:

When the task is complete:
- Set status = "completed".
- Set all three action flags to false.
- Set role and name to empty strings.
- Set typeAction.text to an empty string.
- Set scrollAction.x and scrollAction.y to 0.
- Explain the result in message.

When the task cannot be determined:
- Set status = "unknown".
- Set all three action flags to false.
- Explain what evidence is missing.

When the task cannot proceed:
- Set status = "blocked".
- Set all three action flags to false.
- Explain the obstacle.

TASK PROGRESS:

For tasks requiring several actions:
1. Identify the current state.
2. Determine the next missing step.
3. Execute only that step.
4. Inspect the updated UI.
5. Verify whether the step succeeded.
6. Continue with the next missing step.

Do not keep reopening a view that is already open.
Do not repeatedly click an input when it is already available.
Do not repeat an action merely because the desired final state
has not yet been reached.

If the same action has failed to produce progress, choose a
different valid next step if one exists. Otherwise return blocked.

For extension installation tasks:
- First determine whether the requested extension is installed.
- If installed, report completion without reinstalling it.
- If not installed, navigate to extension search only as needed.
- Search for the requested extension.
- Identify the correct extension from visible results.
- Click its Install button only if it is not already installed.
- Inspect the updated UI to verify installation.
- Do not claim installation succeeded based only on clicking Install.

For settings and theme tasks:
- Inspect the currently visible settings and theme options.
- Use the UI tree to identify relevant menus, lists, and controls.
- Scroll a relevant list when necessary to reveal additional options.
- Distinguish between available options and the currently selected option.
- Select the requested setting only when it is identifiable.
- Verify the resulting selection using the updated UI.
- Do not invent theme names or claim a theme is selected without evidence.

For informational tasks:
- Answer from the supplied UI tree whenever possible.
- If relevant information is hidden in a scrollable panel,
  scroll that panel and inspect the updated UI.
- Do not interact with the desktop unless interaction is
  genuinely necessary for the user's task.
- Do not claim to know options or settings that are not
  established by the available UI evidence.

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
- scrollAction.isRequired: Whether scrolling is required.
- scrollAction.x: Horizontal scroll amount.
- scrollAction.y: Vertical scroll amount.
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
      scroll: output.scrollAction.isRequired,
      scrollX: output.scrollAction.x,
      scrollY: output.scrollAction.y,
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
    const shouldScroll = output.scrollAction.isRequired;

    const requestedActions = [shouldClick, shouldType, shouldScroll].filter(
      Boolean,
    ).length;

    if (requestedActions > 1) {
      console.error("Invalid model output: only one action flag can be true.");
      break;
    }

    if (requestedActions === 0) {
      console.log(
        "No action requested. Stopping to avoid an unnecessary loop.",
      );
      break;
    }

    if (shouldScroll) {
      if (output.scrollAction.x === 0 && output.scrollAction.y === 0) {
        console.error("Invalid scroll action: both scroll amounts are zero.");
        break;
      }
    } else {
      if (!output.role.trim() || !output.name.trim()) {
        console.error("The model requested an action without a valid target.");
        break;
      }
    }

    if (shouldType && !output.typeAction.text.length) {
      console.error("The model requested typing but provided no text.");
      break;
    }

    // 6. Determine the requested action.
    const actionType = shouldClick ? "click" : shouldType ? "type" : "scroll";

    const actionKey = JSON.stringify({
      action: actionType,
      role: output.role,
      name: output.name,
      text: shouldType ? output.typeAction.text : "",
      scrollX: shouldScroll ? output.scrollAction.x : 0,
      scrollY: shouldScroll ? output.scrollAction.y : 0,
    });

    // Prevent the same action from being executed repeatedly.
    if (actionKey === previousActionKey) {
      repeatedActionCount++;
    } else {
      previousActionKey = actionKey;
      repeatedActionCount = 1;
    }

    if (repeatedActionCount >= MAX_REPEATED_ACTIONS) {
      console.error("\nStopping: the same action was requested repeatedly.");

      console.error("Action:", actionType);
      console.error("Target:", output.role, output.name);

      console.error("The action loop was stopped to prevent repeated actions.");

      break;
    }

    // 7. Find the requested UI element.
    // Click, type, and scroll all require a valid UI target.
    const selector = `role:${output.role} && text:${output.name}`;

    const app = await desktop.getCurrentApplication();
    const element = await app.locator(selector).first(3000);

    // Record the action before executing it.
    actionHistory.push({
      action: actionType,
      target: shouldScroll
        ? `${output.role}: ${output.name} [x=${output.scrollAction.x}, y=${output.scrollAction.y}]`
        : `${output.role}: ${output.name}${
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

      console.log("\nExecuted click:", output.role, output.name);
    } else if (shouldType) {
      // Focus the element before typing.
      await element.focus();
      await element.typeText(output.typeAction.text, {
        clearBeforeTyping: result.output.typeAction.clearBeforeTyping,
      });

      console.log("\nExecuted typing:", output.typeAction.text);
    } else if (shouldScroll) {
      const { x, y, width, height } = element.bounds();

      const targetX = Math.round(x + width / 2);
      const targetY = Math.round(y + height / 2);

      // Move the mouse over the target scrollable area.
      robot.moveMouseSmooth(targetX, targetY);

      // Scroll the targeted area.
      robot.scrollMouse(output.scrollAction.x, output.scrollAction.y);

      console.log("\nExecuted scroll:", {
        target: `${output.role}: ${output.name}`,
        x: output.scrollAction.x,
        y: output.scrollAction.y,
      });
    }

    // 9. Allow the UI to update before the next inspection.
    await delay(3000);
  } catch (error) {
    console.error(
      "\nDesktop task failed:",
      error instanceof Error ? error.message : error,
    );

    break;
  }
}

console.log("\nDesktop agent finished.");
