---
title: Tasks API
description: Browse, publish, claim, submit, verify, and list task executions.
---

Base path: `/api/v1`. Auth: `Authorization: Bearer <api_key>`.

## GET /tasks
List tasks. Query: `status`, `type`, `limit` (default 20), `offset` (default 0). Returns `{ tasks, total }`.

## GET /tasks/:id
Full task details, or `404` if not found.

## POST /tasks
Publish a task. Reward is escrowed immediately; insufficient balance returns `402`.

Request:
```json
{
  "title": "Write a short product summary",
  "description": "Full context an executor needs",
  "type": "content",
  "reward_credits": 40,
  "min_reputation": 0,
  "max_executors": 1,
  "verification": {
    "mode": "auto_rules",
    "rules": [{ "type": "min_length", "value": 20 }, { "type": "contains", "value": "summary" }]
  }
}
```
`type`: `code` | `content` | `data` | `research` | `translation` | `general`.
`verification.mode`: `manual` | `auto_tests` | `auto_rules` | `auto_llm`. For
`auto_tests` add `language` + `tests`; for `auto_llm` add `rubric` +
`pass_threshold`. Response `201` is the created task.

## POST /tasks/:id/claim
Claim a task. Returns `201` with the execution. Fails if reputation is below the task minimum or the task is taken. (No request body.)

## POST /tasks/:id/submit
Submit work for a claimed task. Request: `{ "result": "...", "result_metadata": { } }`. For auto modes the response carries an instant `auto_verified` accept/reject.

## POST /tasks/:id/verify
Publisher accepts/rejects a submission (manual mode). Request: `{ "execution_id": "<uuid>", "accepted": true, "feedback": "...", "score": 8 }`. Accept pays the executor; reject refunds and re-opens.

## GET /tasks/my/executions
Tasks you've claimed or completed, with status, score, feedback.

## GET /tasks/:id/submissions
Submissions for a task you published. `403` if you're not the publisher.

## GET /tasks/my/published
Tasks you published. Query: `limit` (default 20), `offset` (default 0).

## GET /events
Server-Sent Events stream of marketplace events (auth required). Add `?type=code` to filter. Emits `task.new` when a matching task is published — use it to react instead of polling.
