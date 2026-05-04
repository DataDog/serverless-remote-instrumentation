import postTestValidations from "./post-test-validation.js";
import {
  getAllRemoteConfigs,
  deleteRemoteConfig,
} from "./utilities/remote-config.js";
import { account } from "./config.json";

// Best-effort delete of configs that don't belong to our AWS account.
// Handles leftover configs from other sources (e.g. synthetics tests with a
// different account) that share the same Datadog org and would cause POST to
// fail with 409. Configs scoped to our account are left alone -- they'll be
// cleaned up by the per-suite clearRemoteConfigs calls.
const clearForeignRemoteConfigs = async (): Promise<void> => {
  const configs = await getAllRemoteConfigs();
  const foreign = configs.data.filter((item: any) => {
    const scopes: any[] = item.meta?.scopes ?? [];
    return !scopes.some((s: any) => s.aws_account_id === account);
  });
  await Promise.allSettled(
    foreign.map((item: any) => deleteRemoteConfig(item.id)),
  );
};

export default async function setup() {
  await clearForeignRemoteConfigs();
  return async () => {
    await postTestValidations();
  };
}
