import postTestValidations from "./post-test-validation.js";
export default function setup() {
  return async () => {
    await postTestValidations();
  };
}
