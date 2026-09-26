import { ScenarioRunner, snapshotCandidateHash } from "../src/index.js";

const root = process.argv[2];
if (!root) throw new Error("Missing test directory");
const runner = new ScenarioRunner(root);
await runner.check("combined-candidate", "crash-after-effect");
await runner.publish("combined-candidate", "crash-after-effect", snapshotCandidateHash("combined-candidate"));
// Intentionally die before any caller could save the result to its database.
process.kill(process.pid, "SIGKILL");
