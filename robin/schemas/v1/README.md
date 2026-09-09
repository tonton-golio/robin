# Robin executable vault contract v1

This directory is the machine-readable source for vault integrity checks.

- `contract.json` declares the canonical page roots, allowed non-HTML brain
  substrate, JSONL ledger locations, transaction-receipt location, and shadow
  root names.
- `page-metadata.schema.json` describes metadata extracted from Robin v0.2 and
  v0.3 HTML. v0.2 remains the default during staged rollout. v0.3 requires an
  immutable UUID `robin:id`; optional repeated `robin:source-kind` and
  `robin:source-ref` tags must be present as non-empty, ordered pairs.
- `memory-event.schema.json`, `annotation-event.schema.json`, and
  `edit-event.schema.json` describe the append-only ledgers.
- `transaction-receipt.schema.json` describes crash-recovery receipts under
  `.robin/transactions/`.
- `capture-manifest.schema.json` and `capture-manifest.template.json` define the
  future capture identity, provenance, retention, and lifecycle envelope.

`robin/scripts/vault-integrity.mjs` consumes these files directly. Change the
contract here first, then update producers and migrations deliberately. A
contract-directory version is independent of the Robin HTML format version:
contract v1 currently accepts Robin page formats v0.2 and v0.3 while declaring
v0.2 as the producer default.

Capture manifests are schema-only in v1: the validator does not expect or
generate them for existing inbox files. The template is a copyable shape for
new capture tooling; replace every example identity, hash, reference, and
timestamp before use.

The validator is read-only. Use `--report` while assessing legacy drift; it
prints every finding but exits successfully. Strict mode is the doctor gate.

```bash
# Safe inventory of an established vault
node robin/scripts/vault-integrity.mjs --vault "$ROBIN_VAULT" --report

# Enforce the contract
node robin/scripts/vault-integrity.mjs --vault "$ROBIN_VAULT" --strict

# Run the same inventory together with all other doctor checks
./robin/scripts/doctor.sh --report
```
