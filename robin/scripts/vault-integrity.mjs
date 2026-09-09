#!/usr/bin/env node

/**
 * Read-only validator for the versioned Robin vault contract.
 *
 * Strict mode exits non-zero when integrity findings exist. Report mode emits
 * the same findings but exits zero so an established vault can inventory legacy
 * drift before choosing migrations. Neither mode writes to the vault.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHtmlContract } from "./html-contract.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_DIR = path.resolve(SCRIPT_DIR, "..", "schemas", "v1");

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, expected) {
  const candidates = Array.isArray(expected) ? expected : [expected];
  const actual = valueType(value);
  return candidates.some((candidate) => {
    if (candidate === "number")
      return actual === "number" || actual === "integer";
    if (candidate === "object") return isPlainObject(value);
    return candidate === actual;
  });
}

function decodePointerSegment(segment) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

class SchemaStore {
  constructor(schemaDir) {
    this.schemaDir = schemaDir;
    this.byPath = new Map();
  }

  load(schemaPath) {
    const absolutePath = path.isAbsolute(schemaPath)
      ? schemaPath
      : path.resolve(this.schemaDir, schemaPath);
    const cached = this.byPath.get(absolutePath);
    if (cached) return cached;
    const schema = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    const loaded = { schema, root: schema, file: absolutePath };
    this.byPath.set(absolutePath, loaded);
    return loaded;
  }

  resolve(ref, context) {
    const hashIndex = ref.indexOf("#");
    const filePart = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;
    const fragment = hashIndex >= 0 ? ref.slice(hashIndex + 1) : "";
    let target;
    if (filePart) {
      const targetPath = path.resolve(path.dirname(context.file), filePart);
      target = this.load(targetPath);
    } else {
      target = { schema: context.root, root: context.root, file: context.file };
    }

    if (!fragment) return target;
    if (!fragment.startsWith("/")) {
      throw new Error(`unsupported schema reference fragment: ${ref}`);
    }
    let schema = target.root;
    for (const rawSegment of fragment.slice(1).split("/")) {
      schema = schema?.[decodePointerSegment(rawSegment)];
    }
    if (schema === undefined)
      throw new Error(`unresolved schema reference: ${ref}`);
    return { schema, root: target.root, file: target.file };
  }
}

function schemaError(instancePath, message) {
  return { instancePath, message };
}

function validateFormat(value, format) {
  if (format === "uuid") {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
  if (format === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }
  if (format === "date-time") {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
        value,
      );
    if (!match) return false;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
      match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const leapYear =
      year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [
      31,
      leapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
    const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
    return (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= daysInMonth[month - 1] &&
      hour <= 23 &&
      minute <= 59 &&
      second <= 59 &&
      offsetHour <= 23 &&
      offsetMinute <= 59
    );
  }
  return true;
}

function eventValues(schema, context, store, seen = new Set()) {
  if (!schema || typeof schema !== "object" || seen.has(schema))
    return new Set();
  seen.add(schema);
  if (schema.$ref) {
    const resolved = store.resolve(schema.$ref, context);
    return eventValues(resolved.schema, resolved, store, seen);
  }
  const values = new Set();
  const eventSchema = schema.properties?.event;
  if (eventSchema?.const !== undefined) values.add(eventSchema.const);
  for (const value of eventSchema?.enum ?? []) values.add(value);
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    for (const child of schema[key] ?? []) {
      for (const value of eventValues(child, context, store, seen))
        values.add(value);
    }
  }
  return values;
}

function eventBranch(schema, eventName, context, store) {
  for (const branch of schema.oneOf ?? []) {
    const values = eventValues(branch, context, store);
    if (values.has(eventName)) {
      if (branch.$ref) return store.resolve(branch.$ref, context);
      return { schema: branch, root: context.root, file: context.file };
    }
  }
  return null;
}

function declaredStringValues(schema) {
  if (typeof schema?.const === "string") return [schema.const];
  if (
    Array.isArray(schema?.enum) &&
    schema.enum.length > 0 &&
    schema.enum.every((value) => typeof value === "string")
  ) {
    return [...schema.enum];
  }
  return [];
}

function validateSchema(
  value,
  schema,
  context,
  store,
  instancePath = "$",
  errors = [],
) {
  if (schema === true || schema === undefined) return errors;
  if (schema === false) {
    errors.push(schemaError(instancePath, "is forbidden by the contract"));
    return errors;
  }
  if (schema.$ref) {
    const resolved = store.resolve(schema.$ref, context);
    return validateSchema(
      value,
      resolved.schema,
      resolved,
      store,
      instancePath,
      errors,
    );
  }

  for (const child of schema.allOf ?? []) {
    validateSchema(value, child, context, store, instancePath, errors);
  }

  if (schema.not) {
    const forbiddenErrors = [];
    validateSchema(
      value,
      schema.not,
      context,
      store,
      instancePath,
      forbiddenErrors,
    );
    if (forbiddenErrors.length === 0) {
      errors.push(
        schemaError(instancePath, "must not match the forbidden schema"),
      );
    }
  }

  if (schema.if) {
    const conditionErrors = [];
    validateSchema(
      value,
      schema.if,
      context,
      store,
      instancePath,
      conditionErrors,
    );
    if (conditionErrors.length === 0 && schema.then) {
      validateSchema(value, schema.then, context, store, instancePath, errors);
    } else if (conditionErrors.length > 0 && schema.else) {
      validateSchema(value, schema.else, context, store, instancePath, errors);
    }
  }

  if (schema.oneOf) {
    const selected =
      isPlainObject(value) && typeof value.event === "string"
        ? eventBranch(schema, value.event, context, store)
        : null;
    if (selected) {
      validateSchema(
        value,
        selected.schema,
        selected,
        store,
        instancePath,
        errors,
      );
    } else {
      const candidates = schema.oneOf.map((candidate) => {
        const candidateErrors = [];
        validateSchema(
          value,
          candidate,
          context,
          store,
          instancePath,
          candidateErrors,
        );
        return candidateErrors;
      });
      const passing = candidates.filter(
        (candidateErrors) => candidateErrors.length === 0,
      );
      if (passing.length !== 1) {
        errors.push(
          schemaError(
            instancePath,
            `must match exactly one schema branch (matched ${passing.length})`,
          ),
        );
        if (passing.length === 0 && candidates.length) {
          const closest = [...candidates].sort(
            (a, b) => a.length - b.length,
          )[0];
          errors.push(...closest);
        }
      }
    }
  }

  if (schema.anyOf) {
    const candidates = schema.anyOf.map((candidate) => {
      const candidateErrors = [];
      validateSchema(
        value,
        candidate,
        context,
        store,
        instancePath,
        candidateErrors,
      );
      return candidateErrors;
    });
    if (!candidates.some((candidateErrors) => candidateErrors.length === 0)) {
      errors.push(
        schemaError(instancePath, "must match at least one schema branch"),
      );
    }
  }

  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push(
      schemaError(instancePath, `must equal ${JSON.stringify(schema.const)}`),
    );
  }
  if (
    schema.enum &&
    !schema.enum.some((candidate) => deepEqual(value, candidate))
  ) {
    errors.push(
      schemaError(
        instancePath,
        `must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`,
      ),
    );
  }
  if (schema.type && !matchesType(value, schema.type)) {
    const expected = Array.isArray(schema.type)
      ? schema.type.join(" or ")
      : schema.type;
    errors.push(
      schemaError(instancePath, `must be ${expected}; got ${valueType(value)}`),
    );
    return errors;
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(
        schemaError(
          instancePath,
          `must contain at least ${schema.minLength} character(s)`,
        ),
      );
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(
        schemaError(
          instancePath,
          `must contain at most ${schema.maxLength} character(s)`,
        ),
      );
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(schemaError(instancePath, `must match ${schema.pattern}`));
    }
    if (schema.format && !validateFormat(value, schema.format)) {
      errors.push(
        schemaError(instancePath, `must be a valid ${schema.format}`),
      );
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(schemaError(instancePath, `must be >= ${schema.minimum}`));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(schemaError(instancePath, `must be <= ${schema.maximum}`));
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(
        schemaError(
          instancePath,
          `must contain at least ${schema.minItems} item(s)`,
        ),
      );
    }
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) {
        errors.push(
          schemaError(instancePath, "must not contain duplicate items"),
        );
      }
    }
    if (schema.items) {
      value.forEach((item, index) => {
        validateSchema(
          item,
          schema.items,
          context,
          store,
          `${instancePath}[${index}]`,
          errors,
        );
      });
    }
  }

  if (isPlainObject(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        errors.push(schemaError(`${instancePath}.${required}`, "is required"));
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        validateSchema(
          value[key],
          child,
          context,
          store,
          `${instancePath}.${key}`,
          errors,
        );
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          errors.push(
            schemaError(`${instancePath}.${key}`, "is not a known field"),
          );
        }
      }
    }
  }

  return errors;
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  }
  return files.sort();
}

function realPathIfPresent(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function firstSymlinkComponent(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!pathInside(root, candidate)) return null;
  let current = path.resolve(root);
  const parts = relative ? relative.split(path.sep) : [];
  for (const part of ["", ...parts]) {
    if (part) current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return current;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  return null;
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function safeReadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatSchemaErrors(errors) {
  return errors.map((error) => `${error.instancePath} ${error.message}`);
}

// The first memory writer used an append-only, pre-v1 shape: memory.saved
// records carried {text, source, created} and did not have the later derived
// arrays/timestamps. Keep those historical rows readable without making the
// current schema permissive. The legacy branch is a complete, closed schema;
// new or partially malformed rows continue through the current validator.
const LEGACY_MEMORY_SAVED_SCHEMA = {
  type: "object",
  required: ["event", "memory"],
  additionalProperties: false,
  properties: {
    event: { const: "memory.saved" },
    memory: {
      type: "object",
      required: ["id", "text", "source", "created"],
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1 },
        type: { type: "string", minLength: 1 },
        tier: { enum: ["episodic", "procedural", "semantic", "working"] },
        status: { enum: ["active", "archived", "rejected", "superseded", "tentative"] },
        confidence: { enum: ["high", "low", "medium"] },
        scope: { type: "string", minLength: 1 },
        text: { type: "string", minLength: 1 },
        body: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        source: {
          type: "object",
          required: ["kind", "ref"],
          additionalProperties: false,
          properties: {
            kind: { enum: ["annotation", "conversation", "manual", "meeting", "other", "repo", "tool"] },
            ref: { type: "string", minLength: 1 },
            quote: { type: "string" },
            date: { type: "string" },
            captured_at: { type: "string", format: "date-time" },
          },
        },
        created: { type: "string", format: "date-time" },
      },
    },
  },
};

export function isLegacyMemorySavedEvent(event) {
  if (!isPlainObject(event) || event.event !== "memory.saved") return false;
  const memory = event.memory;
  if (!isPlainObject(memory)) return false;
  if (Object.hasOwn(event, "schema_version")) return false;
  return ["id", "text", "source", "created"].every((key) => Object.hasOwn(memory, key)) &&
    !["subject", "summary", "sources", "created_at", "updated_at", "last_seen_at", "fingerprint"].some(
      (key) => Object.hasOwn(memory, key),
    );
}

export function validateLegacyMemorySavedEvent(event) {
  if (!isLegacyMemorySavedEvent(event)) return null;
  return validateSchema(event, LEGACY_MEMORY_SAVED_SCHEMA, {}, null);
}

function resolveOptions(options) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const rawVault = options.vault ?? process.env.ROBIN_VAULT ?? "base";
  const vault = path.isAbsolute(rawVault)
    ? path.resolve(rawVault)
    : path.resolve(repoRoot, rawVault);
  const schemaDir = path.resolve(options.schemaDir ?? DEFAULT_SCHEMA_DIR);
  return { repoRoot, vault, schemaDir };
}

export function validateDocument(value, schemaPath, options = {}) {
  const store = new SchemaStore(
    path.resolve(options.schemaDir ?? DEFAULT_SCHEMA_DIR),
  );
  const context = store.load(schemaPath);
  return validateSchema(value, context.schema, context, store);
}

export function validateVault(options = {}) {
  const { repoRoot, vault, schemaDir } = resolveOptions(options);
  const store = new SchemaStore(schemaDir);
  const contractContext = store.load("contract.json");
  const contract = contractContext.schema;
  const pageContext = store.load(contract.page.metadata_schema);
  const pageSchema = pageContext.schema;
  const pageFormatVersions = declaredStringValues(
    pageSchema.properties?.["robin:version"],
  );
  const pageFormatVersion = contract.page.default_format_version;
  if (
    typeof pageFormatVersion !== "string" ||
    !pageFormatVersions.includes(pageFormatVersion)
  ) {
    throw new Error(
      "contract page.default_format_version must be accepted by the page metadata schema",
    );
  }
  const pageFormatVersionSet = new Set(pageFormatVersions);
  const expectedPageVersions = pageFormatVersions
    .map((value) => JSON.stringify(value))
    .join(" or ");
  const findings = [];
  const pageIds = new Map();

  const displayPath = (absolutePath) => {
    if (pathInside(repoRoot, absolutePath))
      return toPosix(path.relative(repoRoot, absolutePath)) || ".";
    return toPosix(absolutePath);
  };
  const add = ({ code, absolutePath, message, line, severity = "error" }) => {
    findings.push({
      severity,
      code,
      file: displayPath(absolutePath),
      ...(line ? { line } : {}),
      message,
    });
  };
  const historyRoot = path.join(vault, ".history");
  const validateSnapshotEvidence = ({
    event,
    evidencePath,
    line,
    codePrefix,
  }) => {
    const snapshot = isPlainObject(event) ? event.snapshot : undefined;
    if (snapshot === undefined) return true;
    if (typeof snapshot !== "string" || !snapshot) {
      add({
        code: `${codePrefix}.snapshot.invalid`,
        absolutePath: evidencePath,
        line,
        message: "snapshot must be a non-empty vault-relative path",
      });
      return false;
    }

    const snapshotPath = path.resolve(vault, snapshot);
    if (!pathInside(historyRoot, snapshotPath)) {
      add({
        code: `${codePrefix}.snapshot.escape`,
        absolutePath: evidencePath,
        line,
        message: `snapshot must remain under .history/: ${JSON.stringify(snapshot)}`,
      });
      return false;
    }

    let stat;
    try {
      const symlink = firstSymlinkComponent(historyRoot, snapshotPath);
      if (symlink) {
        add({
          code: `${codePrefix}.snapshot.symlink`,
          absolutePath: evidencePath,
          line,
          message: `snapshot path contains a symlink: ${JSON.stringify(snapshot)}`,
        });
        return false;
      }
      stat = fs.lstatSync(snapshotPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!stat?.isFile()) {
      add({
        code: `${codePrefix}.snapshot.missing`,
        absolutePath: evidencePath,
        line,
        message: `snapshot is missing or is not a regular file: ${JSON.stringify(snapshot)}`,
      });
      return false;
    }

    const realHistoryRoot = realPathIfPresent(historyRoot);
    const realSnapshotPath = fs.realpathSync(snapshotPath);
    if (!pathInside(realHistoryRoot, realSnapshotPath)) {
      add({
        code: `${codePrefix}.snapshot.escape`,
        absolutePath: evidencePath,
        line,
        message: `snapshot resolves outside .history/: ${JSON.stringify(snapshot)}`,
      });
      return false;
    }

    if (
      typeof event.before_hash === "string" &&
      /^[0-9a-f]{64}$/.test(event.before_hash)
    ) {
      const actualHash = sha256File(snapshotPath);
      if (actualHash !== event.before_hash) {
        add({
          code: `${codePrefix}.snapshot.hash`,
          absolutePath: evidencePath,
          line,
          message: `snapshot sha256 ${actualHash} does not match before_hash ${event.before_hash}`,
        });
        return false;
      }
    }
    return true;
  };

  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
    add({
      code: "vault.missing",
      absolutePath: vault,
      message: "resolved vault directory does not exist",
    });
    return {
      contractVersion: contract.contract_version,
      pageFormatVersion,
      pageFormatVersions,
      findings,
    };
  }

  const repeatableMeta = new Set(
    Object.entries(pageSchema.properties ?? {})
      .filter(([, schema]) => schema.type === "array")
      .map(([name]) => name),
  );

  for (const rootConfig of contract.page.roots) {
    const rootName =
      typeof rootConfig === "string" ? rootConfig : rootConfig.path;
    const include =
      typeof rootConfig === "string" ? "all_html" : rootConfig.include;
    const pageRoot = path.join(vault, rootName);
    for (const pagePath of walkFiles(pageRoot).filter((file) =>
      file.toLowerCase().endsWith(".html"),
    )) {
      const html = fs.readFileSync(pagePath, "utf8");
      const parsedHtml = parseHtmlContract(html);
      if (
        include === "robin_pages" &&
        parsedHtml.articleDataRobinDocCount === 0
      ) {
        continue;
      }
      const relativePath = toPosix(path.relative(vault, pagePath));
      const metaEntries = parsedHtml.robinMeta;
      const normalizedMeta = {};

      for (const [name, values] of metaEntries) {
        if (repeatableMeta.has(name)) {
          normalizedMeta[name] = values.map((entry) => entry.content);
        } else {
          normalizedMeta[name] = values[0].content;
          if (values.length > 1) {
            add({
              code: "page.meta.duplicate",
              absolutePath: pagePath,
              line: values[1].line,
              message: `${name} must appear at most once (found ${values.length})`,
            });
          }
        }
      }

      const version = metaEntries.get("robin:version")?.[0];
      if (!version) {
        add({
          code: "page.version",
          absolutePath: pagePath,
          line: 1,
          message: `missing robin:version (expected ${expectedPageVersions})`,
        });
      } else if (!pageFormatVersionSet.has(version.content)) {
        add({
          code: "page.version",
          absolutePath: pagePath,
          line: version.line,
          message: `robin:version must be ${expectedPageVersions}; found ${JSON.stringify(version.content)}`,
        });
      }

      const declaredPath = metaEntries.get("robin:path")?.[0];
      if (!declaredPath) {
        add({
          code: "page.path",
          absolutePath: pagePath,
          line: 1,
          message: `missing robin:path (expected ${JSON.stringify(relativePath)})`,
        });
      } else if (declaredPath.content !== relativePath) {
        add({
          code: "page.path",
          absolutePath: pagePath,
          line: declaredPath.line,
          message: `robin:path must equal filesystem path ${JSON.stringify(relativePath)}; found ${JSON.stringify(declaredPath.content)}`,
        });
      }

      const declaredSlug = metaEntries.get("robin:slug")?.[0];
      const expectedSlug = path.basename(pagePath, ".html");
      if (declaredSlug && declaredSlug.content !== expectedSlug) {
        add({
          code: "page.slug",
          absolutePath: pagePath,
          line: declaredSlug.line,
          message: `robin:slug must equal basename ${JSON.stringify(expectedSlug)}; found ${JSON.stringify(declaredSlug.content)}`,
        });
      }

      const declaredId = metaEntries.get("robin:id")?.[0];
      if (declaredId) {
        const normalizedId = declaredId.content.toLowerCase();
        if (declaredId.content !== normalizedId) {
          add({
            code: "page.id.case",
            absolutePath: pagePath,
            line: declaredId.line,
            message: "robin:id must use lowercase canonical UUID spelling",
          });
        }
        const firstPage = pageIds.get(normalizedId);
        if (firstPage) {
          add({
            code: "page.id.duplicate",
            absolutePath: pagePath,
            line: declaredId.line,
            message: `robin:id must identify exactly one page; also declared by ${displayPath(firstPage)}`,
          });
        } else {
          pageIds.set(normalizedId, pagePath);
        }
      }

      const errors = validateSchema(
        normalizedMeta,
        pageSchema,
        pageContext,
        store,
      );
      for (const error of errors) {
        if (
          error.instancePath === "$.robin:version" ||
          error.instancePath === "$.robin:path"
        ) {
          continue;
        }
        const metaName = error.instancePath.startsWith("$.robin:")
          ? error.instancePath.slice(2).split(/[.[\]]/, 1)[0]
          : null;
        add({
          code: "page.schema",
          absolutePath: pagePath,
          line: metaName ? (metaEntries.get(metaName)?.[0]?.line ?? 1) : 1,
          message: `${error.instancePath} ${error.message}`,
        });
      }

      const sourceKinds = normalizedMeta["robin:source-kind"];
      const sourceRefs = normalizedMeta["robin:source-ref"];
      if (
        Array.isArray(sourceKinds) &&
        Array.isArray(sourceRefs) &&
        sourceKinds.length !== sourceRefs.length
      ) {
        add({
          code: "page.provenance",
          absolutePath: pagePath,
          line:
            metaEntries.get("robin:source-kind")?.[0]?.line ??
            metaEntries.get("robin:source-ref")?.[0]?.line ??
            1,
          message: `robin:source-kind and robin:source-ref must form ordered pairs (found ${sourceKinds.length} kind tag(s) and ${sourceRefs.length} ref tag(s))`,
        });
      }

      if (
        contract.page.required_structure.doctype &&
        !/^\s*<!doctype\s+html>/i.test(html)
      ) {
        add({
          code: "page.doctype",
          absolutePath: pagePath,
          line: 1,
          message: "page must start with <!doctype html>",
        });
      }
      const articleCount = parsedHtml.articleDataRobinDocCount;
      if (
        articleCount !== contract.page.required_structure.article_data_robin_doc
      ) {
        add({
          code: "page.article",
          absolutePath: pagePath,
          line: 1,
          message: `page must contain exactly one <article data-robin-doc> (found ${articleCount})`,
        });
      }
      if (
        contract.page.required_structure.forbid_legacy_json_scripts &&
        parsedHtml.hasLegacyJsonScript
      ) {
        add({
          code: "page.legacy_script",
          absolutePath: pagePath,
          line: parsedHtml.legacyJsonScriptLine ?? 1,
          message:
            "legacy application/json script blocks are forbidden in v0.2 pages",
        });
      }
    }
  }

  const allowedNonHtmlPaths = new Set(contract.brain.allowed_non_html_paths);
  const allowedNonHtmlBasenames = new Set(
    contract.brain.allowed_non_html_basenames,
  );
  for (const filePath of walkFiles(path.join(vault, "brain"))) {
    const relativePath = toPosix(path.relative(vault, filePath));
    if (filePath.toLowerCase().endsWith(".html")) continue;
    if (allowedNonHtmlPaths.has(relativePath)) continue;
    if (allowedNonHtmlBasenames.has(path.basename(filePath))) continue;
    add({
      code: "brain.non_html",
      absolutePath: filePath,
      message: `non-HTML file is not an allowed brain substrate (${relativePath})`,
    });
  }

  const editIds = new Map();
  for (const ledger of contract.ledgers) {
    const ledgerContext = store.load(ledger.schema);
    const knownEvents = eventValues(ledgerContext.schema, ledgerContext, store);
    let files = [];
    if (ledger.path) {
      const filePath = path.join(vault, ledger.path);
      if (!fs.existsSync(filePath)) {
        if (ledger.required) {
          add({
            code: `${ledger.name}.missing`,
            absolutePath: filePath,
            message: "required ledger file is missing",
          });
        }
        continue;
      }
      files = [filePath];
    } else if (ledger.directory) {
      files = walkFiles(path.join(vault, ledger.directory)).filter((file) =>
        file.endsWith(ledger.suffix),
      );
    }

    for (const ledgerPath of files) {
      const lines = fs.readFileSync(ledgerPath, "utf8").split("\n");
      lines.forEach((line, index) => {
        const lineNumber = index + 1;
        if (!line.trim()) return;
        let event;
        try {
          event = JSON.parse(line);
        } catch (error) {
          add({
            code: `${ledger.name}.json.malformed`,
            absolutePath: ledgerPath,
            line: lineNumber,
            message: `malformed JSON: ${error.message}`,
          });
          return;
        }

        const eventName = isPlainObject(event) ? event.event : undefined;
        if (typeof eventName !== "string" || !knownEvents.has(eventName)) {
          add({
            code: `${ledger.name}.event.unknown`,
            absolutePath: ledgerPath,
            line: lineNumber,
            message: `unknown event ${JSON.stringify(eventName ?? "<missing>")}; expected one of ${[...knownEvents].sort().join(", ")}`,
          });
        } else {
          const branch = eventBranch(
            ledgerContext.schema,
            eventName,
            ledgerContext,
            store,
          );
          // Historical memory.saved rows are normalized by @robin/memory at
          // replay time. Accept only the narrow legacy signature above; all
          // current records remain subject to the versioned schema.
          const legacyErrors = validateLegacyMemorySavedEvent(event);
          const errors = legacyErrors ?? validateSchema(event, branch.schema, branch, store);
          for (const message of formatSchemaErrors(errors)) {
            add({
              code: `${ledger.name}.schema`,
              absolutePath: ledgerPath,
              line: lineNumber,
              message,
            });
          }
        }

        if (
          ledger.name === "edits" &&
          isPlainObject(event) &&
          typeof event.id === "string" &&
          event.id
        ) {
          const identity = event.id.toLowerCase();
          const first = editIds.get(identity);
          if (first) {
            add({
              code: "edits.id.duplicate",
              absolutePath: ledgerPath,
              line: lineNumber,
              message:
                `edit id ${JSON.stringify(event.id)} duplicates ` +
                `${displayPath(first.path)}:${first.line}` +
                (deepEqual(first.event, event)
                  ? ""
                  : " with a conflicting payload"),
            });
          } else {
            editIds.set(identity, {
              path: ledgerPath,
              line: lineNumber,
              event,
            });
          }
        }

        if (ledger.snapshot_field && isPlainObject(event)) {
          const evidenceEvent =
            ledger.snapshot_field === "snapshot"
              ? event
              : { ...event, snapshot: event[ledger.snapshot_field] };
          validateSnapshotEvidence({
            event: evidenceEvent,
            evidencePath: ledgerPath,
            line: lineNumber,
            codePrefix: ledger.name,
          });
        }
      });
    }
  }

  const receiptConfig = contract.transaction_receipts;
  const receiptDirectory = path.join(vault, receiptConfig.directory);
  if (fs.existsSync(receiptDirectory)) {
    const receiptContext = store.load(receiptConfig.schema);
    const directoryStat = fs.lstatSync(receiptDirectory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      add({
        code: "transaction.directory.invalid",
        absolutePath: receiptDirectory,
        message:
          "transaction storage must be a real directory, not a symlink or file",
      });
    } else {
      const entries = fs.readdirSync(receiptDirectory, { withFileTypes: true });
      const tombstones = new Map();
      const receipts = [];
      for (const entry of entries) {
        const entryPath = path.join(receiptDirectory, entry.name);
        if (!entry.isFile()) {
          add({
            code: "transaction.unexpected_node",
            absolutePath: entryPath,
            message:
              "transaction directory may contain only regular receipt/tombstone files",
          });
        } else if (entry.name.endsWith(".deleted")) {
          tombstones.set(entry.name, entryPath);
        } else if (entry.name.endsWith(receiptConfig.suffix)) {
          receipts.push(entryPath);
        } else {
          add({
            code: "transaction.unexpected_file",
            absolutePath: entryPath,
            message: `transaction directory may contain only ${receiptConfig.suffix} receipts and paired .deleted tombstones`,
          });
        }
      }

      const pairedTombstones = new Set();
      const claimedPaths = new Map();
      for (const receiptPath of receipts.sort()) {
        let receipt;
        try {
          receipt = safeReadJson(receiptPath);
        } catch (error) {
          add({
            code: "transaction.json.malformed",
            absolutePath: receiptPath,
            line: 1,
            message: `malformed JSON: ${error.message}`,
          });
          continue;
        }
        const errors = validateSchema(
          receipt,
          receiptContext.schema,
          receiptContext,
          store,
        );
        for (const message of formatSchemaErrors(errors)) {
          add({
            code: "transaction.schema",
            absolutePath: receiptPath,
            line: 1,
            message,
          });
        }
        if (errors.length) continue;

        let correlationValid = true;
        const correlationError = (code, message) => {
          correlationValid = false;
          add({ code, absolutePath: receiptPath, message });
        };

        const expectedFilename = `${receipt.transaction_id}${receiptConfig.suffix}`;
        if (path.basename(receiptPath) !== expectedFilename) {
          correlationError(
            "transaction.filename",
            `receipt filename must be ${JSON.stringify(expectedFilename)}`,
          );
        }
        if (receipt.transaction_id !== receipt.transaction_id.toLowerCase()) {
          correlationError(
            "transaction.id.case",
            "transaction_id must use lowercase canonical UUID spelling",
          );
        }
        if (
          receipt.event.id !== receipt.transaction_id ||
          receipt.event.transaction_id !== receipt.transaction_id
        ) {
          correlationError(
            "transaction.id_mismatch",
            "transaction_id, event.id, and event.transaction_id must be identical",
          );
        }
        if (receipt.created_at !== receipt.event.ts) {
          correlationError(
            "transaction.time_mismatch",
            "created_at must equal event.ts exactly",
          );
        }
        if (receipt.target_path !== receipt.event.page_path) {
          correlationError(
            "transaction.target_mismatch",
            "target_path must equal event.page_path",
          );
        }
        if (
          receipt.event.schema_version !== 2 ||
          receipt.event.status !== "open"
        ) {
          correlationError(
            "transaction.event_state",
            "prepared transaction event must have schema_version=2 and status=open",
          );
        }

        const allowedEvents = {
          delete: new Set(["edit.deleted"]),
          move: new Set(["edit.moved"]),
          write: new Set(["edit.created", "edit.reverted", "edit.saved"]),
        };
        if (!allowedEvents[receipt.operation].has(receipt.event.event)) {
          correlationError(
            "transaction.operation_mismatch",
            `operation ${JSON.stringify(receipt.operation)} is incompatible with ${JSON.stringify(receipt.event.event)}`,
          );
        }
        if (
          receipt.operation === "move" &&
          receipt.source_path !== receipt.event.previous_path
        ) {
          correlationError(
            "transaction.source_mismatch",
            "source_path must equal event.previous_path for a move",
          );
        }

        if (
          !validateSnapshotEvidence({
            event: receipt.event,
            evidencePath: receiptPath,
            line: 1,
            codePrefix: "transaction",
          })
        ) {
          correlationValid = false;
        }

        if (receipt.operation === "delete") {
          const expectedTombstone = `.robin/transactions/${receipt.transaction_id}.deleted`;
          if (receipt.tombstone_path !== expectedTombstone) {
            correlationError(
              "transaction.tombstone_mismatch",
              `tombstone_path must equal ${JSON.stringify(expectedTombstone)}`,
            );
          } else {
            const tombstoneName = path.basename(expectedTombstone);
            const tombstonePath = tombstones.get(tombstoneName);
            if (!tombstonePath) {
              correlationError(
                "transaction.tombstone.missing",
                "pending delete receipt has no matching durable tombstone",
              );
            } else {
              pairedTombstones.add(tombstonePath);
              const actualHash = sha256File(tombstonePath);
              if (actualHash !== receipt.event.before_hash) {
                correlationError(
                  "transaction.tombstone.hash",
                  `tombstone sha256 ${actualHash} does not match before_hash ${receipt.event.before_hash}`,
                );
              }
            }
          }
        }

        if (correlationValid) {
          const paths = [
            receipt.target_path,
            ...(receipt.source_path ? [receipt.source_path] : []),
          ];
          const conflicts = [...new Set(paths)]
            .map((claimedPath) => ({
              claimedPath,
              prior: claimedPaths.get(claimedPath),
            }))
            .filter(({ prior }) => prior);
          if (conflicts.length > 0) {
            for (const { claimedPath, prior } of conflicts) {
              correlationError(
                "transaction.path_conflict",
                `${JSON.stringify(claimedPath)} is also claimed by pending transaction ${prior.transactionId} at ${displayPath(prior.receiptPath)}`,
              );
            }
          } else {
            for (const claimedPath of new Set(paths)) {
              claimedPaths.set(claimedPath, {
                receiptPath,
                transactionId: receipt.transaction_id,
              });
            }
          }
        }

        if (correlationValid) {
          add({
            code: "transaction.pending",
            absolutePath: receiptPath,
            message:
              "valid pending mutation receipt requires recovery or inspection before the integrity gate can pass",
          });
        }
      }

      for (const tombstonePath of tombstones.values()) {
        if (pairedTombstones.has(tombstonePath)) continue;
        add({
          code: "transaction.tombstone.orphan",
          absolutePath: tombstonePath,
          message: "delete tombstone has no valid matching receipt",
        });
      }
    }
  }

  const vaultRealPath = realPathIfPresent(vault);
  for (const rootName of contract.shadow_roots) {
    const shadowPath = path.join(repoRoot, rootName);
    if (!fs.existsSync(shadowPath) || !fs.statSync(shadowPath).isDirectory())
      continue;
    const canonicalPath = path.join(vault, rootName);
    if (realPathIfPresent(shadowPath) === realPathIfPresent(canonicalPath))
      continue;
    add({
      code: "vault.shadow_root",
      absolutePath: shadowPath,
      message: `${rootName}/ exists outside ROBIN_VAULT (${displayPath(vaultRealPath)}); this creates a parallel data root`,
    });
  }

  findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.code.localeCompare(right.code),
  );
  return {
    contractVersion: contract.contract_version,
    pageFormatVersion,
    pageFormatVersions,
    vault: displayPath(vault),
    findings,
  };
}

export function formatTextReport(result, mode = "strict") {
  const lines = [
    `Robin vault integrity — contract v${result.contractVersion}, page v${result.pageFormatVersion} default (accepts ${result.pageFormatVersions.map((version) => `v${version}`).join(", ")})`,
    `Mode: ${mode}${mode === "report" ? " (read-only legacy report; exit status is always zero)" : ""}`,
  ];
  for (const finding of result.findings) {
    const location = `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
    lines.push(
      `[${finding.severity.toUpperCase()}] ${location} [${finding.code}] ${finding.message}`,
    );
  }
  const errors = result.findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warnings = result.findings.filter(
    (finding) => finding.severity === "warning",
  ).length;
  lines.push(`Integrity summary: ${errors} error(s), ${warnings} warning(s).`);
  return lines.join("\n");
}

function usage() {
  return `Usage: vault-integrity.mjs [options]

Options:
  --vault PATH       Vault root (default: ROBIN_VAULT or ./base)
  --repo-root PATH   Repository root used for shadow-root checks (default: cwd)
  --schema-dir PATH  Versioned schema directory (default: robin/schemas/v1)
  --strict           Exit non-zero when findings exist (default)
  --report           Print legacy drift but always exit zero
  --json             Emit a machine-readable JSON report
  --help             Show this help

The validator is read-only in every mode.`;
}

function parseArgs(argv) {
  const options = { mode: "strict", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--report") options.mode = "report";
    else if (argument === "--strict") options.mode = "strict";
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (
      argument === "--vault" ||
      argument === "--repo-root" ||
      argument === "--schema-dir"
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      index += 1;
      if (argument === "--vault") options.vault = value;
      else if (argument === "--repo-root") options.repoRoot = value;
      else options.schemaDir = value;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`vault-integrity: ${error.message}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  try {
    const result = validateVault(options);
    if (options.json) {
      console.log(JSON.stringify({ mode: options.mode, ...result }, null, 2));
    } else {
      console.log(formatTextReport(result, options.mode));
    }
    const hasErrors = result.findings.some(
      (finding) => finding.severity === "error",
    );
    process.exitCode = options.mode === "strict" && hasErrors ? 1 : 0;
  } catch (error) {
    console.error(`vault-integrity: ${error.stack ?? error.message}`);
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}
