import { describe, test, expect } from "vitest";

import { createApplyStateObject } from "../src/apply-state";
import { RcConfig } from "../src/config";
import { RC_PRODUCT, RC_ACKNOWLEDGED, RC_ERROR } from "../src/consts";
import {
  sampleRcConfigID,
  sampleRcTestJSON,
  sampleRcMetadata,
} from "./test-utils";

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
            foo: {
              functionArn: "arn:aws:lambda:us-east-2:123456789:function:foo",
            },
          },
          failed: {},
          skipped: {
            baz: {
              functionArn: "arn:aws:lambda:us-east-2:123456789:function:baz",
            },
          },
        },
        uninstrument: {
          succeeded: {},
          failed: {
            bar: {
              functionArn: "arn:aws:lambda:us-east-2:123456789:function:bar",
            },
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
            foo: {
              functionArn: "arn:aws:lambda:us-east-2:123456789:function:foo",
            },
          },
          failed: {},
          skipped: {
            baz: {
              functionArn: "arn:aws:lambda:us-east-2:123456789:function:baz",
            },
          },
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
