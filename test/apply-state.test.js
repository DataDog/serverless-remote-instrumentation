const { createApplyStateObject } = require("../src/apply-state");
const { RcConfig } = require("../src/config");
const { RC_PRODUCT, RC_ACKNOWLEDGED, RC_ERROR } = require("../src/consts");
const {
  sampleRcConfigID,
  sampleRcTestJSON,
  sampleRcMetadata,
} = require("./test-utils");

describe("createApplyStateObject", () => {
  test("should create an apply state object with apply error", () => {
    const rcConfig = new RcConfig(
      sampleRcConfigID,
      sampleRcTestJSON,
      sampleRcMetadata,
    );
    const applyStateObject = createApplyStateObject(
      {
        instrument: {
          succeeded: {
            foo: "arn:aws:lambda:us-east-2:123456789:function:foo",
          },
          failed: {},
          skipped: { baz: "arn:aws:lambda:us-east-2:123456789:function:baz" },
        },
        uninstrument: {
          succeeded: {},
          failed: {
            bar: "arn:aws:lambda:us-east-2:123456789:function:bar",
          },
          skipped: {},
        },
      },
      rcConfig,
    );
    expect(applyStateObject).toEqual({
      id: rcConfig.configID,
      product: RC_PRODUCT,
      version: rcConfig.rcConfigVersion,
      apply_state: RC_ERROR,
      apply_error: "Failed to instrument functions: bar",
    });
  });
  test("should create an apply state object with no apply error", () => {
    const rcConfig = new RcConfig(
      sampleRcConfigID,
      sampleRcTestJSON,
      sampleRcMetadata,
    );
    const applyStateObject = createApplyStateObject(
      {
        instrument: {
          succeeded: {
            foo: "arn:aws:lambda:us-east-2:123456789:function:foo",
          },
          failed: {},
          skipped: { baz: "arn:aws:lambda:us-east-2:123456789:function:baz" },
        },
        uninstrument: {
          succeeded: {},
          failed: {},
          skipped: {},
        },
      },
      rcConfig,
    );
    expect(applyStateObject).toEqual({
      id: rcConfig.configID,
      product: RC_PRODUCT,
      version: rcConfig.rcConfigVersion,
      apply_state: RC_ACKNOWLEDGED,
      apply_error: "",
    });
  });
});
