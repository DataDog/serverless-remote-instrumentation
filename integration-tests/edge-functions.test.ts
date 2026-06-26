import { describe, it, expect, afterAll, beforeAll, beforeEach } from "vitest";

import {
  setRemoteConfig,
  clearKnownRemoteConfigs,
  clearRemoteConfigs,
} from "./utilities/remote-config";
import { invokeLambdaWithLambdaManagementEvent } from "./utilities/remote-instrumenter-invocations";
import { getEdgeFunctionName } from "./utilities/aws-resources";
import { region } from "./config.json";

let edgeFunctionName: string;

describe.skipIf(region !== "us-east-1")(
  `Remote instrumenter edge function tests (requires us-east-1, current region: ${region})`,
  () => {
    beforeAll(async () => {
      edgeFunctionName = await getEdgeFunctionName();
      await clearRemoteConfigs();
    });

    afterAll(async () => {
      await clearRemoteConfigs();
    });

    beforeEach(async () => {
      await clearKnownRemoteConfigs();
    });

    it("skips a Lambda@Edge function instead of instrumenting it", async () => {
      await setRemoteConfig({
        ruleFilters: [
          {
            key: "function_name",
            values: [edgeFunctionName],
            filter_type: "function_name",
            allow: true,
          },
        ],
      });

      const { payload, errors } = await invokeLambdaWithLambdaManagementEvent({
        eventName: "CreateFunction20150331",
        targetFunctionName: edgeFunctionName,
      });

      expect(errors).toBeFalsy();
      expect(Object.keys(payload.instrument.skipped)).toContain(
        edgeFunctionName,
      );
      expect(
        payload.instrument.skipped[edgeFunctionName].reasonCode,
      ).toStrictEqual("edge-function");
    });
  },
);
