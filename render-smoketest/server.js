import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Answers one question: does Render's free tier keep a file on disk across a
// restart (redeploy, or sleep/wake), or does every restart start from a blank
// disk? Each boot appends itself to a file and reports whether an earlier
// boot's entry was still there when this boot started.
const STATE_PATH = new URL("./smoketest-state.json", import.meta.url);

function loadState() {
  if (!existsSync(STATE_PATH)) return { boots: [] };
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

const state = loadState();
const firstBootSeenOnDisk = state.boots[0] ?? null;
state.boots.push(new Date().toISOString());
state.boots = state.boots.slice(-10);
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

const port = process.env.PORT || 3000;
createServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify(
      {
        thisBootTime: state.boots[state.boots.length - 1],
        firstBootEverSeenOnDisk: firstBootSeenOnDisk,
        allRecordedBoots: state.boots,
        verdict: firstBootSeenOnDisk
          ? "Disk SURVIVED a restart -- this boot found a file an earlier boot wrote."
          : "No prior boot found on disk -- either this is genuinely the first boot ever, or the disk did NOT survive the last restart. Hit this URL again after a redeploy or after the service sleeps and wakes to tell which.",
      },
      null,
      2,
    ),
  );
}).listen(port, () => console.log(`smoketest listening on ${port}`));
