# sector-spiegel

Shows how long Filecoin sectors live and estimates when a network "dies": the point where every
live sector has expired. It works per miner and network-wide, with what-if lines for every sector
extended to its maximum lifetime, and lists the miners that extended sectors between snapshots.

Live at https://dire-states.github.io/filecoin-sector-spiegel/

## Repos

```
sector-spiegel/
  filecoin-sector-spiegel/                   this repo: the site (Vite + React + uPlot) and the fetch scripts
  filecoin-sector-spiegel-data-calibration/  calibnet snapshot (miners.json, miners/<id>.json, history.json)
  filecoin-sector-spiegel-data-main/         mainnet snapshot
```

The site loads `miners.json` and the small `history.json` of per-snapshot changes up front, plus one
miner's file when you click it. Per-sector details such as CIDs and pledge are fetched live from
Glif's public nodes on hover.

## Develop

```sh
npm install
npm run dev
```

The dev and preview servers serve the sibling data repos at `/data/calibnet/` and `/data/mainnet/`.
Switch networks in the header, or with `?net=mainnet` in the URL.

## Fetch a snapshot

```sh
npm run fetch:calibnet    # writes ../filecoin-sector-spiegel-data-calibration
npm run fetch:mainnet     # writes ../filecoin-sector-spiegel-data-main
```

- Add `-- --commit` to commit the snapshot in the data repo, one commit per snapshot.
- Before overwriting, the script compares the previous snapshot with the new data and appends the
  changes to `history.json`.
- Each data repo has a `dataset.json` naming its network. The script aborts if the node is on a
  different network.
- The script aborts if the node's head is more than 10 min old (still syncing); `-- --allow-stale` overrides.
- `LOTUS_API` defaults to the local node for the repo's network.
- A mainnet run takes about 7 minutes and peaks at about 2.3 GB RAM.

## Publish

```sh
scripts/publish.sh calibnet
scripts/publish.sh mainnet
```

- Fetches and commits locally, then force-pushes only the latest tree to GitHub as a single
  parentless commit. The full history stays in the local data repo, about 65 MB per mainnet snapshot.
- `NO_PUSH=1` commits locally without pushing.
- Refuses to run if the data repo has uncommitted changes, or if another publish for it is running.
- GitHub Pages serves each data repo from `main`. The site, deployed by `.github/workflows/pages.yml`,
  reads the data from there at runtime, so data updates need no app redeploy.

### On the Lotus host

1. Install Node 26 and git.
2. Clone the three repos side by side. Give each data repo a deploy key with write access, and set
   `core.sshCommand` and the commit identity in each data clone.
3. Seed each data clone's local `main` once, from the machine that holds the history so far.
4. Add a crontab, for example 4 runs a day:
   ```
   0 */6 * * *   cd /srv/sector-spiegel/filecoin-sector-spiegel && scripts/publish.sh calibnet >> /var/log/sector-spiegel.log 2>&1
   10 */6 * * *  cd /srv/sector-spiegel/filecoin-sector-spiegel && scripts/publish.sh mainnet  >> /var/log/sector-spiegel.log 2>&1
   ```
   Set `LOTUS_API` if the nodes aren't at the defaults.

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `LOTUS_API` | fetch script | calibnet: `http://192.168.50.123:1234/rpc/v1`; mainnet: `http://192.168.50.123:1235/rpc/v1` |
| `DATA_DIR` | publish.sh | `../filecoin-sector-spiegel-data-calibration` or `../filecoin-sector-spiegel-data-main` |
| `NO_PUSH` | publish.sh | unset (push) |
| `DATA_DIR_CALIBNET`, `DATA_DIR_MAINNET` | dev/preview server | the two sibling data repos |
| `BASE_PATH` | build | `/` (Pages build: `/filecoin-sector-spiegel/`) |
| `VITE_DATA_BASE_CALIBNET`, `VITE_DATA_BASE_MAINNET` | build | `/data/calibnet/`, `/data/mainnet/` (Pages build: the data repos' Pages URLs) |
