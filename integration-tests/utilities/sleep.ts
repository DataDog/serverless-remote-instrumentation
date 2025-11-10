const sleep = async (ms) => new Promise((res) => setTimeout(res, ms));

exports.sleep = sleep;
