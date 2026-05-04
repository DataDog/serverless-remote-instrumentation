import postTestValidations from "./post-test-validation.js";
import {
  getAllRemoteConfigs,
  deleteRemoteConfig,
} from "./utilities/remote-config.js";

// Best-effort delete of all configs for the org before tests run.
// Handles leftover configs from other sources (e.g. synthetics tests) that
// have different account/region scopes and would cause POST to fail with 409.
const clearAllRemoteConfigs = async (): Promise<void> => {
  let configs;
  try {
    configs = await getAllRemoteConfigs();
  } catch {
    // Server may 500 on empty results -- safe to ignore, nothing to clean up.
    return;
  }
  await Promise.allSettled(
    configs.data.map((item: any) => deleteRemoteConfig(item.id)),
  );
};

export default async function setup() {
  await clearAllRemoteConfigs();
  return async () => {
    await postTestValidations();
  };
}
