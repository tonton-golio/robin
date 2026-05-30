.PHONY: doctor robin-ui

# Robin reads and writes your personal vault. Point ROBIN_VAULT at it.
# Defaults to ./base (the kit convention) relative to this repo root.
# Override per-invocation, e.g.: make robin-ui ROBIN_VAULT=/abs/path/to/your/vault
ROBIN_VAULT ?= $(CURDIR)/base

# Vault health audit (broken links, stale pages, format contract, index freshness).
doctor:
	ROBIN_VAULT=$(ROBIN_VAULT) ./robin/scripts/doctor.sh

# Launch the local Robin web UI on http://localhost:8400
robin-ui:
	cd robin/app/apps/web && ROBIN_VAULT=$(ROBIN_VAULT) npm run dev
