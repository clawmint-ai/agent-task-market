# Sandbox image for running untrusted submitted code during verification.
#
# Why a custom image: verification runs both JS (`node test.js`) and Python
# (`python3 -m pytest`). The default node:20-bookworm-slim has Node but NO
# python3/pytest, and DockerSandbox runs containers with --network=none, so we
# cannot `pip install` at run time. Both runtimes + pytest must be baked in.
#
# pytest is installed via apt (python3-pytest) rather than pip to avoid needing
# network/pip at build time on the constrained EC2 box and to get a distro-pinned
# build. The container is run with no network, dropped caps, ro rootfs, and
# cpu/mem/pids limits by DockerSandbox (see backend/src/runtime/sandbox.ts).
FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pytest \
    && rm -rf /var/lib/apt/lists/*

# Sanity-check both runners exist at build time so a broken image fails the
# build, not silently at verification time (which would route to manual fallback).
RUN node --version && python3 --version && python3 -m pytest --version

# No CMD: DockerSandbox always passes an explicit cmd (node / python3 ...).
