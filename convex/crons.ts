import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Scheduled posts are sent by their own scheduled function; this only catches the ones that were lost.
crons.interval("publishing watchdog", { minutes: 2 }, internal.publishing.sweep, {});

export default crons;
