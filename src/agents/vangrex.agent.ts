import { isStepCount, ToolLoopAgent } from "ai";
import { geminiModel } from "../model";
import { vsCodeOperatorTool } from "./vscode.agent";

export const vangrexAgent = new ToolLoopAgent({
  model: geminiModel,
  instructions: `You are responsible to make automated decisions. Use the vscode_operator tool one by one divided into steps. eg: Click on extensions on first tool call, Type extension name in search box and stuff like that.`,
  stopWhen: isStepCount(10),
  tools: {
    vscode_operator: vsCodeOperatorTool,
  },
});
