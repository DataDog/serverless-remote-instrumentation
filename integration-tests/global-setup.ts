import postTestValidations from "./post-test-validation.js";

export default async function setup() {
  return async () => {
    await postTestValidations();
  };
}
