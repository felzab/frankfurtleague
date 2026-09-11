import { relative, resolve } from "node:path";

// Head and tail rather than the whole burst: a module that throws prints its stack first and a V8
// fatal prints its header first, so both ends carry the cause and the middle is a native trace.
const KEEP_HEAD = 12;
const KEEP_TAIL = 12;
// A line long enough to wrap the terminal buys nothing here, and every file in the run holds a
// buffer until it ends.
const KEEP_CHARS = 200;

const workers = new Map();

function workerFor(path) {
  let worker = workers.get(path);
  if (!worker) {
    worker = { fileTest: null, announced: new Map(), reported: new Map(), head: [], tail: [], dropped: 0 };
    workers.set(path, worker);
  }
  return worker;
}

// Two cases in one file may carry the same name, and a name says nothing about the depth it sits
// at, so counting by name alone reports a case that ran as still open.
function slot(data) {
  return `${data.nesting}\u0000${data.name}`;
}

function tally(counts, data) {
  const key = slot(data);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function keepOutput(worker, stream, message) {
  for (const raw of String(message).split("\n")) {
    if (raw === "") continue;
    const line = `${stream} ${raw.length > KEEP_CHARS ? `${raw.slice(0, KEEP_CHARS)}…` : raw}`;
    if (worker.head.length < KEEP_HEAD) {
      worker.head.push(line);
      continue;
    }
    worker.tail.push(line);
    if (worker.tail.length > KEEP_TAIL) {
      worker.tail.shift();
      worker.dropped += 1;
    }
  }
}

function outputLines(worker) {
  if (worker.dropped === 0) return [...worker.head, ...worker.tail];
  return [...worker.head, `… ${worker.dropped} line(s) not shown …`, ...worker.tail];
}

function describeExit(error) {
  const parts = [];
  // Both, because Windows leaves an exit code and no signal where Linux leaves a signal and no exit
  // code, and a death here is read off whichever of the two the platform filled in.
  if (error?.exitCode !== undefined && error?.exitCode !== null) parts.push(`exit code ${error.exitCode}`);
  if (error?.signal) parts.push(`killed by ${error.signal}`);
  return parts.length > 0 ? parts.join(", ") : "neither an exit code nor a signal was reported";
}

function describeProgress(worker) {
  let announced = 0;
  let reported = 0;
  const open = [];
  for (const [key, count] of worker.announced) {
    const done = Math.min(worker.reported.get(key) ?? 0, count);
    announced += count;
    reported += done;
    const name = key.slice(key.indexOf("\u0000") + 1);
    if (count > done) open.push(count - done > 1 ? `${JSON.stringify(name)} ×${count - done}` : JSON.stringify(name));
  }
  // An announcement reaches the parent only if the worker flushed it, so zero is the parent's
  // knowledge rather than proof that nothing ran. A suite counts here as one of its own.
  if (announced === 0) return "no test announcement reached the parent";
  const counted = `${reported} of ${announced} announced test(s) reported a result`;
  return open.length === 0 ? counted : `${counted}; still open: ${open.join(", ")}`;
}

export default async function* reportWorkerExits(source) {
  const deaths = [];

  for await (const event of source) {
    const data = event.data;
    if (!data?.file) continue;
    // `test:stderr` names a file as the command line spelled it and `test:fail` names it
    // absolutely, so an unresolved key files one worker's output under two states.
    const path = resolve(data.file);
    const worker = workerFor(path);

    switch (event.type) {
      case "test:stderr":
        keepOutput(worker, "err", data.message);
        break;
      case "test:stdout":
        keepOutput(worker, "out", data.message);
        break;
      case "test:enqueue":
        // The parent enqueues a file's own test before the child announces anything, so the first
        // name against a path is that test and every later one is the worker's own.
        if (worker.fileTest === null) worker.fileTest = data.name;
        else tally(worker.announced, data);
        break;
      case "test:pass":
        if (data.name !== worker.fileTest) tally(worker.reported, data);
        break;
      case "test:fail":
        // A failing test never fails the file's own: that one fails where the worker exited
        // non-zero having reported nothing, which is exactly the population this reports.
        if (data.name === worker.fileTest) deaths.push({ path, error: data.details?.error, worker });
        else tally(worker.reported, data);
        break;
      default:
        break;
    }
  }

  if (deaths.length === 0) return;

  yield `\n${deaths.length} test file(s) failed as a whole — the worker exited without reporting what killed it:\n`;
  for (const { path, error, worker } of deaths) {
    yield `\n  ${relative(process.cwd(), path).split("\\").join("/")}\n`;
    yield `    ${describeExit(error)}\n`;
    yield `    ${describeProgress(worker)}\n`;
    const lines = outputLines(worker);
    if (lines.length === 0) {
      yield `    this worker wrote nothing to stdout or stderr\n`;
    } else {
      for (const line of lines) yield `    │ ${line}\n`;
    }
  }
  yield `\n`;
}
