import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

export default {
    input: "src/main.ts",
    output: [
        {
            file: "dist/transavormer.js",
            format: "umd",
            name: "TransAVormer"
        }, {
            file: "dist/transavormer.min.js",
            format: "umd",
            name: "TransAVormer",
            plugins: [terser()]
        }
    ],
    plugins: [typescript()]
};
