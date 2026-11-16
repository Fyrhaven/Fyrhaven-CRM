# Licensing a self-hosted Fyrhaven server

A self-hosted install **refuses to start** without a licence key it can verify
itself. No call home, no account needed at boot — the key carries a signature and
an expiry, and the server checks both.

```bash
FYRHAVEN_LICENCE=FH1.eyJ2IjoxLCJzdWIiOiJ5b3VAZXhhbXBsZS5jb20i...   # from your order
FYRHAVEN_LICENCE_PUBLIC=<base64 DER public key>                    # already the default
```

`FYRHAVEN_LICENCE_PUBLIC` is the public key a key is checked against; it already
defaults to the one Fyrhaven signs with.

There is **no cloud mode to switch on.** The operator's own service (the paid
tier) is a separate repository, `Fyrhaven/Fyrhaven-CRM-Cloud`, and the code that
would honour a `FYRHAVEN_MODE` flag is not in this one.

## How the key works

```
FH1.<base64url(payload JSON)>.<base64url(ed25519 signature over the payload)>
payload = { v, sub, plan, seats, iss, exp }
```

The server verifies the signature against a **public** key (shipped in
`licence.js`, overridable with `FYRHAVEN_LICENCE_PUBLIC`). The **private** key
never leaves the seller — it lives in `FYRHAVEN_LICENCE_PRIVATE_B64` on the
service that issues licences, and signs a key when a licence product is paid for.

## What this buys, and what it honestly does not

- **It buys**: nobody runs a self-hosted Fyrhaven without a key you issued, and
  nobody can mint one without your private key. Expiry is enforced.
- **It does not buy**: revocation in real time. An offline key cannot be taken
  back once handed out, and anyone willing to patch the source can remove the
  check. The licence is a **contract with honest customers**, not a lock on the
determined — that is the price of working offline, and it is stated here rather
  than implied away.

If you need stronger enforcement later, the honest options are a public-key
signed **renewal** on every update (which is what the 12-month term already is),
or an optional anonymous heartbeat that a customer can turn off.

## Operating it

This repository is the **customer's** side. Issuing, tracking and revoking keys
are the seller's, and they live in `Fyrhaven/Fyrhaven-CRM-Cloud`:

- Issue: a paid `selfhosted` order signs a key and returns it with the order
  (also visible to the customer on their account page).
- Track: `GET /v1/admin/licenses` lists every key with `signed`, `revoked`,
  issue and expiry dates.
- Revoke: `POST /v1/admin/licenses/{id}/revoke` — it stops the list claiming the
  key is good and a renewal is issued instead.
- Rotate: generate a new pair, ship the new public key as the default (or set
  `FYRHAVEN_LICENCE_PUBLIC`), and keep the old private key only for re-issuing.

Generate a pair once, offline:

```bash
node -e "const {generateKeyPairSync}=require('node:crypto');const {publicKey,privateKey}=generateKeyPairSync('ed25519');console.log(publicKey.export({type:'spki',format:'der'}).toString('base64'));console.log(privateKey.export({type:'pkcs8',format:'pem'}))"
```


## Two ways to activate

The server has an **installation key** of its own — `FHI-XXXX-XXXX-XXXX-XXXX`,
created on first boot and kept on the volume (`/data/install.key`). A licence
carries it, so a key issued for one installation does not open another.

### Offline (default)

1. On the server: `GET /v1/licence` (with the workspace token) shows
   `fingerprint` — or read `/data/install.key`.
2. On the site, signed in, paste it under *Self-hosted licence* → the service
   re-signs your licence for **that** installation and shows the key.
3. Paste the key into the server as `FYRHAVEN_LICENCE` and restart — or send it
   to `POST /v1/licence`, which checks it and writes it to `/data/licence.key`.

Nothing but the pasted key crosses the wire, and it works on a machine that has
never been online.

### Online (opt-in)

```bash
FYRHAVEN_ACTIVATION=online
FYRHAVEN_ACTIVATION_URL=https://crm.mailz.se
FYRHAVEN_ACTIVATION_TOKEN=<the account token from your signup>
```

The server presents its fingerprint to the service at boot, receives a key bound
to it, verifies it locally and caches it in `/data/licence.key`. **It verifies
the key it receives** — the activation call is a convenience, never trust. If the
service is down or refuses, the install keeps running on `FYRHAVEN_LICENCE` (or
its cached key) and logs the reason; it does not fall over because we are down.

Either way the check is identical and local: signature, expiry, fingerprint.


## Protecting the server, and moving it

**A username and password.** Set `STORE_AUTH_USER` and `STORE_AUTH_PASSWORD` and
the server answers HTTP Basic; a bearer token still works, so an operator can
never lock themselves out. The plugin holds the pair as a credential, so the
password never reaches the browser page.

**Deactivating, so one licence is one server.** A key that could be copied to a
second machine silently would defeat the whole point, so release is a signed
round trip:

```
POST /v1/licence/challenge        (on YOUR server)  -> { challenge, fingerprint }
POST /v1/licence/deactivate       (on crm.fyrhaven.com) <- { challenge } -> { code }
POST /v1/licence/deactivate       (on YOUR server)  <- { code }     -> { deactivated: true }
```

The middle step is the cloud's: the seller's service is the only place that can
sign a release. Both ends are implemented, one in each repository.

The challenge names the installation and a one-time nonce. The service releases
that installation and returns a code **signed by the seller**; your server checks
the signature, its own fingerprint and the nonce before it forgets the licence,
and the nonce is then spent — so the same code cannot be replayed. The licence is
then free to activate somewhere else.
