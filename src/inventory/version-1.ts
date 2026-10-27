import { generateText, Output } from "ai";
import * as Terminator from "@mediar-ai/terminator";
import z from "zod";
import robot from "robotjs";
import { desktop } from "../desktop";
import { geminiModel } from "../model";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Change this to any desktop task.
const task = "Change theme to light. Don't use shortcuts";

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
    pressEnterAfterTyping: z.boolean(),
  }),

  scrollAction: z.object({
    isRequired: z.boolean(),
    x: z.number(),
    y: z.number(),
  }),

  hoverAction: z.object({
    isRequired: z.boolean(),
    x: z.number(),
    y: z.number(),
  }),

  pressKeyAction: z.object({
    isRequired: z.boolean(),
    combination: z.string(),
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
  await delay(3000);

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


WHATEVER THE ACTION, ALWAYS SELECT AND RETURN THE ROLE AND NAME OF THE ELEMENT.

Do not repeat an action that has already succeeded.
If the task is complete, return status "completed".
If the available UI does not establish the necessary information,
return status "unknown".
If progress is impossible, return status "blocked".

Use the shortest possible path by understanding the current UI.

IMPORTANT:
- Choose only ONE action per iteration.
- Available actions: click, type, scroll, hover, press keys, or no action.
- The program focuses the target element before typing.
- For typing, do not request an additional click just to focus
  the same input.
- For scrolling, specify the UI element whose area should scroll.
- For hovering, specify the UI element to hover over.
- For keyboard shortcuts, provide the exact combination using
  the supported format, such as {Ctrl}d, {Win}, or {Ctrl}{Shift}{Escape}.
- Do not use keyboard shortcuts when a direct UI action is more appropriate.
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
scrolling, hovering, and keyboard actions.

GENERAL RULES:

IF YOU RETURN A UI ACTION, ALWAYS RETURN THE ELEMENT ROLE AND NAME
BECAUSE THEY ARE REQUIRED TO LOCATE THE ELEMENT.

Keyboard actions do not require a UI element target.

1. Follow the user's task exactly.
2. Do not hardcode a particular application, extension, theme,
   or workflow.
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
14. If no action is needed, set every action flag to false.
15. If information cannot be determined, explain why instead of guessing.
16. Never perform actions unrelated to the user's task.
17. Choose the action that makes the most progress toward the user's goal.
18. Do not scroll when the required information or target is already visible.
19. Do not click an element merely to inspect information already visible.
20. After scrolling, inspect the updated UI before deciding what to do next.
21. Prefer small, purposeful steps over unnecessary navigation.
22. Use the action history to avoid repeating unsuccessful actions.
23. Never report an action as successful until the updated UI provides evidence.

ACTION SCHEMA:

You have five independent action flags:
- clickAction.isRequired
- typeAction.isRequired
- scrollAction.isRequired
- hoverAction.isRequired
- pressKeyAction.isRequired

When an action is needed, exactly ONE of these flags must be true.
When no action is needed, all five flags must be false.

CLICKING:
- Set clickAction.isRequired = true.
- Set all other action flags to false.
- Return the exact target role and name from the UI tree.
- Set typeAction.text to an empty string.
- Set scrollAction.x and scrollAction.y to 0.
- Set pressKeyAction.combination to an empty string.

TYPING:
- Set typeAction.isRequired = true.
- Set all other action flags to false.
- Return the exact input role and name from the UI tree.
- Return the exact text in typeAction.text.
- Set typeAction.clearBeforeTyping according to whether existing text
  should be replaced.
- Set scrollAction.x and scrollAction.y to 0.
- Set pressKeyAction.combination to an empty string.

HOVERING:
- Set hoverAction.isRequired = true.
- Set all other action flags to false.
- Return the exact target role and name from the UI tree.
- Set hoverAction.x and hoverAction.y to 0.
- The program uses the center of the target element's bounds.
- Do not click merely to reveal hover-only controls.
- After hovering, inspect the updated UI tree.

SCROLLING:
- Set scrollAction.isRequired = true.
- Set all other action flags to false.
- Return the exact target role and name from the UI tree.
- Set scrollAction.x to the horizontal scroll amount.
- Set scrollAction.y to the vertical scroll amount.
- Use 0 for an axis that does not need to scroll.

SCROLL DIRECTION:
- Negative y values scroll DOWN.
- Positive y values scroll UP.
- Negative x values scroll LEFT.
- Positive x values scroll RIGHT.
- Use 0 for an axis that does not need to scroll.

Examples:
- Scroll down: x = 0, y = -300.
- Scroll up: x = 0, y = 300.
- Scroll right: x = 300, y = 0.
- Scroll left: x = -300, y = 0.

PRESSING KEYS:

When a keyboard key or combination is the next necessary action:
- Use shortcuts only when the task cannot be completed with ui elements. Otherwise strictly don't.
- Set pressKeyAction.isRequired = true.
- Set all other action flags to false.
- Return the exact keyboard combination in pressKeyAction.combination.
- Do not require a role or name for keyboard actions.
- Do not use a separate click action merely to focus the application
  before sending a shortcut when the current focus is already appropriate.
- Use the supported key syntax:
  - {Ctrl}d
  - {Win}
  - {Ctrl}{Shift}{Escape}
- Use keyboard shortcuts only when appropriate for the user's task.
- After pressing keys, inspect the updated UI before deciding what to do next.
- Set pressKeyAction.combination to an empty string when not pressing keys.

NO ACTION:

When the task is complete:
- Set status = "completed".
- Set all action flags to false.
- Set role and name to empty strings.
- Set typeAction.text to an empty string.
- Set scrollAction.x and scrollAction.y to 0.
- Set pressKeyAction.combination to an empty string.
- Explain the result in message.

When the task cannot be determined:
- Set status = "unknown".
- Set all action flags to false.
- Explain what evidence is missing.

When the task cannot proceed:
- Set status = "blocked".
- Set all action flags to false.
- Explain the obstacle.

TASK PROGRESS:

For tasks requiring several actions:
1. Identify the current state.
2. Determine the next missing step.
3. Execute only that step.
4. Inspect the updated UI.
5. Verify whether the step succeeded.
6. Continue with the next missing step.

Do not repeat an action merely because the desired final state
has not yet been reached.

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
- role: Exact target role, or empty if no UI target is needed.
- name: Exact target name, or empty if no UI target is needed.
- clickAction.isRequired: Whether a click is required.
- typeAction.isRequired: Whether typing is required.
- typeAction.text: Exact text to enter, or empty if not typing.
- typeAction.clearBeforeTyping: Whether to clear existing text first.
- scrollAction.isRequired: Whether scrolling is required.
- scrollAction.x: Horizontal scroll amount.
- scrollAction.y: Vertical scroll amount.
- hoverAction.isRequired: Whether hovering is required.
- hoverAction.x: Set to 0; element bounds determine the hover position.
- hoverAction.y: Set to 0; element bounds determine the hover position.
- pressKeyAction.isRequired: Whether a keyboard action is required.
- pressKeyAction.combination: Exact supported key combination, or empty
  when no keyboard action is required.
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
      clearBeforeTyping: output.typeAction.clearBeforeTyping,
      scroll: output.scrollAction.isRequired,
      scrollX: output.scrollAction.x,
      scrollY: output.scrollAction.y,
      hover: output.hoverAction,
      pressKey: output.pressKeyAction,
    });

    console.log("Input tokens:", result.usage.inputTokens);

    // 4. Stop if the task is complete, unknown, or blocked.
    if (output.status !== "in_progress") {
      console.log("\nTask finished:", output.status);
      break;
    }

    // 5. Validate action flags.
    const shouldClick = output.clickAction.isRequired;
    const shouldType = output.typeAction.isRequired;
    const shouldScroll = output.scrollAction.isRequired;
    const shouldHover = output.hoverAction.isRequired;
    const shouldPressKey = output.pressKeyAction.isRequired;

    const requestedActions = [
      shouldClick,
      shouldType,
      shouldScroll,
      shouldHover,
      shouldPressKey,
    ].filter(Boolean).length;

    if (requestedActions > 1) {
      console.error("Invalid model output: only one action flag can be true.");
      break;
    }

    if (requestedActions === 0) {
      console.log("No action requested while task is in progress. Stopping.");
      break;
    }

    if (shouldScroll) {
      if (output.scrollAction.x === 0 && output.scrollAction.y === 0) {
        console.error("Invalid scroll action: both scroll amounts are zero.");
        break;
      }
    }

    // Keyboard actions do not require a UI element.
    if (!shouldPressKey && (!output.role.trim() || !output.name.trim())) {
      console.error("The model requested a UI action without a valid target.");
      break;
    }

    if (shouldType && !output.typeAction.text.length) {
      console.error("The model requested typing but provided no text.");
      break;
    }

    if (shouldPressKey && !output.pressKeyAction.combination.trim()) {
      console.error("The model requested a key press without a combination.");
      break;
    }

    // 6. Determine the requested action, including keyboard input.
    const actionType = shouldClick
      ? "click"
      : shouldType
        ? "type"
        : shouldScroll
          ? "scroll"
          : shouldHover
            ? "hover"
            : "pressKey";

    const actionKey = JSON.stringify({
      action: actionType,
      role: shouldPressKey ? "" : output.role,
      name: shouldPressKey ? "" : output.name,
      text: shouldType ? output.typeAction.text : "",
      scrollX: shouldScroll ? output.scrollAction.x : 0,
      scrollY: shouldScroll ? output.scrollAction.y : 0,
      combination: shouldPressKey ? output.pressKeyAction.combination : "",
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
      console.error(
        "Target:",
        shouldPressKey
          ? output.pressKeyAction.combination
          : `${output.role}: ${output.name}`,
      );
      console.error("The action loop was stopped to prevent repeated actions.");
      break;
    }

    // 7. Record the action.
    const actionTarget = shouldPressKey
      ? output.pressKeyAction.combination
      : shouldScroll
        ? `${output.role}: ${output.name} [x=${output.scrollAction.x}, y=${output.scrollAction.y}]`
        : `${output.role}: ${output.name}${
            shouldType ? ` [${output.typeAction.text}]` : ""
          }`;

    actionHistory.push({
      action: actionType,
      target: actionTarget,
    });

    // 8. Execute exactly one action.
    if (shouldPressKey) {
      const combination = output.pressKeyAction.combination;

      console.log("\nPressing keys:", combination);

      await desktop.pressKey(combination);

      console.log("Executed keyboard action:", combination);
    } else {
      // Find the requested UI element for mouse/typing/scroll actions.
      const selector = `role:${output.role} && text:${output.name}`;
      const app = await desktop.getCurrentApplication();
      const element = await app.locator(selector).first(3000);

      if (shouldHover) {
        const { x, y, width, height } = element.bounds();

        const targetX = Math.round(x + width / 2);
        const targetY = Math.round(y + height / 2);

        console.log("\nHover target:", {
          role: output.role,
          name: output.name,
          bounds: { x, y, width, height },
          mouseTarget: { x: targetX, y: targetY },
        });

        robot.moveMouseSmooth(targetX, targetY);

        await delay(1000);

        console.log("Executed hover:", output.role, output.name);
      } else if (shouldClick) {
        const { x, y, width, height } = element.bounds();

        const targetX = Math.round(x + width / 2);
        const targetY = Math.round(y + height / 2);

        robot.moveMouseSmooth(targetX, targetY);
        robot.mouseClick();

        console.log("Executed click:", output.role, output.name);
      } else if (shouldType) {
        await element.focus();

        await element.typeText(output.typeAction.text, {
          clearBeforeTyping: output.typeAction.clearBeforeTyping,
        });

        if (output.typeAction.pressEnterAfterTyping) {
          await element.pressKey(`{Enter}`);
        }

        console.log("Executed typing:", output.typeAction.text);
      } else if (shouldScroll) {
        const { x, y, width, height } = element.bounds();

        const targetX = Math.round(x + width / 2);
        const targetY = Math.round(y + height / 2);

        robot.moveMouseSmooth(targetX, targetY);

        robot.scrollMouse(output.scrollAction.x, output.scrollAction.y);

        console.log("Executed scroll:", {
          target: `${output.role}: ${output.name}`,
          x: output.scrollAction.x,
          y: output.scrollAction.y,
        });
      }
    }

    // 9. Allow the UI to update before the next inspection.
    await delay(1500);
  } catch (error) {
    console.error(
      "\nDesktop task failed:",
      error instanceof Error ? error.message : error,
    );

    break;
  }
}

console.log("\nDesktop agent finished.");
