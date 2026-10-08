---
title: Run an agent with no code
description: One command installs the safety shell into Claude Code, Codex or OpenClaw. Paper trading by default; no keys of any kind.
---

# Run an agent with no code

The safety shell sits between your AI agent and the market. The agent gets a few buttons, every button that trades has a lock, and every trade leaves a signed record. Version 0 is paper trading only: there is no code path to real trading at all.

## What you need

- A Mac or Linux computer (Windows comes later).
- Claude Code, Codex or OpenClaw.
- Node 20 or newer.

No exchange account. No keys of any kind.

## Install with one command

```sh
npx -y {{npm}} init
```

It does four things:

1. Registers the safety shell with the agent apps you have, using each app's own command.
2. Installs a no-code template that teaches the agent a routine: look at the market, decide, write down why, trade inside the locks, write a journal line.
3. Writes a default config: paper trading with 10,000 USDT of simulated money.
4. Creates a signing key on your computer for the ledger. It never leaves your computer.

Add `--dry-run` to see what it would change first.

To use the `{{cli}}` command in a terminal, install it once:

```sh
npm i -g {{npm}}
```

Or write `npx -y {{npm}}` wherever you see `{{cli}}` below.

## What to tell your agent

Restart your agent app, then say:

> Use {{mcp}} to look at BTC and paper-buy 100 USDT.

The agent checks the market and its account, places a market order and writes down why. Orders fill at the open of the next 1-minute candle with a 0.1% fee. Prices come from Binance spot public market data, or OKX if Binance can't be reached.

## The locks

| Lock | Default | When it's hit |
|---|---|---|
| Symbols | BTC, ETH, SOL, BNB, XRP and DOGE against USDT, spot only | Anything else is refused |
| One order | At least 10 USDT, at most 10% of equity | Refused |
| One coin | At most 30% of equity | Sells only for that coin |
| One day | Down 5% since 00:00 UTC | Sells only for the rest of the day |
| Total loss | Equity falls to 70% of the starting money (a 30% loss) | Automatic halt |
| Pace | 12 orders an hour, 60 a day | Refused |
| Loops | 30 refused orders within an hour | Automatic halt |

There are no buttons for withdrawals, transfers, leverage or futures, and the agent cannot change the locks.

## Kill switch

```sh
{{cli}} halt
```

Cancels orders that haven't filled and refuses everything after. Add `--flatten` to sell every position for USDT at market.

The agent can press the kill switch itself if something looks wrong, but only a person can lift it:

```sh
{{cli}} resume
```

It asks you to type yes in the terminal.

## Read the ledger

```sh
{{cli}} status
{{cli}} replay
{{cli}} verify
```

`status` shows the account. `replay` walks through the day's trades in order, with the agent's reasons. `verify` checks that nothing was changed: each line carries a fingerprint of the line before it and a signature, so editing or deleting a line breaks the chain.

## What it protects against, and what it doesn't

It protects against an agent making mistakes: fat fingers, order loops, chasing a move with ever bigger orders, doubling down after losses, buying coins that aren't on the list.

It can't stop an agent that sets out to get around it. On the same computer the agent has your permissions and can always find a way. That's why version 0 only does paper trading. Real money would need three things together: limits on the exchange side (a sub-account with a small balance, an API key that can trade but not withdraw, locked to one IP address), keys kept off the computer the agent runs on, and the safety shell.

## Uninstall

```sh
npx -y {{npm}} uninstall
```

Removes it from your agent apps. Your ledger stays on your computer.

## Practising on an exchange testnet

The next version of the safety shell adds Binance's spot testnet and OKX's demo trading. Only then do you need an exchange account.

[Step 0: open an account](/en/account/)
