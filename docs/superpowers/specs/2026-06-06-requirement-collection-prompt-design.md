# Requirement-Collection Prompt Fix Design

**Date:** 2026-06-06
**Status:** Approved

## Problem

The sales bot collects a service's requirements by asking the customer one
question at a time. The customer never sees how many answers are coming, so the
drip feels like an interrogation and annoys them. Two prompt rules cause this:

1. **SERVICE DEEP-DIVE** instructs the agent to collect the
   `requirementsFromCustomer` items "ONE at a time… ask the next."
2. **Tone & style** reinforces "Prefer asking one question at a time."

A second, related defect: the **Formatting & lists** rules overload numbered
lists with two meanings at once — "every list is numbered" AND "reply with the
number to pick one." When the agent numbers a list of *questions* (an info
list), the customer is implicitly invited to "reply with a number," which makes
no sense and confuses the exchange.

`requirementsFromCustomer` is a free-text blob that already contains a numbered
list of what the customer must supply (e.g. post link, campaign objective). So
the data supports showing the whole list at once.

## Goal

Change the bot's behavior so that:

- It shows the **full** requirements list up front (the customer sees the total
  scope), accepts whatever they provide, then asks only for the **still-missing**
  items in one short follow-up — no one-by-one drip.
- Numbered lists carry **one** unambiguous meaning per kind: selection menus are
  pick-by-number; info lists (requirements, steps) are numbered only for
  readability and are never pick-by-number.

Prompt-only change. No code, no schema, no tests altered. Behavior is
LLM-driven and verified live by the user.

## Scope

Edit the `SYSTEM_PROMPT` constant in
`src/app/workflows/telegram-hi.workflow.ts`. Four edits:

### Edit 1 — SERVICE DEEP-DIVE requirement collection (current line 66)

Replace the "ONE at a time" bullet with:

> Then collect the requirements from the `requirementsFromCustomer` field. Lay
> out the full list up front so the customer sees exactly what's needed —
> present it as a numbered list for readability (this is an info list, NOT a
> pick-one menu, so do not tell them to reply with a number). Invite them to
> send what they can. After they reply, acknowledge what you received and ask
> ONLY for the items still missing, together in one short follow-up. Never
> re-ask for something they already gave, and never drip the questions one by
> one.

### Edit 2 — Tone & style (current line 86)

Replace "Prefer asking one question at a time. It keeps the chat flowing
naturally." with:

> When you need several pieces of information, lay out what's needed up front so
> the customer can see the full scope, then follow up only on what's still
> missing. Don't drip questions one at a time — it leaves the customer guessing
> how many more are coming. A single quick clarifying question is fine; a long
> interrogation is not.

### Edit 3 — Formatting & lists: split selection vs info lists (current lines 45–46)

Adjust the two bullets so list meaning is unambiguous:

- Keep "every list with two or more items is numbered for readability."
- Add the distinction: lists are one of two kinds —
  1. **selection menus** — options the customer chooses from (services,
     packages, payment methods);
  2. **info lists** — things you tell them or ask them to provide (requirements,
     steps).
  Both are numbered, but **only selection menus are pick-by-number.**
- Scope the "reply with the number" invitation: say "reply with the number to
  choose" **only** right after a selection menu, never after an info list.
- Scope the bare-number handling: when the customer replies with a number, match
  it to your most recent **selection menu** (not an info list); if there's no
  recent menu, ask which option they mean.

### Edit 4 — DISCOVERY qualifying questions (current line 53)

Adjust so the 2-3 qualifying questions are asked **together in one short
message**, not in sequence — consistent with the no-drip principle. Keep them
short and light.

## Out of scope

- No change to `requirementsFromCustomer` data shape or any tool.
- No structured/array representation of requirements (the free-text blob stays).
- No automated test of prompt behavior — verified live.

## Verification

The user sends test messages to the Telegram bot and confirms:
1. On a service deep-dive, the bot lists all requirements at once.
2. Follow-ups ask only for missing items, never re-asking provided ones.
3. Selection menus still say "reply with the number"; requirement lists do not.
4. A bare-number reply is matched to the last selection menu.
