# @filoz/ponder

[![NPM](https://nodei.co/npm/@filoz/ponder.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/@filoz/ponder/)

A Filecoin-compatible fork of [`ponder`](https://www.npmjs.com/package/ponder). Versions track upstream; the only delta is a small set of patches to make Ponder usable against Filecoin's EVM (FVM).

> **This is a fork.** If you're indexing on Ethereum, Base, Arbitrum, or any other standard EVM chain, this fork will work but [upstream `ponder`](https://www.npmjs.com/package/ponder) would be the better choice. This fork exists only to unblock Filecoin (chains 314 and 314159).

## What's different

Patches on top of upstream `main`:

1. **Null round handling.** Filecoin epochs that produce no block return RPC error code 12. Upstream Ponder treats this as a hard error; the fork detects null rounds and skips them. Where upstream assumes every height holds a block, the fork matches realtime reorgs by block hash and takes the nearest block at or below a null height for finality.
2. **logsBloom validation bypass.** Filecoin's FVM fills every logsBloom bit to 1 regardless of log content. The "non-zero bloom implies non-empty logs" check is skipped for Filecoin chains.
3. **Start block lookback fallback.** Lotus gateway endpoints have limited history depth, which breaks the start-block fetch on restart. The fork synthesizes a placeholder block when the gateway can't serve it.
4. **`eth_getLogs` ranges from Lotus errors.** Requests are chunked to the range limit Lotus states in its error.

Filecoin chain IDs (314 mainnet, 314159 calibnet) are configured with 900-block finality.

For the full diff and rationale, see [the fork repository](https://github.com/FilOzone/filecoin-ponder). The original upstream PR was [ponder-sh/ponder#2282](https://github.com/ponder-sh/ponder/pull/2282).

## Install

Use the npm `npm:` alias so source code keeps importing from `"ponder"`. This matters because the package's internal type declarations (virtual modules, type imports) self-reference the original `"ponder"` name; installing under that local name keeps everything resolving:

```json
{
  "dependencies": {
    "ponder": "npm:@filoz/ponder@^0.17.4-filecoin.4"
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
- **Traces.** Ponder uses `debug_traceBlockByHash` (Geth format). Lotus only supports `trace_block` (OpenEthereum format). Trace handlers and transfer handlers don't work on Filecoin.

## Versioning

Versions mirror upstream `ponder`, with a suffix counting fork releases on that base: `@filoz/ponder@0.17.4-filecoin.4` is upstream's `ponder@0.17.4` plus the Filecoin patches. Releases up to `0.17.4-filecoin.3` were published as `@rvagg/ponder`.

## Repository

[github.com/FilOzone/filecoin-ponder](https://github.com/FilOzone/filecoin-ponder)

## License

MIT (same as upstream Ponder).
