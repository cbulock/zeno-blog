---
title: "Building a Plex Issue Fixer That Actually Closes the Loop"
description: "A reproducible Seerr and Plex reporting workflow that classifies media problems, selects a safe replacement, verifies it, and reports back."
pubDate: 2026-07-27
tags:
  - Plex
  - Seerr
  - Automation
  - Media
  - OpenClaw
stability: "Proven in production"
featured: true
---

Someone reports that an episode ends halfway through. What should happen next?

The usual answer is: an administrator sees the ticket eventually. The better answer is: the report is connected to the exact media item, a safe replacement is requested, the resulting file is verified, and the reporter gets an update when it is ready.

That is the system I wanted to build around Seerr and Plex's native reporting feature. This post walks through the implementation shape so you can recreate it with your own Plex, Seerr, Radarr, Sonarr, and automation runner.

The goal is not to build a bot that deletes files whenever somebody says "broken." The goal is to move a high-confidence report toward a verified outcome while escalating uncertain cases to a person.

## The architecture

There are two entry points, but only one resolution workflow.

```text
Seerr issue webhook ───────────────┐
                                  ├─> normalize event ─> resolver ─> Radarr/Sonarr
Plex native report import ────────┘                              │
                                                                  v
                                                     validate replacement file
                                                                  │
                                                                  v
                                                   comment on and resolve Seerr issue
```

Seerr is the shared support record. It already knows the media request, the reporter, and, for TV issues, the affected season and episode. The webhook path is low-latency: a new issue or comment can start resolution immediately.

Plex's reporting feature is a second, useful entry point. It lets people flag the item while they are actually looking at it in Plex. Plex reports do not arrive as Seerr issues, so I import them into Seerr first and then let the same resolver handle both sources.

The important design choice is that neither intake source gets its own repair logic. The resolver is the one action layer.

## 1. Receive Seerr webhooks, but normalize them first

Configure Seerr to send issue-created and issue-comment events to an authenticated HTTPS endpoint you control. The endpoint should be intentionally narrow: it accepts the webhook, verifies the request using your platform's normal webhook authentication, and passes the payload into a transform instead of handing raw JSON straight to an agent or a mutation script.

The exact Seerr fields vary with event type and version, so I normalize the payload into one small internal object. This also gives me one place to bound untrusted text before it enters logs or prompts.

```js
function normalizeIssueEvent(payload) {
  const issue = payload.issue ?? {};
  const media = payload.media ?? {};
  const comment = payload.comment ?? {};

  return {
    notificationType: payload.notification_type ?? 'UNKNOWN',
    issueId: String(payload.issue_id ?? issue.id ?? ''),
    subject: payload.subject ?? media.title ?? 'Unknown media item',
    mediaType: payload.media_type ?? media.media_type ?? media.type ?? '',
    requestId: String(payload.request_id ?? payload.request?.id ?? ''),
    commentMessage: redactAndLimit(payload.comment_message ?? comment.message ?? ''),
    receivedAt: new Date().toISOString(),
  };
}
```

In my OpenClaw setup, the hook mapping names a path, an agent, a stable session key, and a transform module:

```json
{
  "id": "seerr-issues",
  "match": { "path": "seerr" },
  "agentId": "media-support",
  "sessionKey": "agent:media-support:hook:issues",
  "transform": { "module": "seerr-issue.mjs" }
}
```

The transform has three jobs:

1. Normalize inconsistent webhook shapes.
2. Persist a compact event record for debugging and deduplication.
3. Invoke one resolver command with typed arguments such as issue ID, notification type, and comment text.

That last detail is worth keeping. Do not ask an agent to read an untrusted webhook and improvise API calls. The webhook text is input, not instructions. Put mutations behind a narrow resolver with an explicit contract.

Also add a loop guard. Seerr emits comment events, and the resolver comments on Seerr. Mark automation comments with stable prefixes or metadata, then ignore those on the next webhook delivery. Without that guard, the system can react to its own updates forever.

## 2. Pull Plex's native reports into Seerr

Plex's native reports carry a message, the reporting user, and a URL pointing at the affected library item. The useful part is that item URL. It gives you a reliable route from a human complaint to Plex metadata.

The importer runs on a schedule rather than waiting for a webhook. It queries Plex's community GraphQL API for reports, keeps only unseen report IDs, and resolves each report URL:

```text
server://<server-guid>/com.plexapp.plugins.library/library/metadata/<rating-key>
```

From there, the importer:

1. Finds the Plex server by its server GUID.
2. Fetches the movie, show, season, or episode metadata by rating key.
3. Extracts external IDs from Plex GUIDs, especially TMDB and TVDB IDs.
4. Maps the Plex reporter's username to their Seerr user.
5. Finds the matching Seerr media entry.
6. Creates a Seerr issue as that user, preserving the report text and TV episode context.

The core target-resolution code is not complicated:

```python
def resolve_report_target(report):
    server_guid, metadata_id = parse_plex_report_url(report["url"])
    item = plex_fetch_metadata(server_guid, metadata_id)
    ids = parse_plex_guids(item)

    if item.type == "movie":
        return {"media_type": "movie", "tmdb_id": ids.get("tmdb")}

    if item.type == "episode":
        show = plex_fetch_metadata(server_guid, item.grandparent_rating_key)
        return {
            "media_type": "tv",
            "tmdb_id": parse_plex_guids(show).get("tmdb"),
            "tvdb_id": parse_plex_guids(show).get("tvdb"),
            "problem_season": item.parent_index,
            "problem_episode": item.index,
        }
```

Your actual Plex client code will use XML attributes rather than dot access; the point is the join strategy. Do not match by title if you can avoid it. Titles are ambiguous, localized, and occasionally wrong. Plex's metadata IDs plus TMDB/TVDB IDs make the bridge dependable.

Plex does not expose a verified delete or dismiss operation for these native reports in the API surface I used. Instead of trying to mutate Plex state, I keep a small durable import state file:

```json
{
  "reports": {
    "report-123": {
      "status": "imported",
      "issue_id": 456,
      "seen_at": "2026-07-27T12:00:00Z"
    }
  }
}
```

That does two things: repeated scheduled runs stay idempotent, and an import failure can be retried without creating duplicate Seerr issues. Before creating a new issue, also check whether the same Seerr user already has an open issue for that media and episode target.

## 3. Classify reports before touching media

Not every report deserves an automated repair. I use a small set of classes:

- `wrong_length`: truncated or incomplete media
- `quality`: visibly bad quality, hardcoded subtitles, or an early bad release
- `wrong_content`: the file plays the wrong movie or episode
- `unplayable_media`: the file fails before playback begins
- `sync_issue`: persistent audio/video drift
- `client_issue` and `unclear`: do not auto-repair

Rules handle the direct cases first. For example, "cuts off early" is a strong wrong-length signal, and "this is the wrong movie" is a strong wrong-content signal. If no rule is confident, an LLM may classify the report, but it must return structured output:

```json
{
  "classification": "wrong_length",
  "confidence": 0.98,
  "safe_to_auto_act": true,
  "reason": "The report explicitly says the media cuts off early."
}
```

The resolver proceeds only if the class is actionable, `safe_to_auto_act` is true, and confidence exceeds the threshold. Otherwise it leaves the issue open and escalates it with the context needed for a person to investigate.

That gate is the difference between useful automation and a file-deletion machine.

## 4. Select a different release, then request the repair

For a high-confidence issue, use Seerr's media IDs to find the matching Radarr movie or Sonarr series and episode. For television, require an exact season and episode set. If a report is only "season five is bad," ask for clarification or send it to a human instead of replacing an entire season by guesswork.

Before deleting the current file, read Arr history and collect stable identifiers for previously grabbed releases. Then query manual search and select a release that is both:

- distinct from the known bad release; and
- allowed by your quality policy.

Only after finding an eligible alternative should the resolver delete the existing file and submit the selected release. If there is no eligible replacement, keep the existing file and escalate. This ordering avoids the worst failure mode: deleting a watchable copy only to discover that the only available alternative is the same bad release or something worse.

Radarr and Sonarr remain the media managers. The resolver does not recreate their quality profiles or download logic; it supplies a safe decision about *which* different release to grab.

## 5. Verify the replacement before resolving the issue

A completed download is not proof that the problem is fixed.

After a repair request, the resolver schedules rechecks at increasing intervals: 30 minutes, then one hour, then one day. When a replacement appears, it verifies the file rather than trusting its name or Arr's `hasFile` flag:

```bash
ffmpeg -v error -nostdin -xerror -err_detect explode \
  -i "$MEDIA_PATH" -map '0:v?' -map '0:a?' -f null -
```

That performs a full decode of the playback-bearing streams. Then `ffprobe` reads the duration, and `ffmpeg` seeks and decodes a short window at 25%, 50%, and 75% of the file. The seek probes catch a useful class of bad replacement: a file that starts normally but fails partway through.

Only after the validation succeeds does the resolver post its final Seerr comment and mark the issue resolved. If validation fails, it can try another untried release. If the final recheck still cannot verify a good replacement, it escalates instead of retrying forever.

## The practical checklist

To recreate this setup, you need:

- Plex, Seerr, Radarr, and Sonarr with service credentials stored outside source control
- an authenticated HTTPS webhook endpoint for Seerr issue events
- a transform that normalizes and bounds webhook input
- one idempotent resolver script as the only mutation layer
- a scheduled Plex-report importer with durable deduplication state
- a user mapping from Plex usernames to Seerr users
- external-ID matching through TMDB/TVDB rather than titles
- an explicit classification and safety gate
- history-aware manual release selection
- post-download media validation and bounded rechecks
- issue comments that say what happened without overstating what was proved

The result is not merely a ticketing integration. A report from Seerr or Plex can become a verified outcome:

```text
report -> identify media -> classify safely -> choose a different release
       -> repair through Arr -> validate file -> update and resolve the issue
```

That is the feature. The report is only the beginning; the system earns its keep by carrying it all the way to done.
