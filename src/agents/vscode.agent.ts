import { generateText, Output, tool } from "ai";
import z from "zod";
import { desktop } from "../desktop";
import robot from "robotjs";
import * as Terminator from "@mediar-ai/terminator";
import { geminiModel } from "../model";

export const vsCodeOperatorTool = tool({
  description: "You are responsible to automate vscode.",
  inputSchema: z.object({
    intent: z.string().describe("The action to take on the screen."),
  }),
  execute: async ({ intent }) => {
    const { formatted } = desktop.getWindowTreeResult("Code", undefined, {
      propertyMode: Terminator.PropertyLoadingMode.Complete,
      formatOutput: true,
      treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
      includeMonitorScreenshots: false,
      includeWindowScreenshot: false,
    });

    const result = await generateText({
      model: geminiModel,
      prompt: intent,
      instructions: `
You are a desktop UI automation agent.

UI Elements:
${formatted}

Determine the SINGLE next action required to install Thunder Client.

ACTION RULES:
1. Use "click" when the next step requires clicking a button, tab, menu item, input field, extension result, or Install button.
2. Use "type" when the next step requires entering text into an already-focused input field.
3. When the VS Code Extensions search input is already focused and the search query has not been entered, use:
   type: "type"
   text: "Thunder Client"
4. Do NOT return "click" repeatedly when text needs to be entered.
5. After clicking the Extensions icon, inspect the updated UI tree to determine whether the search input needs to be clicked or is already focused.
6. If the search input is not focused, click it first. On a later step, type "Thunder Client".
7. After search results appear, identify the actual Thunder Client extension and click its Install button.
8. If the extension is already installed, identify the appropriate completion state. Do not invent UI elements.
9. Never guess an element that is absent from the UI tree.
10. Return the exact element role and name from the UI tree. Do not include keyboard shortcuts.
11. Use PascalCase for the role, such as Button, Text, ListItem, or TextBox.
12. If multiple elements share the same role and name, use a more specific element name when available.
13. Select the shortest valid next action.

Return:
- intent: a short description of the next action.
- role: the target element's role.
- name: the target element's exact name.
- action.requiresAction: true if an action is needed.
- action.type: "click" or "type".
- action.text: the exact text to enter, required only for "type".
`,
      output: Output.object({
        schema: z.object({
          intent: z.string(),
          role: z.string(),
          name: z.string(),
          action: z.discriminatedUnion("type", [
            z.object({
              requiresAction: z.boolean(),
              type: z.literal("click"),
            }),
            z.object({
              requiresAction: z.boolean(),
              type: z.literal("type"),
              text: z.string(),
            }),
          ]),
        }),
      }),
    });

    console.log("Intent:", result.output.intent);
    console.log("Target:", {
      role: result.output.role,
      name: result.output.name,
    });
    console.log("Action:", result.output.action);

    if (result.output.action.requiresAction) {
      const selector = `role:${result.output.role} && text:${result.output.name}`;

      const app = await desktop.getCurrentApplication();
      const element = await app.locator(selector).first(1000);

      const { x, y, width, height } = element.bounds();

      const targetX = Math.round(x + width / 2);
      const targetY = Math.round(y + height / 2);

      switch (result.output.action.type) {
        case "click": {
          robot.moveMouseSmooth(targetX, targetY);
          robot.mouseClick();
          console.log("Clicked:", result.output.name);
          return {
            message: "Click on the element",
          };
        }

        case "type": {
          robot.moveMouseSmooth(targetX, targetY);
          robot.mouseClick();

          await app.typeText(result.output.action.text);

          console.log("Typed:", result.output.action.text);
          return {
            message: "Text typed",
          };
        }
      }
    }

    console.log("Input tokens:", result.usage.inputTokens);
  },
});
