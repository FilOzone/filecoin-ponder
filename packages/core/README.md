# @filoz/ponder

[![NPM](https://nodei.co/npm/@filoz/ponder.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/@filoz/ponder/)

A Filecoin-compatible fork of [`ponder`](https://www.npmjs.com/package/ponder). Versions track upstream; the only delta is a small set of patches to make Ponder usable against Filecoin's EVM (FVM).

> **This is a fork.** If you're indexing on Ethereum, Base, Arbitrum, or any other standard EVM chain, this fork will work but [upstream `ponder`](https://www.npmjs.com/package/ponder) would be the better choice. This fork exists only to unblock Filecoin (chains 314 and 314159).

## What's different

Patches on top of an upstream release:

1. **Null round handling.** Filecoin epochs that produce no block return RPC error code 12. Upstream Ponder treats this as a hard error; the fork detects null rounds and skips them. Where upstream assumes every height holds a block, the fork matches realtime reorgs by block hash and steps down past null rounds when it searches for the finalized block.
2. **Reorg window.** Filecoin chains (314 mainnet, 314159 calibnet) default to a 600-second `reorgWindow`, 20 epochs and upstream's maximum, in place of upstream's 180 seconds.
3. **Start block lookback fallback.** Lotus gateway endpoints have limited history depth, which breaks the start-block fetch on restart. On Filecoin chains the fork synthesizes a placeholder block when the gateway can't serve it.
4. **`eth_getLogs` ranges from Lotus errors.** Requests are chunked to the range limit Lotus states in its error.
5. **RPC timeout.** 20 seconds, not 10, for blocks with unusually large event payloads.

For the full diff and rationale, see [the fork repository](https://github.com/FilOzone/filecoin-ponder). The original upstream PR was [ponder-sh/ponder#2282](https://github.com/ponder-sh/ponder/pull/2282).

## Install

Use the npm `npm:` alias so source code keeps importing from `"ponder"`. This matters because the package's internal type declarations (virtual modules, type imports) self-reference the original `"ponder"` name; installing under that local name keeps everything resolving:

```json
{
  "dependencies": {
    "ponder": "npm:@filoz/ponder@^0.18.9-filecoin.1"
  }
}
```

```bash
npm install
# or pnpm install / bun install
```

You can install under the scope name directly (`npm install @filoz/ponder`), but then you'll need a tsconfig `paths` entry mapping `"ponder"` to the renamed package, plus your own source-level imports to use either name. The alias above is simpler.

The `@ponder/utils` runtime dep resolves to upstream's published version. No other forks needed.

## Use

The API is identical to upstream Ponder. Refer to [ponder.sh](https://ponder.sh) for documentation, the config reference, schema definition, indexing functions, and everything else.

A minimal Filecoin config:

```ts
// ponder.config.ts
import { createConfig } from "ponder"
import { MyContractAbi } from "./abis/MyContract"

export default createConfig({
  chains: {
    mainnet: {
      id: 314,
      rpc: process.env.FILECOIN_RPC_URL!,
      pollingInterval: 30_000,
    },
  },
  contracts: {
    MyContract: {
      abi: MyContractAbi,
      chain: "mainnet",
      address: "0x...",
      startBlock: 5_000_000,
    },
  },
})
```

## Limitations not addressed

- **Bloom filter optimization.** FVM's all-ones logsBloom defeats Ponder's bloom-skip optimization. Every block triggers an `eth_getLogs` call. Performance impact only.
- **Deep reorgs.** EC finality is 900 epochs. While F3 finalizes tipsets, the 20-epoch window is ample; without F3, a deeper reorg is possible, likelier on calibnet. Ponder then stops with an unrecoverable reorg error, and what it finalized from the abandoned blocks stays in its tables and RPC cache.
- **Traces.** Ponder uses `debug_traceBlockByHash` (Geth format). Lotus only supports `trace_block` (OpenEthereum format). Trace handlers and transfer handlers don't work on Filecoin.

## Versioning

Versions mirror upstream `ponder`, with a suffix counting fork releases on that base: `@filoz/ponder@0.18.9-filecoin.1` is upstream's `ponder@0.18.9` plus the Filecoin patches. Releases up to `0.17.4-filecoin.3` were published as `@rvagg/ponder`.

## Repository

[github.com/FilOzone/filecoin-ponder](https://github.com/FilOzone/filecoin-ponder)

## License

MIT (same as upstream Ponder).
