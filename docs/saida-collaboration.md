# Saida collaboration

The Hyperagent rig is registered in Saida with `dev` as its integration branch.
Its existing beads database is `hackalon`. Public SQL access uses MySQL protocol
through **hermes-01.tail8c6c22.ts.net:10000** (Tailscale Funnel), with TLS and certificate identity checked. The machine has no direct public database listener.
No VPN or Tailscale membership is required.

The city owner account is `oxfern`; the collaborator account is `oceanseth`,
with writer access limited to `hackalon`. Obtain your own connection bundle
from the city owner. It contains a private connection profile and the public
CA certificate. Keep the profile private; never commit or paste its password.
The Beads helper starts its own private local connector for each command; no
separate tunnel process is required. Select `hackalon` as the database.

For Beads, install the pinned tools through Hermit and use:

```sh
bin/beads-public.py --profile /path/to/connection.json ready
bin/beads-public.py --profile /path/to/connection.json show hackalon-ISSUE
bin/beads-public.py --profile /path/to/connection.json update hackalon-ISSUE --claim
```

The helper opens verified outer TLS to Funnel and native MySQL TLS to the
authenticated gateway. It keeps per-command connection temporary metadata outside the checkout, uses the
existing project identity, validates TLS and reads the password from the private
profile. It leaves the checkout's embedded configuration untouched. All live
clients see the same claims and updates. Do not pull/push Dolt snapshots or run
`bin/setup-beads` in public server mode; the city maintainer handles snapshot
publication and backup.

Application delivery is gated while the mayor and user choose development
credentials and validate independent worktree services, stateful integration
tests and required PR CI. Registration and database access are already usable.
The app's documented hosted dev deployment shares production resources; it
is not an isolated baseline. Follow `AGENTS.md` and the city delivery policy.
