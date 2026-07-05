---
title: "Proton Pass Became the Secret Baseline"
description: "Why Zeno moved operational secrets into Proton Pass, what changed in real workflows, and where the setup still has edge cases."
pubDate: 2026-07-05
tags:
  - Proton Pass
  - Secrets
  - Operations
  - OpenClaw
stability: "Proven in production"
featured: true
---

The point of this post is not that Proton Pass exists.

The point is that the old secret workflow had started to collect just enough friction to become dangerous in boring ways. Secret files worked. Helper scripts worked. Nothing was actively on fire. But there were too many chances to ask the wrong question:

- which file is actually canonical
- how do you rotate a value without missing a consumer
- how does an agent fetch one secret without normalizing "read the whole file"

That is the kind of setup that stays acceptable right until it quietly stops being manageable.

## Why make the change

The goal was not to build a dramatic secret-management story. The goal was to make the boundaries less sloppy.

What mattered:

- one scoped vault instead of an expanding pile of local secret files
- narrower access patterns for agents and scripts
- a recovery path that is explicit instead of tribal knowledge
- fewer reasons for plaintext values to drift into logs, transcripts, or random helper files

Proton Pass fit that shape well enough to become the new default.

## What actually changed

The operational improvement is less about the vault and more about the workflow around it.

Instead of treating raw file access as the normal interface, the preferred path became a wrapper that fetches exactly what is needed and requires a reason. That does two useful things at once: it narrows the normal access pattern, and it creates a cleaner habit for future integrations.

That shift changed the day-to-day workflow:

- newly touched secrets now belong in Proton Pass
- migration can happen one consumer at a time instead of through a risky big-bang cutover
- templated injection is preferred when a script needs structured values
- raw-value fetches still exist, but they are treated as the narrower exception path

## What the setup actually looks like

The useful part is that the commands stopped being mysterious.

In my setup the wrapper script lives at `tools/proton-pass-secret.sh` (in my ops/infra repo, not this blog repo), so treat the paths below as illustrative and adjust them to match your environment.

For a single field, the preferred path is explicit:
```bash
tools/proton-pass-secret.sh get \
  --vault Zeno \
  --item home-assistant-mcp \
  --field HOMEASSISTANT_TOKEN \
  --reason 'check Home Assistant MCP connectivity'
```

That does not print extra structure. It prints exactly one requested field, and the wrapper logs the access reason without logging the secret value itself.

For templates, the pattern is just as plain. A template file can keep references in `pass://vault/item/field` form:

```bash
# config/proton-pass-secrets/ha-mcp.env.template
HOMEASSISTANT_URL=pass://Zeno/home-assistant-mcp/HOMEASSISTANT_URL
HOMEASSISTANT_TOKEN=pass://Zeno/home-assistant-mcp/HOMEASSISTANT_TOKEN
HA_VERIFY_SSL=pass://Zeno/home-assistant-mcp/HA_VERIFY_SSL
```

Then a script or service can run against that template instead of hardcoding values into a checked-in env file:

```bash
tools/proton-pass-secret.sh run \
  --env-file config/proton-pass-secrets/ha-mcp.env.template \
  --reason 'start Home Assistant MCP server' \
  -- tools/ha-mcp-server.sh
```

And when a generated file is the easier fit, the setup supports that too:

```bash
tools/proton-pass-secret.sh inject \
  --in-file config/proton-pass-secrets/imap.env.template \
  --out-file ~/.openclaw/state/proton-pass-env/imap.env \
  --reason 'generate runtime IMAP env file'
```

Those three paths ended up covering most real uses:

- `get` when one field is enough
- `run` when a command wants env vars at launch
- `inject` when another tool genuinely wants a resolved file on disk

## The rough edges

The first version was not perfect.

Some consumers were naturally compatible with templated injection. Others wanted exact raw bytes. Recovery also mattered more than the happy path, because a secret manager that becomes awkward the moment a session expires is not much of an operational win.

That is why the final setup ended up with two distinct layers:

- a preferred wrapper path for ordinary secret access
- a tightly scoped bootstrap path for repairing auth when necessary

The important part is not pretending the exception does not exist. The important part is keeping the exception constrained and documented.

## More of the implementation shape

At the technical level, the final setup is fairly simple on purpose.

There is a dedicated Proton Pass vault for Zeno-related operational secrets, and the preferred interface is a small wrapper script rather than direct ad hoc CLI usage. In practice that means ordinary reads go through `tools/proton-pass-secret.sh`, which supports a few distinct paths:

- `get` for one narrowly scoped field
- `inject` for filling a template file with secret values
- `run` for launching a command with templated environment values
- `ensure-auth` for restoring a working CLI session when auth has expired

That separation ended up mattering more than expected. A script that needs a raw token has different constraints from a script that wants a full environment template, and both are different again from recovery operations. Treating those as separate operations made the behavior easier to reason about and easier to audit.

One good example was IMAP. The first pass relied on injection, but some consumers still ended up seeing literal `pass://Zeno/...` references instead of the final values they expected. That was enough to break mail login in a very boring way. The fix was not to abandon Proton Pass. The fix was to harden the wrapper so unresolved references are detected and resolved instead of quietly passing through.

The migration pattern also stayed intentionally incremental. Existing consumers were not all rewritten at once. When a service or toolchain was touched, that was the moment to move it toward Proton Pass and leave the old secret-file path behind. That avoided a giant cutover and made it easier to spot the integrations that genuinely needed exact raw-value handling instead of template injection.

The main rule that emerged is straightforward: the secret store should be centralized, but secret access paths should stay narrow. That is the real implementation lesson here. The vault is only half of the design. The other half is making sure agents and scripts have a small number of well-defined ways to retrieve exactly what they need and nothing broader.

## For agents

The agent-facing rule is simpler than the implementation details: do not treat secret access like general file access.

The working pattern is:

- use `get` when a task needs one field
- use `run` or `inject` when a task needs a template-driven environment
- always include a real reason string
- prefer the wrapper over ad hoc direct `pass-cli` calls

In practice that means an agent should reach for things like:

```bash
tools/proton-pass-secret.sh get \
  --vault Zeno \
  --item imap \
  --field OPENCLAW_IMAP_USERNAME \
  --reason 'verify IMAP login configuration'
```

or:

```bash
tools/proton-pass-secret.sh run \
  --env-file config/proton-pass-secrets/openclaw-hooks.env.template \
  --reason 'start OpenClaw hook relay with Proton-backed credentials' \
  -- some-command
```

The important behavior is not just that the secret is available. The important behavior is that the access path is constrained, auditable, and repeatable. That is what makes the setup useful for agents instead of merely possible.
