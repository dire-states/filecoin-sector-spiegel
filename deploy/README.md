# Running the snapshots on the node host

These steps set up the fetch, commit and publish runs, 4 times a day, on the host that runs the Lotus
nodes, under `/opt/dire-states`. Your admin login (e.g. `ptrk`) owns the files there, and the service
runs as root. Run the steps as that login; `sudo` marks what needs root.

Each data repo gets its own new **deploy key**, because GitHub allows a deploy key on one repo
only. Each key can push to its own data repo and nothing else. The app repo is public and is cloned
over HTTPS.

## 1. Prerequisites

```sh
sudo mkdir -p /opt/dire-states && sudo chown "$USER": /opt/dire-states
git --version
flock --version    # util-linux
```

Node 26 goes to `/opt/dire-states/node` (needs >= 23.6, which runs .ts directly). The service puts
`/opt/dire-states/node/bin` first on its PATH. sudo's `secure_path` drops it, so link `node` into
`/usr/local/bin` for runs by hand:

```sh
cd /tmp
BASE=https://nodejs.org/dist/latest-v26.x
F=$(curl -fsSL $BASE/SHASUMS256.txt | awk '/linux-x64\.tar\.xz$/ {print $2}')
curl -fLO $BASE/$F
curl -fsSL $BASE/SHASUMS256.txt | grep " $F\$" | sha256sum -c -
mkdir -p /opt/dire-states/node
tar -xJf $F -C /opt/dire-states/node --strip-components=1
sudo ln -sf /opt/dire-states/node/bin/node /usr/local/bin/node
sudo node --version
```

## 2. Directories

```sh
mkdir -p /opt/dire-states/.ssh /opt/dire-states/sector-spiegel
chmod 700 /opt/dire-states/.ssh
```

## 3. Deploy keys

```sh
cd /opt/dire-states
for repo in data-main data-calibration; do
  ssh-keygen -t ed25519 -N '' -C "sector-spiegel-$repo@$(hostname)" -f .ssh/sector-spiegel-$repo
done
# Shared by you (cloning) and root (pushing); the clones point ssh at it.
ssh-keyscan github.com > .ssh/known_hosts
cat .ssh/sector-spiegel-data-main.pub .ssh/sector-spiegel-data-calibration.pub
```

On GitHub, add each public key to its repo under **Settings → Deploy keys → Add deploy key**, with
**Allow write access** ticked. Delete any old key of a previous install there.

- `sector-spiegel-data-main.pub` → `dire-states/filecoin-sector-spiegel-data-main`
- `sector-spiegel-data-calibration.pub` → `dire-states/filecoin-sector-spiegel-data-calibration`

## 4. Clone

```sh
cd /opt/dire-states/sector-spiegel
git clone https://github.com/dire-states/filecoin-sector-spiegel.git
for repo in data-main data-calibration; do
  git clone \
    -c core.sshCommand="ssh -i /opt/dire-states/.ssh/sector-spiegel-$repo -o IdentitiesOnly=yes -o UserKnownHostsFile=/opt/dire-states/.ssh/known_hosts" \
    -c user.name=dire-states -c user.email=339008527+dire-states@users.noreply.github.com \
    git@github.com:dire-states/filecoin-sector-spiegel-$repo.git
done
# Root's git refuses repos owned by another user unless they are marked safe.
for r in filecoin-sector-spiegel filecoin-sector-spiegel-data-main filecoin-sector-spiegel-data-calibration; do
  sudo git config --system --add safe.directory /opt/dire-states/sector-spiegel/$r
done
```

Each data clone starts from GitHub's single snapshot commit. From here on the host keeps the full
history locally, one commit per snapshot, and pushes only the latest one. `history.json` is part of
the snapshot, so the extension history carries on.

## 5. Test by hand

```sh
cd /opt/dire-states/sector-spiegel/filecoin-sector-spiegel
sudo NO_PUSH=1 scripts/publish.sh calibnet   # commits, no push
sudo scripts/publish.sh calibnet             # pushes
sudo scripts/publish.sh mainnet              # ~7 min, ~2.5 GB RAM
```

Each run ends with `<net>: published snapshot … as <commit>` and `<net>: done in <N>s`. The nodes
default to `192.168.50.123:1234` (mainnet) and `:1235` (calibnet); set `LOTUS_API` if they live
elsewhere.

## 6. Schedule

The units are linked from this repo, not copied, so a pull plus `daemon-reload` applies changes.
`/opt` must be on the root filesystem for linked units to load at boot.

```sh
D=/opt/dire-states/sector-spiegel/filecoin-sector-spiegel/deploy
sudo systemctl link $D/sector-spiegel@.service
sudo systemctl enable --now $D/sector-spiegel-calibnet.timer $D/sector-spiegel-mainnet.timer
systemctl list-timers 'sector-spiegel*'
sudo systemctl start sector-spiegel@calibnet   # one run through systemd, to check the unit
```

Calibnet runs at 00:00, 06:00, 12:00 and 18:00, and mainnet 10 minutes later. A run missed while
the host was down starts at the next boot.

- Run now: `sudo systemctl start sector-spiegel@mainnet`
- Logs: `sudo journalctl -u sector-spiegel@mainnet -e`
- Failures: `systemctl --failed`. A failed run, for example a node out of sync or unreachable,
  commits and pushes nothing. The next run discards any files it left behind and picks up normally.

## Updating the scripts

```sh
git -C /opt/dire-states/sector-spiegel/filecoin-sector-spiegel pull
sudo systemctl daemon-reload    # if a unit file changed
```
