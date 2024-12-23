const { getExtensionAndRuntimeLayerVersion } = require("../src/instrument");

describe("getExtensionAndRuntimeLayerVersion", () => {
  it("should return the layer and runtime version for node", () => {
    const runtime = "nodejs12.x";
    const config = {
      extensionVersion: 1,
      nodeLayerVersion: 2,
      pythonLayerVersion: 3,
    };
    const expected = {
      runtimeLayerVersion: 2,
      extensionVersion: 1,
    };
    const actual = getExtensionAndRuntimeLayerVersion(runtime, config);
    expect(actual).toEqual(expected);
  });
  it("should return the layer and runtime version for python", () => {
    const runtime = "python3.10";
    const config = {
      extensionVersion: 1,
      nodeLayerVersion: 2,
      pythonLayerVersion: 3,
    };
    const expected = {
      runtimeLayerVersion: 3,
      extensionVersion: 1,
    };
    const actual = getExtensionAndRuntimeLayerVersion(runtime, config);
    expect(actual).toEqual(expected);
  });
  it("should return an undefined runtime layer version for an unsupported runtime", () => {
    const runtime = "go1.x";
    const config = {
      extensionVersion: 1,
      nodeLayerVersion: 2,
      pythonLayerVersion: 3,
    };
    const expected = {
      runtimeLayerVersion: undefined,
      extensionVersion: 1,
    };
    const actual = getExtensionAndRuntimeLayerVersion(runtime, config);
    expect(actual).toEqual(expected);
  });
});
