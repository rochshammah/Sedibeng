---
name: Vite package firewall
description: A Replit package proxy blocked one Vite patch release while allowing the next compatible patch.
---

The package proxy returned HTTP 403 when installing `vite@7.3.7`. Updating the workspace's Vite range to `^7.3.8` allowed both the Sedibeng frontend and the full workspace installation to complete.

**Why:** A patch-level proxy restriction can look like a broken workspace or an incompatible dependency when it is only that one package tarball.

**How to apply:** If the same Vite tarball is blocked again, check for a compatible patch release before changing major versions or unrelated packages.
