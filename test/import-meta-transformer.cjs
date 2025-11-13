// TODO: Hacky workaround for the esm/commonjs problems with jest
// We implement a Custom transformer to replace import.meta.url then delegate to ts-jest
const tsJest = require("ts-jest").default;

const tsJestTransformer = tsJest.createTransformer({
  tsconfig: {
    module: "commonjs",
    esModuleInterop: true,
  },
});

module.exports = {
  process(sourceText, sourcePath, config) {
    // Replace import.meta.url with __filename before ts-jest processes it
    const transformed = sourceText.replace(
      /import\.meta\.url/g,
      `\`file://\${__filename}\``,
    );
    // Now let ts-jest handle the TypeScript transformation
    return tsJestTransformer.process(transformed, sourcePath, config);
  },
};
