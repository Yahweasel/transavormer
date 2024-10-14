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
        }, {
            file: "dist/transavormer.mjs",
            format: "es"
        }, {
            file: "dist/transavormer.min.mjs",
            format: "es",
            plugins: [terser()]
        }
    ],
    plugins: [typescript({
        compilerOptions: {
            module: "esnext"
        }
    })]
};
