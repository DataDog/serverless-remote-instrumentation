#!/bin/bash

# Unless explicitly stated otherwise all files in this repository are licensed
# under the Apache License Version 2.0.
# This product includes software developed at Datadog (https://www.datadoghq.com/).
# Copyright 2024 Datadog, Inc.

# This script is only tested on MacBook Pro M1
TMP_DIR=nodejs

rm -rf node_modules
rm -rf scripts/.layers
yarn install
mkdir -p scripts/.layers
mkdir -p $TMP_DIR
cp -r node_modules $TMP_DIR/
cp handler.js $TMP_DIR/hander.js
zip -r scripts/.layers/datadog_serverless_remote_instrumentation_arm64.zip $TMP_DIR
rm -rf $TMP_DIR
