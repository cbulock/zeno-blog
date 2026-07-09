---
title: "I Built a Petty Bureaucrat for My Data Broker Cleanup"
description: "How I modeled data broker removal as a stateful workflow with case tracking, inbox processing, anti-bot experiments, scheduled rechecks, and hard approval boundaries."
pubDate: 2026-07-09
tags:
  - Privacy
  - Agents
  - Automation
  - OpenClaw
stability: "Observed in production"
featured: true
---

Data broker removal is the kind of problem that looks simple until you try to do it consistently.

You find a site with your information on it. You look for the opt-out page. You submit a request. Maybe it wants email confirmation. Maybe it wants a checkbox with suspiciously specific legal wording. Maybe it wants you to verify by phone. Maybe it quietly does nothing and makes you come back later to see whether the listing is still there.

None of this is hard in an interesting way. It is hard in an administrative way.

That is why I thought it was a good use case for an agent, but only if the agent was constrained properly. I was not interested in fully autonomous privacy cleanup. I do not want a model improvising legal assertions, uploading personal documents, or spraying extra identifying information into random forms because it thinks that is the next logical step.

What I wanted was something narrower and, honestly, more useful: an agent that handles the clerical parts of the workflow without being trusted to make the sensitive decisions.

## Model the work as state

The key change was to stop treating data broker removal like a pile of notes and start treating it like a system with explicit state.

I split the workflow into two layers.

The first layer is a broker catalog. That is one record per broker: who they are, where their official opt-out path lives, what kind of process they use, what their current blocker looks like, and any general notes about the removal flow.

The second layer is a case tracker. That is one record per actual removal attempt: which broker it is tied to, what listing or profile is in scope, how confident I am that it is the right match, what state the case is currently in, what action is required next, whether a human approval is needed, when it was last checked, and when it should be checked again.

That split matters more than it sounds like it should. A broker can have one general removal process but many individual cases over time. If you collapse those together, the system gets messy fast. If you keep them separate, the agent has something clean to reason about.

## Use better statuses than open and closed

The next important design choice was the state model.

A lot of people build tracking workflows with vague statuses like open, pending, and done. That is not enough here. I needed the system to distinguish between the request being submitted, the broker asking for a confirmation step, the public listing actually being verified as gone, the process being blocked on an anti-bot challenge, the next step needing human approval, and there being no reasonable path forward at all.

Those distinctions are the difference between useful automation and confused automation. If everything just becomes blocked, the agent cannot help much. If a case is specifically blocked because of CAPTCHA, that points to a technical problem. If it is blocked because the next step requires an identity document or a legal attestation, that points to a human decision. Those are completely different classes of work.

## Treat email as part of the workflow

I also learned pretty quickly that inbox processing is not a side feature. It is part of the core system.

A lot of broker removals do not end at form submission. They continue in email. The real next step might be a confirmation link, a processing notice, a ticket number, or a request for more information. So I built the workflow to include a mailbox pass over a constrained inbox scope. The agent looks for broker-related replies, extracts the relevant facts, marks reviewed items, and updates case state only when the evidence is clear.

That turns out to be a big deal, because without it, the workflow breaks across channels. You submit a request in one place, get a response somewhere else, and then forget to connect the two. The agent is useful partly because it is willing to do that boring connective tissue work every time.

## The ugly technical layer

The workflow layer was only half the project.

The other half was the browser and anti-bot experimentation layer that tried to make some of these broker flows automatable in the first place. That is where things got much messier and much more interesting.

Some brokers were straightforward enough that the main challenge was keeping state straight. Others sat behind a stack of anti-bot checks that made even reaching the real form annoying. In those cases, the job stopped being "submit the opt-out" and turned into "figure out what the live flow actually is."

That is where tools like FlareSolverr and CapSolver came in.

FlareSolverr was useful mostly as a session bootstrapper, not as a magic bypass. In some cases it was enough to get through Cloudflare or at least load the actual app shell so I could inspect the live removal flow, required fields, hidden inputs, and API endpoints. That was valuable because many of these broker pages look simple until you realize the visible page is just a wrapper around a more stateful client-side process.

CapSolver was even more mixed. Sometimes it was good enough to produce valid-looking tokens for challenges like Turnstile or reCAPTCHA Enterprise and let me get one step deeper into a flow. But getting a token was not the same thing as getting a trustworthy submission path. Several brokers still rejected the final request even when the challenge token looked right, which strongly suggests the anti-bot decision depended on more than the token itself: session continuity, user-agent consistency, cookies, timing, proxy reputation, or browser fingerprinting.

That turned out to be one of the most useful technical lessons in the project. CAPTCHA solving is not "the hard part solved." It is one input into a much larger anti-automation decision.

## Preserve partial progress

That is also why I needed a real `technical_blocked` state instead of a generic failure bucket.

If the system learns that a broker's public page is reachable but the final form submission still returns a CAPTCHA error, that is not the same as learning nothing. If it learns that Turnstile gets you through search but the final verification step switches to hCaptcha, that is not the same as a dead end. If it can discover the real first-step API endpoint but the broker refuses to send the confirmation voucher, that is still operationally useful knowledge.

In other words, partial technical progress is still state.

Knowing that a flow is reachable, that a particular challenge type is in play, that the required fields are known, or that a submission fails only at the last step is exactly the kind of thing a workflow system should remember. That information tells you whether a case needs a better browser strategy, a human approval step, a different automation path, or should simply stay marked as technically blocked for now.

## Add a recheck loop

Then there is the recheck loop.

One of the more annoying parts of this whole space is that request submitted does not mean problem solved. So each case gets a due date for the next public recheck. The system revisits anything that is due and asks a simple question: is the listing still up, clearly gone, back again, or stuck behind some new obstacle?

That lets the workflow track actual outcomes instead of treating submission as success. It also makes it possible to catch reappearances, which is another way these tasks quietly rot if you are not paying attention.

## Make the approval boundary part of the architecture

The most important part, though, is the approval boundary.

I let the agent do the clerical work. It can keep the tracker current, move cases between well-defined statuses, process routine confirmations, maintain due dates, and surface what needs attention next.

I do not let it silently cross into sensitive territory. If the next step involves identity documents, phone or SMS verification, payment, account creation, legal assertions, eligibility claims, or providing more personal data than the workflow already has, it stops and asks.

That boundary is not there to make me feel responsible. It is the actual architecture. Without it, the system becomes a demo. With it, the system becomes something I might actually trust.

## Separate working data from reporting data

The last thing I did was separate the working data from the reporting layer.

The tracker needs detail to be useful. A public progress view absolutely should not contain all of that detail. So the dashboard only exposes sanitized, aggregate state: how many brokers are in the catalog, how many cases exist, how many are submitted, how many are confirmed removed, how many are stuck on technical blockers, and how many still need human input.

The detailed records stay private. The public layer is deliberately less informative than the internal one, because that is the correct trade.

## What the agent is actually good at

That architecture is not flashy. It is basically a state machine, an inbox processor, a scheduler, a browser experimentation layer, and a set of hard approval gates.

But that is also why it works.

The useful part of an agent here is not that it can click through forms. The useful part is that it can be a patient little bureaucrat that is also willing to do technical reconnaissance. It keeps records straight. It notices when something needs follow-up. It does not get bored of rechecking statuses. It does not forget which cases are waiting on confirmation and which ones are waiting on me. And when a broker flow gets weird, it can preserve the exact shape of the weirdness instead of collapsing everything into "didn't work."

That is a much less glamorous vision of AI than the usual autonomous-assistant pitch.

It is also a lot closer to the kind of thing I actually want.
