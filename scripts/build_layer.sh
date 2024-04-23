#!/bin/bash

# Unless explicitly stated otherwise all files in this repository are licensed
# under the Apache License Version 2.0.
# This product includes software developed at Datadog (https://www.datadoghq.com/).
# Copyright 2024 Datadog, Inc.

# This script is only tested on MacBook Pro M1
# nodejs is the designated directory specified in Lambda documentation

rm -rf node_modules
rm -rf scripts/.layers
yarn install
mkdir -p scripts/.layers
mkdir -p nodejs
cp -r node_modules nodejs/
mkdir -p nodejs/node_modules/datadog-remote-instrument
#echo '{"version": "1.0.0","dependencies": {},"name":"datadog-remote-instrument","main": "handler.js"}' >> nodejs/node_modules/datadog-remote-instrument/package.json
# need to put handler into node_modules/ as a package
cp handler.js nodejs/node_modules/datadog-remote-instrument/handler.js
zip -r scripts/.layers/datadog_serverless_remote_instrumentation_arm64.zip nodejs
#rm -rf nodejs
