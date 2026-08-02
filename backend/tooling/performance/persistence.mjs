import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

export async function writeImmutableOrConfirm(destination, bytes) {
  try {
    await writeFile(destination, bytes, { flag: "wx" });
    return "created";
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(destination);
    if (!existing.equals(bytes)) {
      throw new Error(`Immutable evidence already exists with different bytes: ${destination}`);
    }
    return "confirmed";
  }
}

export async function writeFileAtomically(destination, bytes) {
  const temporary = `${destination}.tmp-${String(process.pid)}-${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
