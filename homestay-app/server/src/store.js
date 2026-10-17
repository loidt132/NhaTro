import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const SEED_PATH = path.join(__dirname, "..", "data", "seed.json");

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf-8"));
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export const db = {
  read: load,
  write: save,
};
