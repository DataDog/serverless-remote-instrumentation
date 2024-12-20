const {
  isScheduledInvocationEvent,
  isStackDeletedEvent,
  isStackCreatedEvent,
  isLambdaManagementEvent,
  isUpdateConfigurationEvent,
  isCreateFunctionEvent,
  isTagResourceEvent,
  isUntagResourceEvent,
  shouldSkipEvent,
} = require("../src/lambda-event");

describe("isScheduledInvocationEvent", () => {
  it("should return true if the event is a scheduled invocation event", () => {
    const event = {
      "event-type": "Scheduled Instrumenter Invocation",
    };
    expect(isScheduledInvocationEvent(event)).toBe(true);
  });
  it("should return false if the event is not a scheduled invocation event", () => {
    const event = {
      "event-type": "Not a scheduled invocation event",
    };
    expect(isScheduledInvocationEvent(event)).toBe(false);
  });
  it("should return false if the event-type property is unset", () => {
    const event = {};
    expect(isScheduledInvocationEvent(event)).toBe(false);
  });
});

describe("isStackDeletedEvent", () => {
  it("should return true if the event is a stack deleted event", () => {
    const event = {
      RequestType: "Delete",
    };
    expect(isStackDeletedEvent(event)).toBe(true);
  });
  it("should return false if the event is not a stack deleted event", () => {
    const event = {
      RequestType: "Not a stack deleted event",
    };
    expect(isStackDeletedEvent(event)).toBe(false);
  });
  it("should return false if the RequestType property is unset", () => {
    const event = {};
    expect(isStackDeletedEvent(event)).toBe(false);
  });
});

describe("isStackCreatedEvent", () => {
  it("should return true if the event is a stack created event", () => {
    const event = {
      RequestType: "Create",
    };
    expect(isStackCreatedEvent(event)).toBe(true);
  });
  it("should return false if the event is not a stack created event", () => {
    const event = {
      RequestType: "Not a stack created event",
    };
    expect(isStackCreatedEvent(event)).toBe(false);
  });
  it("should return false if the RequestType property is unset", () => {
    const event = {};
    expect(isStackCreatedEvent(event)).toBe(false);
  });
});

describe("isLambdaManagementEvent", () => {
  it("should return true if the event is a lambda management event", () => {
    const event = {
      "detail-type": "AWS API Call via CloudTrail",
      source: "aws.lambda",
    };
    expect(isLambdaManagementEvent(event)).toBe(true);
  });
  it("should return false if the event has the wrong detail-type", () => {
    const event = {
      "detail-type": "Not a lambda management event",
      source: "aws.lambda",
    };
    expect(isLambdaManagementEvent(event)).toBe(false);
  });
  it("should return false if the event has the wrong source", () => {
    const event = {
      "detail-type": "AWS API Call via CloudTrail",
      source: "Not aws.lambda",
    };
    expect(isLambdaManagementEvent(event)).toBe(false);
  });
  it("should return false if the detail-type property is unset", () => {
    const event = {
      source: "aws.lambda",
    };
    expect(isLambdaManagementEvent(event)).toBe(false);
  });
  it("should return false if the source property is unset", () => {
    const event = {
      "detail-type": "AWS API Call via CloudTrail",
    };
    expect(isLambdaManagementEvent(event)).toBe(false);
  });
});

describe("isUpdateConfigurationEvent", () => {
  it("should return true if the event is an update configuration event", () => {
    const event = {
      detail: {
        eventName: "UpdateFunctionConfiguration20150331v2",
      },
    };
    expect(isUpdateConfigurationEvent(event)).toBe(true);
  });
  it("should return false if the event is not an update configuration event", () => {
    const event = {
      detail: {
        eventName: "Not an update configuration event",
      },
    };
    expect(isUpdateConfigurationEvent(event)).toBe(false);
  });
});

describe("isCreateFunctionEvent", () => {
  it("should return true if the event is a create function event", () => {
    const event = {
      detail: {
        eventName: "CreateFunction20150331",
      },
    };
    expect(isCreateFunctionEvent(event)).toBe(true);
  });
  it("should return false if the event is not a create function event", () => {
    const event = {
      detail: {
        eventName: "Not a create function event",
      },
    };
    expect(isCreateFunctionEvent(event)).toBe(false);
  });
});

describe("isTagResourceEvent", () => {
  it("should return true if the event is a tag resource event", () => {
    const event = {
      detail: {
        eventName: "TagResource20170331v2",
      },
    };
    expect(isTagResourceEvent(event)).toBe(true);
  });
  it("should return false if the event is not a tag resource event", () => {
    const event = {
      detail: {
        eventName: "Not a tag resource event",
      },
    };
    expect(isTagResourceEvent(event)).toBe(false);
  });
});

describe("isUntagResourceEvent", () => {
  it("should return true if the event is an untag resource event", () => {
    const event = {
      detail: {
        eventName: "UntagResource20170331v2",
      },
    };
    expect(isUntagResourceEvent(event)).toBe(true);
  });
  it("should return false if the event is not an untag resource event", () => {
    const event = {
      detail: {
        eventName: "Not an untag resource event",
      },
    };
    expect(isUntagResourceEvent(event)).toBe(false);
  });
});

describe("shouldSkipEvent", () => {
  it("should return true if the event is for the remote instrumenter itself", () => {
    const event = {
      detail: {
        requestParameters: {
          functionName: "instrumenter-function-name",
        },
      },
    };
    process.env.DD_INSTRUMENTER_FUNCTION_NAME = "instrumenter-function-name";
    expect(shouldSkipEvent(event)).toBe(true);
  });
  it("should return true for unsupported events", () => {
    const event = {
      detail: {
        eventName: "UnsupportedEvent",
      },
    };
    expect(shouldSkipEvent(event)).toBe(true);
  });
  it("should return false for update function configuration events", () => {
    const event = {
      detail: {
        eventName: "UpdateFunctionConfiguration20150331v2",
      },
    };
    expect(shouldSkipEvent(event)).toBe(false);
  });
  it("should return false for create function events", () => {
    const event = {
      detail: {
        eventName: "CreateFunction20150331",
      },
    };
    expect(shouldSkipEvent(event)).toBe(false);
  });
  it("should return false for tag resource events", () => {
    const event = {
      detail: {
        eventName: "TagResource20170331v2",
      },
    };
    expect(shouldSkipEvent(event)).toBe(false);
  });
  it("should return false for untag resource events", () => {
    const event = {
      detail: {
        eventName: "UntagResource20170331v2",
      },
    };
    expect(shouldSkipEvent(event)).toBe(false);
  });
});
