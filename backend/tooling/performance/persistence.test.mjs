import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { writeFileAtomically, writeImmutableOrConfirm } from "./persistence.mjs";

test("immutable evidence creation is idempotent only for identical bytes", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "spotter-performance-persistence-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const destination = path.join(directory, "measurement.json");
  const bytes = Buffer.from('{"measured":true}\n');

  assert.equal(await writeImmutableOrConfirm(destination, bytes), "created");
  assert.equal(await writeImmutableOrConfirm(destination, bytes), "confirmed");
  await assert.rejects(
    writeImmutableOrConfirm(destination, Buffer.from('{"measured":false}\n')),
    /different bytes/u,
  );
  assert.deepEqual(await readFile(destination), bytes);
});

test("mutable baseline index replacement is atomic and leaves no temporary file", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "spotter-performance-persistence-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const destination = path.join(directory, "baseline.json");
  await writeFile(destination, "old\n", "utf8");

  await writeFileAtomically(destination, Buffer.from("new\n"));

  assert.equal(await readFile(destination, "utf8"), "new\n");
  assert.deepEqual(
    (await readdir(directory)).filter((entry) => entry.includes(".tmp-")),
    [],
  );
});
