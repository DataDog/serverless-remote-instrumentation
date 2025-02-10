const { pollUntilTrue } = require("./utilities/poll-until-true");
const {
  isFunctionInstrumented,
  isFunctionUninstrumented,
} = require("./utilities/is-function-instrumented");
const {
  setRemoteConfig,
  clearRemoteConfigs,
} = require("./utilities/remote-config");
const { namingSeed } = require("./config.json");
const { sleep } = require("./utilities/sleep");
const { doesObjectExist, deleteObject } = require("./utilities/s3-helpers");
const {
  createFunction,
  deleteFunction,
} = require("./utilities/lambda-functions");
const {
  invokeLambdaWithCFNDeleteEvent,
} = require("./utilities/remote-instrumenter-invocations");

describe("Remote instrumenter cloudformation event tests", () => {
  const testFunction = `cloudformationEvents${namingSeed}`;
  let keysToDelete = [];

  afterAll(async () => {
    await deleteFunction(testFunction);
    await clearRemoteConfigs();
    await Promise.all(keysToDelete.map((key) => deleteObject(key)));
  });

  beforeEach(async () => {
    await deleteFunction(testFunction);
    await clearRemoteConfigs();
  });

  it("uninstruments everything on delete", async () => {
    // When there is a remote config
    await setRemoteConfig();
    // And a lambda is created
    await createFunction({
      FunctionName: testFunction,
      Tags: { foo: "bar" },
    });
    // After some time
    const isInstrumented = await pollUntilTrue(60000, 5000, () =>
      isFunctionInstrumented(testFunction),
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

    const isUninstrumented = await isFunctionUninstrumented(testFunction);
    expect(isUninstrumented).toStrictEqual(true);
  });
});
