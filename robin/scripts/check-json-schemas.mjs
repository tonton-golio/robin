#!/usr/bin/env node

/**
 * Strictly compile checked-in JSON Schemas and validate their committed
 * examples. This is intentionally separate from the dependency-free manifest
 * checker: CI runs both, preventing the executable schema and business rules
 * from silently drifting apart.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const APP_PACKAGE = path.join(REPO_ROOT, "robin", "app", "package.json");
const requireFromApp = createRequire(APP_PACKAGE);
const Ajv2020 = requireFromApp("ajv/dist/2020.js").default;
const addFormats = requireFromApp("ajv-formats");

const schemaPaths = [
  "governance/workspace-manifest.schema.json",
  ...fs
    .readdirSync(path.join(REPO_ROOT, "robin", "schemas", "v1"))
    .filter((name) => name.endsWith(".schema.json"))
    .sort()
    .map((name) => `robin/schemas/v1/${name}`),
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function formatErrors(errors) {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validators = new Map();

for (const schemaPath of schemaPaths) {
  const schema = readJson(schemaPath);
  validators.set(schemaPath, ajv.compile(schema));
  console.log(`compiled ${schemaPath}`);
}

const examples = [
  {
    schema: "governance/workspace-manifest.schema.json",
    // A public starter has no adopter's manifest yet. Always validate the
    // synthetic example; validate the real manifest when one exists locally.
    documents: [
      "governance/workspace-manifest.example.json",
      ...(fs.existsSync(path.join(REPO_ROOT, "workspace.manifest.json")) ? ["workspace.manifest.json"] : []),
    ],
  },
  {
    schema: "robin/schemas/v1/capture-manifest.schema.json",
    documents: ["robin/schemas/v1/capture-manifest.template.json"],
  },
];

let failed = false;
for (const group of examples) {
  const validate = validators.get(group.schema);
  if (!validate) throw new Error(`schema was not compiled: ${group.schema}`);
  for (const documentPath of group.documents) {
    if (!validate(readJson(documentPath))) {
      failed = true;
      console.error(
        `invalid ${documentPath} against ${group.schema}: ${formatErrors(validate.errors)}`,
      );
    } else {
      console.log(`validated ${documentPath}`);
    }
  }
}

if (failed) process.exitCode = 1;
