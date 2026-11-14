# The common targets (link, install, reload, logs, pack, check, the nested
# shell, ...) are in scripts/common.mk; GitHub Bar's own go after it.
include scripts/common.mk

# The screenshots in docs/screenshots/, over the stand-in account.
.PHONY: shots

shots:
	@$(NESTED) shots
