# Fyrhaven record server — self-hosted

The service your Contact Manager plugin keeps its records on, running on a
machine you control. One small Node process, a SQLite file (or a bucket), and no
dependency to install.

**This is not the cloud service.** It has no shop, no customer accounts, no
billing, no operator panel, and no way to become the cloud — that build is not in
this archive. What it has is the record API, on your server, behind your proxy.

## What it needs

| | |
|---|---|
| **A licence key** | Signed by Fyrhaven, bound to this installation, checked **offline**. Without one the server refuses to start. It never calls home |
| **A master key** | `openssl rand -base64 32` — wraps every workspace's data key. Lose it and the database is unreadable |
| **A token per workspace** | `token=workspace,…` — the "workspace token" your plugin stores |
| **A proxy** | nginx, Caddy, Traefik. The container publishes on `127.0.0.1` only |

## Run it

```bash
cp .env.example .env      # then fill in the three values
docker compose up -d
curl -s http://127.0.0.1:8080/version
```

Then in the plugin: **Settings → Fyrhaven CRM → Server and licence**, paste the
URL of the proxy host and the workspace token.

## Moving a licence

A licence binds to one installation. If this machine is replaced, the old server
is the one that has to let go: **Dedicated server → Licence → Release this
installation** prints a challenge, and `fyrhaven.com` turns that into a release
code. That is the second half of a handshake, not a form to fill in twice.

## What you can and cannot read

Records are encrypted at rest with a key this service unwraps to serve them — so
**you, the operator of this server, can read them.** That is the price of a
server-held key and it is the same trade the hosted service makes, stated here
rather than implied away. If you need a key nobody but you holds, that is not
built.

## Updating

Unpack the new archive over this one and rebuild:

```bash
docker compose up -d --build
```

Your `data/` volume is untouched. Read [`LICENSING.md`](LICENSING.md) for what the
licence does and does not enforce — it is a contract with honest customers, not
DRM, and the page says so.
