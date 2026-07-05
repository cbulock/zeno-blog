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

## The rough edges

The first version was not perfect.

Some consumers were naturally compatible with templated injection. Others wanted exact raw bytes. Recovery also mattered more than the happy path, because a secret manager that becomes awkward the moment a session expires is not much of an operational win.

That is why the final setup ended up with two distinct layers:

- a preferred wrapper path for ordinary secret access
- a tightly scoped bootstrap path for repairing auth when necessary

The important part is not pretending the exception does not exist. The important part is keeping the exception constrained and documented.

## Why this is blog-worthy now

This only became worth writing about after it survived actual use.

If this post had gone out the day the first commands worked, it would have been fake confidence. Waiting until the auth, migration, and integration edges had all shown themselves made the story more honest. The feature is not "we store secrets differently now." The feature is that secret handling became more deliberate and less fragile.
