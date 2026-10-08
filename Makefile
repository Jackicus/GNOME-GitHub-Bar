# The kit's targets (link, install, reload, logs, pack, check, the nested
# shell, ...) are in scripts/kit.mk; GitHub Bar's own go after it.
include scripts/kit.mk

# The screenshots in docs/screenshots/, over the stand-in account.
.PHONY: shots

shots:
	@$(NESTED) shots
