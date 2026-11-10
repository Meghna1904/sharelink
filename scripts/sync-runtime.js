import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const runtimeFiles = ["app.js", "db.js"];

for (const file of runtimeFiles) {
  await copyFile(
    fileURLToPath(new URL(`../dist/${file}`, import.meta.url)),
    fileURLToPath(new URL(`../src/${file}`, import.meta.url)),
  );
}
