# @cdktn/bundler-docker

Container-based asset bundler for [CDK Terrain](https://github.com/open-constructs/cdk-terrain).

`DockerBundler` runs a build inside a docker image and stages its output as a
`TerraformAsset`. Because the build runs in an image the caller pins, the
artifact is reproducible across machines that share the same image, without
requiring the toolchain on the host. For a build that runs directly on the host
use `@cdktn/bundler-local` instead.

## Usage

```ts
import { TerraformAsset, AssetType } from "cdktn";
import { DockerBundler, BundlingFileAccess } from "@cdktn/bundler-docker";

new TerraformAsset(this, "asset", {
  path: "./src",
  type: AssetType.DIRECTORY,
  bundler: new DockerBundler({
    image: "node:20",
    command: [
      "sh",
      "-c",
      "cd /asset-input && npm ci && npm run build -- --out /asset-output",
    ],
    bundlingFileAccess: BundlingFileAccess.BIND_MOUNT,
  }),
});
```

The container is run with the source mounted read-only at `/asset-input` and the
build output written to `/asset-output`.

### File access modes

- `BIND_MOUNT` (default) — bind-mounts the host source and output directories
  into the container. Fastest, but requires the host paths to be shareable with
  the docker daemon.
- `VOLUME_COPY` — copies the source into a named volume, runs the build, and
  copies the output back out. Works with a remote docker daemon where bind
  mounts are unavailable. Helper containers and volumes are cleaned up even when
  the build fails.

`VOLUME_COPY` uses a short-lived helper container to seed the input volume and
fix volume ownership. It reuses the build image for this by default, so the
bundler never pulls an image the caller did not specify. If the build image has
no POSIX shell or `chown` (e.g. a `scratch`- or distroless-based image), set
`volumeCopyHelperImage` to any small image that does.

The docker binary can be overridden with the `CDK_DOCKER` environment variable.

## License

Mozilla Public License 2.0
