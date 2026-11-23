# Releases and Helm chart

The `master` branch follows the latest stable Node.js release, including new majors before LTS. Runtime versions are pinned in Dockerfile and CI and updated together by Renovate. `@types/node` follows stable releases separately so its npm cooldown cannot hold back a runtime security patch.

Renovate reads `renovate.json5` as repository configuration. It must not also be passed as the bot's global configuration: mergeable custom managers and rules would be loaded twice.

## Release an application version

A push to `master` runs release-please with the repository's `psr` versioning strategy. Versions have the form `<upstream>-psr.<major>.<minor>.<patch>`. The upstream base stays unchanged during fork releases. The legacy `5.5.1-psr.4.3` is treated as fork version `4.3.0`: the next fix becomes `5.5.1-psr.4.3.1`, a feature becomes `5.5.1-psr.4.4.0`, and a breaking change becomes `5.5.1-psr.5.0.0`.

The release PR updates package.json, the changelog, the release manifest, and `charts/summaly/Chart.yaml` appVersion. Git tags have no `v` prefix. Although SemVer interprets the suffix as a prerelease, these are normal production releases of this fork, so GitHub Releases use `prerelease: false`. Consumers must track this fork explicitly, not a stable-only npm version range. Chart versions use independent ordinary SemVer.

Only when importing a new upstream base, include a `Release-As: 5.6.0-psr.4.4.0` commit footer with the intended full version. It must increase the previous version and retain the fork suffix. Ordinary dependency updates must not use `Release-As`.

The weekly workflow merges only the GitHub App's release PR targeting `master`, after the `test` and `lint` jobs and all other checks succeed, with the checked head SHA pinned. For an urgent security release, run `Weekly Release PR Merge` manually after the release PR checks finish.

After release-please creates the GitHub Release, the same pipeline publishes and verifies the amd64 and arm64 image before publishing the Helm chart. `Retry Release Publish` accepts an existing release version and resolves its original tag. Published image tags must not be overwritten with a different revision.

## Publish the chart

The chart source is `charts/summaly` and the published repository is `oci://ghcr.io/soli0222/charts/summaly`. Empty `image.tag` selects `Chart.appVersion`. PKE owns deployment-specific values and tracks published chart versions through its Flux HelmRepository and Renovate.

Chart-only changes also run the publisher; a daily reconciliation recovers missed runs. The shared publisher follows this repository's default branch, checks that referenced images exist, and reports `published`, `no-op`, or `deferred`. Structural chart changes require a minor/major version bump; an appVersion-only release can receive an automatic patch bump.

Release creation and weekly merge use the existing `RENOVATE_CLIENT_ID` and `RENOVATE_PRIVATE_KEY`. Image and chart publication use the workflow's GITHUB_TOKEN. The GHCR chart package must be public for unauthenticated Flux pulls.

## Validate

```sh
pnpm install --frozen-lockfile
pnpm build
SKIP_NETWORK_TEST=true pnpm test
pnpm oxlint
python3 -m unittest discover -s scripts/release -p 'test_*.py'
npm ci --ignore-scripts --prefix scripts/release
npm test --prefix scripts/release
helm lint --strict charts/summaly
helm template summaly charts/summaly
```

Use Node.js matching CI. Container checks should verify `/health` through the published port, because Kubernetes probes connect from outside the container.
