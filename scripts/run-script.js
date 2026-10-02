const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("ts-node").register({
  compilerOptions: {
    module: "CommonJS",
  },
});
require("tsconfig-paths").register({
  baseUrl: path.resolve(__dirname, ".."),
  paths: {
    "@/*": ["src/*"],
  },
});

const scriptToRun = process.argv[2];
if (!scriptToRun) {
  console.error("Please provide a script path to run.");
  process.exit(1);
}

require(path.resolve(process.cwd(), scriptToRun));
