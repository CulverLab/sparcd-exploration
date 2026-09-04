# Jetstream2 deploy

The running deployment: a Caddy shard proxy on a Jetstream2 instance fronting
the JS2 object store (`js2.jetstream-cloud.org:8001`, Ceph RGW) on port 443
plus the shard ports 8443-8462, HTTP/3 on every one.

`cloud-init.yaml` is the whole machine. It installs Caddy from the upstream
apt repository, mounts the certificate volume, enables BBR, and writes the
Caddyfile plus an environment file holding the instance's hostname and
upstream.

- Instance: `sparcd-quic-proxy-03` (m3.tiny), JS2 project BIO260073
- DNS: `sparcd-quic-proxy-03.bio260073.projects.jetstream-cloud.org`
- Certificate volume: `sparcd-quic-proxy-certs`, 8 GB, mounted `/var/lib/caddy`

## Deploying a config change

SSH from residential CGNAT networks is unreliable — per-flow egress IPs defeat
IP-pinned security-group rules — so the working method is a full reimage:

```sh
openstack --os-cloud BIO260073_IU server rebuild \
  --image Featured-Minimal-Ubuntu24 \
  --user-data apps/sparcd-shard-proxy/deploy/jetstream2/cloud-init.yaml \
  sparcd-quic-proxy-03
```

The instance keeps its IP, DNS name, flavor, and security groups. The root
disk is wiped; the certificate volume is not, which is the point of having it.
About 90 seconds to serving.

Even so, **batch config changes**. Let's Encrypt issues 5 certificates per
exact name per week, and the volume only protects you as long as it stays
attached — a lost volume plus a few rebuilds exhausts the name's budget and
the instance serves nothing until the window rolls.

## Verifying after a rebuild

From the repo root:

```sh
node apps/sparcd-shard-proxy/smoke.mjs \
  --base https://sparcd-quic-proxy-03.bio260073.projects.jetstream-cloud.org \
  --ports 443,8443,8444,8445,8446,8447,8448,8449,8450,8451,8452,8453,8454,8455,8456,8457,8458,8459,8460,8461,8462
```

Add `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` to make the signed checks real.
Port 443 is the one that proves the portless-Host branch; the others prove the
`host:port` branch.

## Keeping the embedded Caddyfile in sync

cloud-init has no way to reference a file it is not carrying, so
`cloud-init.yaml` embeds a verbatim copy of the canonical
[`../../Caddyfile`](../../Caddyfile). They must stay identical:

```sh
diff <(awk '/Caddyfile.sparcd/{f=1} f&&/^    content: \|$/{c=1;next} c&&/^[a-z]/{exit} c' \
         apps/sparcd-shard-proxy/deploy/jetstream2/cloud-init.yaml | sed 's/^      //') \
     apps/sparcd-shard-proxy/Caddyfile
```

Nothing site-specific lives in that copy. Hostname and upstream come from
`/etc/caddy/sparcd.env`, which a systemd drop-in feeds to `caddy.service` — the
packaged unit reads no environment file of its own.

## Why the pieces are there

- **A named-per-instance hostname.** Let's Encrypt's limit is per exact name,
  so a spent budget is escaped by giving the next instance a new name. That is
  where `-03` came from; `-02`'s budget was gone.
- **The certificate volume.** `server rebuild` wipes the root disk and
  preserves attached volumes, so mounting one at `/var/lib/caddy` means
  certificates are issued once and reused forever.

  On a rebuild it is already labelled `caddydata` and nothing is formatted. On
  a first boot the script scans `/dev/vdb` and `/dev/sdb`, and formats only if
  **exactly one** of them carries no filesystem signature at all — zero or
  several and the boot fails with the reason. Guessing here destroys somebody's
  data. If you know the volume, name it exactly and skip the scan by exporting
  `CERT_DEV` before that step:

  ```
  CERT_DEV=/dev/disk/by-id/virtio-$(echo $VOLUME_ID | cut -c1-20)
  ```

  OpenStack exposes attached volumes under `/dev/disk/by-id/virtio-<first 20
  characters of the volume UUID>`, which survives a device-name reshuffle where
  `/dev/vdb` does not.
- **BBR** (`net.ipv4.tcp_congestion_control=bbr` plus `net.core.default_qdisc=fq`).
  On a long lossy path, cubic collapses per-connection throughput on loss that
  is not congestion. BBR does not.
- **Ports, not subdomains.** JS2 auto-creates one DNS record per floating IP
  and nothing else, so extra origins have to be extra ports here. That suits
  the uploader, which looks for 8443 through 8462 on the endpoint's own host
  and finds nothing else — which is also what sets the shard count, since it
  stripes across however many of those `SHARD_ADDRESSES` publishes. A
  deployment with its own DNS zone can use subdomain shards on :443 instead —
  they survive firewalls that only allow outbound 443 — but only a client told
  those names will use them.
