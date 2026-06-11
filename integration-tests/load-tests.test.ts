import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { pollUntilTrue } from "./utilities/poll-until-true";
import { isFunctionInstrumented } from "./utilities/is-function-instrumented";
import {
  setRemoteConfig,
  clearRemoteConfigs,
  clearKnownRemoteConfigs,
} from "./utilities/remote-config";
import {
  createFunctions,
  deleteTestFunctions,
} from "./utilities/lambda-functions";

const RUN_LOAD_TESTS = process.env.RUN_LOAD_TESTS === "true";

describe.skipIf(!RUN_LOAD_TESTS)("Remote instrumenter load tests", () => {
  beforeAll(async () => {
    await clearRemoteConfigs();
  }, 300_000);

  afterAll(async () => {
    await deleteTestFunctions();
    await clearKnownRemoteConfigs();
  }, 300_000);

  it("can handle many lambda management events", async () => {
    await setRemoteConfig();

    const NUM_FUNCTIONS = 100;
    const functions = await createFunctions(
      { Tags: { foo: "bar" } },
      NUM_FUNCTIONS,
    );
    const functionNames = functions.map((f) => f.FunctionName);

    const results = await Promise.all(
      functionNames.map((functionName) =>
        pollUntilTrue(1200000, 5000, () =>
          isFunctionInstrumented(functionName),
        ),
      ),
    );

    const allInstrumented = results.every(Boolean);
    expect(allInstrumented).toStrictEqual(true);
  }, 1200_000);
});
