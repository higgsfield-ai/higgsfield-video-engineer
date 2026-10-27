#!/bin/bash
# Runs ON a Runpod pod (Ubuntu 24.04, NVIDIA_DRIVER_CAPABILITIES=all): Node LTS, Google Chrome stable, Vulkan loader,
# rsync. puppeteer-core is pushed separately to /opt/rp/node_modules (by `rp setup`, from the kit's engine/node_modules).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if [ ! -f /opt/rp/.setup_done ]; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends wget ca-certificates gnupg rsync xz-utils libvulkan1 vulkan-tools mesa-vulkan-drivers \
    fonts-liberation libnss3 libatk-bridge2.0-0t64 libgtk-3-0t64 libgbm1 libasound2t64 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 >/dev/null
  if ! command -v google-chrome >/dev/null; then
    # Google's signed apt repository, so apt checks the package signature; set CHROME_VERSION to pin one build
    wget -q -O- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
    apt-get update -qq && apt-get install -y -qq "google-chrome-stable${CHROME_VERSION:+=$CHROME_VERSION}" >/dev/null
  fi
  if ! /opt/node/bin/node --version >/dev/null 2>&1; then
    V=v24.11.1; SHA=60e3b0a8500819514aca603487c254298cd776de0698d3cd08f11dba5b8289a8  # from nodejs.org SHASUMS256.txt
    wget -q -O /tmp/node.tar.xz https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz
    echo "$SHA  /tmp/node.tar.xz" | sha256sum -c --quiet - || { echo "node download checksum mismatch" >&2; exit 1; }
    mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components 1
  fi
  ln -sf /opt/node/bin/node /usr/local/bin/node
  # NVIDIA Vulkan ICD: the container toolkit mounts libGLX_nvidia when capabilities include graphics; make sure the ICD json exists
  if [ ! -f /usr/share/vulkan/icd.d/nvidia_icd.json ] && [ ! -f /etc/vulkan/icd.d/nvidia_icd.json ]; then
    lib=$(ls /usr/lib/x86_64-linux-gnu/libGLX_nvidia.so.0 2>/dev/null || true)
    if [ -n "$lib" ]; then
      mkdir -p /etc/vulkan/icd.d
      printf '{"file_format_version":"1.0.0","ICD":{"library_path":"libGLX_nvidia.so.0","api_version":"1.3"}}\n' > /etc/vulkan/icd.d/nvidia_icd.json
    fi
  fi
  mkdir -p /opt/rp /work && touch /opt/rp/.setup_done
fi
node --version; google-chrome --version
vulkaninfo --summary 2>/dev/null | grep -E "deviceName|driverName|apiVersion" || echo "vulkaninfo: no device"
