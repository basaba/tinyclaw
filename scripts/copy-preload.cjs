// Copy the preload script (plain CJS) to dist after tsc build
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "src", "ui", "preload", "index.cjs");
const destDir = path.join(__dirname, "..", "dist", "ui", "preload");
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, "index.cjs"));
console.log("Copied preload script to dist/ui/preload/index.cjs");
