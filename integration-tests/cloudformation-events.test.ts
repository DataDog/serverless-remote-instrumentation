import {
  describe,
  it,
  expect,
  afterAll,
  afterEach,
  beforeEach,
  beforeAll,
} from "vitest";

import { pollUntilTrue } from "./utilities/poll-until-true";
import {
  isFunctionInstrumented,
  isFunctionUninstrumented,
} from "./utilities/is-function-instrumented";
import {
  setRemoteConfig,
  clearKnownRemoteConfigs,
  clearRemoteConfigs,
} from "./utilities/remote-config";
import { sleep } from "./utilities/sleep";
import { doesObjectExist, deleteObject } from "./utilities/s3-helpers";
import {
  createFunction,
  deleteTestFunctions,
} from "./utilities/lambda-functions";
import {
  invokeLambdaWithCFNCreateEvent,
  invokeLambdaWithCFNDeleteEvent,
} from "./utilities/remote-instrumenter-invocations";

describe("Remote instrumenter cloudformation event tests", () => {
  let keysToDelete: string[] = [];

  afterAll(async () => {
    await clearRemoteConfigs();
    await Promise.all(keysToDelete.map((key) => deleteObject(key)));
  });

  afterEach(async () => {
    await deleteTestFunctions();
  });

  beforeEach(async () => {
    await clearKnownRemoteConfigs();
  });

  beforeAll(async () => {
    await clearRemoteConfigs();
  });

  it("uninstruments everything on delete", async () => {
    // When there is a remote config
    await setRemoteConfig();
    // And a lambda is created
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });
    // After some time
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(functionName),
    );

    // The function is instrumented correctly
    expect(isInstrumented).toStrictEqual(true);

    // Wait until the lambda stops being updated
    await sleep(20000);

    // Invoke the remote instrumenter like it would be on stack delete
    const { s3Key } = await invokeLambdaWithCFNDeleteEvent();
    keysToDelete.push(s3Key);

    const didCfnCallbackHappen = await doesObjectExist(s3Key);
    expect(didCfnCallbackHappen).toEqual(true);

    const isUninstrumented = await isFunctionUninstrumented(functionName);
    expect(isUninstrumented).toStrictEqual(true);
  });

  it("instruments functions on stack creation", async () => {
    // When there is a lambda
    const { FunctionName: functionName } = await createFunction({
      Tags: { foo: "bar" },
    });
    // And a remote config that should cause that lambda to be instrumented
    await setRemoteConfig();

    // The remote instrumenter being called like it would be on stack create
    const { s3Key } = await invokeLambdaWithCFNCreateEvent();
    keysToDelete.push(s3Key);

    // Does the CFN callback
    const didCfnCallbackHappen = await doesObjectExist(s3Key);
    expect(didCfnCallbackHappen).toEqual(true);

    // And instruments the lambda
    const isInstrumented = await isFunctionInstrumented(functionName);
    expect(isInstrumented).toStrictEqual(true);
  });
});
