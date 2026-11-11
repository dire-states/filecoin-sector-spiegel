# Running the snapshots on the node host

These steps set up the fetch, commit and publish runs, 4 times a day, on the host that runs the Lotus
nodes, under `/opt/dire-states`. Run them as root unless a step says otherwise.

Each data repo gets its own new **deploy key**, because GitHub allows a deploy key on one repo
only. Each key can push to its own data repo and nothing else. The app repo is public and is cloned
over HTTPS.

## 1. Prerequisites

```sh
node --version     # needs >= 23.6 (runs .ts directly); 26 recommended
git --version
flock --version    # util-linux
```

If Node is missing or too old, unpack the official Node 26 linux-x64 tarball into
`/opt/dire-states/node`. The service puts `/opt/dire-states/node/bin` first on its PATH:

```sh
mkdir -p /opt/dire-states/node
tar -xJf node-v26.*-linux-x64.tar.xz -C /opt/dire-states/node --strip-components=1
/opt/dire-states/node/bin/node --version
```

## 2. Service user

```sh
useradd --system --home-dir /opt/dire-states --shell /usr/sbin/nologin dire-states
mkdir -p /opt/dire-states/.ssh /opt/dire-states/sector-spiegel
chown -R dire-states: /opt/dire-states
chmod 700 /opt/dire-states/.ssh
```

## 3. Deploy keys

```sh
cd /opt/dire-states
for repo in data-main data-calibration; do
  sudo -u dire-states ssh-keygen -t ed25519 -N '' -C "sector-spiegel-$repo@$(hostname)" \
    -f .ssh/sector-spiegel-$repo
done
sudo -u dire-states sh -c 'ssh-keyscan github.com >> .ssh/known_hosts'
cat .ssh/sector-spiegel-data-main.pub .ssh/sector-spiegel-data-calibration.pub
```

On GitHub, add each public key to its repo under **Settings → Deploy keys → Add deploy key**, with
**Allow write access** ticked:

- `sector-spiegel-data-main.pub` → `dire-states/filecoin-sector-spiegel-data-main`
- `sector-spiegel-data-calibration.pub` → `dire-states/filecoin-sector-spiegel-data-calibration`

## 4. Clone

```sh
cd /opt/dire-states/sector-spiegel
sudo -u dire-states git clone https://github.com/dire-states/filecoin-sector-spiegel.git
for repo in data-main data-calibration; do
  sudo -u dire-states git clone \
    -c core.sshCommand="ssh -i /opt/dire-states/.ssh/sector-spiegel-$repo -o IdentitiesOnly=yes" \
    -c user.name=dire-states -c user.email=339008527+dire-states@users.noreply.github.com \
    git@github.com:dire-states/filecoin-sector-spiegel-$repo.git
done
```

Each data clone starts from GitHub's single snapshot commit. From here on the host keeps the full
history locally, one commit per snapshot, and pushes only the latest one. `history.json` is part of
the snapshot, so the extension history carries on.

## 5. Test by hand

```sh
cd /opt/dire-states/sector-spiegel/filecoin-sector-spiegel
sudo -u dire-states env PATH=/opt/dire-states/node/bin:$PATH NO_PUSH=1 scripts/publish.sh calibnet   # commits, no push
sudo -u dire-states env PATH=/opt/dire-states/node/bin:$PATH scripts/publish.sh calibnet             # pushes
sudo -u dire-states env PATH=/opt/dire-states/node/bin:$PATH scripts/publish.sh mainnet              # ~7 min, ~2.5 GB RAM
```

Each run ends with `<net>: published snapshot … as <commit>` and `<net>: done in <N>s`. The nodes
default to `192.168.50.123:1234` (calibnet) and `:1235` (mainnet); set `LOTUS_API` if they live
elsewhere.

## 6. Schedule

```sh
cp deploy/sector-spiegel@.service deploy/sector-spiegel-calibnet.timer deploy/sector-spiegel-mainnet.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now sector-spiegel-calibnet.timer sector-spiegel-mainnet.timer
systemctl list-timers 'sector-spiegel*'
```

Calibnet runs at 00:00, 06:00, 12:00 and 18:00, and mainnet 10 minutes later. A run missed while
the host was down starts at the next boot.

- Run now: `systemctl start sector-spiegel@mainnet`
- Logs: `journalctl -u sector-spiegel@mainnet -e`
- Failures: `systemctl --failed`. A failed run, for example a node out of sync, commits and pushes
  nothing; the next run picks up normally.

## Updating the scripts

```sh
sudo -u dire-states git -C /opt/dire-states/sector-spiegel/filecoin-sector-spiegel pull
```

If a unit file changed, copy it again and run `systemctl daemon-reload`.
