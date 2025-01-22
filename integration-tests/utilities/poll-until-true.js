const sleep = async (ms) => new Promise((res) => setTimeout(res, ms));

// This function will call functionToCheck every interval ms
// until the timeout (in ms), and return once it is true
const pollUntilTrue = async (timeout, interval, functionToCheck) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    await sleep(interval);
    const result = await functionToCheck();
    if (result) {
      return true;
    }
  }
  return false;
};

exports.pollUntilTrue = pollUntilTrue;
