/**
 * Night batch runner with resume/checkpoint support.
 *
 * Pipeline per episode:
 *   1) importEpisode --batch N-N
 *   2) pushToSupabase episodes_N-N.json
 *   3) resegment_with_whisper.py --apply
 *   4) retranslate_episode_openai.py --force
 *
 * Usage:
 *   npx tsx scripts/nightBatch.ts --start 13 --end 30
 *   npx tsx scripts/nightBatch.ts --resume
 *   npx tsx scripts/nightBatch.ts --start 13 --end 190 --continue-on-error --max-retries 2
 */
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "night_batch_state.json");
const EPISODES_FILE = path.join(DATA_DIR, "episodes.json");

type Step = "import" | "push" | "resegment" | "translate";
const STEPS: Step[] = ["import", "push", "resegment", "translate"];

type EpisodeProgress = Partial<Record<Step, boolean>>;

type State = {
  start: number;
  end: number;
  model: string;
  last_episode: number | null;
  episodes: Record<string, EpisodeProgress>;
  failed: Record<string, string>;
  skipped: number[];
  updated_at: string;
};

function getArg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] || fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function saveState(state: State): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function loadState(): State | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
}

function runCommand(command: string, description: string): void {
  console.log(`\n[RUN] ${description}`);
  console.log(`      ${command}`);
  const r = spawnSync(command, {
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) {
    throw new Error(`Failed: ${description} (exit ${r.status ?? "unknown"})`);
  }
}

function runStepWithRetry(command: string, description: string, retries: number): void {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[RETRY] ${description} attempt ${attempt}/${retries}`);
      }
      runCommand(command, description);
      return;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError || new Error(`Failed after ${retries} attempts: ${description}`);
}

function parseSkipList(raw: string | undefined): Set<number> {
  if (!raw) return new Set<number>();
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const n = parseInt(part.trim(), 10);
    if (!Number.isNaN(n)) out.add(n);
  }
  return out;
}

function validateImportedEpisode(ep: number): void {
  const singleFile = path.join(DATA_DIR, `episodes_${ep}-${ep}.json`);
  if (!fs.existsSync(singleFile)) {
    throw new Error(`Import file missing: ${singleFile}`);
  }
  const arr = JSON.parse(fs.readFileSync(singleFile, "utf-8")) as Array<{ segments?: unknown[] }>;
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(`Import output empty for episode ${ep}`);
  }
  const segs = Array.isArray(arr[0].segments) ? arr[0].segments.length : 0;
  if (segs <= 0) {
    throw new Error(`Episode ${ep} imported with 0 segments. Fix URL/parser and resume.`);
  }
}

function stepCommand(step: Step, ep: number, model: string): string {
  const singleFile = path.join("scripts", "data", `episodes_${ep}-${ep}.json`);
  if (step === "import") {
    return `npx tsx scripts/importEpisode.ts --batch ${ep}-${ep}`;
  }
  if (step === "push") {
    return `npx tsx scripts/pushToSupabase.ts ${singleFile}`;
  }
  if (step === "resegment") {
    return `python scripts/resegment_with_whisper.py --episode ${ep} --source-json ${singleFile} --apply --model ${model}`;
  }
  return `python scripts/retranslate_episode_openai.py --episode ${ep} --force`;
}

function ensureEpisodesFile(): void {
  if (!fs.existsSync(EPISODES_FILE)) {
    throw new Error(`Missing ${EPISODES_FILE}. Run fetchEpisodeList/resolveUrls first.`);
  }
}

function initState(start: number, end: number, model: string): State {
  return {
    start,
    end,
    model,
    last_episode: null,
    episodes: {},
    failed: {},
    skipped: [],
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  ensureEpisodesFile();

  const resume = hasFlag("--resume");
  const start = parseInt(getArg("--start", "13")!, 10);
  const end = parseInt(getArg("--end", "190")!, 10);
  const model = getArg("--model", "tiny")!;
  const continueOnError = hasFlag("--continue-on-error");
  const maxRetries = Math.max(1, parseInt(getArg("--max-retries", "2")!, 10));
  const skipList = parseSkipList(getArg("--skip"));

  let state: State;
  if (resume) {
    const loaded = loadState();
    if (!loaded) {
      throw new Error("No checkpoint found. Start once without --resume.");
    }
    state = loaded;
    state.failed = state.failed || {};
    state.skipped = state.skipped || [];
    console.log(`Resuming ${state.start}-${state.end} (model=${state.model})`);
  } else {
    state = initState(start, end, model);
    saveState(state);
    console.log(`Starting new night batch ${start}-${end} (model=${model})`);
  }

  for (let ep = state.start; ep <= state.end; ep++) {
    const key = String(ep);
    if (skipList.has(ep)) {
      if (!state.skipped.includes(ep)) state.skipped.push(ep);
      console.log(`\n========== EPISODE ${ep} ==========\n[SKIP] manually skipped`);
      saveState(state);
      continue;
    }
    if (!state.episodes[key]) state.episodes[key] = {};
    state.last_episode = ep;
    saveState(state);
    console.log(`\n========== EPISODE ${ep} ==========`);

    for (const step of STEPS) {
      if (state.episodes[key][step]) {
        console.log(`[SKIP] ${step} already done`);
        continue;
      }
      const cmd = stepCommand(step, ep, state.model);
      try {
        runStepWithRetry(cmd, `ep ${ep} / ${step}`, maxRetries);
        if (step === "import") {
          validateImportedEpisode(ep);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        state.failed[key] = `${step}: ${msg}`;
        saveState(state);
        if (continueOnError) {
          console.error(`[FAIL] ep ${ep} / ${step}: ${msg}`);
          console.error("       continue-on-error enabled, moving to next episode");
          break;
        }
        throw e;
      }
      state.episodes[key][step] = true;
      delete state.failed[key];
      saveState(state);
    }
  }

  const failedEpisodes = Object.keys(state.failed).map((k) => Number(k)).filter((n) => !Number.isNaN(n));
  if (failedEpisodes.length > 0) {
    console.log(`\nNight batch completed with failures: ${failedEpisodes.length}`);
    console.log(`Failed episodes: ${failedEpisodes.sort((a, b) => a - b).join(", ")}`);
  } else {
    console.log("\nNight batch completed successfully.");
  }
  console.log(`Checkpoint: ${STATE_FILE}`);
}

main().catch((e) => {
  console.error("\nBatch stopped:", e instanceof Error ? e.message : e);
  console.error(`Resume with: npx tsx scripts/nightBatch.ts --resume`);
  process.exit(1);
});

