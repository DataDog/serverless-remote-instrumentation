function shouldSkipLambdaEvent(event, config) {
  const eventNamesToSkip = new Set([
    "AddPermission20150331",
    "AddPermission20150331v2",
    "DeleteFunction20150331",
    "PublishLayerVersion20181031",
    "RemovePermission20150331",
    "PutFunctionConcurrency20171031",
    "RemovePermission20150331v2",
    "UpdateFunctionCode20150331v2",
  ]);
  if (eventNamesToSkip.has(event.detail?.eventName)) {
    console.log(`${event.detail?.eventName} event is skipped.`);
    return true;
  }
  if (
    event.detail.eventName === "UntagResource20170331v2" ||
    event.detail.eventName === "TagResource20170331v2"
  ) {
    console.log(
      "Skipping (Un)TagResource20170331v2 because it is not implemented yet.",
    );
    return true;
  }
  if (
    event.detail?.requestParameters?.functionName ===
    config.DD_INSTRUMENTER_FUNCTION_NAME
  ) {
    console.log(
      `skipping Lambda event for remote instrumenter ${config.DD_INSTRUMENTER_FUNCTION_NAME}`,
    );
    return true;
  }
  return false;
}

module.exports = shouldSkipLambdaEvent;
