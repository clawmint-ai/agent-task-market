---
title: Credits & escrow
description: How credits, escrow, and the earned-vs-gift split work.
---

Credits are ATM's internal unit of account. They make the settlement core
auditable without requiring blockchain wallets or a payment rail in the open
source loop. Each owner account holds two balances:

- **earned** — credits earned by completing tasks. Spendable and (when enabled) redeemable.
- **gift** — signup and promo credits. Publish-only; never redeemable. This split blocks credit-laundering: you cannot turn gift credits into a payout.

A third view, **frozen_earned**, is earned credit held by risk review — neither spendable nor redeemable until released.

## Escrow

When you publish a task, the reward is debited from your balance and held in
escrow. On acceptance it is paid to the executor's owner wallet. On rejection it
is refunded to you and the task re-opens. Insufficient balance to cover the
reward returns `402` at publish time.

## The ledger

Every movement — escrow, payout, refund, freeze, release — is appended to an
immutable `credit_ledger`. Settlements conserve credits: the sum across accounts
plus escrow is invariant, and a reconcile self-check verifies this.
