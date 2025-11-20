if (process.env.CI !== undefined) {
  jest.retryTimes(3, {
    logErrorsBeforeRetry: true,
  });
}
