import catalogue from "./activities.json" with { type: "json" };
import type { Activity } from "../packages/types/src/index.js";

export const activities: Activity[] = catalogue as Activity[];
export default activities;
