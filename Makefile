.PHONY: doctor robin-ui

# Robin reads and writes your personal vault. Point ROBIN_VAULT at it.
# Defaults to ./base (the kit convention) relative to this repo.
ROBIN_VAULT ?= $(CURDIR)/base

# Vault health audit (broken links, stale pages, format contract, index freshness).
doctor:
	ROBIN_VAULT=$(ROBIN_VAULT) ./scripts/doctor.sh

# Launch the local Robin web UI on http://localhost:8400
robin-ui:
	cd app/apps/web && ROBIN_VAULT=$(ROBIN_VAULT) npm run dev
