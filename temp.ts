import robot from "robotjs";
import { desktop } from "./src/desktop";

await desktop.pressKey(`{Ctrl}d`);
await desktop.pressKey(`{Win}`);
await desktop.pressKey(`{Ctrl}{Shift}{Escape}`);
