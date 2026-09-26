# Deterministic MVP-02 scenario

This package owns the synthetic Dev A / Dev B fixture used by the minimum demo.
It contains no credentials, live source code, wall-clock values, randomness, or
network calls.

From the repository root, reset and generate the complete fixture with:

```sh
npm run seed:mvp-02
```

The command writes only to `demo/generated/mvp-02`. It refuses to reset an
existing directory unless that directory contains the seeder's marker file.
Generated output includes a manifest, four exact workspace snapshots, and the
frozen policy-evaluation dataset. Candidate and artifact hashes are SHA-256
values derived from canonical fixture content.
