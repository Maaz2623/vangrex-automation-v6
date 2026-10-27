import { vangrexAgent } from "./agents/vangrex.agent";
import "dotenv/config";

const result = await vangrexAgent.generate({
  prompt: "Change the theme to light.",
});

console.log("Tokens Used: ", result.usage.inputTokens);
