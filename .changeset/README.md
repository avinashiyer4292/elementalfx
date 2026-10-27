# Changesets

Each pull request that changes a package adds a changeset describing it:

```sh
pnpm changeset
```

Pick the packages, the bump type (patch, minor, major) and write one line for the changelog. On merge, the Release workflow collects pending changesets into a "Version Packages" pull request; merging that publishes the new versions.
