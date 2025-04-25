const { pollUntilTrue } = require("./utilities/poll-until-true");
const {
  isFunctionInstrumented,
  isFunctionUninstrumented,
} = require("./utilities/is-function-instrumented");
const {
  setRemoteConfig,
  clearKnownRemoteConfigs,
  clearRemoteConfigs,
} = require("./utilities/remote-config");
const { sleep } = require("./utilities/sleep");
const { doesObjectExist, deleteObject } = require("./utilities/s3-helpers");
const {
  createFunction,
  deleteTestFunctions,
} = require("./utilities/lambda-functions");
const {
  invokeLambdaWithCFNCreateEvent,
  invokeLambdaWithCFNDeleteEvent,
} = require("./utilities/remote-instrumenter-invocations");

describe("Remote instrumenter cloudformation event tests", () => {
  let keysToDelete = [];

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

    // Wait for the instrumenter's cache to become invalid
    await sleep(6000);

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
