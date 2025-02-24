#!/bin/bash

# Unless explicitly stated otherwise all files in this repository are licensed
# under the Apache License Version 2.0.
# This product includes software developed at Datadog (https://www.datadoghq.com/).
# Copyright 2025 Datadog, Inc.

# From repo root, execute the script with `VERSION=<DESIRED_VERSION> ./scripts/publish_prod.sh`

set -e

# Ensure the target version is defined
if [ -z "$VERSION" ]; then
    echo "New layer version not specified"
    echo ""
    echo "EXITING SCRIPT."
    exit 1
fi

if [ -z $ARCHITECTURE ]; then
    echo "No architecture specified, defaulting to arm64"
    ARCHITECTURE="arm64"
fi

# Move into the root directory
SCRIPTS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $SCRIPTS_DIR/..

VERSION=$VERSION ARCHITECTURE=$ARCHITECTURE ./scripts/build_layer.sh

# Signing layer
./scripts/sign_layers.sh prod

# Publish layer
./scripts/publish_layers.sh
