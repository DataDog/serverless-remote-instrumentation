const { sleep } = require("./sleep");

// This function will call functionToCheck every interval ms
// until the timeout (in ms), and return once it is true
const pollUntilTrue = async (timeout, interval, functionToCheck) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const result = await functionToCheck();
    if (result) {
      return true;
    }
    await sleep(interval);
  }
  return false;
};

exports.pollUntilTrue = pollUntilTrue;
