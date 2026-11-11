# sector-spiegel

Shows how long Filecoin sectors live and estimates when a network "dies": the point where every
live sector has expired. It works per miner and network-wide, with what-if lines for every sector
extended to its maximum lifetime.

## Repos

```
sector-spiegel/
  app/            this repo: the site (Vite + React + uPlot) and the fetch script
  data-calibnet/  daily calibnet snapshot (miners.json + miners/<id>.json)
  data-mainnet/   daily mainnet snapshot
```

The site loads only `miners.json` up front, plus one miner's file when you click it. Per-sector
details such as CIDs and pledge are fetched live from Glif's public nodes on hover.

## Develop

```sh
npm install
npm run dev
```

The dev and preview servers serve the sibling data repos at `/data/calibnet/` and `/data/mainnet/`.
Switch networks in the header, or with `?net=mainnet` in the URL.

## Fetch a snapshot

```sh
npm run fetch:calibnet                                  # writes ../data-calibnet
npm run fetch:mainnet                                   # writes ../data-mainnet
```

- Add `-- --commit` to commit the snapshot in the data repo.
- Each data repo has a `dataset.json` naming its network. The script aborts if the node is on a
  different network.
- The script aborts if the node's head is more than 10 min old (still syncing); `-- --allow-stale` overrides.
- `LOTUS_API` defaults to the local node for the repo's network.

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `LOTUS_API` | fetch script | calibnet: `http://192.168.50.123:1234/rpc/v1`; mainnet: `http://192.168.50.123:1235/rpc/v1` |
| `DATA_DIR_CALIBNET`, `DATA_DIR_MAINNET` | dev/preview server | `../data-calibnet`, `../data-mainnet` |
| `VITE_DATA_BASE_CALIBNET`, `VITE_DATA_BASE_MAINNET` | build | `/data/calibnet/`, `/data/mainnet/` (set to the published data URLs for a deployment) |
